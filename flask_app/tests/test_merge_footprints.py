"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/square-one/blob/main/LICENSE.md
"""

import unittest
from pathlib import Path

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
        """Test loading and merging denver footprints (8 buildings +/-)"""
        # Approximate polygon for Denver block
        denver_polygon = Polygon([(-104.984860, 39.736826), (-104.984852, 39.735269), (-104.983598, 39.735283), (-104.983596, 39.736865)])

        service = FootprintService()
        # grab the quadkeys
        quadkeys = service.get_quadkeys_for_polygon(denver_polygon)
        service.update_datasets(quadkeys)

        # Load real OSM footprints
        osm_gdf = service.load_osm_footprints(denver_polygon)
        osm_gdf = service.process_osm_footprints(osm_gdf)

        # Load real MS footprints
        ms_gdf = service.load_ms_footprints(denver_polygon, quadkeys)
        ms_gdf = service.process_ms_footprints(ms_gdf)

        merged_gdf = service.merge_footprint_geodataframes(osm_gdf, ms_gdf)

        # save the file to a geojson in an output directory for inspection
        output_dir = Path("flask_app/tests/output")
        output_dir.mkdir(parents=True, exist_ok=True)
        merged_gdf.to_file(output_dir / "denver_merged_footprints.geojson", driver="GeoJSON")
        self.assertEqual(len(merged_gdf), 8)

        # check some of the merging
        # the first building have a building type of 'Public services'
        self.assertEqual(merged_gdf.iloc[0]["building_type"], "Public services")
