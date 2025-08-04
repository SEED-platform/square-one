"""
Service for handling data transformation and location processing.
"""

import csv
import logging
import os
from typing import Optional

from cbl_workflow.utils.common import Location

from flask_app.services.logging_utils import log_error_with_context


class DataTransformationService:
    """Service class for handling data transformation operations."""

    def __init__(self):
        self.logger = logging.getLogger(__name__)

        # Define ESPM data file paths
        self.espm_data_dir = os.path.join(os.path.dirname(__file__), "..", "esmp_data")
        self.category_file = os.path.join(self.espm_data_dir, "energystar_site_eui_by_category.csv")
        self.subcategory_file = os.path.join(self.espm_data_dir, "energystar_site_eui_by_subcategory.csv")

        # Building types from category file (main types)
        self.building_types = {
            "All",
            "Banking/financial services",
            "Education",
            "Entertainment/public assembly",
            "Food sales and service",
            "Healthcare",
            "Lodging/residential",
            "Manufacturing/industrial",
            "Office",
            "Other",
            "Public services",
            "Religious worship",
            "Retail",
            "Services",
            "Technology/science",
            "Utility",
            "Warehouse/storage",
        }

        # Building subtypes from subcategory file (specific types)
        self.building_subtypes = {
            "Personal Services (Health/Beauty, Dry Cleaning, etc.)",
            "All",
            "Bank Branch",
            "College/University",
            "Convenience Store without Gas Station",
            "Courthouse",
            "Distribution Center",
            "Fast Food Restaurant",
            "Financial Office",
            "Fire Station",
            "Fitness Center/Health Club/Gym",
            "Food Sales",
            "Food Service",
            "Laboratory",
            "Library",
            "Manufacturing/Industrial Plant",
            "Medical Office",
            "Movie Theater",
            "Non-Refrigerated Warehouse",
            "Office",
            "Other",
            "Other - Education",
            "Other - Entertainment/Public Assembly",
            "Other - Lodging/Residential",
            "Other - Public Service",
            "Other - Recreation",
            "Other - Restaurant/Bar",
            "Other - Retail/Mall",
            "Other - Services",
            "Other - Technology/Science",
            "Other - Utility",
            "Performing Arts",
            "Pre-school/Daycare",
            "Prison/Incarceration",
            "Refrigerated Warehouse",
            "Restaurant",
            "Retail Store",
            "Self-Storage Facility",
            "Social/Meeting Hall",
            "Strip Mall",
            "Supermarket/Grocery Store",
            "Urgent Care/Clinic/Other Outpatient",
            "Vehicle Dealership",
            "Vehicle Repair Services",
            "Wholesale Club/Supercenter",
            "Worship Facility",
        }

        # Climate zones available in ESPM data
        self.climate_zones = {
            "All",  # Default for all climate zones
            "1A",  # Very Hot, Humid
            "2A",  # Hot, Humid
            "2B",  # Hot, Dry
            "3A",  # Warm, Humid
            "3B",  # Warm, Dry
            "3C",  # Warm, Marine
            "4A",  # Mixed, Humid
            "4B",  # Mixed, Dry
            "4C",  # Mixed, Marine
            "5A",  # Cool, Humid
            "5B",  # Cool, Dry
            "6A",  # Cold, Humid
            "6B",  # Cold, Dry
            "7",  # Very Cold
            "8",  # Subarctic
        }

        # Year built ranges available in ESPM data
        self.year_built_ranges = {
            "All",  # Default for all years
            "Before 1946",  # Before 1946
            "1946-1959",  # 1946 to 1959
            "1960-1979",  # 1960 to 1979
            "1980-1999",  # 1980 to 1999
            "2000-2009",  # 2000 to 2009
            "2010 and after",  # 2010 and after
        }

        # Weekly hours ranges available in ESPM data
        self.weekly_hours_ranges = {
            "All",  # Default for all hours
            "Fewer than 40",  # Less than 40 hours per week
            "40-48",  # 40 to 48 hours per week
            "48.01 - 60",  # 48.01 to 60 hours per week
            "60.01 - 84",  # 60.01 to 84 hours per week
            "84.01-167",  # 84.01 to 167 hours per week
            "Open Continuously",  # Open 24/7 (168 hours per week)
        }

        # Gross Floor Area (GFA) ranges available in ESPM data (in square feet)
        self.gfa_ranges = {
            "All",  # Default for all sizes
            "1,000 - 4,999",  # 1,000 to 4,999 sq ft
            "5,000 - 9,999",  # 5,000 to 9,999 sq ft
            "10,000 - 24,999",  # 10,000 to 24,999 sq ft
            "25,000 - 49,999",  # 25,000 to 49,999 sq ft
            "50,000 - 99,999",  # 50,000 to 99,999 sq ft
            "100,000 - 199,999",  # 100,000 to 199,999 sq ft
            "200,000 - 499,999",  # 200,000 to 499,999 sq ft
            "500,000 - 999,999",  # 500,000 to 999,999 sq ft
            "1,000,000+",  # 1,000,000+ sq ft
        }

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

    def _convert_year_to_range(self, year: str) -> str:
        """
        Convert a single year to the appropriate ESMP year range.

        Args:
            year: Single year as string (e.g., "1995", "2005")

        Returns:
            ESMP year range string (e.g., "1980-1999", "2000-2009") or "All" if invalid
        """
        try:
            if not year or not year.strip():
                return "All"

            # Convert to integer
            year_int = int(year.strip())

            # Map to appropriate range
            if year_int < 1946:
                return "Before 1946"
            elif 1946 <= year_int <= 1959:
                return "1946-1959"
            elif 1960 <= year_int <= 1979:
                return "1960-1979"
            elif 1980 <= year_int <= 1999:
                return "1980-1999"
            elif 2000 <= year_int <= 2009:
                return "2000-2009"
            elif year_int >= 2010:
                return "2010 and after"
            else:
                return "All"

        except (ValueError, TypeError):
            self.logger.warning(f"Invalid year format '{year}', using 'All'")
            return "All"

    def _convert_weekly_hours_to_range(self, hours: str) -> str:
        """
        Convert weekly hours to the appropriate ESPM range.

        Args:
            hours: Weekly hours as string (e.g., "45", "60", "168")

        Returns:
            ESPM weekly hours range string or "All" if invalid
        """
        try:
            if not hours or not hours.strip():
                return "All"

            # Convert to float to handle decimal values
            hours_float = float(hours.strip())

            # Map to appropriate range
            if hours_float < 40:
                return "Fewer than 40"
            elif 40 <= hours_float <= 48:
                return "40-48"
            elif 48.01 <= hours_float <= 60:
                return "48.01 - 60"
            elif 60.01 <= hours_float <= 84:
                return "60.01 - 84"
            elif 84.01 <= hours_float <= 167:
                return "84.01-167"
            elif hours_float >= 168:
                return "Open Continuously"
            else:
                return "All"

        except (ValueError, TypeError):
            self.logger.warning(f"Invalid weekly hours format '{hours}', using 'All'")
            return "All"

    def _convert_gfa_to_range(self, gfa: str) -> str:
        """
        Convert gross floor area to the appropriate ESPM range.

        Args:
            gfa: Gross floor area as string (e.g., "15000", "250000")

        Returns:
            ESPM GFA range string or "All" if invalid
        """
        try:
            if not gfa or not gfa.strip():
                return "All"

            # Remove commas and convert to integer
            gfa_str = str(gfa).strip().replace(",", "")
            gfa_int = int(float(gfa_str))  # Use float first to handle decimal inputs, then int

            # Map to appropriate range
            if 1000 <= gfa_int <= 4999:
                return "1,000 - 4,999"
            elif 5000 <= gfa_int <= 9999:
                return "5,000 - 9,999"
            elif 10000 <= gfa_int <= 24999:
                return "10,000 - 24,999"
            elif 25000 <= gfa_int <= 49999:
                return "25,000 - 49,999"
            elif 50000 <= gfa_int <= 99999:
                return "50,000 - 99,999"
            elif 100000 <= gfa_int <= 199999:
                return "100,000 - 199,999"
            elif 200000 <= gfa_int <= 499999:
                return "200,000 - 499,999"
            elif 500000 <= gfa_int <= 999999:
                return "500,000 - 999,999"
            elif gfa_int >= 1000000:
                return "1,000,000+"
            else:
                # If less than 1000 sq ft, use "All" as fallback
                self.logger.warning(f"GFA '{gfa}' is below minimum range (< 1,000 sq ft), using 'All'")
                return "All"

        except (ValueError, TypeError):
            self.logger.warning(f"Invalid GFA format '{gfa}', using 'All'")
            return "All"

    def assign_target_eui(self, building_data: list[dict]) -> list[dict]:
        """
        Assign target EUI values for buildings based on ESMP data lookups.

        Args:
            building_data: List of building dictionaries with properties

        Returns:
            List of building dictionaries with added EUI target data
        """
        try:
            enriched_data = []

            for building in building_data:
                # Create a copy to avoid modifying original data
                enriched_building = building.copy()

                # Remove any existing EUI columns to prevent duplicates
                self._remove_existing_eui_columns(enriched_building)

                # Lookup EUI data based on building properties
                eui_data = self._lookup_eui_data(building)

                # Add EUI fields to the building data
                if eui_data:
                    enriched_building.update(eui_data)

                enriched_data.append(enriched_building)

            self.logger.info(f"Assigned target EUI data for {len(enriched_data)} buildings")
            return enriched_data

        except Exception as e:
            log_error_with_context("Error assigning target EUI data", e)
            raise

    def _remove_existing_eui_columns(self, building: dict) -> None:
        """
        Remove any existing EUI-related columns from a building dictionary.

        This prevents duplicate columns when re-running the EUI assignment process.

        Args:
            building: Building dictionary to clean up
        """
        # Remove ALL columns that start with 'eui' or contain 'EUI' (comprehensive cleanup)
        keys_to_remove = []
        for key in building:
            key_lower = key.lower()
            if key_lower.startswith("eui") or "eui" in key_lower or key == "P25 target EUI":
                keys_to_remove.append(key)

        # Remove all identified EUI columns
        for key in keys_to_remove:
            del building[key]
            self.logger.debug(f"Removed EUI column: {key}")

        if keys_to_remove:
            self.logger.info(f"Cleaned up {len(keys_to_remove)} existing EUI columns before reassignment")

    def _lookup_eui_data(self, building: dict) -> dict:
        """
        Lookup EUI data for a single building from ESPM CSV files.

        Args:
            building: Building dictionary with properties

        Returns:
            Dictionary with EUI data fields or empty dict if no match found
        """
        try:
            # Extract relevant fields for lookup
            building_type = building.get("building_type", "").strip()
            climate_zone = building.get("climate_zone", "").strip()
            year_built = building.get("year_built", "")
            gfa = building.get("gross_floor_area", "") or building.get("gfa", "")
            hours_operation = building.get("hours_of_operation", "") or building.get("weekly_hours", "")

            # If building_type is blank, set it to "All"
            if not building_type:
                building_type = "All"

            # If climate_zone is blank or not in our valid set, use "All"
            if not climate_zone or climate_zone not in self.climate_zones:
                if climate_zone and climate_zone not in self.climate_zones:
                    self.logger.warning(f"Climate zone '{climate_zone}' not found in ESPM data, using 'All'")
                climate_zone = "All"

            # Convert single year to ESMP year range
            year_built_range = self._convert_year_to_range(year_built)
            self.logger.debug(f"Converted year_built '{year_built}' to range '{year_built_range}'")

            # Convert weekly hours to ESPM range
            weekly_hours_range = self._convert_weekly_hours_to_range(hours_operation)
            self.logger.debug(f"Converted hours_operation '{hours_operation}' to range '{weekly_hours_range}'")

            # Convert GFA to ESPM range
            gfa_range = self._convert_gfa_to_range(gfa)
            self.logger.debug(f"Converted gfa '{gfa}' to range '{gfa_range}'")

            # Check if at least one secondary field has a specific value (not "All")
            has_specific_values = climate_zone != "All" or year_built_range != "All" or weekly_hours_range != "All" or gfa_range != "All"

            if not has_specific_values:
                self.logger.info(
                    f"All secondary fields are 'All' for building_type '{building_type}' "
                    f"(climate_zone='{climate_zone}', year_built_range='{year_built_range}', "
                    f"weekly_hours_range='{weekly_hours_range}', gfa_range='{gfa_range}'). "
                    f"Returning null EUI as no specific characteristics are available."
                )
                return {
                    "P25 target EUI": None,
                    "eui_message": 'All secondary fields are "All" - no specific building characteristics available',
                }

            # Determine which file to use based on building_type
            lookup_field = "building_type"
            csv_file = self.category_file

            # Check if building_type matches a subtype (use subcategory file)
            if building_type in self.building_subtypes:
                lookup_field = "building_subtype"
                csv_file = self.subcategory_file
            # Check if building_type matches a main type (use category file)
            elif building_type in self.building_types:
                lookup_field = "building_type"
                csv_file = self.category_file
            else:
                # If no exact match, fall back to "All" using category file
                self.logger.warning(f"Building type '{building_type}' not found in ESPM data, using 'All'")
                building_type = "All"
                lookup_field = "building_type"
                csv_file = self.category_file

            # Perform the CSV lookup
            eui_data = self._perform_csv_lookup(
                csv_file=csv_file,
                lookup_field=lookup_field,
                building_type=building_type,
                climate_zone=climate_zone,
                year_built_range=year_built_range,
                weekly_hours_range=weekly_hours_range,
                gfa_range=gfa_range,
            )
            print(f" EUI Data: {eui_data}")
            # No additional metadata needed - CSV lookup returns only essential columns
            return eui_data

        except Exception as e:
            log_error_with_context("Error looking up EUI data for building", e)
            return {}

    def _perform_csv_lookup(
        self,
        csv_file: str,
        lookup_field: str,
        building_type: str,
        climate_zone: str,
        year_built_range: str,
        weekly_hours_range: str,
        gfa_range: str,
    ) -> dict:
        """
        Perform CSV lookup for EUI data with 4-tier hierarchical relaxation strategy.

        Strategy:
        1. Requires at least one field to have a specific value (not "All")
        2. If requirement met, tries exact match on all 5 fields first
        3. If no exact match found, relaxes weekly_hours to "All" and tries again
        4. If still no match, relaxes weekly_hours and year_built to "All" and tries again
        5. If still no match, relaxes weekly_hours, year_built, and gfa to "All" and tries again
        6. Returns null if insufficient specific data or no matches found with any strategy

        Args:
            csv_file: Path to the CSV file to search
            lookup_field: Field name to match building_type against ('building_type' or 'building_subtype')
            building_type: Building type to search for
            climate_zone: Climate zone for matching
            year_built_range: Year built range for matching (e.g., "1980-1999", "All")
            weekly_hours_range: Weekly hours range for matching (e.g., "40-48", "All")
            gfa_range: GFA range for matching (e.g., "10,000 - 24,999", "All")

        Returns:
            Dictionary with EUI data or empty dict if no match found
        """
        try:
            # Store original values for tracking relaxed fields
            original_weekly_hours_requested = weekly_hours_range if weekly_hours_range != "All" else None
            original_year_built_requested = year_built_range if year_built_range != "All" else None
            original_gfa_requested = gfa_range if gfa_range != "All" else None

            if not os.path.exists(csv_file):
                self.logger.error(f"CSV file not found: {csv_file}")
                return {}

            # Look for matches with hierarchical relaxation
            match_attempts = [
                # Attempt 1: Exact match on all fields
                {
                    "building_type": building_type,
                    "climate_zone": climate_zone,
                    "year_built": year_built_range,
                    "weekly_hours": weekly_hours_range,
                    "gfa": gfa_range,
                    "description": "exact match",
                },
                # Attempt 2: Relax weekly_hours to "All"
                {
                    "building_type": building_type,
                    "climate_zone": climate_zone,
                    "year_built": year_built_range,
                    "weekly_hours": "All",
                    "gfa": gfa_range,
                    "description": "relaxed weekly_hours",
                },
                # Attempt 3: Relax weekly_hours and year_built to "All"
                {
                    "building_type": building_type,
                    "climate_zone": climate_zone,
                    "year_built": "All",
                    "weekly_hours": "All",
                    "gfa": gfa_range,
                    "description": "relaxed weekly_hours and year_built",
                },
                # Attempt 4: Relax weekly_hours, year_built, and gfa to "All"
                {
                    "building_type": building_type,
                    "climate_zone": climate_zone,
                    "year_built": "All",
                    "weekly_hours": "All",
                    "gfa": "All",
                    "description": "relaxed weekly_hours, year_built, and gfa",
                },
            ]

            # Try each matching attempt in order
            for attempt in match_attempts:
                print(f" ATTEMPT: {attempt['description']}")
                matches = []

                with open(csv_file, encoding="utf-8") as file:
                    reader = csv.DictReader(file)

                    for row in reader:
                        # Check if all fields match for this attempt
                        if (
                            row.get(lookup_field, "").strip() == attempt["building_type"]
                            and row.get("climate_zone", "").strip() == attempt["climate_zone"]
                            and row.get("year_built", "").strip() == attempt["year_built"]
                            and row.get("weekly_hours", "").strip() == attempt["weekly_hours"]
                            and row.get("gfa", "").strip() == attempt["gfa"]
                        ):
                            twenty_fifth_percentile = row.get("twenty_fifth_percentile", "").strip()
                            has_eui_data = twenty_fifth_percentile and twenty_fifth_percentile != ""

                            matches.append({"row": row, "has_data": has_eui_data})
                print(f"Found {len(matches)} matches using {attempt['description']} strategy")
                # If we found matches for this attempt, use them
                if matches:
                    self.logger.info(f"Found {len(matches)} matches using {attempt['description']} strategy")

                    # Prioritize matches with EUI data
                    matches_with_data = [m for m in matches if m["has_data"]]
                    matches_without_data = [m for m in matches if not m["has_data"]]

                    # Use match with data if available, otherwise use first match
                    if matches_with_data:
                        best_match = matches_with_data[0]
                        match_type = f"{attempt['description']}_with_data"
                    else:
                        best_match = matches_without_data[0]
                        match_type = f"{attempt['description']}_without_data"

                    match_row = best_match["row"]

                    self.logger.info(
                        f"Selected {match_type} for building_type '{building_type}', climate_zone '{climate_zone}', "
                        f"year_built_range '{year_built_range}', weekly_hours_range '{weekly_hours_range}', gfa_range '{gfa_range}' "
                        f"(found {len(matches)} matches, {len(matches_with_data)} with EUI data)"
                    )

                    # Extract the twenty_fifth_percentile as the primary EUI value
                    primary_eui = self._safe_float_conversion(match_row.get("twenty_fifth_percentile"))

                    # make message
                    msg = f"Found match using {attempt['description']} strategy, "
                    if primary_eui:
                        msg = msg + f"EUI retrieved was: {primary_eui}."
                    else:
                        msg = msg + "No EUI data available for this combination of inputs."

                    self.logger.info(msg)

                    # Return only essential EUI data for display
                    eui_data = {
                        "P25 target EUI": primary_eui,
                        "eui_message": msg,
                    }

                    # Add tracking for relaxed fields if applicable
                    if attempt.get("relax_weekly_hours") and original_weekly_hours_requested:
                        eui_data["eui_original_weekly_hours_requested"] = original_weekly_hours_requested
                    if attempt.get("relax_year_built") and original_year_built_requested:
                        eui_data["eui_original_year_built_requested"] = original_year_built_requested
                    if attempt.get("relax_gfa") and original_gfa_requested:
                        eui_data["eui_original_gfa_requested"] = original_gfa_requested

                    self.logger.info(f"Found match using {attempt['description']} strategy, returning P25 target EUI: {primary_eui}")
                    return eui_data

            # If no matches found with any relaxation strategy
            self.logger.warning(
                f"No matches found even with 4-tier relaxation for building_type '{building_type}', climate_zone '{climate_zone}', "
                f"year_built_range '{year_built_range}', weekly_hours_range '{weekly_hours_range}', "
                f"gfa_range '{gfa_range}' in {csv_file}"
            )
            return {
                "P25 target EUI": None,
                "eui_message": "No match found even with relaxed weekly_hours, year_built, and gfa for the specified building characteristics",
            }

        except Exception as e:
            log_error_with_context("Error performing CSV lookup", e)
            return {}

    def _safe_float_conversion(self, value: str) -> Optional[float]:
        """
        Safely convert a string value to float, handling empty/null values.

        Args:
            value: String value to convert

        Returns:
            Float value or None if conversion fails
        """
        try:
            if not value or value.strip() == "":
                return None
            return float(value)
        except (ValueError, TypeError):
            return None
