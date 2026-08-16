"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/cbl-web-tool/blob/main/LICENSE.md
"""

import gzip
import json
import json.scanner
import logging
import os
import sys
import time
import traceback
import warnings
from collections import OrderedDict
from typing import Any

import geopandas as gpd
import mercantile
import numpy as np
from building_data_utilities.common import Location
from building_data_utilities.geocode_addresses import geocode_addresses
from building_data_utilities.normalize_address import normalize_address
from building_data_utilities.ubid import encode_ubid
from building_data_utilities.update_dataset_links import update_dataset_links
from building_data_utilities.update_quadkeys import update_quadkeys
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from shapely.geometry import Point

import flask_app.config as config
from flask_app.osm_location import get_location_bbox
from flask_app.services.common_service import (
    create_geojson_response,
    handle_service_exceptions,
    log_error_with_context,
    parse_polygon_from_request,
    validate_request_data,
)
from flask_app.services.data_transformation_service import DataTransformationService
from flask_app.services.file_processing_service import FileProcessingService
from flask_app.services.footprint_service import FootprintService
from flask_app.services.geocoding_service import GeocodingService


class NumpyEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles NumPy data types."""

    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, np.bool_):
            return bool(obj)
        return super().default(obj)


warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", category=UserWarning)

app = Flask(__name__)
CORS(app)
load_dotenv()

# Initialize services
footprint_service = FootprintService()
geocoding_service = GeocodingService()
file_processing_service = FileProcessingService()
data_transformation_service = DataTransformationService()

