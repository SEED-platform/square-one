"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/cbl-web-tool/blob/main/LICENSE.md
"""

import json
import logging
import os
from typing import Optional

import requests
from building_data_utilities.ubid import encode_ubid
from shapely.geometry import Polygon

from flask_app.services.logging_utils import log_error_with_context


class GeocodingService:
    """Service class for handling geocoding operations."""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.mapbox_token = os.environ.get("MAPBOX_ACCESS_TOKEN")
        if not self.mapbox_token:
            self.logger.warning("MAPBOX_ACCESS_TOKEN not found in environment variables")

    def reverse_geocode_polygon(self, polygon: Polygon, property_names: list) -> tuple[Optional[dict], Optional[str]]:
        """
        Reverse geocode a polygon using Mapbox API.

        Args:
            polygon: Shapely Polygon object
            property_names: List of property names to initialize

        Returns:
            Tuple of (properties_dict, error_message)
        """
        try:
            # Calculate centroid
            centroid = polygon.centroid
            lat = centroid.y
            lon = centroid.x

            self.logger.info(f"Calculated lat: {lat}, lon: {lon}")

            # Initialize properties
            properties = {}
            for key in property_names:
                properties[key] = " "

            # Encode UBID from coordinates
            try:
                ubid = encode_ubid(polygon)
                self.logger.debug(f"Generated UBID: {ubid}")
                properties["ubid"] = ubid
            except AssertionError as e:
                self.logger.error(f"Invalid longitude coordinates for UBID: {e}")
                return None, "Invalid longitude coordinates"
            except Exception as e:
                self.logger.error(f"Error encoding UBID: {e}")
                return None, f"Error encoding UBID: {e}"

            # Add coordinates to properties
            properties["latitude"] = str(lat)
            properties["longitude"] = str(lon)

            # Make Mapbox API call
            if not self.mapbox_token:
                self.logger.warning("No Mapbox token available, setting default address values")
                self._set_default_address_values(properties)
                return properties, None

            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{lon},{lat}.json"
            params = {"access_token": self.mapbox_token, "limit": 1}

            self.logger.debug(f"Making API call to: {url}")

            try:
                response = requests.get(url, params=params, verify=True)
                self.logger.debug(f"API response status: {response.status_code}")
                self.logger.debug(f"API response content: {response.text}")
            except Exception as e:
                self.logger.error(f"Error making API request: {e}")
                return None, f"Error making API request: {e}"

            if response.status_code in {401, 403}:
                self.logger.error(f"API authentication error: {response.status_code}")
                return None, "Error: Could not reverse geocode using the mapbox API."

            # Parse API response
            try:
                result = response.json()
                self.logger.debug(f"API result: {result}")
            except json.JSONDecodeError as e:
                self.logger.error(f"Invalid JSON response from API: {e}")
                return None, f"Invalid JSON response from API: {e}"

            # Process result
            self._process_mapbox_result(properties, result)

            return properties, None

        except Exception as e:
            log_error_with_context("Error in reverse geocoding", e)
            return None, f"Error in reverse geocoding: {e}"

    def _set_default_address_values(self, properties: dict) -> None:
        """
        Set default address values when API is not available.

        Args:
            properties: Dictionary to update with default values
        """
        properties["street_address"] = "Unknown"
        properties["city"] = "Unknown"
        properties["state"] = "Unknown"
        properties["postal_code"] = "Unknown"
        properties["country"] = "Unknown"

    def _process_mapbox_result(self, properties: dict, result: dict) -> None:
        """
        Process Mapbox API result and update properties.

        Args:
            properties: Dictionary to update
            result: Result from Mapbox API
        """
        features = result.get("features", [])
        if not features:
            self.logger.warning("No features returned from API")
            self._set_default_address_values(properties)
            return

        feature = features[0]
        self.logger.debug(f"Processing feature: {feature}")

        # Initialize with defaults
        self._set_default_address_values(properties)

        # Extract address components from context
        context = feature.get("context", [])
        for item in context:
            item_id = item.get("id", "")
            if "place" in item_id:
                properties["city"] = item.get("text", "Unknown")
            elif "region" in item_id:
                properties["state"] = item.get("text", "Unknown")
            elif "postcode" in item_id:
                properties["postal_code"] = item.get("text", "Unknown")
            elif "country" in item_id:
                properties["country"] = item.get("text", "Unknown")

        # Extract street address - prefer properties.address over place_name
        place_name = feature.get("place_name", "")
        feature_properties = feature.get("properties", {})
        address = feature_properties.get("address") if feature_properties else None

        if address:
            properties["street_address"] = address
        elif place_name:
            properties["street_address"] = place_name
