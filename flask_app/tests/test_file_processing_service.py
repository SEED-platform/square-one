"""
Tests for the file processing service.
"""

import json
import unittest
from unittest.mock import Mock, patch

import geopandas as gpd
import pandas as pd
from flask_app.services.file_processing_service import FileProcessingService
from shapely.geometry import Point


class TestFileProcessingService(unittest.TestCase):
    """Test cases for file processing service."""

    def setUp(self):
        """Set up test fixtures before each test method."""
        self.service = FileProcessingService()

        # Sample data for testing
        self.sample_data = [
            {"street_address": "123 Main St", "city": "Denver", "state": "CO"},
            {"street_address": "456 Oak Ave", "city": "Boulder", "state": "Colorado"},
        ]

        self.sample_geojson = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-105.0, 40.0]}, "properties": {"name": "Test Point"}}
            ],
        }

    def test_process_json_file_success(self):
        """Test successful JSON file processing."""
        # Create mock file
        mock_file = Mock()
        mock_file.content_type = "application/json"
        mock_file.read.return_value = json.dumps(self.sample_data).encode("utf-8")

        result, error = self.service.process_uploaded_file(mock_file)

        self.assertIsNone(error)
        self.assertEqual(result, self.sample_data)

    def test_process_csv_file_success(self):
        """Test successful CSV file processing."""
        mock_file = Mock()
        mock_file.content_type = "text/csv"

        with patch("pandas.read_csv") as mock_read_csv:
            mock_df = pd.DataFrame(self.sample_data)
            mock_read_csv.return_value = mock_df

            result, error = self.service.process_uploaded_file(mock_file)

            self.assertIsNone(error)
            self.assertEqual(len(result), 2)
            mock_read_csv.assert_called_once_with(mock_file)

    def test_process_excel_file_success(self):
        """Test successful Excel file processing."""
        mock_file = Mock()
        mock_file.content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        with patch("pandas.read_excel") as mock_read_excel:
            mock_df = pd.DataFrame(self.sample_data)
            mock_read_excel.return_value = mock_df

            result, error = self.service.process_uploaded_file(mock_file)

            self.assertIsNone(error)
            self.assertEqual(len(result), 2)
            mock_read_excel.assert_called_once_with(mock_file)

    def test_process_geojson_file_success(self):
        """Test successful GeoJSON file processing."""
        mock_file = Mock()
        mock_file.content_type = "application/geo+json"

        with patch("geopandas.read_file") as mock_read_file:
            # Create a mock GeoDataFrame
            mock_gdf = Mock()
            mock_gdf.to_json.return_value = json.dumps(self.sample_geojson)
            mock_read_file.return_value = mock_gdf

            result, error = self.service.process_uploaded_file(mock_file)

            self.assertIsNone(error)
            self.assertEqual(result, self.sample_geojson)
            mock_read_file.assert_called_once_with(mock_file)

    def test_process_unsupported_file_type(self):
        """Test processing unsupported file type."""
        mock_file = Mock()
        mock_file.content_type = "application/unsupported"

        result, error = self.service.process_uploaded_file(mock_file)

        self.assertIsNone(result)
        self.assertIn("Unsupported file type", error)

    def test_process_no_file(self):
        """Test processing with no file provided."""
        result, error = self.service.process_uploaded_file(None)

        self.assertIsNone(result)
        self.assertEqual(error, "No file provided")

    def test_process_json_file_invalid_json(self):
        """Test JSON file processing with invalid JSON."""
        mock_file = Mock()
        mock_file.content_type = "application/json"
        mock_file.read.return_value = b"invalid json content"

        result, error = self.service.process_uploaded_file(mock_file)

        self.assertIsNone(result)
        self.assertIn("Error processing uploaded file", error)

    def test_geodataframe_to_json_success(self):
        """Test successful GeoDataFrame to JSON conversion."""
        # Create test GeoDataFrame
        gdf = gpd.GeoDataFrame({"name": ["Point1", "Point2"], "geometry": [Point(-105.0, 40.0), Point(-104.0, 39.0)]})

        result = self.service.geodataframe_to_json(gdf)

        self.assertIsInstance(result, str)
        parsed = json.loads(result)
        self.assertEqual(parsed["type"], "FeatureCollection")
        self.assertEqual(len(parsed["features"]), 2)

    def test_geodataframe_to_json_empty(self):
        """Test GeoDataFrame to JSON conversion with empty dataframe."""
        gdf = gpd.GeoDataFrame()

        result = self.service.geodataframe_to_json(gdf)

        self.assertIsInstance(result, str)
        parsed = json.loads(result)
        self.assertEqual(parsed["type"], "FeatureCollection")
        self.assertEqual(len(parsed["features"]), 0)

    def test_validate_required_columns_success(self):
        """Test successful data validation."""
        valid_data = [
            {"street_address": "123 Main St", "city": "Denver", "state": "CO"},
            {"Street_Address": "456 Oak Ave", "City": "Boulder", "State": "Colorado"},
        ]

        is_valid, error = self.service.validate_required_columns(valid_data)

        self.assertTrue(is_valid)
        self.assertIsNone(error)

    def test_validate_required_columns_missing_street(self):
        """Test validation with missing street address."""
        invalid_data = [{"city": "Denver", "state": "CO"}]

        is_valid, error = self.service.validate_required_columns(invalid_data)

        self.assertFalse(is_valid)
        self.assertIn("Missing street address field", error)

    def test_validate_required_columns_missing_city(self):
        """Test validation with missing city."""
        invalid_data = [{"street_address": "123 Main St", "state": "CO"}]

        is_valid, error = self.service.validate_required_columns(invalid_data)

        self.assertFalse(is_valid)
        self.assertIn("Missing city field", error)

    def test_validate_required_columns_missing_state(self):
        """Test validation with missing state."""
        invalid_data = [{"street_address": "123 Main St", "city": "Denver"}]

        is_valid, error = self.service.validate_required_columns(invalid_data)

        self.assertFalse(is_valid)
        self.assertIn("Missing state field", error)

    def test_validate_required_columns_invalid_data_type(self):
        """Test validation with invalid data type."""
        invalid_data = [{"street_address": "123 Main St", "city": "Denver", "state": "CO", "complex_field": {"nested": "object"}}]

        is_valid, error = self.service.validate_required_columns(invalid_data)

        self.assertFalse(is_valid)
        self.assertIn("Invalid data type", error)

    def test_validate_required_columns_empty_data(self):
        """Test validation with empty data."""
        is_valid, error = self.service.validate_required_columns([])

        self.assertFalse(is_valid)
        self.assertEqual(error, "No data provided")


if __name__ == "__main__":
    unittest.main()