# Configure detailed logging
logging.basicConfig(level=logging.DEBUG, format="[%(asctime)s] %(levelname)s in %(module)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

# Configure Flask app logging
app.logger.setLevel(logging.DEBUG)
app.config["DEBUG"] = True

if not app.logger.handlers:
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s")
    stream_handler.setFormatter(formatter)
    app.logger.addHandler(stream_handler)

api_key = ""


@app.errorhandler(Exception)
def handle_exception(e):
    """Global error handler to catch and log all exceptions"""
    app.logger.error("=" * 50)
    app.logger.error(f"UNHANDLED EXCEPTION: {e!s}")
    app.logger.error(f"Exception type: {type(e).__name__}")
    app.logger.error(f"Traceback: {traceback.format_exc()}")
    app.logger.error("=" * 50)

    # Also print to console for visibility
    print("=" * 50)
    print(f"UNHANDLED EXCEPTION: {e!s}")
    print(f"Exception type: {type(e).__name__}")
    print(f"Traceback: {traceback.format_exc()}")
    print("=" * 50)

    # Return JSON error response
    return jsonify({"error": True, "message": f"Internal server error: {e!s}", "type": type(e).__name__}), 500


@app.errorhandler(400)
def handle_bad_request(e):
    """Handle 400 Bad Request errors"""
    app.logger.error(f"Bad Request (400): {e!s}")
    print(f"Bad Request (400): {e!s}")
    return jsonify({"error": True, "message": "Bad Request", "details": str(e)}), 400


@app.errorhandler(404)
def handle_not_found(e):
    """Handle 404 Not Found errors"""
    app.logger.error(f"Not Found (404): {e!s}")
    print(f"Not Found (404): {e!s}")
    return jsonify({"error": True, "message": "Endpoint not found", "details": str(e)}), 404


@app.errorhandler(500)
def handle_internal_error(e):
    """Handle 500 Internal Server errors"""
    app.logger.error(f"Internal Server Error (500): {e!s}")
    print(f"Internal Server Error (500): {e!s}")
    return jsonify({"error": True, "message": "Internal server error", "details": str(e)}), 500


@app.route("/api/submit_file", methods=["POST"])
def submit_file():
    """
    Read uploaded file(s), confirm file names are different, confirm file names the same, return user data.

    This function is called with the "Get Started" button on the homepage is clicked and when edited data is saved.
    In Angular, sendInitialData() and sendData()
    """
    app.logger.info("function: submit_file")

    files = request.files.getlist("userFiles[]")
    input_dict = OrderedDict()  # will this order be maintained when sending JSON back and forth to the front end?

    for file in files:
        if file.filename in input_dict:
            return jsonify({"message": "Uploaded two files with the same filename. Please upload non-duplicate files."}), 400

        file_data, error_message = file_processing_service.process_uploaded_file(file)
        if error_message:
            return jsonify({"message": error_message}), 400

        if not file_data or len(file_data) == 0:
            return jsonify({"message": "Uploaded a file in the wrong format. Please upload different format"}), 400

        input_dict[file.filename] = file_data

    input_json_str = json.dumps(input_dict)
    return jsonify({"message": "success", "user_data": input_json_str}), 200


@app.route("/api/check_data", methods=["POST"])
def check_data():
    """
    Check that request has the required column names Street_Address, City, and State
    """
    app.logger.info("function: check_data")

    if not request.json or "value" not in request.json:
        return jsonify({"message": "Missing 'value' in request body"}), 400
    json_string = request.json.get("value")
    file_data = json.loads(json_string)
    json_data = json.dumps(file_data)

    # is_good_data = True  # check_data_quality(file_data)
    # TODO: implement check_data_quality

    return jsonify({"message": "success", "user_data": json_data}), 200


def _rows_to_geojson_response(file_data: list[dict], data: list[dict[str, Any]]) -> dict:
    """
    Merge original uploaded row data with per-row geocode/coordinate results and convert to a
    GeoJSON FeatureCollection string, in the same shape the frontend (CBL Table) expects.
    """
    poor_quality_codes = ["Ambiguous", "No results found", "Less Than 0.90 Confidence"]

    merged_data = []
    for i in range(len(data)):
        file_dict = file_data[i]
        data_dict = data[i]

        if data_dict.get("quality") in poor_quality_codes:
            data_dict["quality"] = "Poor"
        elif data_dict.get("quality") is not None:
            data_dict["quality"] = "Good"

        merged_dict = data_transformation_service.merge_dicts(file_dict, data_dict)
        merged_data.append(merged_dict)

    columns = ["street_address", "city", "state"]
    for key in merged_data[0]:
        if key.lower() not in columns:
            columns.append(key)

    gdf = gpd.GeoDataFrame(data=merged_data, columns=columns)
    return file_processing_service.geodataframe_to_json(gdf)


@app.route("/api/build_initial_geojson", methods=["POST"])
def build_initial_geojson():
    """
    Build the initial GeoJSON for the CBL Table directly from the uploaded/validated rows,
    WITHOUT calling any geocoding service or matching footprints. Rows that already contain a
    valid latitude/longitude get that point; rows without one are placed at (0, 0) with
    "quality": "Not geocoded", to be resolved later via the "Geocode Addresses" button.

    This lets the Data Validation Table's "Continue to Map" action be fast and side-effect-free
    (no Amazon API calls, no footprint downloads) -- geocoding and footprint matching are
    explicit, separate steps the user triggers from the CBL Table.
    """
    app.logger.info("function: build_initial_geojson")

    try:
        json_string = request.json.get("value")
        file_data = json.loads(json_string)
    except ValueError:
        return jsonify({"message": "Something went wrong while reading the edited json"}), 400

    if not file_data:
        return jsonify({"message": "No data provided"}), 400

    locations = data_transformation_service.generate_locations_list(file_data)
    for loc in locations:
        loc["street"] = normalize_address(loc["street"])

    data: list[dict[str, Any]] = []
    for i, record in enumerate(file_data):
        coords = data_transformation_service.extract_coordinates(record)
        if coords is not None:
            latitude, longitude = coords
            datum = data_transformation_service.build_provided_coordinate_datum(record, locations[i], latitude, longitude)
            datum["geometry"] = Point(longitude, latitude)
            datum["ubid"] = None
            data.append(datum)
        else:
            data.append(
                {
                    "quality": "Not geocoded",
                    "address": locations[i]["street"],
                    "city": locations[i]["city"],
                    "state": locations[i]["state"],
                    "postal_code": None,
                    "country": None,
                    "latitude": 0,
                    "longitude": 0,
                    "geometry": None,
                    "ubid": None,
                }
            )

    final_geojson = _rows_to_geojson_response(file_data, data)
    return jsonify({"message": "success", "user_data": final_geojson}), 200


@app.route("/api/geocode_missing_addresses", methods=["POST"])
def geocode_missing_addresses():
    """
    Runs when the user clicks "Geocode Addresses" on the CBL Table. Geocodes (via Amazon
    Location Services) only the currently-selected buildings that don't already have a valid
    latitude/longitude (quality == "Not geocoded" or address-based rows), leaving buildings
    that already have coordinates untouched.

    Expected request body: {"value": "<json string of GeoJSON feature properties list>"}
    Each item should include the address fields (street_address/city/state/postal_code/country)
    and an "id" the frontend can use to reapply the result to the right row.

    Response: {"message": "success", "results": [{"id": ..., quality, latitude, longitude, ...}]}
    """
    app.logger.info("function: geocode_missing_addresses")

    try:
        json_string = request.json.get("value")
        rows = json.loads(json_string)
    except ValueError:
        return jsonify({"message": "Something went wrong while reading the edited json"}), 400

    if not rows:
        return jsonify({"message": "No rows provided"}), 400

    locations = data_transformation_service.generate_locations_list(rows)
    for loc in locations:
        loc["street"] = normalize_address(loc["street"])

    AMAZON_API_KEY = os.getenv("AMAZON_API_KEY")
    AMAZON_BASE_URL = os.getenv("AMAZON_BASE_URL") or "https://places.geo.us-east-2.api.aws/v2"
    AMAZON_APP_ID = os.getenv("AMAZON_APP_ID")

    if not AMAZON_API_KEY:
        app.logger.warning("Missing Amazon API key")

    try:
        geocoded_results = geocode_addresses(locations, AMAZON_API_KEY, AMAZON_BASE_URL, AMAZON_APP_ID)
    except Exception as e:
        app.logger.warning(f"Geocoding failed for {len(locations)} row(s): {e}")
        return (
            jsonify(
                {
                    "message": (
                        f"Geocoding failed for {len(locations)} building(s) (Amazon Location Services API key "
                        f"is missing, invalid, or at its limit): {e}"
                    )
                }
            ),
            400,
        )

    poor_quality_codes = ["Ambiguous", "No results found", "Less Than 0.90 Confidence"]
    results = []
    for row, geocoded_result in zip(rows, geocoded_results):
        result = dict(geocoded_result)
        result["id"] = row.get("id")
        result["quality"] = "Poor" if result.get("quality") in poor_quality_codes else "Geocoded"
        results.append(result)

    return jsonify({"message": "success", "results": results}), 200


@app.route("/api/match_footprints", methods=["POST"])
def match_footprints():
    """
    Runs when the user clicks "Match Footprints" on the CBL Table. Matches the currently-selected
    (already-geocoded) buildings against Microsoft footprint data, batched per MS quadkey tile
    so tiles are only loaded/read once and spatial-joined against all of their points in a
    single vectorized operation (rather than one join per building).

    Expected request body: {"value": "<json string of rows>"}, each row a dict with "id",
    "latitude", and "longitude".

    Response: {"message": "success", "results": [{"id", "geometry", "height", "ubid",
    "footprint_match"}]}. Rows whose quadkey tile is unavailable, or with no candidate
    footprints nearby, are omitted from the results.
    """
    app.logger.info("function: match_footprints")

    try:
        json_string = request.json.get("value")
        rows = json.loads(json_string)
    except ValueError:
        return jsonify({"message": "Something went wrong while reading the edited json"}), 400

    if not rows:
        return jsonify({"message": "No rows provided"}), 400

    points = []
    for row in rows:
        try:
            latitude = float(row["latitude"])
            longitude = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if latitude == 0 and longitude == 0:
            continue
        points.append({"index": row.get("id"), "latitude": latitude, "longitude": longitude})

    if not points:
        return jsonify({"message": "success", "results": []}), 200

    quadkeys = set()
    for p in points:
        tile = mercantile.tile(p["longitude"], p["latitude"], 9)
        quadkeys.add(int(mercantile.quadkey(tile)))

    update_dataset_links()
    update_quadkeys(list(quadkeys))

    matches = footprint_service.match_points_to_ms_footprints(points)

    results = []
    for point_index, match in matches.items():
        results.append(
            {
                "id": point_index,
                "geometry": json.loads(gpd.GeoSeries([match["geometry"]]).to_json())["features"][0]["geometry"],
                "height": match["height"],
                "ubid": match["ubid"],
                "footprint_match": match["footprint_match"],
            }
        )

    return jsonify({"message": "success", "results": results}), 200


@app.route("/api/generate_cbl", methods=["POST"])
def generate_cbl():
    """
    Runs when user clicks "Generate CBL" button.
    """
    app.logger.info("function: generate_cbl")

    file_data = []
    locations: list[Location] = []

    try:
        json_string = request.json.get("value")
        file_data = json.loads(json_string)
    except ValueError:
        return jsonify({"message": "Something went wrong while reading the edited json"}), 400

    locations = data_transformation_service.generate_locations_list(file_data)

    for loc in locations:
        loc["street"] = normalize_address(loc["street"])

    # Rows that already include a valid latitude/longitude can skip geocoding entirely and go
    # straight to footprint matching below, preserving their original (often more accurate)
    # coordinates instead of having them overwritten by the geocoding service.
    provided_coordinates = [data_transformation_service.extract_coordinates(record) for record in file_data]
    geocode_indices = [i for i, coords in enumerate(provided_coordinates) if coords is None]

    data: list[dict[str, Any]] = [{} for _ in file_data]
    geocoding_warning: str | None = None

    if geocode_indices:
        AMAZON_API_KEY = os.getenv("AMAZON_API_KEY")
        AMAZON_BASE_URL = os.getenv("AMAZON_BASE_URL")
        AMAZON_APP_ID = os.getenv("AMAZON_APP_ID")

        if not AMAZON_API_KEY:
            app.logger.warning("Missing Amazon API key")

        if not AMAZON_BASE_URL:
            app.logger.warning("Missing Amazon base URL. Using default: https://places.geo.us-east-2.api.aws/v2")
            AMAZON_BASE_URL = "https://places.geo.us-east-2.api.aws/v2"

        locations_to_geocode = [locations[i] for i in geocode_indices]

        try:
            geocoded_results = geocode_addresses(locations_to_geocode, AMAZON_API_KEY, AMAZON_BASE_URL, AMAZON_APP_ID)
        except Exception as e:
            # Don't fail the whole batch just because the rows missing latitude/longitude
            # couldn't be geocoded (e.g. no/invalid Amazon API key). Mark only those rows as
            # "Ambiguous" (same as a low-confidence geocode result) so rows that already had
            # valid provided coordinates still get processed successfully below.
            app.logger.warning(f"Geocoding failed for {len(locations_to_geocode)} row(s) missing coordinates: {e}")
            geocoded_results = [{"quality": "Ambiguous"} for _ in locations_to_geocode]
            geocoding_warning = (
                f"{len(locations_to_geocode)} building(s) were missing latitude/longitude and could not be "
                "geocoded (Amazon Location Services API key is missing, invalid, or at its limit). They were "
                "marked as 'Poor' quality; add a valid API key or provide coordinates manually to resolve them."
            )

        for i, result in zip(geocode_indices, geocoded_results):
            data[i] = result

    for i, coords in enumerate(provided_coordinates):
        if coords is not None:
            latitude, longitude = coords
            data[i] = data_transformation_service.build_provided_coordinate_datum(file_data[i], locations[i], latitude, longitude)

    poor_quality_codes = ["Ambiguous", "No results found", "Less Than 0.90 Confidence"]

    # Find all quadkeys that the coordinates fall within
    # TODO: this is redundant with the quadkey generation in the download_ms_footprints function, resolve
    quadkeys = set()
    for datum in data:
        if datum["quality"] not in poor_quality_codes:  # todo: check that "longitude" field is present
            tile = mercantile.tile(datum["longitude"], datum["latitude"], 9)
            quadkey = int(mercantile.quadkey(tile))
            quadkeys.add(quadkey)
            datum["quadkey"] = quadkey

    # Download quadkey dataset links
    update_dataset_links()

    # Download quadkeys
    update_quadkeys(list(quadkeys))

    loaded_quadkeys: dict[int, Any] = {}
    index = 0
    for datum in data:
        if datum["quality"] not in poor_quality_codes:
            quadkey = datum["quadkey"]
            if quadkey not in loaded_quadkeys:
                app.logger.info(f"Loading quadkey: {quadkey}")

                with gzip.open(config.ms_footprint_dir / f"{quadkey}.geojsonl.gz", "rb") as f:
                    loaded_quadkeys[quadkey] = gpd.read_file(f)
                    app.logger.info(f"  {len(loaded_quadkeys[quadkey])} footprints in quadkey")

            geojson = loaded_quadkeys[quadkey]
            point = Point(datum["longitude"], datum["latitude"])
            point_gdf = gpd.GeoDataFrame(crs="epsg:4326", geometry=[point])

            # intersections have `geometry`, `index_right`, and `height`
            intersections = gpd.sjoin(point_gdf, geojson)
            if len(intersections) >= 1:
                footprint = geojson.iloc[intersections.iloc[0].index_right]
                datum["footprint_match"] = "intersection"
            else:
                footprint = geojson.iloc[geojson.distance(point).sort_values().index[0]]
                datum["footprint_match"] = "closest"
            datum["geometry"] = footprint.geometry
            datum["height"] = footprint.height if footprint.height != -1 else None

            # Determine UBIDs from footprints
            datum["ubid"] = encode_ubid(datum["geometry"])
        else:
            datum["address"] = normalize_address(locations[index]["street"])
            datum["city"] = locations[index]["city"]
            datum["state"] = locations[index]["state"]
            datum["postal_code"] = None
            datum["county"] = None
            datum["country"] = None
            datum["latitude"] = 0
            datum["longitude"] = 0
            datum["quality"] = "Ambiguous"
            datum["geometry"] = None
            datum["ubid"] = 0
        index = index + 1

    # since the data dict contains information only from Amazon, need to merge original
    # dict and the data dict to display all information
    merged_data = []
    for i in range(len(data)):
        file_dict = file_data[i]
        data_dict = data[i]

        if data_dict["quality"] in poor_quality_codes:
            data_dict["quality"] = "Poor"
        else:
            data_dict["quality"] = "Good"

        merged_dict = data_transformation_service.merge_dicts(file_dict, data_dict)
        merged_data.append(merged_dict)

    columns = ["street_address", "city", "state"]
    for key in merged_data[0]:
        if key.lower() not in columns:
            columns.append(key)

    # Convert covered building list as GeoJSON
    gdf = gpd.GeoDataFrame(data=merged_data, columns=columns)
    final_geojson = file_processing_service.geodataframe_to_json(gdf)

    response_payload = {"message": "success", "user_data": final_geojson}
    if geocoding_warning:
        response_payload["warning"] = geocoding_warning

    return jsonify(response_payload), 200


# Endpoint to get bounding box for a location name using osmnx
@app.route("/api/location_bbox", methods=["POST"])
def location_bbbou():
    data = request.get_json()
    location_name = data.get("location")
    if not location_name:
        return jsonify({"error": True, "message": "Missing location name"}), 400
    bbox_geojson = get_location_bbox(location_name)
    if bbox_geojson is None:
        return jsonify({"error": True, "message": f"Could not find location: {location_name}"}), 404
    return jsonify({"bbox": bbox_geojson, "message": "success"})


@app.route("/api/merge_footprints", methods=["POST"])
def merge_footprints():
    """
    Merge two sets of building footprints (GeoJSON) and return the merged result.
    Expects JSON with keys 'geojson_1' and 'geojson_2'.
    """
    app.logger.info("function: merge_footprints")

    try:
        app.logger.info("Getting JSON data from request")
        data = request.get_json()

        if data is None:
            app.logger.error("No JSON data received")
            return jsonify({"error": True, "message": "No JSON data received"}), 400

        app.logger.info(f"Received data keys: {list(data.keys()) if data else 'None'}")
        app.logger.info(f"Request content type: {request.content_type}")
        app.logger.info(f"Request data size: {len(request.data) if request.data else 0} bytes")

        geojson_1 = data.get("geojson_1")
        geojson_2 = data.get("geojson_2")

        app.logger.info(
            f"geojson_1 type: {type(geojson_1)}, has features: {geojson_1 is not None and 'features' in geojson_1 if geojson_1 else False}"
        )
        app.logger.info(
            f"geojson_2 type: {type(geojson_2)}, has features: {geojson_2 is not None and 'features' in geojson_2 if geojson_2 else False}"
        )

        if not geojson_1 or not geojson_2:
            return jsonify({"error": True, "message": "Missing geojson_1 or geojson_2 in request"}), 400

        # Validate GeoJSON structure
        if not isinstance(geojson_1, dict) or "features" not in geojson_1:
            app.logger.error(f"Invalid geojson_1 structure: {geojson_1}")
            return jsonify({"error": True, "message": "geojson_1 must be a valid GeoJSON with features"}), 400

        if not isinstance(geojson_2, dict) or "features" not in geojson_2:
            app.logger.error(f"Invalid geojson_2 structure: {geojson_2}")
            return jsonify({"error": True, "message": "geojson_2 must be a valid GeoJSON with features"}), 400

        if not geojson_1["features"] or not geojson_2["features"]:
            return jsonify({"error": True, "message": "Both datasets must have at least one feature"}), 400

        app.logger.info(
            f"Merging {len(geojson_1.get('features', []))} MS footprints with {len(geojson_2.get('features', []))} OSM footprints"
        )

        # Clean and validate GeoJSON features before processing
        def clean_geojson_features(features):
            """Clean GeoJSON features to remove any problematic data"""
            cleaned_features = []
            for feature in features:
                if not isinstance(feature, dict):
                    app.logger.warning(f"Skipping non-dict feature: {type(feature)}")
                    continue

                if "geometry" not in feature or "properties" not in feature:
                    app.logger.warning(f"Skipping feature missing geometry or properties: {feature.keys()}")
                    continue

                # Create a clean copy with only the essential parts
                clean_feature = {"type": "Feature", "geometry": feature["geometry"], "properties": feature["properties"]}

                # Add id if present
                if "id" in feature:
                    clean_feature["id"] = feature["id"]

                cleaned_features.append(clean_feature)

            return cleaned_features

        # Convert GeoJSON to GeoDataFrames
        app.logger.info("Cleaning and converting geojson_1 to GeoDataFrame")
        try:
            cleaned_features_1 = clean_geojson_features(geojson_1["features"])
            app.logger.info(f"Cleaned geojson_1: {len(cleaned_features_1)} valid features out of {len(geojson_1['features'])}")
            gdf_1 = gpd.GeoDataFrame.from_features(cleaned_features_1, crs="EPSG:4326")
            app.logger.info(f"Successfully created gdf_1 with {len(gdf_1)} features")
        except Exception as e:
            app.logger.error(f"Error creating gdf_1: {e}")
            # Log a sample feature to debug
            if geojson_1.get("features"):
                sample_feature = geojson_1["features"][0]
                app.logger.error(
                    f"Sample geojson_1 feature keys: {list(sample_feature.keys()) if isinstance(sample_feature, dict) else 'Not a dict'}"
                )
                app.logger.error(f"Sample geojson_1 feature: {str(sample_feature)[:500]}...")
            raise

        app.logger.info("Cleaning and converting geojson_2 to GeoDataFrame")
        try:
            cleaned_features_2 = clean_geojson_features(geojson_2["features"])
            app.logger.info(f"Cleaned geojson_2: {len(cleaned_features_2)} valid features out of {len(geojson_2['features'])}")
            gdf_2 = gpd.GeoDataFrame.from_features(cleaned_features_2, crs="EPSG:4326")
            app.logger.info(f"Successfully created gdf_2 with {len(gdf_2)} features")
        except Exception as e:
            app.logger.error(f"Error creating gdf_2: {e}")
            # Log a sample feature to debug
            if geojson_2.get("features"):
                sample_feature = geojson_2["features"][0]
                app.logger.error(
                    f"Sample geojson_2 feature keys: {list(sample_feature.keys()) if isinstance(sample_feature, dict) else 'Not a dict'}"
                )
                app.logger.error(f"Sample geojson_2 feature: {str(sample_feature)[:500]}...")
            raise

        app.logger.info("Calling merge_footprint_geodataframes")
        app.logger.info(f"Input datasets: gdf_1={len(gdf_1)} footprints, gdf_2={len(gdf_2)} footprints")

        merged_gdf = footprint_service.merge_footprint_geodataframes(gdf_1, gdf_2)

        app.logger.info(f"Merge completed, resulted in {len(merged_gdf)} total footprints")
        if "source" in merged_gdf.columns:
            source_counts = merged_gdf["source"].value_counts()
            app.logger.info(f"Source breakdown: {dict(source_counts)}")

        # Convert back to GeoJSON with error handling for serialization
        try:
            # Use custom encoder to handle NumPy types
            geojson_str = merged_gdf.to_json()
            merged_geojson = json.loads(geojson_str)
        except TypeError as e:
            app.logger.error(f"JSON serialization error: {e}")
            # Log the problematic columns
            for col in merged_gdf.columns:
                if col != "geometry":
                    sample_value = merged_gdf[col].iloc[0] if len(merged_gdf) > 0 else None
                    app.logger.error(f"Column {col}: type={type(sample_value)}, value={sample_value}")

            # Try manual conversion with our custom encoder
            try:
                app.logger.info("Attempting manual JSON conversion with NumpyEncoder")
                # Convert to dict first, then use custom encoder
                geojson_dict = json.loads(merged_gdf.to_json())
                merged_geojson = json.loads(json.dumps(geojson_dict, cls=NumpyEncoder))
            except Exception as e2:
                app.logger.error(f"Manual conversion also failed: {e2}")
                raise e

        app.logger.info(f"Preparing response with {len(merged_geojson.get('features', []))} merged features")

        # Check response size
        response_data = {"message": "success", "merged_geojson": merged_geojson}

        # Try to calculate response size safely
        try:
            response_size = len(json.dumps(response_data, cls=NumpyEncoder))
            app.logger.info(f"Response size: {response_size} bytes ({response_size / 1024 / 1024:.2f} MB)")

            if response_size > 50 * 1024 * 1024:  # 50MB limit
                app.logger.warning("Response is very large, this might cause timeout issues")
                # Consider reducing the response size
                feature_count = len(merged_geojson.get("features", []))
                app.logger.warning(f"Large response has {feature_count} features")

        except Exception as e:
            app.logger.error(f"Could not calculate response size: {e}")

        app.logger.info("Creating Flask response...")
        flask_response = jsonify(response_data)

        # Add response headers for debugging
        flask_response.headers["X-Feature-Count"] = str(len(merged_geojson.get("features", [])))
        flask_response.headers["X-Response-Time"] = str(int(time.time() * 1000))

        app.logger.info("Sending successful merge response")
        return flask_response

    except Exception as e:
        app.logger.error(f"Error in merge_footprints: {e!s}")
        app.logger.error(f"Exception type: {type(e).__name__}")

        app.logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({"error": True, "message": f"Error merging footprints: {e!s}"}), 500


@app.route("/api/reverse_geocode", methods=["POST"])
@handle_service_exceptions("reverse_geocode")
def reverse_geocode():
    """
    Given lat/lon in request, look up the address using Mapbox and return the resulting data.
    """
    app.logger.info("=== Starting reverse_geocode function ===")
    app.logger.info(f"Request data: {request.json}")

    try:
        # Validate request data
        data, error = validate_request_data(["value"])
        if error:
            return error

        # Parse the value
        json_string = data.get("value")
        app.logger.info(f"json_string: {json_string}")

        try:
            json_data = json.loads(json_string)
            app.logger.info(f"Parsed json_data: {json_data}")
        except json.JSONDecodeError as e:
            app.logger.error(f"Invalid JSON in request: {e}")
            return jsonify({"message": f"Invalid JSON in request: {e}"}), 400

        # Extract coordinates
        coords = json_data.get("coordinates")
        if not coords:
            app.logger.error("No coordinates found in request data")
            return jsonify({"message": "No coordinates found in request data"}), 400

        app.logger.info(f"Coordinates: {coords}")

        # Parse polygon from coordinates
        polygon, error = parse_polygon_from_request({"coordinates": [coords]})
        if error:
            return error

        # Get property names and features length
        property_names = json_data.get("propertyNames", [])
        features_length = json_data.get("featuresLength", 0)

        app.logger.info(f"Property names: {property_names}")
        app.logger.info(f"Features length: {features_length}")

        # Use geocoding service to reverse geocode
        properties, error_msg = geocoding_service.reverse_geocode_polygon(polygon, property_names)
        if error_msg:
            return jsonify({"message": error_msg}), 400

        # Create returned feature
        properties["quality"] = "reverseGeocode"
        new_id = str(features_length)
        returned_feature = {
            "id": new_id,
            "type": "Feature",
            "properties": properties,
            "geometry": {"type": "Polygon", "coordinates": [coords]},
        }

        app.logger.info(f"Returning feature: {returned_feature}")
        return jsonify({"message": "success", "user_data": json.dumps(returned_feature)}), 200

    except Exception as e:
        log_error_with_context("Unexpected error in reverse_geocode", e)
        return jsonify({"message": f"Unexpected error: {e}"}), 500


@app.route("/api/geocode", methods=["POST"])
@handle_service_exceptions("geocode")
def geocode():
    """
    Given address (street, city, state, postal_code (optional), and country (optional)) in request, look up the address using Amazon Location Services and return the resulting data.
    """
    app.logger.info("=== Starting geocode function ===")
    app.logger.info(f"Request data: {request.json}")

    try:
        # Validate request data
        data, error = validate_request_data(["value"])
        if error:
            return error

        # Parse the value
        json_string = data.get("value")

        locations = []
        try:
            json_data = json.loads(json_string)
            app.logger.info(f"Parsed json_data: {json_data}")
            locations = json_data["locations"]
        except json.JSONDecodeError as e:
            app.logger.error(f"Invalid JSON in request: {e}")
            return jsonify({"message": f"Invalid JSON in request: {e}"}), 400

        # Use geocoding service to get Lat/Lng
        properties, error_msg = geocoding_service.geocode_addresses(locations)
        if error_msg:
            return jsonify({"message": error_msg}), 400

        # Create returned feature
        app.logger.info(f"Returning feature: {properties}")
        return jsonify({"message": "success", "user_data": json.dumps(properties)}), 200

    except Exception as e:
        log_error_with_context("Unexpected error in geocode", e)
        return jsonify({"message": f"Unexpected error: {e}"}), 500


@app.route("/api/edit_footprint", methods=["POST"])
@handle_service_exceptions("edit_footprint")
def edit_footprint():
    """
    Receive a new footprint in the request, add UBID, return new lat, lon, and UBID.
    """
    app.logger.info("function: edit_footprint")

    # Validate request data
    data, error = validate_request_data(["value"])
    if error:
        return error

    # Parse the value
    json_string = data.get("value")
    json_data = json.loads(json_string)
    coords = json_data["coordinates"]

    # Parse polygon from coordinates
    polygon, error = parse_polygon_from_request({"coordinates": [coords]})
    if error:
        return error

    # Calculate centroid
    centroid = polygon.centroid
    lat = centroid.y
    lon = centroid.x

    # Encode UBID from coordinates
    try:
        ubid = encode_ubid(polygon)
    except AssertionError:
        return jsonify({"message": "Invalid longitude coordinates"}), 400

    new_polygon_data = {"latitude": lat, "longitude": lon, "ubid": ubid}
    return jsonify({"message": "success", "user_data": json.dumps(new_polygon_data)}), 200


@app.route("/api/update_api_key", methods=["POST"])
def update_api_key():
    """
    Receive a new API key for Amazon Location Services in the request and save it

    todo: generalize for other services
    """
    app.logger.info("function: update_api_key")

    data = request.get_json()
    api_key = data["apiKey"]
    base_url = data["baseUrl"]
    app_id = data["app_id"]

    if api_key:
        os.environ["AMAZON_API_KEY"] = api_key
        if base_url:
            os.environ["AMAZON_BASE_URL"] = base_url
        if app_id:
            os.environ["AMAZON_APP_ID"] = app_id

        return jsonify({"message": "API key updated successfully!"}), 200
    else:
        return jsonify({"message": "No API key provided!"}), 400


@app.route("/api/download_ms_footprints", methods=["POST"])
@handle_service_exceptions("download_ms_footprints")
def download_ms_footprints():
    """
    Download Microsoft footprint buildings within a selected polygon.
    Takes a polygon GeoJSON and returns a GeoJSON/Excel file with all intersecting MS footprints.
    """
    app.logger.info("=== Starting download_ms_footprints function ===")

    try:
        # Validate request data
        data, error = validate_request_data(["polygon"])
        if error:
            return error

        polygon_data = data["polygon"]
        app.logger.info(f"Polygon data: {polygon_data}")

        # Parse polygon from request
        polygon, error = parse_polygon_from_request(polygon_data)
        if error:
            return error

        # Get quadkeys for the polygon
        quadkeys = footprint_service.get_quadkeys_for_polygon(polygon)

        # Update datasets
        footprint_service.update_datasets(quadkeys)

        # Load Microsoft footprints
        ms_gdf = footprint_service.load_ms_footprints(polygon, quadkeys)

        if len(ms_gdf) == 0:
            app.logger.warning("No Microsoft footprints found in the area")
            return jsonify({"message": "No Microsoft footprints found in the selected area", "footprints_count": 0}), 200

        # Process the footprints
        processed_gdf = footprint_service.process_ms_footprints(ms_gdf)

        # Save debug CSV
        processed_gdf.to_csv("ms_footprints_debug.csv", index=False)

        # Create GeoJSON response
        return create_geojson_response(processed_gdf, "footprints_count")

    except Exception as e:
        log_error_with_context("Unexpected error in download_ms_footprints", e)
        return jsonify({"error": f"Unexpected error: {e}"}), 500


@app.route("/api/download_osm_footprints", methods=["POST"])
@handle_service_exceptions("download_osm_footprints")
def download_osm_footprints():
    """
    Download OpenStreetMap building footprints for a given polygon using OSMnx.
    """
    app.logger.info("=== Starting download_osm_footprints function ===")

    try:
        # Validate request data
        data, error = validate_request_data(["polygon"])
        if error:
            return error

        polygon_data = data["polygon"]
        app.logger.info(f"Received polygon: {polygon_data}")

        # Parse polygon from request
        polygon, error = parse_polygon_from_request(polygon_data)
        if error:
            return error

        # Load OSM footprints
        osm_gdf = footprint_service.load_osm_footprints(polygon)

        if len(osm_gdf) == 0:
            app.logger.info("No OSM building footprints found in the polygon")
            return jsonify({"message": "No OSM building footprints found in the selected area", "footprints_count": 0}), 200

        # Process the footprints
        processed_gdf = footprint_service.process_osm_footprints(osm_gdf)

        # Save debug CSV
        processed_gdf.to_csv("osm_footprints_debug.csv", index=False)

        # Create GeoJSON response
        return create_geojson_response(processed_gdf, "footprints_count")

    except Exception as e:
        log_error_with_context("Unexpected error in download_osm_footprints", e)
        return jsonify({"error": f"Unexpected error: {e}"}), 500


@app.route("/api/download_footprints_for_points", methods=["POST"])
@handle_service_exceptions("download_footprints_for_points")
def download_footprints_for_points():
    """
    Download Microsoft footprints and/or OpenStreetMap building footprints near a set of
    selected points (typically the currently-selected rows in the CBL Table), and determine
    which footprints actually overlap (contain) each point.

    Runs when the user clicks "Download Footprints" in the CBL Table toolbar.

    Expected request format:
    {
        "points": [{"id": "<row id>", "latitude": <float>, "longitude": <float>}, ...],
        "sources": ["ms", "osm"],
        "keep_new": false  # if true, also return footprints that don't overlap any point
    }

    Response format:
    {
        "message": "success",
        "footprints": [
            {"type": "Feature", "geometry": {...}, "properties": {..., "matched_point_id": "<row id>" | null}}
        ],
        "matched_count": <int>,
        "new_count": <int>
    }
    Only footprints with a non-null "matched_point_id" overlap a selected point; footprints
    with "matched_point_id" set to null are newly discovered nearby footprints and are only
    included when "keep_new" is true.
    """
    app.logger.info("function: download_footprints_for_points")

    data, error = validate_request_data(["points", "sources"])
    if error:
        return error

    points = data["points"]
    requested_sources = data["sources"]
    keep_new = bool(data.get("keep_new", False))

    if not points:
        return jsonify({"error": "No points provided"}), 400

    valid_sources = {"ms", "osm"}
    sources = [s for s in requested_sources if s in valid_sources]
    if not sources:
        return jsonify({"error": "No valid sources provided. Must include 'ms' and/or 'osm'"}), 400

    try:
        points_gdf = gpd.GeoDataFrame(
            {"point_id": [str(p["id"]) for p in points]},
            geometry=[Point(float(p["longitude"]), float(p["latitude"])) for p in points],
            crs="EPSG:4326",
        )
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"error": f"Invalid points data: {e}"}), 400

    polygon = footprint_service.build_point_query_polygon(points)

    all_footprints: list[dict] = []
    matched_count = 0
    new_count = 0

    if "ms" in sources:
        quadkeys = footprint_service.get_quadkeys_for_polygon(polygon)
        footprint_service.update_datasets(quadkeys)
        ms_gdf = footprint_service.load_ms_footprints(polygon, quadkeys)
        if len(ms_gdf) > 0:
            ms_gdf = footprint_service.process_ms_footprints(ms_gdf)
            matched, unmatched = footprint_service.match_footprints_to_points(points_gdf, ms_gdf)

            matched_features = footprint_service.footprints_to_feature_dicts(matched)
            all_footprints.extend(matched_features)
            matched_count += len(matched_features)

            if keep_new:
                new_features = footprint_service.footprints_to_feature_dicts(unmatched)
                for feature in new_features:
                    feature["properties"]["matched_point_id"] = None
                all_footprints.extend(new_features)
                new_count += len(new_features)

    if "osm" in sources:
        osm_gdf = footprint_service.load_osm_footprints(polygon)
        if len(osm_gdf) > 0:
            osm_gdf = footprint_service.process_osm_footprints(osm_gdf)
            matched, unmatched = footprint_service.match_footprints_to_points(points_gdf, osm_gdf)

            matched_features = footprint_service.footprints_to_feature_dicts(matched)
            all_footprints.extend(matched_features)
            matched_count += len(matched_features)

            if keep_new:
                new_features = footprint_service.footprints_to_feature_dicts(unmatched)
                for feature in new_features:
                    feature["properties"]["matched_point_id"] = None
                all_footprints.extend(new_features)
                new_count += len(new_features)

    app.logger.info(f"download_footprints_for_points: {matched_count} matched, {new_count} new (keep_new={keep_new})")

    return jsonify(
        {
            "message": "success",
            "footprints": all_footprints,
            "matched_count": matched_count,
            "new_count": new_count,
        }
    ), 200


