"""
Service for handling file processing operations.
"""

import json
import logging
from typing import Optional, Union

import geopandas as gpd
import pandas as pd

from flask_app.services.logging_utils import log_error_with_context


class FileProcessingService:
    """Service class for handling file upload and processing operations."""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.supported_types = {
            "application/json": self._process_json,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": self._process_excel,
            "application/csv": self._process_csv,
            "text/csv": self._process_csv,
            "application/geo+json": self._process_geojson,
            "application/octet-stream": self._process_geojson,
        }

    def process_uploaded_file(self, file) -> tuple[Union[list[dict], dict, None], Optional[str]]:
        """
        Process an uploaded file and convert it to a standardized format.

        Args:
            file: Uploaded file object

        Returns:
            Tuple of (processed_data, error_message)
        """
        try:
            if not file:
                return None, "No file provided"

            file_type = file.content_type
            self.logger.info(f"Processing file of type: {file_type}")

            if file_type not in self.supported_types:
                return None, f"Unsupported file type: {file_type}"

            processor = self.supported_types[file_type]
            data = processor(file)

            self.logger.info(f"Successfully processed file with {len(data) if isinstance(data, list) else 1} records")
            return data, None

        except Exception as e:
            error_msg = f"Error processing uploaded file: {e}"
            log_error_with_context(error_msg, e)
            return None, error_msg

    def _process_json(self, file) -> Union[list[dict], dict]:
        """Process JSON file."""
        file_content = file.read().decode("utf-8")
        return json.loads(file_content)

    def _process_excel(self, file) -> list[dict]:
        """Process Excel file."""
        data_frame = pd.read_excel(file)
        return self._dataframe_to_dict_list(data_frame)

    def _process_csv(self, file) -> list[dict]:
        """Process CSV file."""
        data_frame = pd.read_csv(file)
        return self._dataframe_to_dict_list(data_frame)

    def _process_geojson(self, file) -> dict:
        """Process GeoJSON file."""
        data_gdf = gpd.read_file(file)
        data_string = data_gdf.to_json()
        return json.loads(data_string)

    def _dataframe_to_dict_list(self, df: pd.DataFrame) -> list[dict]:
        """Convert DataFrame to list of dictionaries."""
        json_data = df.to_json(orient="records")
        return json.loads(json_data)

    def geodataframe_to_json(self, geojson_gdf: gpd.GeoDataFrame) -> str:
        """
        Convert a GeoDataFrame to JSON string.

        Args:
            geojson_gdf: GeoDataFrame to convert

        Returns:
            JSON string representation
        """
        try:
            # Handle empty GeoDataFrame
            if geojson_gdf.empty or "geometry" not in geojson_gdf.columns:
                return '{"type": "FeatureCollection", "features": []}'

            # Sort by coordinates for consistent output
            geojson_gdf = geojson_gdf.copy()
            centroids = geojson_gdf.geometry.centroid
            geojson_gdf["_sort_x"] = centroids.x
            geojson_gdf["_sort_y"] = centroids.y
            geojson_gdf = geojson_gdf.sort_values(["_sort_y", "_sort_x"])
            geojson_gdf = geojson_gdf.drop(columns=["_sort_x", "_sort_y"])

            return geojson_gdf.to_json()

        except Exception as e:
            log_error_with_context("Error converting GeoDataFrame to JSON", e)
            raise

    def validate_required_columns(self, data: list[dict]) -> tuple[bool, Optional[str]]:
        """
        Validate that required columns are present in the data.

        Args:
            data: List of dictionaries to validate

        Returns:
            Tuple of (is_valid, error_message)
        """
        try:
            if not data:
                return False, "No data provided"

            for i, record in enumerate(data):
                # Check for street address variants
                street_variants = ["street_address", "Street_Address", "Street_address", "street_Address"]
                has_street = any(variant in record for variant in street_variants)

                if not has_street:
                    return False, f"Missing street address field in record {i + 1}"

                # Check for city variants
                city_variants = ["city", "City"]
                has_city = any(variant in record for variant in city_variants)

                if not has_city:
                    return False, f"Missing city field in record {i + 1}"

                # Check for state variants
                state_variants = ["state", "State"]
                has_state = any(variant in record for variant in state_variants)

                if not has_state:
                    return False, f"Missing state field in record {i + 1}"

                # Validate data types
                for key, value in record.items():
                    if value is not None and not isinstance(value, (int, str, bool, float)):
                        return False, f"Invalid data type in record {i + 1}, field '{key}'"

            return True, None

        except Exception as e:
            error_msg = f"Error validating data: {e}"
            log_error_with_context(error_msg, e)
            return False, error_msg
