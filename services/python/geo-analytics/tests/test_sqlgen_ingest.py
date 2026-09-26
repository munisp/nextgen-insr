"""test_sqlgen_ingest.py — Q5 (2026-09-25). SQL generation, ingestion parsing,
fail-closed paths (no DB required — testcontainers disclosed optional)."""
import json

import httpx
import pytest

from app import sqlgen
from app.ingest import (
    GeoSource,
    SourceFetchError,
    SourceParseError,
    fetch_source,
    parse_feature_collection,
    parse_sources_env,
)

FC = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "id": "flood-ng-lagos-001",
            "properties": {"name": "Lagos Lagoon Flood Zone", "severity": "high"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[3.30, 6.45], [3.45, 6.45], [3.45, 6.60], [3.30, 6.60], [3.30, 6.45]]
                ],
            },
        },
        {
            "type": "Feature",
            "properties": {"name": "no id here"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[4.0, 7.0], [4.1, 7.0], [4.1, 7.1], [4.0, 7.1], [4.0, 7.0]]
                ],
            },
        },
        {
            "type": "Feature",
            "id": "bad-geom",
            "properties": {},
            "geometry": {"type": "Point", "coordinates": [3.4, 6.5]},
        },
    ],
}

SRC = GeoSource(url="https://data.example.org/flood-zones.geojson", zone_kind="flood_zone", risk_score=0.8)


# ── SQL generation (honest: strings + param tuples, no DB) ─────────────────

def test_sql_is_parameterised_no_interpolation():
    for stmt in (
        sqlgen.SQL_UPSERT_ZONE,
        sqlgen.SQL_ZONES_CONTAINING_POINT,
        sqlgen.SQL_ZONES_INTERSECTING_GEOJSON,
    ):
        assert "%s" in stmt
        assert "ST_" in stmt
        # no python format holes / f-string leftovers
        assert "{" not in stmt.replace("'{", "").replace("}'", "")


def test_zone_table_uses_postgis_geometry():
    assert "geometry(MultiPolygon, 4326)" in sqlgen.DDL_CREATE_ZONE_FEATURES
    assert "gist" in sqlgen.DDL_CREATE_ZONE_FEATURES_INDEX.lower()


def test_upsert_params_order_and_validity_guard():
    params = sqlgen.upsert_zone_params("z1", "Zone 1", "flood_zone", 0.5, "{}", '{"type":"Polygon"}', "https://x")
    assert params[0] == "z1" and params[6] == "https://x"
    # geometry appears twice: insert + ST_IsValid fail-closed guard
    assert params[5] == params[7]
    assert "ST_IsValid" in sqlgen.SQL_UPSERT_ZONE


def test_point_params_used_twice_for_bbox_and_exact():
    assert sqlgen.zones_containing_point_params(3.4, 6.5) == (3.4, 6.5, 3.4, 6.5)


# ── Ingestion parsing ───────────────────────────────────────────────────────

def test_parse_feature_collection_counts_skips():
    report = parse_feature_collection(json.dumps(FC).encode(), SRC)
    assert report.ok is True
    assert report.features_total == 3
    assert report.features_valid == 1          # only the well-formed feature
    assert report.features_skipped == 2        # missing id + Point geometry
    zone = report.zones[0]
    assert zone.zone_id == "flood-ng-lagos-001"
    assert zone.zone_kind == "flood_zone"
    assert zone.risk_score == 0.8
    assert json.loads(zone.geom_geojson)["type"] == "Polygon"


def test_parse_fail_closed_on_non_featurecollection():
    with pytest.raises(SourceParseError):
        parse_feature_collection(b'{"type":"Feature"}', SRC)
    with pytest.raises(SourceParseError):
        parse_feature_collection(b"not json", SRC)


def test_zero_valid_features_is_source_failure():
    body = json.dumps({"type": "FeatureCollection", "features": []}).encode()
    report = parse_feature_collection(body, SRC)
    assert report.ok is False
    assert "fail-closed" in report.error


def test_parse_sources_env_fail_closed():
    assert parse_sources_env(None) == []
    assert parse_sources_env("") == []
    with pytest.raises(SourceParseError):
        parse_sources_env("not json")
    with pytest.raises(SourceParseError):
        parse_sources_env('{"url":"https://x"}')          # must be a list
    with pytest.raises(SourceParseError):
        parse_sources_env('[{"zone_kind":"flood"}]')       # missing url
    with pytest.raises(SourceParseError):
        parse_sources_env('[{"url":"ftp://x"}]')           # not http(s)
    srcs = parse_sources_env('[{"url":"https://a/b.geojson","zone_kind":"admin_boundary"}]')
    assert srcs[0].zone_kind == "admin_boundary"


def test_fetch_source_real_http_fail_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/ok":
            return httpx.Response(200, json=FC)
        if request.url.path == "/broken":
            return httpx.Response(500, text="boom")
        if request.url.path == "/down":
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, text="not json")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    ok = fetch_source(client, GeoSource(url="https://t/ok"))
    assert ok.ok and ok.features_valid == 1
    with pytest.raises(SourceFetchError):
        fetch_source(client, GeoSource(url="https://t/broken"))
    with pytest.raises(SourceParseError):
        fetch_source(client, GeoSource(url="https://t/notjson"))
    with pytest.raises(SourceFetchError):
        fetch_source(client, GeoSource(url="https://t/down"))
