"""
SEED Platform (TM), Copyright (c) Alliance for Sustainable Energy, LLC, and other contributors.
See also https://github.com/SEED-platform/cbl-web-tool/blob/main/LICENSE.md
"""

import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import geopandas as gpd
import pytest
from shapely.geometry import MultiPolygon, Point, Polygon

from flask_app.services.footprint_service import FootprintService


class TestFootprintService(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures before each test method."""
        self.service = FootprintService()

        # Create a simple test polygon (roughly a square)
        self.test_polygon = Polygon([(-104.99, 39.73), (-104.98, 39.73), (-104.98, 39.74), (-104.99, 39.74), (-104.99, 39.73)])

    @patch("flask_app.services.footprint_service.update_quadkeys")
    @patch("flask_app.services.footprint_service.update_dataset_links")
    def test_update_datasets(self, mock_update_links, mock_update_quadkeys):
        """Test dataset update functionality."""
        quadkeys = [23010203, 23010202]

        self.service.update_datasets(quadkeys)

        mock_update_links.assert_called_once_with(save_directory=self.service.quadkeys_dir)
        mock_update_quadkeys.assert_called_once_with(quadkeys, self.service.quadkeys_dir)

    @patch("flask_app.services.footprint_service.update_quadkeys")
    @patch("flask_app.services.footprint_service.update_dataset_links")
    def test_update_datasets_error_handling(self, mock_update_links, mock_update_quadkeys):
        """Test error handling in dataset updates."""
        mock_update_links.side_effect = Exception("Update failed")
        quadkeys = [23010203]

        with pytest.raises(Exception, match="Update failed"):
            self.service.update_datasets(quadkeys)

    def test_load_ms_footprints_no_quadkeys(self):
        """Test loading MS footprints with no quadkeys."""
        result = self.service.load_ms_footprints(self.test_polygon, [])

        self.assertIsInstance(result, gpd.GeoDataFrame)
        self.assertEqual(len(result), 0)

    def test_process_osm_footprint(self):
        """Test that the OSM service returns buildings for Denver."""
        # Approximate polygon for Denver block
        denver_polygon = Polygon([(-104.984860, 39.736826), (-104.984852, 39.735269), (-104.983598, 39.735283), (-104.983596, 39.736865)])

        service = FootprintService()
        # Load real OSM footprints
        osm_gdf = service.load_osm_footprints(denver_polygon)
        processed_gdf = service.process_osm_footprints(osm_gdf)
        print(f"Found {len(processed_gdf)} OSM buildings in Denver")
        self.assertEqual(len(processed_gdf), 8)

        # save the file to a geojson in an output directory for inspection
        output_dir = Path("flask_app/tests/output")
        output_dir.mkdir(parents=True, exist_ok=True)
        processed_gdf.to_file(output_dir / "denver_osm_footprints.geojson", driver="GeoJSON")

    def test_process_ms_footprint(self):
        """Test that the MS service returns buildings for Denver."""
        # Approximate polygon for Denver block
        denver_polygon = Polygon([(-104.984860, 39.736826), (-104.984852, 39.735269), (-104.983598, 39.735283), (-104.983596, 39.736865)])

        service = FootprintService()
        # grab the correct quadkeys
        quadkeys = service.get_quadkeys_for_polygon(denver_polygon)
        service.update_datasets(quadkeys)

        # Load real MS footprints
        ms_gdf = service.load_ms_footprints(denver_polygon, quadkeys)
        processed_gdf = service.process_ms_footprints(ms_gdf)
        print(f"Found {len(processed_gdf)} MS buildings in Denver")
        self.assertEqual(len(processed_gdf), 8)

        # save the file to a geojson in an output directory for inspection
        output_dir = Path("flask_app/tests/output")
        output_dir.mkdir(parents=True, exist_ok=True)
        processed_gdf.to_file(output_dir / "denver_ms_footprints.geojson", driver="GeoJSON")

    def test_build_point_query_polygon(self):
        """Test that a small padded box is built around each point (not one bbox spanning all points)."""
        service = FootprintService()
        points = [
            {"latitude": 39.7, "longitude": -104.9},
            {"latitude": 39.71, "longitude": -104.95},
        ]

        polygon = service.build_point_query_polygon(points, buffer_degrees=0.01)

        # The overall bounds should still cover both points plus padding...
        minx, miny, maxx, maxy = polygon.bounds
        self.assertAlmostEqual(minx, -104.96, places=5)
        self.assertAlmostEqual(maxx, -104.89, places=5)
        self.assertAlmostEqual(miny, 39.69, places=5)
        self.assertAlmostEqual(maxy, 39.72, places=5)

        # All input points should fall within the resulting geometry
        for point in points:
            self.assertTrue(polygon.contains(Point(point["longitude"], point["latitude"])))

        # ...but a point far from both should NOT be inside the (per-point) union, since each
        # point only contributes its own small buffered box rather than one bbox spanning both.
        self.assertFalse(polygon.contains(Point(-104.925, 39.705)))

    def test_build_point_query_polygon_far_apart_points_stay_disjoint(self):
        """Test that widely separated points don't get swept into one giant bounding box."""
        service = FootprintService()
        points = [
            {"latitude": 39.7355, "longitude": -104.9845},  # Denver
            {"latitude": 45.0, "longitude": -110.0},  # far away (Montana)
        ]

        polygon = service.build_point_query_polygon(points, buffer_degrees=0.003)

        self.assertIsInstance(polygon, MultiPolygon)
        self.assertEqual(len(polygon.geoms), 2)

        # A point roughly "between" the two selected points should NOT be covered
        self.assertFalse(polygon.contains(Point(-107.5, 42.4)))

    def test_get_quadkeys_for_multipolygon_stays_small(self):
        """Test that quadkeys for widely separated points are computed per-part, not via one huge bbox."""
        service = FootprintService()
        points = [
            {"latitude": 39.7355, "longitude": -104.9845},  # Denver
            {"latitude": 45.0, "longitude": -110.0},  # far away (Montana)
        ]
        polygon = service.build_point_query_polygon(points, buffer_degrees=0.003)

        quadkeys = service.get_quadkeys_for_polygon(polygon)

        # Each small per-point box should only span a small handful of z9 tiles (not the dozens
        # of tiles that a single bbox spanning Denver-to-Montana would sweep in).
        self.assertLessEqual(len(quadkeys), 4)

    def test_match_footprints_to_points_overlap_only(self):
        """Test that only footprints containing a query point are returned as matched."""
        service = FootprintService()

        footprint_inside = Polygon([(-104.985, 39.735), (-104.984, 39.735), (-104.984, 39.736), (-104.985, 39.736)])
        footprint_far_away = Polygon([(-105.5, 40.5), (-105.4, 40.5), (-105.4, 40.6), (-105.5, 40.6)])

        footprints_gdf = gpd.GeoDataFrame({"height": [15.5, 22.0], "geometry": [footprint_inside, footprint_far_away]}, crs="EPSG:4326")
        points_gdf = gpd.GeoDataFrame(
            {"point_id": ["row-1"]},
            geometry=[Point(-104.9845, 39.7355)],  # inside footprint_inside
            crs="EPSG:4326",
        )

        matched, unmatched = service.match_footprints_to_points(points_gdf, footprints_gdf)

        self.assertEqual(len(matched), 1)
        self.assertEqual(matched.iloc[0]["matched_point_id"], "row-1")
        self.assertAlmostEqual(matched.iloc[0]["height"], 15.5)

        self.assertEqual(len(unmatched), 1)
        self.assertAlmostEqual(unmatched.iloc[0]["height"], 22.0)

    def test_match_footprints_to_points_no_overlap(self):
        """Test that a point outside every footprint (and beyond the nearest-fallback threshold) results in no matches."""
        service = FootprintService()

        footprint = Polygon([(-104.985, 39.735), (-104.984, 39.735), (-104.984, 39.736), (-104.985, 39.736)])
        footprints_gdf = gpd.GeoDataFrame({"height": [15.5]}, geometry=[footprint], crs="EPSG:4326")
        points_gdf = gpd.GeoDataFrame({"point_id": ["row-1"]}, geometry=[Point(-104.9, 39.7)], crs="EPSG:4326")

        matched, unmatched = service.match_footprints_to_points(points_gdf, footprints_gdf)

        self.assertEqual(len(matched), 0)
        self.assertEqual(len(unmatched), 1)

    def test_match_footprints_to_points_falls_back_to_closest(self):
        """A point just outside a footprint (but within the nearest-fallback threshold) should still match it."""
        service = FootprintService()

        footprint = Polygon([(-104.985, 39.735), (-104.984, 39.735), (-104.984, 39.736), (-104.985, 39.736)])
        footprints_gdf = gpd.GeoDataFrame({"height": [15.5]}, geometry=[footprint], crs="EPSG:4326")
        # Just outside the polygon (by ~0.0005 degrees), well within the default 0.003 threshold.
        points_gdf = gpd.GeoDataFrame({"point_id": ["row-1"]}, geometry=[Point(-104.9855, 39.7355)], crs="EPSG:4326")

        matched, unmatched = service.match_footprints_to_points(points_gdf, footprints_gdf)

        self.assertEqual(len(matched), 1)
        self.assertEqual(matched.iloc[0]["matched_point_id"], "row-1")
        self.assertEqual(matched.iloc[0]["footprint_match"], "closest")
        self.assertAlmostEqual(matched.iloc[0]["height"], 15.5)
        self.assertEqual(len(unmatched), 0)

    def test_footprints_to_feature_dicts(self):
        """Test conversion of a footprints GeoDataFrame into plain GeoJSON Feature dicts."""
        service = FootprintService()
        footprint = Polygon([(-104.985, 39.735), (-104.984, 39.735), (-104.984, 39.736), (-104.985, 39.736)])
        gdf = gpd.GeoDataFrame({"height": [15.5], "matched_point_id": ["row-1"]}, geometry=[footprint], crs="EPSG:4326")

        features = service.footprints_to_feature_dicts(gdf)

        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["type"], "Feature")
        self.assertEqual(features[0]["properties"]["matched_point_id"], "row-1")
        self.assertAlmostEqual(features[0]["properties"]["height"], 15.5)
        self.assertEqual(features[0]["geometry"]["type"], "Polygon")

    def test_footprints_to_feature_dicts_empty(self):
        """Test that an empty GeoDataFrame produces an empty feature list."""
        service = FootprintService()
        empty_gdf = gpd.GeoDataFrame()

        self.assertEqual(service.footprints_to_feature_dicts(empty_gdf), [])

    def test_match_points_to_ms_footprints_empty_points(self):
        """Test that an empty points list returns an empty result dict without touching disk."""
        service = FootprintService()
        self.assertEqual(service.match_points_to_ms_footprints([]), {})

    @patch("pathlib.Path.exists")
    @patch("gzip.open")
    @patch("geopandas.read_file")
    def test_match_points_to_ms_footprints_batches_per_quadkey(self, mock_read_file, mock_gzip_open, mock_exists):
        """
        Two points that land in the same MS quadkey tile should only load/read that tile's file
        once, and be matched via a single batched spatial join rather than one join per point.
        """
        service = FootprintService()
        mock_exists.return_value = True
        mock_gzip_open.return_value.__enter__ = Mock(return_value=Mock())
        mock_gzip_open.return_value.__exit__ = Mock(return_value=False)

        footprint_a = Polygon([(-104.985, 39.735), (-104.984, 39.735), (-104.984, 39.736), (-104.985, 39.736)])
        footprint_b = Polygon([(-104.981, 39.735), (-104.980, 39.735), (-104.980, 39.736), (-104.981, 39.736)])
        footprints_gdf = gpd.GeoDataFrame({"height": [15.5, 20.0]}, geometry=[footprint_a, footprint_b], crs="EPSG:4326")
        mock_read_file.return_value = footprints_gdf

        points = [
            {"index": "row-1", "latitude": 39.7355, "longitude": -104.9845},  # inside footprint_a
            {"index": "row-2", "latitude": 39.7355, "longitude": -104.9805},  # inside footprint_b
        ]

        results = service.match_points_to_ms_footprints(points)

        # Only one quadkey file should have been read, even though there are 2 points.
        self.assertEqual(mock_read_file.call_count, 1)

        self.assertEqual(set(results.keys()), {"row-1", "row-2"})
        self.assertEqual(results["row-1"]["footprint_match"], "intersection")
        self.assertAlmostEqual(results["row-1"]["height"], 15.5)
        self.assertEqual(results["row-2"]["footprint_match"], "intersection")
        self.assertAlmostEqual(results["row-2"]["height"], 20.0)

    @patch("pathlib.Path.exists")
    @patch("gzip.open")
    @patch("geopandas.read_file")
    def test_match_points_to_ms_footprints_falls_back_to_closest(self, mock_read_file, mock_gzip_open, mock_exists):
        """A point that doesn't intersect any footprint should fall back to the nearest one."""
        service = FootprintService()
        mock_exists.return_value = True
        mock_gzip_open.return_value.__enter__ = Mock(return_value=Mock())
        mock_gzip_open.return_value.__exit__ = Mock(return_value=False)

        footprint = Polygon([(-104.985, 39.735), (-104.984, 39.735), (-104.984, 39.736), (-104.985, 39.736)])
        footprints_gdf = gpd.GeoDataFrame({"height": [15.5]}, geometry=[footprint], crs="EPSG:4326")
        mock_read_file.return_value = footprints_gdf

        points = [{"index": "row-1", "latitude": 39.7, "longitude": -104.9}]  # not inside the footprint

        results = service.match_points_to_ms_footprints(points)

        self.assertEqual(results["row-1"]["footprint_match"], "closest")
        self.assertAlmostEqual(results["row-1"]["height"], 15.5)

    @patch("pathlib.Path.exists")
    def test_match_points_to_ms_footprints_missing_quadkey_file(self, mock_exists):
        """Points whose quadkey tile file doesn't exist on disk should be omitted from results."""
        service = FootprintService()
        mock_exists.return_value = False

        points = [{"index": "row-1", "latitude": 39.7355, "longitude": -104.9845}]

        self.assertEqual(service.match_points_to_ms_footprints(points), {})
