"""test_api_lakehouse.py — Q5 (2026-09-25). FastAPI contract (TestClient),
fail-closed behaviour without externals, lakehouse parquet writer,
OpenSearch indexer (real HTTP via MockTransport — no fabricated server)."""
import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app, indexer, store
from app.lakehouse import LakehouseUnavailableError, LakehouseWriter
from app.opensearch_client import OpenSearchError, OpenSearchIndexer

client = TestClient(app)


# ── API contract + fail-closed (no DATABASE_URL in test env) ───────────────

def test_healthz_reports_engine_and_gates():
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "geo-analytics"
    # Honest engine disclosure: no spark in test env ⇒ postgis-fallback.
    assert body["geospatial_engine"]["engine"] in ("postgis-fallback", "apache-sedona")
    assert "checks" in body


def test_lookup_fail_closed_without_database(monkeypatch):
    monkeypatch.setattr(store, "_url", None)
    r = client.get("/zones/lookup", params={"lon": 3.379, "lat": 6.524})
    assert r.status_code == 503
    assert "fail-closed" in r.json()["detail"]


def test_lookup_validates_coordinates():
    assert client.get("/zones/lookup", params={"lon": 200, "lat": 6.5}).status_code == 422
    assert client.get("/zones/lookup", params={"lon": 3.4, "lat": -95}).status_code == 422
    assert client.get("/zones/lookup").status_code == 422


def test_ingest_fail_closed_without_sources(monkeypatch):
    monkeypatch.delenv("GEODATA_SOURCES", raising=False)
    r = client.post("/ingest")
    assert r.status_code == 503
    assert "GEODATA_SOURCES" in r.json()["detail"]


def test_ingest_fail_closed_on_invalid_sources_env(monkeypatch):
    monkeypatch.setenv("GEODATA_SOURCES", "not json")
    r = client.post("/ingest")
    assert r.status_code == 500


def test_export_fail_closed_without_db(monkeypatch):
    monkeypatch.setattr(store, "_url", None)
    r = client.post("/features/export")
    assert r.status_code == 503


# ── Lakehouse writer (real parquet via pyarrow; skipped honestly if the
# runtime lacks pyarrow) ────────────────────────────────────────────────────

def test_lakehouse_fail_closed_without_path():
    with pytest.raises(LakehouseUnavailableError):
        LakehouseWriter(None)


def test_lakehouse_writes_parquet_and_catalog(tmp_path):
    pa = pytest.importorskip("pyarrow")  # honest: needs pyarrow installed
    import pyarrow.parquet as pq  # noqa

    writer = LakehouseWriter(str(tmp_path))
    rows = [
        {
            "zone_id": "flood-ng-lagos-001",
            "zone_name": "Lagos Lagoon Flood Zone",
            "zone_kind": "flood_zone",
            "risk_score": 0.8,
            "properties": "{}",
            "geom_geojson": '{"type":"Polygon"}',
            "source_url": "https://data.example.org/x.geojson",
            "ingested_at": "2026-09-25T00:00:00Z",
        }
    ]
    out = writer.write_zone_features(rows)
    assert out.name == "data.parquet"
    table = pq.read_table(out)
    assert table.num_rows == 1
    assert table.column("zone_id").to_pylist() == ["flood-ng-lagos-001"]
    catalog = json.loads((tmp_path / "_catalog.json").read_text())
    assert catalog["zone_risk_features"]["row_count"] == 1
    assert catalog["zone_risk_features"]["format"] == "parquet"


def test_lakehouse_refuses_empty(tmp_path):
    pytest.importorskip("pyarrow")
    writer = LakehouseWriter(str(tmp_path))
    with pytest.raises(LakehouseUnavailableError):
        writer.write_zone_features([])


# ── OpenSearch indexer (config-gated, fail-closed, real HTTP semantics) ────

def test_opensearch_disabled_fail_closed():
    idx = OpenSearchIndexer(None)
    assert idx.enabled is False
    with pytest.raises(OpenSearchError):
        idx.bulk_index([{"zone_id": "z1"}])


def test_opensearch_bulk_ndjson_and_errors(monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content.decode()
        captured["content_type"] = request.headers["content-type"]
        if request.url.path == "/_bulk":
            return httpx.Response(200, json={"errors": False, "items": [{"index": {"status": 200}}]})
        return httpx.Response(404)

    idx = OpenSearchIndexer("http://opensearch.test:9200")
    monkeypatch.setattr(idx, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    n = idx.bulk_index([{"zone_id": "z1", "risk_score": 0.4}])
    assert n == 1
    lines = captured["body"].strip().split("\n")
    assert json.loads(lines[0]) == {"index": {"_index": "insureportal-zone-features", "_id": "z1"}}
    assert json.loads(lines[1])["zone_id"] == "z1"
    assert captured["content_type"] == "application/x-ndjson"

    def err_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errors": True, "items": [{"index": {"error": {"type": "mapper_parsing_exception"}}}]})

    monkeypatch.setattr(idx, "_client", httpx.Client(transport=httpx.MockTransport(err_handler)))
    with pytest.raises(OpenSearchError):
        idx.bulk_index([{"zone_id": "z1"}])
