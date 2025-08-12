import geopandas as gpd
from shapely.geometry import Polygon

from flask_app.services.footprint_service import FootprintService

footprint_service = FootprintService()


def test_merge_footprint_geodataframes():
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

    merged = footprint_service.merge_footprint_geodataframes(gdf_1, gdf_2)

    print(merged)
    assert len(merged) > 0, "Merged GeoDataFrame should not be empty"
    assert "geometry" in merged.columns, "Merged GeoDataFrame should have geometry column"
    assert "ubid_1" in merged.columns, "Merged GeoDataFrame should have ubid_1 column"
