"""db.py — Q-wave Q5 (2026-09-25)

Postgres/PostGIS access (psycopg v3). Fail-closed: DATABASE_URL unset ⇒
store unavailable and API endpoints return 503 (never a fabricated answer).
"""

from __future__ import annotations

import json
from typing import Any

try:
    import psycopg

    _PSYCOPG_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PSYCOPG_AVAILABLE = False

from . import sqlgen
from .ingest import ZoneFeature


class StoreUnavailableError(RuntimeError):
    """Postgres is not configured/reachable (fail-closed)."""


class ZoneStore:
    def __init__(self, database_url: str | None) -> None:
        self._url = database_url
        self._conn = None

    @property
    def configured(self) -> bool:
        return bool(self._url) and _PSYCOPG_AVAILABLE

    def _connect(self):
        if not _PSYCOPG_AVAILABLE:
            raise StoreUnavailableError("psycopg not installed (fail-closed)")
        if not self._url:
            raise StoreUnavailableError("DATABASE_URL is not configured (fail-closed)")
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._url, connect_timeout=10, autocommit=True)
        return self._conn

    def ping(self) -> bool:
        try:
            conn = self._connect()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            return True
        except Exception:
            return False

    def ensure_schema(self) -> None:
        """Idempotent additive DDL (geo_zone_features only — no existing
        tables touched). Requires PostGIS; raises (fail-closed) if absent."""
        conn = self._connect()
        with conn.cursor() as cur:
            cur.execute(sqlgen.DDL_ENSURE_EXTENSION)
            cur.execute(sqlgen.DDL_CREATE_ZONE_FEATURES)
            cur.execute(sqlgen.DDL_CREATE_ZONE_FEATURES_INDEX)

    def upsert_zones(self, zones: list[ZoneFeature]) -> int:
        conn = self._connect()
        written = 0
        with conn.cursor() as cur:
            for z in zones:
                cur.execute(
                    sqlgen.SQL_UPSERT_ZONE,
                    sqlgen.upsert_zone_params(
                        z.zone_id,
                        z.zone_name,
                        z.zone_kind,
                        z.risk_score,
                        json.dumps(z.properties),
                        z.geom_geojson,
                        z.source_url,
                    ),
                )
                written += cur.rowcount
        return written

    def zones_containing_point(self, lon: float, lat: float) -> list[dict[str, Any]]:
        conn = self._connect()
        with conn.cursor() as cur:
            cur.execute(
                sqlgen.SQL_ZONES_CONTAINING_POINT,
                sqlgen.zones_containing_point_params(lon, lat),
            )
            rows = cur.fetchall()
        return [
            {
                "zone_id": r[0],
                "zone_name": r[1],
                "zone_kind": r[2],
                "risk_score": float(r[3]) if r[3] is not None else None,
                "properties": r[4],
            }
            for r in rows
        ]

    def all_zone_features(self) -> list[dict[str, Any]]:
        conn = self._connect()
        with conn.cursor() as cur:
            cur.execute(sqlgen.SQL_ALL_ZONE_FEATURES)
            rows = cur.fetchall()
        return [
            {
                "zone_id": r[0],
                "zone_name": r[1],
                "zone_kind": r[2],
                "risk_score": float(r[3]) if r[3] is not None else None,
                "properties": json.dumps(r[4]) if not isinstance(r[4], str) else r[4],
                "geom_geojson": r[5],
                "source_url": r[6],
                "ingested_at": r[7].isoformat() if r[7] is not None else None,
            }
            for r in rows
        ]

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
