"""
Tests for the data transformation service.
"""

import unittest
from unittest.mock import patch

from flask_app.services.data_transformation_service import DataTransformationService


class TestDataTransformationService(unittest.TestCase):
    """Test cases for data transformation service."""

    def setUp(self):
        """Set up test fixtures before each test method."""
        self.service = DataTransformationService()

        # Sample data for testing
        self.sample_records = [
            {"street_address": "123 Main St", "city": "Denver", "state": "Colorado"},
            {"Street_Address": "456 Oak Ave", "City": "Boulder", "State": "CO"},
        ]

    def test_generate_locations_list_success(self):
        """Test successful location list generation."""
        with patch("flask_app.services.logging_utils.log_error_with_context"):
            result = self.service.generate_locations_list(self.sample_records)

            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["street"], "123 Main St")
            self.assertEqual(result[0]["city"], "Denver")
            self.assertEqual(result[0]["state"], "CO")  # Should be normalized

            self.assertEqual(result[1]["street"], "456 Oak Ave")
            self.assertEqual(result[1]["city"], "Boulder")
            self.assertEqual(result[1]["state"], "CO")

    def test_generate_locations_list_missing_fields(self):
        """Test location list generation with missing fields."""
        incomplete_records = [
            {"city": "Denver"},  # Missing street and state
            {"street_address": "456 Oak Ave"},  # Missing city and state
        ]

        result = self.service.generate_locations_list(incomplete_records)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["street"], "")
        self.assertEqual(result[0]["city"], "Denver")
        self.assertEqual(result[0]["state"], "")

        self.assertEqual(result[1]["street"], "456 Oak Ave")
        self.assertEqual(result[1]["city"], "")
        self.assertEqual(result[1]["state"], "")

    def test_extract_field_case_insensitive(self):
        """Test field extraction with case insensitive matching."""
        record = {"Street_Address": "123 Main St", "CITY": "Denver", "state": "CO"}

        street = self.service._extract_field(record, "street_address")
        city = self.service._extract_field(record, "city")
        state = self.service._extract_field(record, "STATE")

        self.assertEqual(street, "123 Main St")
        self.assertEqual(city, "Denver")
        self.assertEqual(state, "CO")

    def test_extract_field_not_found(self):
        """Test field extraction when field doesn't exist."""
        record = {"other_field": "value"}

        result = self.service._extract_field(record, "street_address")

        self.assertIsNone(result)

    def test_normalize_state_full_name(self):
        """Test state normalization with full state names."""
        test_cases = [
            ("colorado", "CO"),
            ("Colorado", "CO"),
            ("COLORADO", "CO"),
            ("california", "CA"),
            ("new york", "NY"),
            ("district of columbia", "DC"),
        ]

        for input_state, expected in test_cases:
            result = self.service.normalize_state(input_state)
            self.assertEqual(result, expected, f"Failed for input: {input_state}")

    def test_normalize_state_abbreviation(self):
        """Test state normalization with abbreviations."""
        test_cases = [("co", "CO"), ("CO", "CO"), ("ca", "CA"), ("NY", "NY")]

        for input_state, expected in test_cases:
            result = self.service.normalize_state(input_state)
            self.assertEqual(result, expected, f"Failed for input: {input_state}")

    def test_normalize_state_unknown(self):
        """Test state normalization with unknown state."""
        result = self.service.normalize_state("Unknown State")
        self.assertEqual(result, "UNKNOWN STATE")

    def test_normalize_state_empty(self):
        """Test state normalization with empty string."""
        result = self.service.normalize_state("")
        self.assertEqual(result, "")

        result = self.service.normalize_state(None)
        self.assertEqual(result, "")

    def test_merge_location_data_success(self):
        """Test successful location data merging."""
        file_dict = {
            "name": "Building A",
            "height": "50",
            "street_address": "Old Address",  # Should not overwrite API data
        }

        api_dict = {
            "address": "123 Main St",
            "longitude": -105.0,
            "latitude": 40.0,
            "side_of_street": "left",  # Should be excluded
            "neighborhood": "Downtown",
        }

        result = self.service.merge_location_data(file_dict, api_dict)

        self.assertEqual(result["street_address"], "123 Main St")
        self.assertEqual(result["name"], "Building A")
        self.assertEqual(result["height"], "50")
        self.assertEqual(result["longitude"], -105.0)
        self.assertEqual(result["latitude"], 40.0)
        self.assertNotIn("side_of_street", result)

    def test_merge_location_data_missing_address(self):
        """Test location data merging with missing address."""
        file_dict = {"name": "Building A"}
        api_dict = {"address": None, "longitude": -105.0}

        result = self.service.merge_location_data(file_dict, api_dict)

        self.assertEqual(result["street_address"], "Missing Address")
        self.assertEqual(result["name"], "Building A")
        self.assertEqual(result["longitude"], -105.0)

    def test_remove_duplicate_values(self):
        """Test removal of duplicate values."""
        data_dict = {
            "field1": "value1",
            "field2": "value2",
            "field3": "value1",  # Duplicate
            "field4": "value3",
        }

        result = self.service._remove_duplicate_values(data_dict)

        # Should keep first occurrence of each value
        self.assertIn("field1", result)
        self.assertNotIn("field3", result)  # Duplicate should be removed
        self.assertIn("field2", result)
        self.assertIn("field4", result)
        self.assertEqual(len(result), 3)

    def test_standardize_address_fields_success(self):
        """Test successful address field standardization."""
        data = [
            {"street_addr": "123 Main St", "municipality": "Denver", "province": "Colorado", "zip": "80202"},
            {"address": "456 Oak Ave", "city": "Boulder", "state": "CO", "postal_code": "80301"},
        ]

        result = self.service.standardize_address_fields(data)

        self.assertEqual(len(result), 2)

        # Check first record
        self.assertEqual(result[0]["street_address"], "123 Main St")
        self.assertEqual(result[0]["city"], "Denver")
        self.assertEqual(result[0]["state"], "CO")
        self.assertEqual(result[0]["postal_code"], "80202")

        # Check second record
        self.assertEqual(result[1]["street_address"], "456 Oak Ave")
        self.assertEqual(result[1]["city"], "Boulder")
        self.assertEqual(result[1]["state"], "CO")
        self.assertEqual(result[1]["postal_code"], "80301")

    def test_standardize_address_fields_with_normalization(self):
        """Test address field standardization with state normalization."""
        data = [
            {
                "address": "123 Main St",
                "city": "Denver",
                "state": "Colorado",  # Should be normalized to CO
            }
        ]

        result = self.service.standardize_address_fields(data)

        self.assertEqual(result[0]["state"], "CO")

    def test_standardize_address_fields_preserve_other_fields(self):
        """Test that standardization preserves non-address fields."""
        data = [{"street_address": "123 Main St", "city": "Denver", "state": "CO", "building_type": "Commercial", "height": 50}]

        result = self.service.standardize_address_fields(data)

        self.assertEqual(result[0]["building_type"], "Commercial")
        self.assertEqual(result[0]["height"], 50)

    def test_merge_dicts_success(self):
        """Test successful dictionary merging."""
        dict1 = {"name": "Test", "city": "Denver", "original_field": "value1"}
        dict2 = {"city": "Boulder", "state": "CO", "processed_field": "value2"}

        result = self.service.merge_dicts(dict1, dict2)

        # dict2 values should override dict1
        self.assertEqual(result["city"], "Boulder")
        # dict1 values should remain if not in dict2
        self.assertEqual(result["name"], "Test")
        self.assertEqual(result["original_field"], "value1")
        # dict2 values should be included
        self.assertEqual(result["state"], "CO")
        self.assertEqual(result["processed_field"], "value2")

    def test_merge_dicts_empty_dicts(self):
        """Test merging empty dictionaries."""
        dict1 = {}
        dict2 = {}

        result = self.service.merge_dicts(dict1, dict2)

        self.assertEqual(result, {})

    def test_merge_dicts_one_empty(self):
        """Test merging with one empty dictionary."""
        dict1 = {"key1": "value1"}
        dict2 = {}

        result = self.service.merge_dicts(dict1, dict2)

        self.assertEqual(result, {"key1": "value1"})

        # Test other way around
        dict1 = {}
        dict2 = {"key2": "value2"}

        result = self.service.merge_dicts(dict1, dict2)

        self.assertEqual(result, {"key2": "value2"})


if __name__ == "__main__":
    unittest.main()
