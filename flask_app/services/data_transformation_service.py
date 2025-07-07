"""
Service for handling data transformation and location processing.
"""

import logging
from typing import Optional

from cbl_workflow.utils.common import Location

from flask_app.services.logging_utils import log_error_with_context


class DataTransformationService:
    """Service class for handling data transformation operations."""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        # US state abbreviations mapping
        self.state_abbreviations = {
            "alabama": "AL",
            "alaska": "AK",
            "arizona": "AZ",
            "arkansas": "AR",
            "california": "CA",
            "colorado": "CO",
            "connecticut": "CT",
            "delaware": "DE",
            "florida": "FL",
            "georgia": "GA",
            "hawaii": "HI",
            "idaho": "ID",
            "illinois": "IL",
            "indiana": "IN",
            "iowa": "IA",
            "kansas": "KS",
            "kentucky": "KY",
            "louisiana": "LA",
            "maine": "ME",
            "maryland": "MD",
            "massachusetts": "MA",
            "michigan": "MI",
            "minnesota": "MN",
            "mississippi": "MS",
            "missouri": "MO",
            "montana": "MT",
            "nebraska": "NE",
            "nevada": "NV",
            "new hampshire": "NH",
            "new jersey": "NJ",
            "new mexico": "NM",
            "new york": "NY",
            "north carolina": "NC",
            "north dakota": "ND",
            "ohio": "OH",
            "oklahoma": "OK",
            "oregon": "OR",
            "pennsylvania": "PA",
            "rhode island": "RI",
            "south carolina": "SC",
            "south dakota": "SD",
            "tennessee": "TN",
            "texas": "TX",
            "utah": "UT",
            "vermont": "VT",
            "virginia": "VA",
            "washington": "WA",
            "west virginia": "WV",
            "wisconsin": "WI",
            "wyoming": "WY",
            "district of columbia": "DC",
        }

    def generate_locations_list(self, json_dict_list: list[dict]) -> list[Location]:
        """
        Generate a list of Location objects from user input data.

        Args:
            json_dict_list: List of dictionaries containing location data

        Returns:
            List of Location objects
        """
        try:
            locations = []

            for record in json_dict_list:
                street = self._extract_field(record, "street_address")
                city = self._extract_field(record, "city")
                state = self._extract_field(record, "state")

                # Normalize state if needed
                if state:
                    state = self.normalize_state(state)

                loc_dict = {"street": street or "", "city": city or "", "state": state or ""}
                locations.append(loc_dict)

            self.logger.info(f"Generated {len(locations)} location objects")
            return locations

        except Exception as e:
            log_error_with_context("Error generating locations list", e)
            raise

    def _extract_field(self, record: dict, field_name: str) -> Optional[str]:
        """
        Extract field value with case-insensitive matching.

        Args:
            record: Dictionary to search
            field_name: Field name to find

        Returns:
            Field value or None if not found
        """
        for key, value in record.items():
            if key.lower() == field_name.lower():
                return str(value) if value is not None else None
        return None

    def normalize_state(self, state_name: str) -> str:
        """
        Normalize state name to standard abbreviation.

        Args:
            state_name: State name or abbreviation

        Returns:
            Standardized state abbreviation
        """
        if not state_name:
            return ""

        state_lower = state_name.lower().strip()

        # If it's already an abbreviation, return uppercase
        if len(state_lower) == 2 and state_lower.isalpha():
            return state_lower.upper()

        # Look up full name
        return self.state_abbreviations.get(state_lower, state_name.upper())

    def merge_location_data(self, file_dict: dict, api_dict: dict) -> dict:
        """
        Merge location data from file and API response.

        Args:
            file_dict: Data from uploaded file
            api_dict: Data from API response

        Returns:
            Merged dictionary
        """
        try:
            merged_dict = {}

            # Process API data first
            for key, value in api_dict.items():
                normalized_key = key.lower()

                if normalized_key == "address":
                    merged_dict["street_address"] = value if value else "Missing Address"
                elif normalized_key not in {"side_of_street", "footprint_match", "neighborhood", "height", "quadkey"}:
                    merged_dict[normalized_key] = value

            # Add file data, but don't overwrite critical API fields
            protected_fields = {"street_address", "geometry", "longitude", "latitude"}
            for key, value in file_dict.items():
                normalized_key = key.lower()
                if normalized_key not in protected_fields:
                    merged_dict[normalized_key] = value

            # Remove duplicate values across different keys
            merged_dict = self._remove_duplicate_values(merged_dict)

            return merged_dict

        except Exception as e:
            log_error_with_context("Error merging location data", e)
            raise

    def _remove_duplicate_values(self, data_dict: dict) -> dict:
        """
        Remove duplicate values across different keys, keeping the first occurrence.

        Args:
            data_dict: Dictionary to deduplicate

        Returns:
            Dictionary with duplicate values removed
        """
        value_to_keys = {}
        for key, value in data_dict.items():
            if value not in value_to_keys:
                value_to_keys[value] = [key]
            else:
                value_to_keys[value].append(key)

        # Keep only the first key for each value
        result = {}
        for value, keys in value_to_keys.items():
            result[keys[0]] = value

        return result

    def merge_dicts(self, dict1: dict, dict2: dict) -> dict:
        """
        Merge two dictionaries, with dict2 values taking precedence over dict1.

        Args:
            dict1: First dictionary (typically original file data)
            dict2: Second dictionary (typically processed data)

        Returns:
            Merged dictionary with dict2 values overriding dict1 values
        """
        try:
            merged = dict1.copy()
            merged.update(dict2)
            return merged
        except Exception as e:
            log_error_with_context("Error merging dictionaries", e)
            raise

    def standardize_address_fields(self, data: list[dict]) -> list[dict]:
        """
        Standardize address field names across all records.

        Args:
            data: List of dictionaries with potentially inconsistent field names

        Returns:
            List of dictionaries with standardized field names
        """
        try:
            standardized_data = []

            for record in data:
                standardized = {}

                for key, value in record.items():
                    # Standardize common field variations
                    lower_key = key.lower()
                    if lower_key in ["street_address", "street_addr", "address"]:
                        standardized["street_address"] = value
                    elif lower_key in ["city", "municipality"]:
                        standardized["city"] = value
                    elif lower_key in ["state", "province", "region"]:
                        standardized["state"] = self.normalize_state(str(value)) if value else ""
                    elif lower_key in ["zip", "zipcode", "postal_code", "postcode"]:
                        standardized["postal_code"] = value
                    elif lower_key in ["country", "nation"]:
                        standardized["country"] = value
                    else:
                        # Keep other fields as-is
                        standardized[key] = value

                standardized_data.append(standardized)

            self.logger.info(f"Standardized {len(standardized_data)} records")
            return standardized_data

        except Exception as e:
            log_error_with_context("Error standardizing address fields", e)
            raise
