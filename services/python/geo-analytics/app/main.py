"""main.py — Q-wave Q5 (2026-09-25): geo-analytics service.

Geospatial risk support for parametric products:
  - GeoLibre-style open geodata ingestion (configurable public GeoJSON URLs,
    real HTTP, fail-closed)
  - PostGIS zone storage + lookup (Apache Sedona where available — see
    sedona.py for the dated engine disclosure)
  - zone_risk_features export to the lakehouse (parquet, repo convention)
  - OpenSearch bulk indexing of zone features (config-gated, fail-closed)
  - FastAPI zone-lookup API used to enrich parametric trigger definitions
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from .db import StoreUnavailableError, ZoneStore
from .ingest import (
    SourceFetchError,
    SourceParseError,
    fetch_source,
    parse_sources_env,
)
from .lakehouse import LakehouseUnavailableError, LakehouseWriter
from .opensearch_client import OpenSearchError, OpenSearchIndexer
from .sedona import sedona_status

store = ZoneStore(os.environ.get("DATABASE_URL"))
indexer = OpenSearchIndexer(os.environ.get("OPENSEARCH_ADDR"))
LAKEHOUSE_PATH = os.environ.get("LAKEHOUSE_PATH", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    store.close()
    indexer.close()


app = FastAPI(
    title="geo-analytics",
    version="q5-2026-09-25",
    lifespan=lifespan,
)


class IngestResponse(BaseModel):
    sources_configured: int
    sources_ok: int
    sources_failed: int
    zones_upserted: int
    reports: list[dict]


class ZoneHit(BaseModel):
    zone_id: str
    zone_name: str
    zone_kind: str
    risk_score: float | None
    properties: dict = Field(default_factory=dict)


class LookupResponse(BaseModel):
    lon: float
    lat: float
    engine: str
    zones: list[ZoneHit]


@app.get("/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "service": "geo-analytics",
        "version": "q5-2026-09-25",
        "geospatial_engine": sedona_status(),
        "checks": {
            "postgres_configured": store.configured,
            "opensearch_enabled": indexer.enabled,
            "lakehouse_configured": bool(LAKEHOUSE_PATH),
        },
    }


@app.post("/ingest", response_model=IngestResponse)
def ingest() -> IngestResponse:
    """Fetch all configured GEODATA_SOURCES (real HTTP) and upsert zones into
    PostGIS. Fail-closed: unreachable/invalid sources are reported, never
    fabricated; zero valid features from a source = source failed."""
    try:
        sources = parse_sources_env(os.environ.get("GEODATA_SOURCES"))
    except SourceParseError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not sources:
        raise HTTPException(
            status_code=503,
            detail="GEODATA_SOURCES is not configured (fail-closed, disclosed 2026-09-25)",
        )
    try:
        store.ensure_schema()
    except StoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # e.g. PostGIS extension missing
        raise HTTPException(
            status_code=503, detail=f"schema ensure failed (PostGIS required, fail-closed): {exc}"
        ) from exc

    reports: list[dict] = []
    zones_upserted = 0
    sources_ok = 0
    with httpx.Client() as client:
        for source in sources:
            try:
                report = fetch_source(client, source)
                if report.ok:
                    zones_upserted += store.upsert_zones(report.zones)
                    sources_ok += 1
                reports.append(
                    {
                        "source_url": report.source_url,
                        "ok": report.ok,
                        "features_total": report.features_total,
                        "features_valid": report.features_valid,
                        "features_skipped": report.features_skipped,
                        "error": report.error,
                    }
                )
            except (SourceFetchError, SourceParseError) as exc:
                reports.append({"source_url": source.url, "ok": False, "error": str(exc)})
    return IngestResponse(
        sources_configured=len(sources),
        sources_ok=sources_ok,
        sources_failed=len(sources) - sources_ok,
        zones_upserted=zones_upserted,
        reports=reports,
    )


@app.get("/zones/lookup", response_model=LookupResponse)
def zones_lookup(
    lon: float = Query(..., ge=-180.0, le=180.0),
    lat: float = Query(..., ge=-90.0, le=90.0),
) -> LookupResponse:
    """Which risk zones contain this point? Used to enrich parametric trigger
    definitions. Fail-closed: no DATABASE_URL ⇒ 503 (never a guessed zone)."""
    try:
        hits = store.zones_containing_point(lon, lat)
    except StoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"zone lookup failed (fail-closed): {exc}") from exc
    return LookupResponse(
        lon=lon, lat=lat, engine=sedona_status()["engine"], zones=[ZoneHit(**h) for h in hits]
    )


@app.post("/features/export")
def features_export() -> dict:
    """Export zone_risk_features to the lakehouse (parquet) and bulk-index to
    OpenSearch when configured. Both sinks fail closed with honest errors."""
    try:
        rows = store.all_zone_features()
    except StoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(
            status_code=409, detail="no zone features to export (ingest first; fail-closed)"
        )

    result: dict = {"rows": len(rows), "lakehouse": None, "opensearch": None}
    try:
        writer = LakehouseWriter(LAKEHOUSE_PATH)
        out = writer.write_zone_features(rows)
        result["lakehouse"] = {"ok": True, "path": str(out)}
    except LakehouseUnavailableError as exc:
        result["lakehouse"] = {"ok": False, "error": str(exc)}

    if indexer.enabled:
        try:
            indexed = indexer.bulk_index(rows)
            result["opensearch"] = {"ok": True, "indexed": indexed}
        except OpenSearchError as exc:
            result["opensearch"] = {"ok": False, "error": str(exc)}
    else:
        result["opensearch"] = {
            "ok": False,
            "error": "OPENSEARCH_ADDR not configured (config-gated, disclosed 2026-09-25)",
        }
    return result
