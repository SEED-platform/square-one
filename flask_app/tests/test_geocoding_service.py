"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/cbl-web-tool/blob/main/LICENSE.md
"""

import json
import unittest
from unittest.mock import Mock, patch

from flask_app.services.geocoding_service import GeocodingService
from shapely.geometry import Polygon


class TestGeocodingService(unittest.TestCase):
    """Test cases for GeocodingService."""

    def setUp(self):
        """Set up test fixtures before each test method."""
        self.service = GeocodingService()

        # Create a simple test polygon (roughly a square)
        self.test_polygon = Polygon([(-104.99, 39.73), (-104.98, 39.73), (-104.98, 39.74), (-104.99, 39.74), (-104.99, 39.73)])

        self.property_names = ["street_address", "city", "state", "postal_code", "country"]

        # Sample Mapbox API response
        self.sample_mapbox_response = {
            "features": [
                {
                    "place_name": "123 Main St, Denver, Colorado 80202, United States",
                    "properties": {"address": "123 Main Street"},
                    "context": [
                        {"id": "place.123", "text": "Denver"},
                        {"id": "region.456", "text": "Colorado"},
                        {"id": "postcode.789", "text": "80202"},
                        {"id": "country.101", "text": "United States"},
                    ],
                }
            ]
        }

    @patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": "test_token"})
    def test_init_with_token(self):
        """Test service initialization with Mapbox token."""
        service = GeocodingService()
        self.assertEqual(service.mapbox_token, "test_token")

    @patch.dict("os.environ", {}, clear=True)
    def test_init_without_token(self):
        """Test service initialization without Mapbox token."""
        with patch("flask_app.services.geocoding_service.logging.getLogger") as mock_logger:
            mock_logger_instance = Mock()
            mock_logger.return_value = mock_logger_instance

            service = GeocodingService()

            self.assertIsNone(service.mapbox_token)
            mock_logger_instance.warning.assert_called_with("MAPBOX_ACCESS_TOKEN not found in environment variables")

    @patch("flask_app.services.geocoding_service.encode_ubid")
    @patch("flask_app.services.geocoding_service.requests.get")
    @patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": "test_token"})
    def test_reverse_geocode_polygon_success(self, mock_requests, mock_encode_ubid):
        """Test successful reverse geocoding of a polygon."""
        # Mock UBID encoding
        mock_encode_ubid.return_value = "test_ubid_12345"

        # Mock successful API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = self.sample_mapbox_response
        mock_response.text = json.dumps(self.sample_mapbox_response)
        mock_requests.return_value = mock_response

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(error)
        self.assertIsNotNone(result)
        self.assertIn("ubid", result)
        self.assertIn("latitude", result)
        self.assertIn("longitude", result)
        self.assertIn("street_address", result)
        self.assertIn("city", result)
        self.assertIn("state", result)
        self.assertIn("postal_code", result)
        self.assertIn("country", result)

        self.assertEqual(result["ubid"], "test_ubid_12345")
        self.assertEqual(result["city"], "Denver")
        self.assertEqual(result["state"], "Colorado")
        self.assertEqual(result["postal_code"], "80202")
        self.assertEqual(result["country"], "United States")

        # Verify API call was made
        mock_requests.assert_called_once()
        call_args = mock_requests.call_args
        self.assertIn("mapbox.places", call_args[0][0])

    @patch("flask_app.services.geocoding_service.encode_ubid")
    def test_reverse_geocode_polygon_no_token(self, mock_encode_ubid):
        """Test reverse geocoding without Mapbox token."""
        # Mock UBID encoding
        mock_encode_ubid.return_value = "test_ubid_12345"

        # Service without token
        service = GeocodingService()
        service.mapbox_token = None

        result, error = service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(error)
        self.assertIsNotNone(result)

        # Should have default values
        self.assertEqual(result["street_address"], "Unknown")
        self.assertEqual(result["city"], "Unknown")
        self.assertEqual(result["state"], "Unknown")
        self.assertEqual(result["postal_code"], "Unknown")
        self.assertEqual(result["country"], "Unknown")

    @patch("flask_app.services.geocoding_service.encode_ubid")
    def test_reverse_geocode_polygon_ubid_error(self, mock_encode_ubid):
        """Test reverse geocoding with UBID encoding error."""
        # Mock UBID encoding to raise AssertionError
        mock_encode_ubid.side_effect = AssertionError("Invalid coordinates")

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(result)
        self.assertEqual(error, "Invalid longitude coordinates")

    @patch("flask_app.services.geocoding_service.encode_ubid")
    def test_reverse_geocode_polygon_ubid_general_error(self, mock_encode_ubid):
        """Test reverse geocoding with general UBID encoding error."""
        # Mock UBID encoding to raise general Exception
        mock_encode_ubid.side_effect = Exception("UBID encoding failed")

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(result)
        self.assertIn("Error encoding UBID", error)

    @patch("flask_app.services.geocoding_service.encode_ubid")
    @patch("flask_app.services.geocoding_service.requests.get")
    @patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": "test_token"})
    def test_reverse_geocode_polygon_api_auth_error(self, mock_requests, mock_encode_ubid):
        """Test reverse geocoding with API authentication error."""
        # Mock UBID encoding
        mock_encode_ubid.return_value = "test_ubid_12345"

        # Mock API authentication error
        mock_response = Mock()
        mock_response.status_code = 401
        mock_requests.return_value = mock_response

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(result)
        self.assertIn("Could not reverse geocode using the mapbox API", error)

    @patch("flask_app.services.geocoding_service.encode_ubid")
    @patch("flask_app.services.geocoding_service.requests.get")
    @patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": "test_token"})
    def test_reverse_geocode_polygon_request_error(self, mock_requests, mock_encode_ubid):
        """Test reverse geocoding with request error."""
        # Mock UBID encoding
        mock_encode_ubid.return_value = "test_ubid_12345"

        # Mock request exception
        mock_requests.side_effect = Exception("Network error")

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(result)
        self.assertIn("Error making API request", error)

    @patch("flask_app.services.geocoding_service.encode_ubid")
    @patch("flask_app.services.geocoding_service.requests.get")
    @patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": "test_token"})
    def test_reverse_geocode_polygon_json_decode_error(self, mock_requests, mock_encode_ubid):
        """Test reverse geocoding with JSON decode error."""
        # Mock UBID encoding
        mock_encode_ubid.return_value = "test_ubid_12345"

        # Mock invalid JSON response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)
        mock_response.text = "invalid json"
        mock_requests.return_value = mock_response

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(result)
        self.assertIn("Invalid JSON response from API", error)

    @patch("flask_app.services.geocoding_service.encode_ubid")
    @patch("flask_app.services.geocoding_service.requests.get")
    @patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": "test_token"})
    def test_reverse_geocode_polygon_no_features(self, mock_requests, mock_encode_ubid):
        """Test reverse geocoding with no features in response."""
        # Mock UBID encoding
        mock_encode_ubid.return_value = "test_ubid_12345"

        # Mock response with no features
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"features": []}
        mock_response.text = '{"features": []}'
        mock_requests.return_value = mock_response

        result, error = self.service.reverse_geocode_polygon(self.test_polygon, self.property_names)

        self.assertIsNone(error)
        self.assertIsNotNone(result)

        # Should have default values
        self.assertEqual(result["street_address"], "Unknown")
        self.assertEqual(result["city"], "Unknown")
        self.assertEqual(result["state"], "Unknown")
        self.assertEqual(result["postal_code"], "Unknown")
        self.assertEqual(result["country"], "Unknown")

    def test_set_default_address_values(self):
        """Test setting default address values."""
        properties = {}
        self.service._set_default_address_values(properties)

        self.assertEqual(properties["street_address"], "Unknown")
        self.assertEqual(properties["city"], "Unknown")
        self.assertEqual(properties["state"], "Unknown")
        self.assertEqual(properties["postal_code"], "Unknown")
        self.assertEqual(properties["country"], "Unknown")

    def test_process_mapbox_result_with_context(self):
        """Test processing Mapbox result with full context."""
        properties = {}
        self.service._process_mapbox_result(properties, self.sample_mapbox_response)

        self.assertEqual(properties["city"], "Denver")
        self.assertEqual(properties["state"], "Colorado")
        self.assertEqual(properties["postal_code"], "80202")
        self.assertEqual(properties["country"], "United States")
        self.assertEqual(properties["street_address"], "123 Main Street")

    def test_process_mapbox_result_minimal_context(self):
        """Test processing Mapbox result with minimal context."""
        minimal_response = {"features": [{"place_name": "Some Place", "context": [{"id": "place.123", "text": "SomeCity"}]}]}

        properties = {}
        self.service._process_mapbox_result(properties, minimal_response)

        self.assertEqual(properties["city"], "SomeCity")
        self.assertEqual(properties["state"], "Unknown")  # Should have defaults
        self.assertEqual(properties["street_address"], "Some Place")

    def test_process_mapbox_result_with_feature_properties(self):
        """Test processing Mapbox result with feature properties."""
        response_with_props = {"features": [{"place_name": "123 Main St", "properties": {"address": "123 Main Street"}, "context": []}]}

        properties = {}
        self.service._process_mapbox_result(properties, response_with_props)

        self.assertEqual(properties["street_address"], "123 Main Street")

    def test_polygon_centroid_calculation(self):
        """Test that polygon centroid is calculated correctly."""
        # Create a polygon where we know the centroid
        square_polygon = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])

        with patch("flask_app.services.geocoding_service.encode_ubid") as mock_encode_ubid:
            mock_encode_ubid.return_value = "test_ubid"

            service = GeocodingService()
            service.mapbox_token = None  # Skip API call

            result, error = service.reverse_geocode_polygon(square_polygon, self.property_names)

            # Centroid of the square should be (1, 1)
            self.assertEqual(result["latitude"], "1.0")
            self.assertEqual(result["longitude"], "1.0")


if __name__ == "__main__":
    unittest.main()
