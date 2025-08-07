import logging

import osmnx as ox
from osmnx._errors import InsufficientResponseError
from shapely.geometry import MultiPolygon, Polygon


def get_location_bbox(location_name):
    # Accept string or dict
    if isinstance(location_name, dict):
        if "place_name" in location_name:
            location_query = location_name["place_name"]
        else:
            logging.error(f"location_name dict missing 'place_name': {location_name}")
            return None
    elif isinstance(location_name, str):
        location_query = location_name
    else:
        logging.error(f"location_name is not str or dict: {location_name}")
        return None

    logging.info(f"Geocoding location: {location_query}")
    try:
        geocode_result = ox.geocode_to_gdf(location_query)
        logging.info(f"Geocode result: {geocode_result}")
    except InsufficientResponseError as e:
        logging.warning(f"No geocode results for location: {location_query} ({e})")
        return None
    except Exception as e:
        logging.error(f"Geocoding failed for '{location_query}': {e}")
        raise
    if geocode_result.empty:
        logging.warning(f"No geocode results for location: {location_query}")
        return None

    # Return a valid GeoJSON Feature for the polygon or multipolygon
    geom = geocode_result.geometry.iloc[0]
    if geom.is_empty:
        logging.warning(f"Geometry is empty for location: {location_query}")
        return None  # Handle empty geometries gracefully

    def polygon_to_coords(polygon):
        rings = [list(polygon.exterior.coords)]
        rings += [list(interior.coords) for interior in polygon.interiors]
        return rings

    geometry_type = None
    coordinates = None
    if isinstance(geom, Polygon):
        geometry_type = "Polygon"
        coordinates = polygon_to_coords(geom)
    elif isinstance(geom, MultiPolygon):
        geometry_type = "MultiPolygon"
        coordinates = [polygon_to_coords(part) for part in geom.geoms if isinstance(part, Polygon)]
    else:
        logging.warning(f"Unsupported geometry type for location: {location_query}")
        return None  # Unsupported geometry

    # Coordinates from Shapely are already in (lon, lat) order; no swap needed
    geojson = {
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": geometry_type,
            "coordinates": coordinates,
        },
    }
    logging.info(f"Final GeoJSON Feature: {geojson}")
    return geojson
