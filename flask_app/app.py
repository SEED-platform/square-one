import gzip
import json
import json.scanner
import os
import warnings
from collections import OrderedDict
from typing import Any

import geopandas as gpd
import mercantile
import requests
from cbl_workflow.utils.common import Location
from cbl_workflow.utils.geocode_addresses import geocode_addresses
from cbl_workflow.utils.normalize_address import normalize_address
from cbl_workflow.utils.ubid import encode_ubid
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

api_key = ""


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
    app.logger.info("function: reverse_geocode")

    # todo: make sure this is the best way to handle this error. Nothing is being displayed to the user.
    if "MAPQUEST_API_KEY" not in os.environ:
        return jsonify({"message": "MAPQUEST_API_KEY not present in env file"}), 400

    json_string = request.json.get("value")
    json_data = json.loads(json_string)

    coords = json_data["coordinates"]

    properties = {}
    for key in json_data["propertyNames"]:
        properties[key] = " "
    newId = str(json_data["featuresLength"])

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

    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{lon},{lat}.json"
    params = {"access_token": os.environ["MAPQUEST_API_KEY"], "limit": 1}

    # TODO: remove verify
    response = requests.get(url, params=params, verify=True)
    if response.status_code in {401, 403}:
        return jsonify({"message": "Error: Could not reverse geocode using the mapbox API."}), 400

    result = response.json()
    try:
        properties["ubid"] = ubid
        properties["latitude"] = str(lat)
        properties["longitude"] = str(lon)
        features = result["features"]
        context = features[0]["context"]
        for item in context:
            if "place" in item["id"]:
                properties["city"] = item["text"]

            if "region" in item["id"]:
                state_name = item["text"]
                properties["state"] = normalize_state(state_name)

            if "postcode" in item["id"]:
                properties["postal_code"] = item["text"]

            if "country" in item["id"]:
                properties["country"] = item["text"]

        properties["street_address"] = normalize_address(features[0]["place_name"])
    except Exception:
        app.logger.warning("missing data from reverse geocoding")

    if not properties or len(properties) == 0:
        return jsonify({"message": "Error: Reverse geocoding returned poor data."}), 400

    properties["quality"] = "reverseGeocode"
    returned_feature = {"id": newId, "type": "Feature", "properties": properties, "geometry": {"type": "Polygon", "coordinates": [coords]}}

    return jsonify({"message": "success", "user_data": json.dumps(returned_feature)}), 200


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


def return_one():
    return 1


if __name__ == "__main__":
    app.run(port=5001)
