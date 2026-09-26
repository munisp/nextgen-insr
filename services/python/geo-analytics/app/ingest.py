"""ingest.py — Q-wave Q5 (2026-09-25)

GeoLibre-style open geodata ingestion: flood-zone / admin-boundary GeoJSON
from CONFIGURABLE public URLs (GEODATA_SOURCES env, JSON list of
{"url","zone_kind","risk_score"} entries). Real HTTP via httpx with a hard
timeout; every failure mode is fail-closed:

  - URL unreachable / non-2xx        → SourceFetchError, source skipped
  - body not valid JSON / not a
    FeatureCollection                  → SourceParseError, source skipped
  - feature with unparseable geometry  → feature skipped (counted)
  - zero valid features                → source counted as failed

A failed source NEVER produces fabricated zones.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx

from .geometry import GeometryError, parse_geometry


class SourceFetchError(RuntimeError):
    """Source could not be retrieved (fail-closed)."""


class SourceParseError(RuntimeError):
    """Source body is not a usable GeoJSON FeatureCollection (fail-closed)."""


@dataclass(frozen=True)
class GeoSource:
    url: str
    zone_kind: str = "flood_zone"
    risk_score: float | None = None


@dataclass
class ZoneFeature:
    zone_id: str
    zone_name: str
    zone_kind: str
    risk_score: float | None
    properties: dict
    geom_geojson: str
    source_url: str


@dataclass
class IngestReport:
    source_url: str
    ok: bool
    features_total: int = 0
    features_valid: int = 0
    features_skipped: int = 0
    error: str | None = None
    zones: list[ZoneFeature] = field(default_factory=list)


def parse_sources_env(raw: str | None) -> list[GeoSource]:
    """GEODATA_SOURCES env → [GeoSource]. Fail-closed: missing/invalid env ⇒
    empty list (the /ingest endpoint then reports 0 sources, never guesses)."""
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SourceParseError(f"GEODATA_SOURCES is not valid JSON: {exc}") from exc
    if not isinstance(items, list):
        raise SourceParseError("GEODATA_SOURCES must be a JSON list")
    out: list[GeoSource] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            raise SourceParseError(f"GEODATA_SOURCES[{i}] lacks a url (fail-closed)")
        url = item["url"]
        if not url.startswith(("https://", "http://")):
            raise SourceParseError(f"GEODATA_SOURCES[{i}] url must be http(s) (fail-closed)")
        out.append(
            GeoSource(
                url=url,
                zone_kind=str(item.get("zone_kind", "flood_zone")),
                risk_score=item.get("risk_score"),
            )
        )
    return out


def parse_feature_collection(body: bytes, source: GeoSource) -> IngestReport:
    """Parse a GeoJSON FeatureCollection body into ZoneFeatures.

    Fail-closed: invalid JSON / wrong type ⇒ SourceParseError; individual
    features with bad geometry are skipped and counted (never fabricated).
    """
    report = IngestReport(source_url=source.url, ok=False)
    try:
        obj = json.loads(body)
    except json.JSONDecodeError as exc:
        raise SourceParseError(f"{source.url}: body is not valid JSON: {exc}") from exc
    if not isinstance(obj, dict) or obj.get("type") != "FeatureCollection":
        raise SourceParseError(f"{source.url}: not a GeoJSON FeatureCollection (fail-closed)")
    features = obj.get("features")
    if not isinstance(features, list):
        raise SourceParseError(f"{source.url}: features is not a list (fail-closed)")

    report.features_total = len(features)
    for idx, feat in enumerate(features):
        try:
            if not isinstance(feat, dict) or feat.get("type") != "Feature":
                raise GeometryError("not a GeoJSON Feature")
            polys = parse_geometry(feat.get("geometry"))
            if not polys:
                raise GeometryError("no polygon in geometry")
            props = feat.get("properties") if isinstance(feat.get("properties"), dict) else {}
            zone_id = str(props.get("zone_id") or props.get("id") or feat.get("id") or "")
            if not zone_id:
                raise GeometryError("feature lacks an id (fail-closed)")
            # Normalise Polygon/MultiPolygon: keep the ORIGINAL GeoJSON
            # geometry text for ST_GeomFromGeoJSON (already validated
            # parseable by geometry.parse_geometry above).
            geom_geojson = json.dumps(feat["geometry"], separators=(",", ":"))
            report.zones.append(
                ZoneFeature(
                    zone_id=zone_id,
                    zone_name=str(props.get("name", zone_id)),
                    zone_kind=source.zone_kind,
                    risk_score=source.risk_score,
                    properties=props,
                    geom_geojson=geom_geojson,
                    source_url=source.url,
                )
            )
        except GeometryError:
            report.features_skipped += 1
    report.features_valid = len(report.zones)
    report.ok = report.features_valid > 0
    if not report.ok:
        report.error = (
            f"{source.url}: 0/{report.features_total} features usable (fail-closed)"
        )
    return report


def fetch_source(client: httpx.Client, source: GeoSource, timeout_s: float = 20.0) -> IngestReport:
    """Fetch + parse one source. Real HTTP, fail-closed."""
    try:
        resp = client.get(source.url, timeout=timeout_s, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise SourceFetchError(f"{source.url}: unreachable: {exc}") from exc
    if resp.status_code != 200:
        raise SourceFetchError(f"{source.url}: HTTP {resp.status_code} (fail-closed)")
    return parse_feature_collection(resp.content, source)
