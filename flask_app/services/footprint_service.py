"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/cbl-web-tool/blob/main/LICENSE.md
"""

import logging
from pathlib import Path

import geopandas as gpd
from building_data_utilities import footprints
from building_data_utilities.update_dataset_links import update_dataset_links
from building_data_utilities.update_quadkeys import update_quadkeys
from shapely.geometry import MultiPolygon, Polygon

import flask_app.config as config


class FootprintService:
    """
    Service class for handling footprint operations.

    This is a thin wrapper around building_data_utilities.footprints, which holds the
    reusable (non-app-specific) footprint loading/merging/matching logic. This class only
    adds the app's on-disk quadkey cache location.
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.data_dir = Path(config.data_dir)
        self.quadkeys_dir = self.data_dir / "quadkeys"

    def get_quadkeys_for_polygon(self, polygon: Polygon | MultiPolygon) -> list[int]:
        """
        Get quadkeys that intersect with the given polygon.

        Args:
            polygon: Shapely Polygon or MultiPolygon object

        Returns:
            List of quadkey integers
        """
        return footprints.get_quadkeys_for_polygon(polygon)

    def update_datasets(self, quadkeys: list[int]) -> None:
        """
        Update dataset links and quadkeys.

        Args:
            quadkeys: List of quadkey integers
        """
        try:
            update_dataset_links(save_directory=self.quadkeys_dir)
            update_quadkeys(quadkeys, self.quadkeys_dir)
            self.logger.info("Dataset links and quadkeys updated successfully")
        except Exception as e:
            self.logger.error(f"Error updating dataset links/quadkeys: {e}")
            raise

    def load_ms_footprints(self, polygon: Polygon, quadkeys: list[int]) -> gpd.GeoDataFrame:
        """
        Load Microsoft footprints for the given polygon and quadkeys.

        Args:
            polygon: Shapely Polygon object defining the area of interest
            quadkeys: List of quadkey integers

        Returns:
            GeoDataFrame containing Microsoft footprints
        """
        return footprints.load_ms_footprints(polygon, quadkeys, self.quadkeys_dir)

    def process_ms_footprints(self, ms_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Process Microsoft footprints data.

        Args:
            ms_gdf: GeoDataFrame with Microsoft footprints

        Returns:
            Processed GeoDataFrame
        """
        return footprints.process_ms_footprints(ms_gdf)

    def load_osm_footprints(self, polygon: Polygon) -> gpd.GeoDataFrame:
        """
        Load OpenStreetMap footprints for the given polygon.

        Args:
            polygon: Shapely Polygon object defining the area of interest

        Returns:
            GeoDataFrame containing OSM footprints
        """
        return footprints.load_osm_footprints(polygon)

    def process_osm_footprints(self, osm_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Process OpenStreetMap footprints data.

        Args:
            osm_gdf: GeoDataFrame with OSM footprints

        Returns:
            Processed GeoDataFrame
        """
        return footprints.process_osm_footprints(osm_gdf)

    def merge_footprint_geodataframes(self, gdf_1, gdf_2):
        """
        Merge two footprint GeoDataFrames, preserving unique footprints and merging overlapping ones.

        Returns a GeoDataFrame with unique + merged footprints.
        """
        return footprints.merge_footprint_geodataframes(gdf_1, gdf_2)

    def build_point_query_polygon(self, points: list[dict], buffer_degrees: float = 0.003) -> Polygon | MultiPolygon:
        """
        Build a small, padded box around EACH query point and return their union, suitable for
        looking up nearby MS/OSM footprints (via get_quadkeys_for_polygon/load_*_footprints).

        Args:
            points: List of dicts with "latitude" and "longitude" keys
            buffer_degrees: Padding (in degrees) added around each point

        Returns:
            Shapely Polygon (single point) or MultiPolygon (multiple points) covering the area
            around each point plus padding
        """
        return footprints.build_point_query_polygon(points, buffer_degrees)

    def match_points_to_ms_footprints(self, points: list[dict]) -> dict:
        """
        Batched matching of a (potentially large) list of geocoded points to Microsoft footprints.

        Args:
            points: list of dicts, each with "index", "latitude", and "longitude" keys.

        Returns:
            Dict mapping each input point's "index" to a result dict with keys:
            "geometry", "height", "ubid", "footprint_match".
        """
        return footprints.match_points_to_ms_footprints(points, self.quadkeys_dir)

    def match_footprints_to_points(
        self, points_gdf: gpd.GeoDataFrame, footprints_gdf: gpd.GeoDataFrame, max_nearest_distance_degrees: float = 0.003
    ) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
        """
        Split a set of candidate footprints into those that match at least one of the given
        query points, and those that don't.

        Args:
            points_gdf: GeoDataFrame of query points with a "point_id" column
            footprints_gdf: GeoDataFrame of candidate footprint polygons
            max_nearest_distance_degrees: Maximum distance (in degrees) a point may be from its
                nearest footprint to still count as a "closest" match

        Returns:
            Tuple of (matched, unmatched) GeoDataFrames.
        """
        return footprints.match_footprints_to_points(points_gdf, footprints_gdf, max_nearest_distance_degrees)

    def footprints_to_feature_dicts(self, gdf: gpd.GeoDataFrame) -> list[dict]:
        """
        Convert a footprints GeoDataFrame into a list of plain GeoJSON Feature dicts.

        Args:
            gdf: GeoDataFrame to convert

        Returns:
            List of GeoJSON Feature dicts (empty list if gdf is empty)
        """
        return footprints.footprints_to_feature_dicts(gdf)
