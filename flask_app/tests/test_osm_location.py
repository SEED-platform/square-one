from flask_app.osm_location import get_location_bbox

# These tests will actually call out to OSMnx/Nominatim


def test_get_location_bbox_with_valid_string():
    bbox = get_location_bbox("Denver, CO")
    assert bbox is not None
    assert isinstance(bbox, dict)
    assert bbox.get("type") == "Feature"
    geometry = bbox.get("geometry")
    assert geometry is not None
    assert geometry["type"] in ("Polygon", "MultiPolygon")
    coords = geometry["coordinates"]
    assert isinstance(coords, list)


def test_get_location_bbox_with_valid_dict():
    bbox = get_location_bbox({"place_name": "San Francisco, CA"})
    assert bbox is not None
    assert isinstance(bbox, dict)
    assert bbox.get("type") == "Feature"
    geometry = bbox.get("geometry")
    assert geometry is not None
    assert geometry["type"] in ("Polygon", "MultiPolygon")
    coords = geometry["coordinates"]
    assert isinstance(coords, list)


def test_get_location_bbox_with_invalid_dict():
    bbox = get_location_bbox({"not_a_place": "Nowhere"})
    assert bbox is None


def test_get_location_bbox_with_invalid_string():
    bbox = get_location_bbox("asldkfjalsdkfjalskdjflasdjflasdjf")
    assert bbox is None


def test_get_location_bbox_sunnyvale():
    bbox = get_location_bbox("Sunnyvale, California, United States")
    assert bbox is not None
    assert isinstance(bbox, dict)
    assert bbox.get("type") == "Feature"
    geometry = bbox.get("geometry")
    assert geometry is not None
    assert geometry["type"] in ("Polygon", "MultiPolygon")
    coords = geometry["coordinates"]
    assert isinstance(coords, list)


def test_get_location_bbox_sunnyvale_with_dict():
    bbox = get_location_bbox({"place_name": "Sunnyvale, California, United States"})
    assert bbox is not None
    assert isinstance(bbox, dict)
    assert bbox.get("type") == "Feature"
    geometry = bbox.get("geometry")
    assert geometry is not None
    assert geometry["type"] in ("Polygon", "MultiPolygon")
    coords = geometry["coordinates"]
    assert isinstance(coords, list)
