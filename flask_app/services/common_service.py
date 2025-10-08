"""
Common service utilities for handling requests, validation, and responses.
"""

import json
import logging
from functools import wraps
from typing import Any, Optional, Union

from flask import jsonify, request
from shapely.geometry import Polygon

from flask_app.services.file_processing_service import FileProcessingService
from flask_app.services.logging_utils import log_error_with_context


def validate_request_data(required_fields: list) -> tuple[Optional[dict], Optional[Any]]:
    """
    Validate that request contains required fields.

    Args:
        required_fields: List of required field names

    Returns:
        Tuple of (data, error_response). If error_response is not None, return it immediately.
    """
    try:
        data = request.get_json()
        if not data:
            return None, jsonify({"error": "No data provided in request"}), 400

        for field in required_fields:
            if field not in data:
                return None, jsonify({"error": f"Missing required field: {field}"}), 400

        return data, None
    except Exception as e:
        return None, jsonify({"error": f"Invalid request data: {e}"}), 400


def parse_polygon_from_request(polygon_data: dict) -> tuple[Optional[Polygon], Optional[Any]]:
    """
    Parse polygon data from request into Shapely Polygon.

    Args:
        polygon_data: Dictionary containing polygon coordinates

    Returns:
        Tuple of (polygon, error_response). If error_response is not None, return it immediately.
    """
    try:
        # Handle different polygon data formats
        if isinstance(polygon_data, dict) and "coordinates" in polygon_data:
            # GeoJSON format
            coordinates = polygon_data["coordinates"][0]  # Get first ring
        elif isinstance(polygon_data, list) and len(polygon_data) > 0:
            # Direct coordinates array
            coordinates = polygon_data[0]
        else:
            return None, jsonify({"error": "Invalid polygon format"}), 400

        polygon = Polygon(coordinates)
        logging.info(f"Created Shapely polygon with {len(coordinates)} coordinates")
        return polygon, None

    except Exception as e:
        logging.error(f"Error creating Shapely polygon: {e}")
        return None, jsonify({"error": f"Invalid polygon format: {e}"}), 400


def handle_service_exceptions(operation_name: str):
    """
    Decorator to handle exceptions in service operations consistently.

    Args:
        operation_name: Name of the operation for logging
    """

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                log_error_with_context(f"Error in {operation_name}", e)
                return jsonify({"error": f"Error in {operation_name}: {e}"}), 500

        return wrapper

    return decorator


def create_success_response(data: Any, message: str = "success", extra_fields: Optional[dict] = None) -> tuple[dict, int]:
    """
    Create a standardized success response.

    Args:
        data: The main data to return
        message: Success message
        extra_fields: Additional fields to include in response

    Returns:
        Tuple of (response_dict, status_code)
    """
    response = {"message": message, "data": data}

    if extra_fields:
        response.update(extra_fields)

    return response, 200


def create_geojson_response(gdf, count_field_name: str = "footprints_count") -> tuple[dict, int]:
    """
    Create a standardized GeoJSON response from a GeoDataFrame.

    Args:
        gdf: GeoDataFrame to convert
        count_field_name: Name for the count field

    Returns:
        Tuple of (response_dict, status_code)
    """
    try:
        file_processing_service = FileProcessingService()
        geojson_data = file_processing_service.geodataframe_to_json(gdf)
        logging.info("Successfully converted GeoDataFrame to GeoJSON")

        return jsonify({"message": "success", count_field_name: len(gdf), "geojson": json.loads(geojson_data)}), 200

    except Exception as e:
        log_error_with_context("Error creating GeoJSON response", e)
        return jsonify({"error": f"Error creating GeoJSON data: {e}"}), 500


def validate_polygon_data(polygon_data: Any) -> tuple[Optional[Any], Optional[tuple[Any, int]]]:
    """
    Validate polygon data from request.

    Args:
        polygon_data: The polygon data to validate

    Returns:
        Tuple of (validated_data, error_response_tuple)
    """
    if not polygon_data:
        return None, (jsonify({"error": "No polygon data provided"}), 400)

    # Check if it's a valid format
    if (isinstance(polygon_data, dict) and "coordinates" in polygon_data) or (isinstance(polygon_data, list) and len(polygon_data) > 0):
        return polygon_data, None
    else:
        return None, (jsonify({"error": "Invalid polygon format"}), 400)


def create_feature_properties(property_names: list, feature_length: int) -> tuple[dict, str]:
    """
    Create initial feature properties dictionary.

    Args:
        property_names: List of property names to initialize
        feature_length: Length of features for ID generation

    Returns:
        Tuple of (properties_dict, new_id)
    """
    properties = {}
    for key in property_names:
        properties[key] = " "

    new_id = str(feature_length)
    return properties, new_id
