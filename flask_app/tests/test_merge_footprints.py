"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/square-one/blob/main/LICENSE.md
"""

import unittest

import geopandas as gpd
from shapely.geometry import Polygon

from flask_app.services.footprint_service import FootprintService


class TestMergeFootprint(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures before each test method."""
        self.service = FootprintService()

    def test_merge_footprint_geodataframes(self):
        # Create two simple GeoDataFrames with overlapping polygons and UBIDs
        gdf_1 = gpd.GeoDataFrame(
            {
                "ubid_1": ["A", "B"],
                "height_1": [10, 20],
                "geometry": [Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)]), Polygon([(3, 3), (5, 3), (5, 5), (3, 5), (3, 3)])],
            },
            crs="EPSG:4326",
        )

        gdf_2 = gpd.GeoDataFrame(
            {
                "ubid_2": ["A", "C"],
                "height_2": [15, 25],
                "geometry": [Polygon([(1, 1), (3, 1), (3, 3), (1, 3), (1, 1)]), Polygon([(6, 6), (8, 6), (8, 8), (6, 8), (6, 6)])],
            },
            crs="EPSG:4326",
        )

        merged = self.service.merge_footprint_geodataframes(gdf_1, gdf_2)

        print(merged)
        print("Columns:", merged.columns.tolist())
        assert len(merged) > 0, "Merged GeoDataFrame should not be empty"
        assert "geometry" in merged.columns, "Merged GeoDataFrame should have geometry column"
        assert "ubid" in merged.columns, "Merged GeoDataFrame should have ubid column"

    def test_merge_ms_osm_footprints(self):
        """Test merging processed OSM and Microsoft footprints without external services."""
        geometries = [
            Polygon(
                [
                    (-104.985 + index * 0.0001, 39.735),
                    (-104.98495 + index * 0.0001, 39.735),
                    (-104.98495 + index * 0.0001, 39.73505),
                    (-104.985 + index * 0.0001, 39.73505),
                ]
            )
            for index in range(8)
        ]
        osm_gdf = gpd.GeoDataFrame({"id": range(1, 9), "building": ["civic"] * 8, "geometry": geometries}, crs="EPSG:4326")
        ms_gdf = gpd.GeoDataFrame({"height": [10] * 8, "geometry": geometries}, crs="EPSG:4326")

        service = FootprintService()
        osm_gdf = service.process_osm_footprints(osm_gdf)
        ms_gdf = service.process_ms_footprints(ms_gdf)

        merged_gdf = service.merge_footprint_geodataframes(osm_gdf, ms_gdf)

        self.assertEqual(len(merged_gdf), 8)

        # The first building has a type of 'Public services'.
        self.assertEqual(merged_gdf.iloc[0]["building_type"], "Public services")
