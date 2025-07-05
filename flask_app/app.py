import gzip
import json
import json.scanner
import logging
import os
import sys
import traceback
import warnings
from collections import OrderedDict
from typing import Any

import geopandas as gpd
import mercantile
from cbl_workflow.utils.common import Location
from cbl_workflow.utils.geocode_addresses import geocode_addresses
from cbl_workflow.utils.normalize_address import normalize_address
from cbl_workflow.utils.ubid import encode_ubid
from cbl_workflow.utils.update_dataset_links import update_dataset_links
from cbl_workflow.utils.update_quadkeys import update_quadkeys
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from shapely.geometry import Point

import flask_app.config as config
from flask_app.exceptions import LocationError
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

    isGoodData = True  # check_data_quality(file_data)
    if isinstance(isGoodData, LocationError):
        return jsonify({"message": f"{isGoodData.message}", "user_data": json_data}), 400

    return jsonify({"message": "success", "user_data": json_data}), 200


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

    MAPQUEST_API_KEY = os.getenv("MAPQUEST_API_KEY")

    if not MAPQUEST_API_KEY:
        app.logger.warning("Missing MapQuest API key")

    for loc in locations:
        loc["street"] = normalize_address(loc["street"])

    try:
        data = geocode_addresses(locations, MAPQUEST_API_KEY)

    except Exception:
        return jsonify(
            {"message": "Failed geocoding property states due to MapQuest error. Your MapQuest API Key is either invalid or at its limit."}
        ), 400

    poorQualityCodes = ["Ambiguous", "P1CAA", "B1CAA", "B1ACA", "A5XAX", "L1CAA", "B1AAA", "L1BCA", "L1CBA"]

    # Find all quadkeys that the coordinates fall within
    # TODO: this is redundant with the quadkey generation in the download_ms_footprints function, resolve
    quadkeys = set()
    for datum in data:
        if datum["quality"] not in poorQualityCodes:  # todo: check that "longitude" field is present
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
        if datum["quality"] not in poorQualityCodes:
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

    # since the data dict contains information only from mapquest, need to merge original
    # dict and the data dict to display all information
    merged_data = []
    for i in range(len(data)):
        file_dict = file_data[i]
        data_dict = data[i]

        if "P1A" in data_dict["quality"] or "P1B" in data_dict["quality"]:
            data_dict["quality"] = "Very Good"
        elif "L1A" in data_dict["quality"] or "L1B" in data_dict["quality"]:
            data_dict["quality"] = "Good"
        elif data_dict["quality"] in poorQualityCodes:
            data_dict["quality"] = "Poor"

        merged_dict = data_transformation_service.merge_dicts(file_dict, data_dict)
        merged_data.append(merged_dict)

    columns = ["street_address", "city", "state"]
    for key in merged_data[0]:
        if key.lower() not in columns:
            columns.append(key)

    # Convert covered building list as GeoJSON
    gdf = gpd.GeoDataFrame(data=merged_data, columns=columns)
    final_geojson = file_processing_service.geodataframe_to_json(gdf)

    return jsonify({"message": "success", "user_data": final_geojson}), 200


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

    new_polygon_data = {"lat": lat, "lon": lon, "ubid": ubid}
    return jsonify({"message": "success", "user_data": json.dumps(new_polygon_data)}), 200


@app.route("/api/update_api_key", methods=["POST"])
def update_api_key():
    """
    Receive a new API key for Mapquest in the request and save it

    todo: generalize for other services
    """
    app.logger.info("function: update_api_key")

    data = request.get_json()
    api_key = data["apiKey"]

    if api_key:
        os.environ["MAPQUEST_API_KEY"] = api_key
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
