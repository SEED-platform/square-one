import gzip
import json
import json.scanner
import logging
import os
import sys
import traceback
import warnings
from collections import OrderedDict
from pathlib import Path
from typing import Any

import geopandas as gpd
import mercantile
import pandas as pd
import requests
from cbl_workflow.utils.common import Location
from cbl_workflow.utils.geocode_addresses import geocode_addresses
from cbl_workflow.utils.normalize_address import normalize_address
from cbl_workflow.utils.ubid import bounding_box, centroid, encode_ubid
from cbl_workflow.utils.update_dataset_links import update_dataset_links
from cbl_workflow.utils.update_quadkeys import update_quadkeys
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from shapely.geometry import Point, Polygon

import flask_app.config as config
from flask_app.utils.convert_file_to_dicts import convert_file_to_dicts, geodataframe_to_json
from flask_app.utils.generate_locations_list import generate_locations_list
from flask_app.utils.location_error import LocationError
from flask_app.utils.merge_dicts import merge_dicts
from flask_app.utils.normalize_state import normalize_state

warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", category=UserWarning)

app = Flask(__name__)
CORS(app)
load_dotenv()

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

        file_data = convert_file_to_dicts(file)
        if not file_data or len(file_data) == 0:
            return jsonify({"message": "Uploaded a file in the wrong format. Please upload different format"}), 400

        if isinstance(file_data, LocationError):
            return jsonify({"message": f"{file_data.message}"}), 400

        input_dict[file.filename] = file_data

    input_json_str = json.dumps(input_dict)
    return jsonify({"message": "success", "user_data": input_json_str}), 200


@app.route("/api/check_data", methods=["POST"])
def check_data():
    """
    Check that request has the required column names Street_Address, City, and State
    """
    app.logger.info("function: check_data")

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

    locations = generate_locations_list(file_data)

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

        merged_dict = merge_dicts(file_dict, data_dict)
        merged_data.append(merged_dict)

    columns = ["street_address", "city", "state"]
    for key in merged_data[0]:
        if key.lower() not in columns:
            columns.append(key)

    # Convert covered building list as GeoJSON
    gdf = gpd.GeoDataFrame(data=merged_data, columns=columns)
    final_geojson = geodataframe_to_json(gdf)

    return jsonify({"message": "success", "user_data": final_geojson}), 200


@app.route("/api/reverse_geocode", methods=["POST"])
def reverse_geocode():
    """
    Given lat/lon in request, look up the address using Mapbox and return the resulting data.
    """
    app.logger.info("=== Starting reverse_geocode function ===")
    app.logger.info(f"Request data: {request.json}")

    try:
        # Check for API key
        if "MAPBOX_ACCESS_TOKEN" not in os.environ:
            app.logger.error("MAPBOX_ACCESS_TOKEN not present in env file")
            return jsonify({"message": "MAPBOX_ACCESS_TOKEN not present in env file"}), 400

        # Parse request data
        json_string = request.json.get("value")
        app.logger.info(f"json_string: {json_string}")

        if not json_string:
            app.logger.error("No 'value' provided in request")
            return jsonify({"message": "No 'value' provided in request"}), 400

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

        # Initialize properties
        properties = {}
        property_names = json_data.get("propertyNames", [])
        for key in property_names:
            properties[key] = " "
        newId = str(json_data.get("featuresLength", 0))

        app.logger.info(f"Property names: {property_names}")
        app.logger.info(f"New ID: {newId}")

        # Create polygon and calculate centroid
        try:
            polygon = Polygon(coords)
            centroid = polygon.centroid
            app.logger.info(f"Polygon created successfully, centroid: {centroid}")
        except Exception as e:
            app.logger.error(f"Error creating polygon: {e}")
            return jsonify({"message": f"Error creating polygon: {e}"}), 400

        # Calculate lat, long (center of polygon)
        lat = centroid.y
        lon = centroid.x
        app.logger.info(f"Calculated lat: {lat}, lon: {lon}")

        # Encode UBID from coordinates
        ubid = ""
        try:
            ubid = encode_ubid(polygon)
            app.logger.debug(f"Generated UBID: {ubid}")
        except AssertionError as e:
            app.logger.error(f"Invalid longitude coordinates for UBID: {e}")
            return jsonify({"message": "Invalid longitude coordinates"}), 400
        except Exception as e:
            app.logger.error(f"Error encoding UBID: {e}")
            return jsonify({"message": f"Error encoding UBID: {e}"}), 400

        # Make Mapbox API call
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{lon},{lat}.json"
        params = {"access_token": os.environ["MAPBOX_ACCESS_TOKEN"], "limit": 1}

        app.logger.debug(f"Making API call to: {url}")

        try:
            response = requests.get(url, params=params, verify=True)
            app.logger.debug(f"API response status: {response.status_code}")
            app.logger.debug(f"API response content: {response.text}")
        except Exception as e:
            app.logger.error(f"Error making API request: {e}")
            return jsonify({"message": f"Error making API request: {e}"}), 500

        if response.status_code in {401, 403}:
            app.logger.error(f"API authentication error: {response.status_code}")
            return jsonify({"message": "Error: Could not reverse geocode using the mapbox API."}), 400

        # Parse API response
        try:
            result = response.json()
            app.logger.debug(f"API result: {result}")
        except json.JSONDecodeError as e:
            app.logger.error(f"Invalid JSON response from API: {e}")
            return jsonify({"message": f"Invalid JSON response from API: {e}"}), 500

        # Process result
        try:
            properties["ubid"] = ubid
            properties["latitude"] = str(lat)
            properties["longitude"] = str(lon)

            features = result.get("features", [])
            if not features:
                app.logger.warning("No features returned from API")
                properties["street_address"] = "Unknown"
                properties["city"] = "Unknown"
                properties["state"] = "Unknown"
                properties["postal_code"] = "Unknown"
                properties["country"] = "Unknown"
            else:
                feature = features[0]
                app.logger.debug(f"Processing feature: {feature}")

                # Extract address components from context
                context = feature.get("context", [])
                for item in context:
                    item_id = item.get("id", "")
                    if "place" in item_id:
                        properties["city"] = item.get("text", "Unknown")

                    if "region" in item_id:
                        state_name = item.get("text", "Unknown")
                        properties["state"] = normalize_state(state_name)

                    if "postcode" in item_id:
                        properties["postal_code"] = item.get("text", "Unknown")

                    if "country" in item_id:
                        properties["country"] = item.get("text", "Unknown")

                # Extract street address
                place_name = feature.get("place_name", "Unknown")
                properties["street_address"] = normalize_address(place_name)

                app.logger.info(f"Extracted properties: {properties}")

        except Exception as e:
            app.logger.error(f"Error processing API result: {e}")
            app.logger.error(f"Exception traceback: {traceback.format_exc()}")
            return jsonify({"message": f"Error processing API result: {e}"}), 500

        # Validate properties
        if not properties or len(properties) == 0:
            app.logger.error("No properties extracted from reverse geocoding")
            return jsonify({"message": "Error: Reverse geocoding returned poor data."}), 400

        # Create returned feature
        properties["quality"] = "reverseGeocode"
        returned_feature = {
            "id": newId,
            "type": "Feature",
            "properties": properties,
            "geometry": {"type": "Polygon", "coordinates": [coords]},
        }

        app.logger.info(f"Returning feature: {returned_feature}")

        return jsonify({"message": "success", "user_data": json.dumps(returned_feature)}), 200

    except Exception as e:
        app.logger.error(f"Unexpected error in reverse_geocode: {e}")
        app.logger.error(f"Exception type: {type(e).__name__}")
        app.logger.error(f"Exception traceback: {traceback.format_exc()}")
        return jsonify({"message": f"Unexpected error: {e}"}), 500


