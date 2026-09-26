"""test_geometry.py — Q5 (2026-09-25). Pure-python geometry predicates."""
import pytest

from app.geometry import (
    GeometryError,
    containing_zone_ids,
    parse_geometry,
    point_in_polygon,
    ring_area_sqdeg,
)

# Lagos-ish square: lon 3.30..3.45, lat 6.45..6.60
SQUARE = {
    "type": "Polygon",
    "coordinates": [
        [[3.30, 6.45], [3.45, 6.45], [3.45, 6.60], [3.30, 6.60], [3.30, 6.45]]
    ],
}


def test_parse_polygon_ok():
    polys = parse_geometry(SQUARE)
    assert len(polys) == 1
    assert polys[0].bbox == (3.30, 6.45, 3.45, 6.60)


def test_point_in_polygon_inside_outside():
    (poly,) = parse_geometry(SQUARE)
    assert point_in_polygon((3.375, 6.52), poly) is True
    assert point_in_polygon((4.0, 6.52), poly) is False   # outside (bbox)
    assert point_in_polygon((3.375, 7.0), poly) is False  # outside north


def test_polygon_with_hole():
    geom = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
        ],
    }
    (poly,) = parse_geometry(geom)
    assert point_in_polygon((2, 2), poly) is True
    assert point_in_polygon((5, 5), poly) is False  # inside the hole


def test_multipolygon():
    geom = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
        ],
    }
    polys = parse_geometry(geom)
    assert len(polys) == 2


def test_parse_fail_closed_on_bad_input():
    with pytest.raises(GeometryError):
        parse_geometry({"type": "Point", "coordinates": [3, 6]})
    with pytest.raises(GeometryError):
        parse_geometry({"type": "Polygon", "coordinates": []})
    with pytest.raises(GeometryError):
        parse_geometry({"type": "Polygon", "coordinates": [[[0, 0], [1, 1]]]})
    with pytest.raises(GeometryError):
        parse_geometry("not a geometry")
    with pytest.raises(GeometryError):
        parse_geometry({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, "x"], [0, 0]]]})


def test_containing_zone_ids():
    (poly,) = parse_geometry(SQUARE)
    zones = [("flood-lagos-1", poly)]
    assert containing_zone_ids((3.375, 6.52), zones) == ["flood-lagos-1"]
    assert containing_zone_ids((9.0, 9.0), zones) == []


def test_ring_area():
    ring = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (0.0, 0.0)]
    assert ring_area_sqdeg(ring) == pytest.approx(4.0)
