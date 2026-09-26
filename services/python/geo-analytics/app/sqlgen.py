"""sqlgen.py — Q-wave Q5 (2026-09-25)

PostGIS SQL generation for the fallback geospatial path. All statements are
parameterised (%s placeholders) — geometry/values NEVER string-interpolated
(SQL-injection safe by construction). The pure-python geometry module mirrors
these predicates for environments without a database.

Target table (migration-owned by this service's deploy step, additive):

    geo_zone_features (
        zone_id     text PRIMARY KEY,
        zone_name   text NOT NULL,
        zone_kind   text NOT NULL,          -- flood_zone | admin_boundary | crop_zone
        risk_score  numeric(6,3),           -- 0..1 computed feature
        properties  jsonb NOT NULL DEFAULT '{}',
        geom        geometry(MultiPolygon, 4326) NOT NULL,
        source_url  text NOT NULL,
        ingested_at timestamp NOT NULL DEFAULT now()
    )
"""

from __future__ import annotations

# ── DDL (idempotent; PostGIS extension required — fail-closed when absent) ──

DDL_ENSURE_EXTENSION = "CREATE EXTENSION IF NOT EXISTS postgis"

DDL_CREATE_ZONE_FEATURES = """
CREATE TABLE IF NOT EXISTS geo_zone_features (
    zone_id     text PRIMARY KEY,
    zone_name   text NOT NULL,
    zone_kind   text NOT NULL,
    risk_score  numeric(6,3),
    properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
    geom        geometry(MultiPolygon, 4326) NOT NULL,
    source_url  text NOT NULL,
    ingested_at timestamp NOT NULL DEFAULT now()
)
"""

DDL_CREATE_ZONE_FEATURES_INDEX = """
CREATE INDEX IF NOT EXISTS geo_zone_features_geom_gix
ON geo_zone_features USING gist (geom)
"""

# ── Ingestion upsert (real GeoJSON → WGS84 MultiPolygon) ────────────────────
# ST_GeomFromGeoJSON parses the REAL feature geometry; ST_Multi normalises
# Polygon → MultiPolygon; ST_IsValid guard fails the row closed.
SQL_UPSERT_ZONE = """
INSERT INTO geo_zone_features
    (zone_id, zone_name, zone_kind, risk_score, properties, geom, source_url)
SELECT %s, %s, %s, %s, %s::jsonb,
       ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
       %s
WHERE ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
ON CONFLICT (zone_id) DO UPDATE SET
    zone_name   = EXCLUDED.zone_name,
    zone_kind   = EXCLUDED.zone_kind,
    risk_score  = EXCLUDED.risk_score,
    properties  = EXCLUDED.properties,
    geom        = EXCLUDED.geom,
    source_url  = EXCLUDED.source_url,
    ingested_at = now()
"""

# ── Zone lookup: which zones contain the point (lon, lat)? ──────────────────
SQL_ZONES_CONTAINING_POINT = """
SELECT zone_id, zone_name, zone_kind, risk_score, properties
FROM geo_zone_features
WHERE geom && ST_SetSRID(ST_MakePoint(%s, %s), 4326)      -- bbox pre-filter
  AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
ORDER BY zone_kind, zone_id
"""

# ── Trigger enrichment: zones intersecting a trigger's area of interest ─────
SQL_ZONES_INTERSECTING_GEOJSON = """
SELECT zone_id, zone_name, zone_kind, risk_score
FROM geo_zone_features
WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
ORDER BY zone_kind, zone_id
"""

# ── Feature export for the lakehouse writer ─────────────────────────────────
SQL_ALL_ZONE_FEATURES = """
SELECT zone_id, zone_name, zone_kind, risk_score, properties,
       ST_AsGeoJSON(geom) AS geom_geojson, source_url, ingested_at
FROM geo_zone_features
ORDER BY zone_id
"""


def zones_containing_point_params(lon: float, lat: float) -> tuple[float, ...]:
    """Parameter tuple for SQL_ZONES_CONTAINING_POINT (point used twice:
    bbox pre-filter + exact predicate)."""
    return (lon, lat, lon, lat)


def upsert_zone_params(
    zone_id: str,
    zone_name: str,
    zone_kind: str,
    risk_score: float | None,
    properties_json: str,
    geom_geojson: str,
    source_url: str,
) -> tuple:
    """Parameter tuple for SQL_UPSERT_ZONE (geometry supplied twice for the
    ST_IsValid fail-closed guard)."""
    return (
        zone_id,
        zone_name,
        zone_kind,
        risk_score,
        properties_json,
        geom_geojson,
        source_url,
        geom_geojson,
    )
