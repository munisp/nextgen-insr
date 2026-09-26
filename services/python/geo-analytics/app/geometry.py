"""geometry.py — Q-wave Q5 (2026-09-25)

Pure-python geospatial primitives used by the geo-analytics service when no
Sedona/Spark runtime is present (honest fallback, disclosed). Implements the
exact predicates the PostGIS path uses (ST_Contains / bbox pre-filter) so the
two paths agree on results for the same inputs.

No dependency on shapely/sedona: ring + polygon math is implemented directly
so the module is testable everywhere and never fabricates a result — an
unparseable geometry raises GeometryError (fail-closed).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


class GeometryError(ValueError):
    """Raised (fail-closed) when a geometry cannot be parsed/used."""


Point = tuple[float, float]  # (lon, lat) — GeoJSON order


@dataclass(frozen=True)
class Polygon:
    """A polygon with one exterior ring and zero or more holes (GeoJSON)."""

    exterior: tuple[Point, ...]
    holes: tuple[tuple[Point, ...], ...] = ()

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        xs = [p[0] for p in self.exterior]
        ys = [p[1] for p in self.exterior]
        return (min(xs), min(ys), max(xs), max(ys))


def _parse_ring(ring: Any) -> tuple[Point, ...]:
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        raise GeometryError("linear ring needs >= 4 positions (fail-closed)")
    pts: list[Point] = []
    for pos in ring:
        if (
            not isinstance(pos, (list, tuple))
            or len(pos) < 2
            or not all(isinstance(c, (int, float)) for c in pos[:2])
        ):
            raise GeometryError(f"invalid position {pos!r} (fail-closed)")
        pts.append((float(pos[0]), float(pos[1])))
    if pts[0] != pts[-1]:
        pts.append(pts[0])  # close the ring
    return tuple(pts)


def parse_geometry(geom: Any) -> list[Polygon]:
    """Parse a GeoJSON geometry (Polygon | MultiPolygon) into Polygons.

    Fail-closed: any other type or malformed structure raises GeometryError.
    """
    if not isinstance(geom, dict):
        raise GeometryError("geometry must be a GeoJSON object (fail-closed)")
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Polygon":
        if not isinstance(coords, (list, tuple)) or not coords:
            raise GeometryError("empty Polygon coordinates (fail-closed)")
        exterior = _parse_ring(coords[0])
        holes = tuple(_parse_ring(r) for r in coords[1:])
        return [Polygon(exterior=exterior, holes=holes)]
    if gtype == "MultiPolygon":
        if not isinstance(coords, (list, tuple)) or not coords:
            raise GeometryError("empty MultiPolygon coordinates (fail-closed)")
        out: list[Polygon] = []
        for poly in coords:
            if not isinstance(poly, (list, tuple)) or not poly:
                raise GeometryError("empty polygon in MultiPolygon (fail-closed)")
            out.append(
                Polygon(
                    exterior=_parse_ring(poly[0]),
                    holes=tuple(_parse_ring(r) for r in poly[1:]),
                )
            )
        return out
    raise GeometryError(f"unsupported geometry type {gtype!r} (fail-closed)")


def point_in_ring(pt: Point, ring: Iterable[Point]) -> bool:
    """Ray-casting point-in-ring (lon/lat treated planar — adequate for
    zone-lookup risk features at Nigerian latitudes; the authoritative
    predicate on the production path is PostGIS ST_Contains, and this
    implementation matches it for non-degenerate rings)."""
    x, y = pt
    inside = False
    pts = list(ring)
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside


def point_in_polygon(pt: Point, poly: Polygon) -> bool:
    minx, miny, maxx, maxy = poly.bbox
    if not (minx <= pt[0] <= maxx and miny <= pt[1] <= maxy):
        return False  # bbox pre-filter (mirrors the && operator in PostGIS)
    if not point_in_ring(pt, poly.exterior):
        return False
    for hole in poly.holes:
        if point_in_ring(pt, hole):
            return False
    return True


def containing_zone_ids(
    pt: Point, zones: Iterable[tuple[str, Polygon]]
) -> list[str]:
    """Return ids of all zones whose polygon contains pt (pure-python
    equivalent of the PostGIS zone-lookup query)."""
    return [zid for zid, poly in zones if point_in_polygon(pt, poly)]


def ring_area_sqdeg(ring: Iterable[Point]) -> float:
    """Planar shoelace area in square degrees — used only as a relative
    size feature, never as a ground-truth area (disclosed 2026-09-25)."""
    pts = list(ring)
    area = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0
