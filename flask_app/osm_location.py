import osmnx as ox
from shapely.geometry import MultiPolygon, Polygon


def get_location_bbox(location_name: str):
    # Use osmnx to geocode the location and get the bounding box
    geocode_result = ox.geocode_to_gdf(location_name)
    if geocode_result.empty:
        return None

    # Return the list of [lon, lat] coordinates for the polygon or multipolygon
    geom = geocode_result.geometry.iloc[0]
    if geom.is_empty:
        return None  # Handle empty geometries gracefully

    def polygon_to_coords(polygon):
        # Primo anello: esterno, poi eventuali interni (holes)
        rings = [list(polygon.exterior.coords)]
        rings += [list(interior.coords) for interior in polygon.interiors]
        return rings

    coords_list = []
    if isinstance(geom, Polygon):
        coords_list = [polygon_to_coords(geom)]
    elif isinstance(geom, MultiPolygon):
        for part in geom.geoms:
            if isinstance(part, Polygon):
                coords_list.append(polygon_to_coords(part))
    else:
        return None  # Unsupported geometry

    if len(coords_list) == 1:
        return coords_list[0]
    return coords_list
