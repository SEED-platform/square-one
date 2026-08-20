"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/square-one/blob/main/LICENSE.md
"""

import json
import unittest
from unittest.mock import Mock, patch

import geopandas as gpd
from flask import Flask
from shapely.geometry import Polygon

from flask_app.services.common_service import (
    create_feature_properties,
    create_geojson_response,
    create_success_response,
    handle_service_exceptions,
    parse_polygon_from_request,
    validate_polygon_data,
    validate_request_data,
)
from flask_app.services.logging_utils import log_error_with_context


class TestCommonService(unittest.TestCase):
    """Test cases for common service utilities."""

    def setUp(self):
        """Set up test fixtures before each test method."""
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True

        # Create test polygon
        self.test_polygon = Polygon([(-104.99, 39.73), (-104.98, 39.73), (-104.98, 39.74), (-104.99, 39.74), (-104.99, 39.73)])

        # Valid polygon data formats
        self.valid_polygon_geojson = {
            "type": "Polygon",
            "coordinates": [[[-104.99, 39.73], [-104.98, 39.73], [-104.98, 39.74], [-104.99, 39.74], [-104.99, 39.73]]],
        }

        self.valid_polygon_coordinates = [[[-104.99, 39.73], [-104.98, 39.73], [-104.98, 39.74], [-104.99, 39.74], [-104.99, 39.73]]]

    def test_validate_request_data_success(self):
        """Test successful request data validation."""
        with self.app.test_request_context(
            "/", method="POST", data=json.dumps({"field1": "value1", "field2": "value2"}), content_type="application/json"
        ):
            result = validate_request_data(["field1", "field2"])

            # Success case returns (data, None)
            self.assertEqual(len(result), 2)
            data, error = result
            self.assertIsNotNone(data)
            self.assertIsNone(error)
            self.assertEqual(data["field1"], "value1")
            self.assertEqual(data["field2"], "value2")

    def test_validate_request_data_missing_field(self):
        """Test request data validation with missing field."""
        with self.app.test_request_context("/", method="POST", data=json.dumps({"field1": "value1"}), content_type="application/json"):
            result = validate_request_data(["field1", "field2"])

            # Error case returns (None, response, status_code)
            self.assertEqual(len(result), 3)
            data, error_response, status_code = result
            self.assertIsNone(data)
            self.assertIsNotNone(error_response)
            self.assertEqual(status_code, 400)

    def test_validate_request_data_no_data(self):
        """Test request data validation with no data."""
        with self.app.test_request_context("/", method="POST"):
            result = validate_request_data(["field1"])

            # Error case returns (None, response, status_code)
            self.assertEqual(len(result), 3)
            data, error_response, status_code = result
            self.assertIsNone(data)
            self.assertIsNotNone(error_response)
            self.assertEqual(status_code, 400)

    def test_validate_request_data_invalid_json(self):
        """Test request data validation with invalid JSON."""
        with self.app.test_request_context("/", method="POST", data="invalid json", content_type="application/json"):
            result = validate_request_data(["field1"])

            # Error case returns (None, response, status_code)
            self.assertEqual(len(result), 3)
            data, error_response, status_code = result
            self.assertIsNone(data)
            self.assertIsNotNone(error_response)
            self.assertEqual(status_code, 400)

    def test_parse_polygon_from_request_geojson(self):
        """Test parsing polygon from GeoJSON format."""
        with self.app.app_context():
            result = parse_polygon_from_request(self.valid_polygon_geojson)

            # Success case returns (polygon, None)
            self.assertEqual(len(result), 2)
            polygon, error = result
            self.assertIsNotNone(polygon)
            self.assertIsNone(error)
            self.assertIsInstance(polygon, Polygon)
            self.assertTrue(polygon.is_valid)

    def test_parse_polygon_from_request_coordinates(self):
        """Test parsing polygon from coordinates format."""
        with self.app.app_context():
            polygon_data = {"coordinates": self.valid_polygon_coordinates}
            result = parse_polygon_from_request(polygon_data)

            # Success case returns (polygon, None)
            self.assertEqual(len(result), 2)
            polygon, error = result
            self.assertIsNotNone(polygon)
            self.assertIsNone(error)
            self.assertIsInstance(polygon, Polygon)
            self.assertTrue(polygon.is_valid)

    def test_parse_polygon_from_request_coordinates_only(self):
        """Test parsing polygon from coordinates list only."""
        with self.app.app_context():
            result = parse_polygon_from_request(self.valid_polygon_coordinates)

            # Success case returns (polygon, None)
            self.assertEqual(len(result), 2)
            polygon, error = result
            self.assertIsNotNone(polygon)
            self.assertIsNone(error)
            self.assertIsInstance(polygon, Polygon)
            self.assertTrue(polygon.is_valid)

    def test_parse_polygon_from_request_invalid_data(self):
        """Test parsing polygon from invalid data."""
        with self.app.app_context():
            result = parse_polygon_from_request({"invalid": "data"})

            # Error case returns (None, response, status_code)
            self.assertEqual(len(result), 3)
            polygon, error_response, status_code = result
            self.assertIsNone(polygon)
            self.assertIsNotNone(error_response)
            self.assertEqual(status_code, 400)

    def test_parse_polygon_from_request_invalid_coordinates(self):
        """Test parsing polygon with invalid coordinates."""
        with self.app.app_context():
            invalid_coordinates = [
                [-104.99, 39.73],
                [-104.98, 39.73],  # Not enough points for a valid polygon
            ]

            result = parse_polygon_from_request(invalid_coordinates)

            # Error case returns (None, response, status_code)
            self.assertEqual(len(result), 3)
            polygon, error_response, status_code = result
            self.assertIsNone(polygon)
            self.assertIsNotNone(error_response)
            self.assertEqual(status_code, 400)

    def test_handle_service_exceptions_decorator(self):
        """Test the handle_service_exceptions decorator."""

        @handle_service_exceptions("test operation")
        def test_function():
            return "success"

        result = test_function()
        self.assertEqual(result, "success")

    def test_handle_service_exceptions_decorator_with_exception(self):
        """Test the handle_service_exceptions decorator with exception."""

        @handle_service_exceptions("test operation")
        def test_function():
            raise ValueError("Test error")

        with self.app.app_context(), patch("flask_app.services.common_service.log_error_with_context") as mock_log:
            result = test_function()

            # Should return a Flask response
            self.assertIsNotNone(result)
            mock_log.assert_called_once()

    @patch("logging.getLogger")
    def test_log_error_with_context(self, mock_get_logger):
        """Test error logging with context."""
        mock_logger = Mock()
        mock_get_logger.return_value = mock_logger

        try:
            raise ValueError("Test error")
        except ValueError as e:
            log_error_with_context("Test message", e)

            # Check that logger.error was called
            self.assertTrue(mock_logger.error.called)

    @patch("flask_app.services.file_processing_service.FileProcessingService.geodataframe_to_json")
    def test_create_geojson_response_success(self, mock_geodf_to_json):
        """Test successful GeoJSON response creation."""
        # Create test GeoDataFrame
        test_gdf = gpd.GeoDataFrame({"geometry": [self.test_polygon], "id": [1]})

        # Mock the conversion function
        mock_geodf_to_json.return_value = '{"type": "FeatureCollection", "features": []}'

        with self.app.app_context():
            response, status_code = create_geojson_response(test_gdf, "count")

            self.assertEqual(status_code, 200)
            self.assertIsNotNone(response)
            mock_geodf_to_json.assert_called_once_with(test_gdf)

    @patch("flask_app.services.file_processing_service.FileProcessingService.geodataframe_to_json")
    def test_create_geojson_response_error(self, mock_geodf_to_json):
        """Test GeoJSON response creation with error."""
        # Create test GeoDataFrame
        test_gdf = gpd.GeoDataFrame({"geometry": [self.test_polygon], "id": [1]})

        # Mock the conversion function to raise error
        mock_geodf_to_json.side_effect = Exception("Conversion error")

        with self.app.app_context():
            response, status_code = create_geojson_response(test_gdf, "count")

            self.assertEqual(status_code, 500)
            self.assertIsNotNone(response)

    def test_validate_polygon_data_valid_dict(self):
        """Test polygon data validation with valid dictionary."""
        with self.app.app_context():
            valid_data, error = validate_polygon_data(self.valid_polygon_geojson)

            self.assertIsNotNone(valid_data)
            self.assertIsNone(error)
            self.assertEqual(valid_data, self.valid_polygon_geojson)

    def test_validate_polygon_data_valid_list(self):
        """Test polygon data validation with valid list."""
        with self.app.app_context():
            valid_data, error = validate_polygon_data(self.valid_polygon_coordinates)

            self.assertIsNotNone(valid_data)
            self.assertIsNone(error)
            self.assertEqual(valid_data, self.valid_polygon_coordinates)

    def test_validate_polygon_data_no_data(self):
        """Test polygon data validation with no data."""
        with self.app.app_context():
            valid_data, error = validate_polygon_data(None)

            self.assertIsNone(valid_data)
            self.assertIsNotNone(error)

    def test_validate_polygon_data_invalid_format(self):
        """Test polygon data validation with invalid format."""
        with self.app.app_context():
            valid_data, error = validate_polygon_data({"invalid": "format"})

            self.assertIsNone(valid_data)
            self.assertIsNotNone(error)

    def test_validate_polygon_data_empty_list(self):
        """Test polygon data validation with empty list."""
        with self.app.app_context():
            valid_data, error = validate_polygon_data([])

            self.assertIsNone(valid_data)
            self.assertIsNotNone(error)

    def test_create_feature_properties(self):
        """Test feature properties creation."""
        property_names = ["street_address", "city", "state"]
        feature_length = 5

        properties, new_id = create_feature_properties(property_names, feature_length)

        self.assertEqual(len(properties), len(property_names))
        self.assertEqual(new_id, "5")

        for prop in property_names:
            self.assertIn(prop, properties)
            self.assertEqual(properties[prop], " ")

    def test_create_feature_properties_empty_list(self):
        """Test feature properties creation with empty list."""
        property_names = []
        feature_length = 0

        properties, new_id = create_feature_properties(property_names, feature_length)

        self.assertEqual(len(properties), 0)
        self.assertEqual(new_id, "0")

    def test_create_success_response(self):
        """Test success response creation."""
        data = {"key": "value"}
        message = "Operation successful"
        extra_fields = {"extra": "field"}

        response, status_code = create_success_response(data, message, extra_fields)

        self.assertEqual(status_code, 200)
        self.assertIsInstance(response, dict)
        self.assertEqual(response["message"], message)
        self.assertEqual(response["data"], data)
        self.assertEqual(response["extra"], "field")

    def test_create_success_response_minimal(self):
        """Test success response creation with minimal parameters."""
        data = {"key": "value"}

        response, status_code = create_success_response(data)

        self.assertEqual(status_code, 200)
        self.assertIsInstance(response, dict)
        self.assertEqual(response["message"], "success")
        self.assertEqual(response["data"], data)


if __name__ == "__main__":
    unittest.main()
