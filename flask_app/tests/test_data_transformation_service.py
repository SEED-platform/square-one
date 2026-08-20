"""
Tests for the data transformation service.
"""

import csv
import os
import tempfile
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

    def test_extract_coordinates_valid(self):
        """Test extracting a valid latitude/longitude pair."""
        record = {"Latitude": "39.7392", "Longitude": "-104.9903"}

        result = self.service.extract_coordinates(record)

        self.assertEqual(result, (39.7392, -104.9903))

    def test_extract_coordinates_missing(self):
        """Test extracting coordinates when latitude/longitude are absent."""
        record = {"street_address": "123 Main St"}

        result = self.service.extract_coordinates(record)

        self.assertIsNone(result)

    def test_extract_coordinates_zero_sentinel(self):
        """Test that (0, 0) is treated as a missing/sentinel coordinate."""
        record = {"latitude": "0", "longitude": "0"}

        result = self.service.extract_coordinates(record)

        self.assertIsNone(result)

    def test_extract_coordinates_out_of_range(self):
        """Test that out-of-range coordinates are rejected."""
        record = {"latitude": "200", "longitude": "-104.99"}

        result = self.service.extract_coordinates(record)

        self.assertIsNone(result)

    def test_extract_coordinates_non_numeric(self):
        """Test that non-numeric latitude/longitude values are rejected."""
        record = {"latitude": "unknown", "longitude": "-104.99"}

        result = self.service.extract_coordinates(record)

        self.assertIsNone(result)

    def test_build_provided_coordinate_datum(self):
        """Test building a geocode-result-shaped dict from a record with provided coordinates."""
        record = {"postal_code": "80202", "country": "US"}
        location = {"street": "123 Main St", "city": "Denver", "state": "CO"}

        result = self.service.build_provided_coordinate_datum(record, location, 39.7392, -104.9903)

        self.assertEqual(result["quality"], "Provided")
        self.assertEqual(result["address"], "123 Main St")
        self.assertEqual(result["latitude"], 39.7392)
        self.assertEqual(result["longitude"], -104.9903)
        self.assertEqual(result["city"], "Denver")
        self.assertEqual(result["state"], "CO")
        self.assertEqual(result["postal_code"], "80202")
        self.assertEqual(result["country"], "US")

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

    def test_assign_target_eui_success(self):
        """Test successful EUI assignment with mock CSV data."""
        # Create temporary CSV file for testing
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as temp_file:
            writer = csv.writer(temp_file)
            writer.writerow(["building_type", "climate_zone", "year_built", "weekly_hours", "gfa", "twenty_fifth_percentile"])
            # Create exact match for the inputs we'll provide
            writer.writerow(["Office", "All", "2000-2009", "40-48", "10,000 - 24,999", "45.2"])
            temp_csv_path = temp_file.name

        # Test the CSV lookup directly
        result = self.service._perform_csv_lookup(
            csv_file=temp_csv_path,
            lookup_field="building_type",
            building_type="Office",
            climate_zone="All",
            year_built_range="2000-2009",
            weekly_hours_range="40-48",
            gfa_range="10,000 - 24,999",
        )

        self.assertEqual(result["P25 target EUI"], 45.2)
        self.assertIn("exact match", result["eui_message"])

        # Clean up
        os.unlink(temp_csv_path)

    def test_assign_target_eui_with_relaxation(self):
        """Test EUI assignment with field relaxation strategy."""
        # Create CSV with relaxation scenario
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as temp_file:
            writer = csv.writer(temp_file)
            writer.writerow(["building_type", "climate_zone", "year_built", "weekly_hours", "gfa", "twenty_fifth_percentile"])
            # No exact match - should relax weekly_hours
            writer.writerow(["Office", "1A", "2000-2009", "All", "10,000 - 24,999", "42.8"])
            temp_csv_path = temp_file.name

        # Test the CSV lookup directly with relaxation
        result = self.service._perform_csv_lookup(
            csv_file=temp_csv_path,
            lookup_field="building_type",
            building_type="Office",
            climate_zone="1A",
            year_built_range="2000-2009",
            weekly_hours_range="48.01 - 60",  # This won't match, should trigger relaxation to "All"
            gfa_range="10,000 - 24,999",
        )

        self.assertEqual(result["P25 target EUI"], 42.8)
        self.assertIn("relaxed weekly_hours", result["eui_message"])

        # Clean up
        os.unlink(temp_csv_path)

    def test_assign_target_eui_no_specific_values(self):
        """Test EUI assignment when all secondary fields are 'All'."""
        with patch.object(self.service, "building_types", {"Office"}), patch.object(self.service, "climate_zones", {"1A"}):
            buildings = [
                {
                    "building_type": "Office",
                    "climate_zone": "",  # Will become 'All'
                    "year_built": "",  # Will become 'All'
                    "weekly_hours": "",  # Will become 'All'
                    "gross_floor_area": "",  # Will become 'All'
                }
            ]

            result = self.service.assign_target_eui(buildings)

            self.assertEqual(len(result), 1)
            self.assertIsNone(result[0]["P25 target EUI"])
            self.assertIn("no specific building characteristics", result[0]["eui_message"])

    def test_assign_target_eui_removes_existing_columns(self):
        """Test that existing EUI columns are removed before assignment."""
        buildings = [
            {"building_type": "Office", "P25 target EUI": "old_value", "eui_message": "old_message", "some_other_field": "keep_this"}
        ]

        with patch.object(self.service, "_lookup_eui_data") as mock_lookup:
            mock_lookup.return_value = {"P25 target EUI": 45.2, "eui_message": "new_message"}

            result = self.service.assign_target_eui(buildings)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["P25 target EUI"], 45.2)
            self.assertEqual(result[0]["eui_message"], "new_message")
            self.assertEqual(result[0]["some_other_field"], "keep_this")

    def test_convert_year_to_range(self):
        """Test year conversion to ESPM ranges."""
        # Test various year inputs
        test_cases = [
            (1950, "1946-1959"),
            (1965, "1960-1979"),
            (1985, "1980-1999"),
            (2005, "2000-2009"),
            (2015, "2010 and after"),
            (1940, "Before 1946"),
            ("", "All"),
            (None, "All"),
            ("invalid", "All"),
            ("1995", "1980-1999"),  # Test string input
            ("2005", "2000-2009"),  # Test string input
        ]

        for year_input, expected_range in test_cases:
            with self.subTest(year=year_input):
                result = self.service._convert_year_to_range(year_input)
                self.assertEqual(result, expected_range)

    def test_convert_weekly_hours_to_range(self):
        """Test weekly hours conversion to ESPM ranges."""
        test_cases = [
            (35, "Fewer than 40"),
            (44, "40-48"),
            (55, "48.01 - 60"),
            (65, "60.01 - 84"),
            (100, "84.01-167"),
            (180, "Open Continuously"),
            ("", "All"),
            (None, "All"),
            ("invalid", "All"),
            ("44", "40-48"),  # Test string input
            ("55", "48.01 - 60"),  # Test string input
        ]

        for hours_input, expected_range in test_cases:
            with self.subTest(hours=hours_input):
                result = self.service._convert_weekly_hours_to_range(hours_input)
                self.assertEqual(result, expected_range)

    def test_convert_gfa_to_range(self):
        """Test GFA conversion to ESMP ranges."""
        test_cases = [
            (2500, "1,000 - 4,999"),
            (7500, "5,000 - 9,999"),
            (15000, "10,000 - 24,999"),
            (35000, "25,000 - 49,999"),
            (75000, "50,000 - 99,999"),
            (150000, "100,000 - 199,999"),
            (350000, "200,000 - 499,999"),
            (750000, "500,000 - 999,999"),
            (1500000, "1,000,000+"),
            ("", "All"),
            (None, "All"),
            ("invalid", "All"),
        ]

        for gfa_input, expected_range in test_cases:
            with self.subTest(gfa=gfa_input):
                result = self.service._convert_gfa_to_range(gfa_input)
                self.assertEqual(result, expected_range)

    def test_lookup_eui_data_building_subtype(self):
        """Test EUI lookup for building subtype vs main type."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as temp_category:
            writer = csv.writer(temp_category)
            writer.writerow(["building_type", "climate_zone", "year_built", "weekly_hours", "gfa", "twenty_fifth_percentile"])
            writer.writerow(["Office", "1A", "All", "All", "All", "50.0"])
            temp_category_path = temp_category.name

        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as temp_subcategory:
            writer = csv.writer(temp_subcategory)
            writer.writerow(["building_subtype", "climate_zone", "year_built", "weekly_hours", "gfa", "twenty_fifth_percentile"])
            writer.writerow(["Bank Branch", "1A", "All", "All", "All", "35.0"])
            temp_subcategory_path = temp_subcategory.name

        with (
            patch.object(self.service, "category_file", temp_category_path),
            patch.object(self.service, "subcategory_file", temp_subcategory_path),
            patch.object(self.service, "building_types", {"Office"}),
            patch.object(self.service, "building_subtypes", {"Bank Branch"}),
            patch.object(self.service, "climate_zones", {"1A"}),  # Include '1A' as valid
        ):
            # Test main building type
            building_main = {"building_type": "Office", "climate_zone": "1A"}  # Specific climate zone
            result_main = self.service._lookup_eui_data(building_main)
            self.assertEqual(result_main["P25 target EUI"], 50.0)

            # Test building subtype
            building_sub = {"building_type": "Bank Branch", "climate_zone": "1A"}  # Specific climate zone
            result_sub = self.service._lookup_eui_data(building_sub)
            self.assertEqual(result_sub["P25 target EUI"], 35.0)

        os.unlink(temp_category_path)
        os.unlink(temp_subcategory_path)

    def test_perform_csv_lookup_four_tier_relaxation(self):
        """Test the 4-tier hierarchical relaxation strategy."""
        # Create CSV with specific match pattern for relaxation testing
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as temp_file:
            writer = csv.writer(temp_file)
            writer.writerow(["building_type", "climate_zone", "year_built", "weekly_hours", "gfa", "twenty_fifth_percentile"])
            # Only match after relaxing weekly_hours, year_built, and gfa
            writer.writerow(["Office", "1A", "All", "All", "All", "40.0"])
            temp_csv_path = temp_file.name

        # Test that it finds match at tier 4 (all fields relaxed except building_type and climate_zone)
        result = self.service._perform_csv_lookup(
            csv_file=temp_csv_path,
            lookup_field="building_type",
            building_type="Office",
            climate_zone="1A",
            year_built_range="2000-2009",  # Won't match
            weekly_hours_range="40-48",  # Won't match
            gfa_range="10,000 - 24,999",  # Won't match
        )

        self.assertEqual(result["P25 target EUI"], 40.0)
        self.assertIn("relaxed weekly_hours, year_built, and gfa", result["eui_message"])

        os.unlink(temp_csv_path)

    def test_lookup_eui_data_invalid_building_type(self):
        """Test EUI lookup with invalid building type falls back to 'All'."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as temp_file:
            writer = csv.writer(temp_file)
            writer.writerow(["building_type", "climate_zone", "year_built", "weekly_hours", "gfa", "twenty_fifth_percentile"])
            writer.writerow(["All", "1A", "All", "All", "All", "45.0"])
            temp_csv_path = temp_file.name

        with (
            patch.object(self.service, "category_file", temp_csv_path),
            patch.object(self.service, "building_types", {"Office"}),
            patch.object(self.service, "building_subtypes", set()),
            patch.object(self.service, "climate_zones", {"1A"}),  # Include '1A' as valid
        ):
            building = {
                "building_type": "UnknownType",
                "climate_zone": "1A",  # Specific climate zone provides specificity
                "year_built": "",  # Empty will become 'All'
                "weekly_hours": "",  # Empty will become 'All'
                "gross_floor_area": "",  # Empty will become 'All'
            }

            result = self.service._lookup_eui_data(building)

            self.assertEqual(result["P25 target EUI"], 45.0)

        os.unlink(temp_csv_path)

    def test_remove_existing_eui_columns(self):
        """Test removal of existing EUI columns."""
        buildings = [
            {
                "building_type": "Office",
                "P25 target EUI": "old_value",
                "eui_message": "old_message",
                "eui_relaxed_fields": "old_relaxed",
                "keep_this": "value",
            },
            {"building_type": "Retail", "some_field": "another_value"},
        ]

        # Test the method on each building individually
        for building in buildings:
            building_copy = building.copy()
            self.service._remove_existing_eui_columns(building_copy)

            if building["building_type"] == "Office":
                # First building should have EUI columns removed
                self.assertNotIn("P25 target EUI", building_copy)
                self.assertNotIn("eui_message", building_copy)
                self.assertNotIn("eui_relaxed_fields", building_copy)
                self.assertIn("keep_this", building_copy)
                self.assertIn("building_type", building_copy)
            else:
                # Second building should remain unchanged
                self.assertEqual(building_copy["building_type"], "Retail")
                self.assertEqual(building_copy["some_field"], "another_value")


if __name__ == "__main__":
    unittest.main()