@app.route("/api/edit_footprint", methods=["POST"])
def edit_footprint():
    """
    Receive a new footprint in the request, add UBID, return new lat, lon, and UBID.
    """
    app.logger.info("function: edit_footprint")

    json_string = request.json.get("value")
    json_data = json.loads(json_string)
    coords = json_data["coordinates"]

    polygon = Polygon(coords)
    centroid = polygon.centroid

    # calculate lat, long (center of polygon)
    lat = centroid.y
    lon = centroid.x

    # encode ubid from coordinates
    ubid = ""
    try:
        ubid = encode_ubid(polygon)
    except AssertionError:
        return jsonify({"message": "Invalid longitude coordinates"}), 400

    newPolygonData = {"lat": lat, "lon": lon, "ubid": ubid}
    return jsonify({"message": "success", "user_data": json.dumps(newPolygonData)}), 200


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
def download_ms_footprints():
    """
    Download Microsoft footprint buildings within a selected polygon.
    Takes a polygon GeoJSON and returns a GeoJSON/Excel file with all intersecting MS footprints.
    """
    app.logger.info("=== Starting download_ms_footprints function ===")

    try:
        # Get the polygon from the request
        request_data = request.get_json()
        app.logger.info(f"Request data: {request_data}")

        if not request_data or "polygon" not in request_data:
            app.logger.error("No polygon data provided in request")
            return jsonify({"error": "No polygon data provided"}), 400

        polygon_data = request_data["polygon"]

        app.logger.info(f"Polygon data: {polygon_data}")

        # Convert polygon to GeoDataFrame
        if isinstance(polygon_data, dict) and "coordinates" in polygon_data:
            # Single polygon
            polygon_geom = Polygon(polygon_data["coordinates"][0])
        elif isinstance(polygon_data, list) and len(polygon_data) > 0:
            # Multiple coordinates
            polygon_geom = Polygon(polygon_data[0])
        else:
            app.logger.error("Invalid polygon format")
            return jsonify({"error": "Invalid polygon format"}), 400

        # Create GeoDataFrame for the area of interest
        aoi_gdf = gpd.GeoDataFrame([{"geometry": polygon_geom}], crs="EPSG:4326")
        app.logger.info(f"Area of interest created: {aoi_gdf.bounds}")

        # Get bounds of the area of interest
        bounds = aoi_gdf.bounds.iloc[0]
        minx, miny, maxx, maxy = bounds["minx"], bounds["miny"], bounds["maxx"], bounds["maxy"]
        app.logger.info(f"Area of interest bounds: {minx}, {miny}, {maxx}, {maxy}")

        # Get quadkeys for the area
        quadkeys = set()
        for tile in list(mercantile.tiles(minx, miny, maxx, maxy, zooms=9)):
            quadkeys.add(int(mercantile.quadkey(tile)))
        quadkeys = list(quadkeys)

        app.logger.info(f"The input area spans {len(quadkeys)} tiles: {quadkeys}")

        # Update dataset links and quadkeys
        data_dir = Path(config.data_dir)
        quadkeys_dir = data_dir / "quadkeys"

        try:
            update_dataset_links(save_directory=quadkeys_dir)
            update_quadkeys(list(quadkeys), quadkeys_dir)
            app.logger.info("Dataset links and quadkeys updated successfully")
        except Exception as e:
            app.logger.error(f"Error updating dataset links/quadkeys: {e}")
            return jsonify({"error": f"Error updating dataset: {e}"}), 500

        # Load and process Microsoft footprints
        idx = 0
        ms_gdf = gpd.GeoDataFrame()
        loaded_quadkeys = {}

        for quadkey in quadkeys:
            if quadkey not in loaded_quadkeys:
                app.logger.info(f"Loading quadkey id: {quadkey}")
                quadkey_file = quadkeys_dir / f"{quadkey}.geojsonl.gz"

                if not quadkey_file.exists():
                    app.logger.warning(f"Quadkey file not found: {quadkey_file}")
                    continue

                try:
                    with gzip.open(quadkey_file, "rb") as f:
                        gdf = gpd.read_file(f)
                        app.logger.info(f"  Quadkey: {quadkey} has {len(gdf)} footprints")

                        # Filter geometries within the area of interest
                        gdf = gdf[gdf.geometry.within(aoi_gdf.geometry.iloc[0])]
                        app.logger.info(f"  Quadkey: {quadkey} has {len(gdf)} footprints within the area of interest")

                        # Save the quadkey to be combined later
                        loaded_quadkeys[quadkey] = gdf

                except Exception as e:
                    app.logger.error(f"Error loading quadkey {quadkey}: {e}")
                    continue

        # Merge the GeoDataFrames
        for loaded_gdf in loaded_quadkeys.values():
            loaded_gdf["id"] = range(idx, idx + len(loaded_gdf))
            idx += len(loaded_gdf)
            ms_gdf = pd.concat([ms_gdf, loaded_gdf], ignore_index=True)

        if len(ms_gdf) == 0:
            app.logger.warning("No Microsoft footprints found in the area")
            return jsonify({"message": "No Microsoft footprints found in the selected area"}), 200

        app.logger.info(f"Total Microsoft footprints found: {len(ms_gdf)}")

        # Process the data
        # Handle -1 heights
        ms_gdf["height"] = ms_gdf["height"].apply(lambda x: x if x != -1 else None)

        # Add UBID encoding
        try:
            ms_gdf["ubid"] = ms_gdf.apply(lambda x: encode_ubid(x["geometry"]), axis=1)
            ms_gdf["ubid_bounding_box"] = ms_gdf.apply(lambda x: bounding_box(x["ubid"]), axis=1)
            ms_gdf["ubid_centroid"] = ms_gdf.apply(lambda x: centroid(x["ubid"]), axis=1)
        except Exception as e:
            app.logger.error(f"Error encoding UBIDs: {e}")
            return jsonify({"error": f"Error encoding UBIDs: {e}"}), 500

        # Calculate areas
        try:
            ms_gdf_crs = ms_gdf.to_crs(epsg=3857)
            ms_gdf["ms_footprint_area_m2"] = ms_gdf_crs.area
            ms_gdf["ms_footprint_area_ft2"] = ms_gdf["ms_footprint_area_m2"] * 10.764
        except Exception as e:
            app.logger.error(f"Error calculating areas: {e}")
            return jsonify({"error": f"Error calculating areas: {e}"}), 500

        # Create GeoJSON data for response
        try:
            # Drop geometry columns that can't be serialized to GeoJSON
            drop_geom_columns = ["ubid_bounding_box", "ubid_centroid"]
            output_gdf = ms_gdf.drop(columns=[col for col in drop_geom_columns if col in ms_gdf.columns])

            # Convert to GeoJSON format
            geojson_data = output_gdf.to_json()

            app.logger.info("Successfully created GeoJSON data")

            return jsonify({"message": "success", "footprints_count": len(ms_gdf), "geojson": json.loads(geojson_data)}), 200

        except Exception as e:
            app.logger.error(f"Error creating GeoJSON data: {e}")
            return jsonify({"error": f"Error creating GeoJSON data: {e}"}), 500

    except Exception as e:
        app.logger.error(f"Unexpected error in download_ms_footprints: {e}")
        app.logger.error(f"Exception type: {type(e).__name__}")
        app.logger.error(f"Exception traceback: {traceback.format_exc()}")
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