@app.route("/api/assign_target_eui", methods=["POST"])
@handle_service_exceptions("assign_target_eui")
def assign_target_eui():
    """
    Assign target EUI values for selected buildings based on ESPM data.
    Expected request format:
    {
        "buildings": [
            {
                "id": "building_id",
                "properties": {
                    "building_type": "Office",
                    "climate_zone": "4A",
                    "year_built": "1990",
                    "gross_floor_area": "50000",
                    "hours_of_operation": "60"
                }
            }
        ]
    }
    """
    try:
        # Validate request data
        if not request.json:
            return jsonify({"error": "No JSON data provided"}), 400

        buildings_data = request.json.get("buildings", [])
        if not buildings_data:
            return jsonify({"error": "No buildings data provided"}), 400

        # Extract building properties for EUI lookup
        building_properties = []
        for building in buildings_data:
            if "properties" in building:
                building_properties.append(building["properties"])
            else:
                # Handle case where building data is directly provided
                building_properties.append(building)

        # Retrieve target EUI data using the service
        enriched_buildings = data_transformation_service.assign_target_eui(building_properties)

        # Return the enriched building data
        return jsonify(
            {
                "success": True,
                "message": f"Assigned target EUI data for {len(enriched_buildings)} buildings",
                "buildings": enriched_buildings,
            }
        )

    except Exception as e:
        log_error_with_context("Error in assign_target_eui endpoint", e)
        return jsonify({"error": f"Failed to assign target EUI data: {e!s}"}), 500


def return_one():
    return 1


if __name__ == "__main__":
    # Configure logging for development
    import sys

    # Create a console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG)

    # Create a formatter
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s in %(module)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    console_handler.setFormatter(formatter)

    # Add the handler to the Flask app logger
    app.logger.addHandler(console_handler)
    app.logger.setLevel(logging.DEBUG)

    # Also add to the root logger
    root_logger = logging.getLogger()
    root_logger.addHandler(console_handler)
    root_logger.setLevel(logging.DEBUG)

    print("Flask app starting with detailed logging enabled...")
    print("All error messages will be displayed in this console.")

    app.run(port=5001, use_reloader=False)
