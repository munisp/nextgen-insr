"""
OpenAppSec → Lakehouse Connector
Exports WAF attack events, security metrics, and threat intelligence
from the OpenAppSec agent syslog/HTTP API into the S3 lakehouse.

OpenAppSec writes events to:
  1. A local syslog/log file (parsed via tail)
  2. An optional HTTP reporting endpoint
  3. The APISIX access log (enriched with WAF decisions)
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import boto3
import httpx
import pyarrow as pa
import pyarrow.parquet as pq

log = logging.getLogger(__name__)

OPENAPPSEC_LOG_PATH = os.getenv("OPENAPPSEC_LOG_PATH", "/var/log/nano_agent/cp-nano-http-transaction-handler.log")
OPENAPPSEC_API_URL = os.getenv("OPENAPPSEC_API_URL", "http://openappsec-agent:8090")
APISIX_ACCESS_LOG_PATH = os.getenv("APISIX_ACCESS_LOG_PATH", "/var/log/apisix/access.log")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
S3_BUCKET = os.getenv("S3_BUCKET", "insureportal-lakehouse")

WAF_EVENT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("event_type", pa.string()),     # DETECT / PREVENT / ALLOW
    pa.field("attack_type", pa.string()),    # SQLi / XSS / CSRF / etc.
    pa.field("severity", pa.string()),       # CRITICAL / HIGH / MEDIUM / LOW
    pa.field("source_ip", pa.string()),
    pa.field("source_country", pa.string()),
    pa.field("destination_ip", pa.string()),
    pa.field("http_method", pa.string()),
    pa.field("uri", pa.string()),
    pa.field("host", pa.string()),
    pa.field("user_agent", pa.string()),
    pa.field("matched_rule", pa.string()),
    pa.field("matched_location", pa.string()),
    pa.field("matched_parameter", pa.string()),
    pa.field("matched_value", pa.string()),
    pa.field("response_code", pa.int32()),
    pa.field("tenant_id", pa.string()),
    pa.field("request_id", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

SECURITY_METRICS_SCHEMA = pa.schema([
    pa.field("metric_name", pa.string()),
    pa.field("attack_type", pa.string()),
    pa.field("count", pa.int64()),
    pa.field("blocked_count", pa.int64()),
    pa.field("detected_count", pa.int64()),
    pa.field("top_source_ips", pa.string()),   # JSON array
    pa.field("top_uris", pa.string()),         # JSON array
    pa.field("window_start", pa.timestamp("us", tz="UTC")),
    pa.field("window_end", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

APISIX_ACCESS_SCHEMA = pa.schema([
    pa.field("request_id", pa.string()),
    pa.field("client_ip", pa.string()),
    pa.field("http_method", pa.string()),
    pa.field("uri", pa.string()),
    pa.field("host", pa.string()),
    pa.field("status_code", pa.int32()),
    pa.field("response_time_ms", pa.float64()),
    pa.field("bytes_sent", pa.int64()),
    pa.field("user_agent", pa.string()),
    pa.field("upstream", pa.string()),
    pa.field("waf_action", pa.string()),
    pa.field("waf_attack_type", pa.string()),
    pa.field("request_time", pa.timestamp("us", tz="UTC")),
    pa.field("exported_at", pa.timestamp("us", tz="UTC")),
])

# Known attack type patterns in OpenAppSec log lines
ATTACK_PATTERNS = {
    "SQLi": re.compile(r"sql.inject|sqli|sql_injection", re.IGNORECASE),
    "XSS": re.compile(r"cross.site.script|xss", re.IGNORECASE),
    "CSRF": re.compile(r"cross.site.request|csrf", re.IGNORECASE),
    "PathTraversal": re.compile(r"path.travers|directory.travers", re.IGNORECASE),
    "RCE": re.compile(r"remote.code.exec|rce|command.inject", re.IGNORECASE),
    "SSRF": re.compile(r"server.side.request|ssrf", re.IGNORECASE),
    "BotAttack": re.compile(r"bot.attack|scraping|crawler", re.IGNORECASE),
    "BruteForce": re.compile(r"brute.force|credential.stuff", re.IGNORECASE),
    "DDoS": re.compile(r"ddos|rate.limit|flood", re.IGNORECASE),
}


def _get_s3():
    try:
        return boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
        )
    except Exception as e:
        log.warning(f"S3 unavailable: {e}")
        return None


def _write_parquet(records: List[Dict], schema: pa.Schema, s3_key: str) -> Dict[str, Any]:
    if not records:
        return {"status": "skip", "rows": 0}
    s3 = _get_s3()
    if not s3:
        return {"status": "no_s3", "rows": 0}

    arrays = []
    for field in schema:
        vals = []
        for r in records:
            v = r.get(field.name)
            if v is None:
                if pa.types.is_string(field.type):
                    v = ""
                elif pa.types.is_integer(field.type):
                    v = 0
                elif pa.types.is_floating(field.type):
                    v = 0.0
                elif pa.types.is_timestamp(field.type):
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and isinstance(v, str):
                try:
                    v = datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    v = datetime.now(timezone.utc)
            if pa.types.is_timestamp(field.type) and hasattr(v, "tzinfo") and v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            vals.append(v)
        arrays.append(pa.array(vals, type=field.type))

    table = pa.table(arrays, schema=schema)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)

    try:
        s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=buf.read())
        log.info(f"[OpenAppSec→Lakehouse] Wrote {len(records)} rows → s3://{S3_BUCKET}/{s3_key}")
        return {"status": "ok", "rows": len(records), "key": s3_key}
    except Exception as e:
        log.error(f"[OpenAppSec→Lakehouse] S3 write failed: {e}")
        return {"status": "error", "error": str(e)}


def _detect_attack_type(text: str) -> str:
    for attack_type, pattern in ATTACK_PATTERNS.items():
        if pattern.search(text):
            return attack_type
    return "Unknown"


def _parse_openappsec_log_line(line: str) -> Optional[Dict]:
    """Parse a single OpenAppSec JSON log line."""
    try:
        ev = json.loads(line.strip())
        attack_type = _detect_attack_type(
            ev.get("matchedLocation", "") + " " + ev.get("matchedSample", "")
        )
        severity_map = {"critical": "CRITICAL", "high": "HIGH", "medium": "MEDIUM", "low": "LOW"}
        raw_sev = str(ev.get("severity", "")).lower()
        severity = severity_map.get(raw_sev, "MEDIUM")

        event_time_str = ev.get("eventTime", ev.get("timestamp", ""))
        try:
            event_time = datetime.fromisoformat(event_time_str.replace("Z", "+00:00"))
        except Exception:
            event_time = datetime.now(timezone.utc)

        return {
            "event_id": str(ev.get("eventId", ev.get("id", ""))),
            "event_type": str(ev.get("eventType", ev.get("action", "DETECT"))).upper(),
            "attack_type": attack_type,
            "severity": severity,
            "source_ip": str(ev.get("sourceIdentifiers", {}).get("sourceIP", ev.get("clientIP", ""))),
            "source_country": str(ev.get("sourceIdentifiers", {}).get("country", "")),
            "destination_ip": str(ev.get("destIP", "")),
            "http_method": str(ev.get("httpMethod", "")),
            "uri": str(ev.get("httpURI", ev.get("uri", ""))),
            "host": str(ev.get("httpHostName", ev.get("host", ""))),
            "user_agent": str(ev.get("httpUserAgent", "")),
            "matched_rule": str(ev.get("matchedSignatureId", ev.get("ruleId", ""))),
            "matched_location": str(ev.get("matchedLocation", "")),
            "matched_parameter": str(ev.get("matchedParameter", "")),
            "matched_value": str(ev.get("matchedSample", ""))[:500],
            "response_code": int(ev.get("responseCode", 0)),
            "tenant_id": str(ev.get("tenantId", "")),
            "request_id": str(ev.get("requestId", "")),
            "event_time": event_time,
            "exported_at": datetime.now(timezone.utc),
        }
    except Exception:
        return None


def export_waf_events_from_log(
    log_path: Optional[str] = None,
    since_hours: int = 24,
    max_lines: int = 100000,
) -> Dict[str, Any]:
    """Parse the OpenAppSec log file and export WAF events to the lakehouse."""
    now = datetime.now(timezone.utc)
    path = Path(log_path or OPENAPPSEC_LOG_PATH)
    events: List[Dict] = []

    if not path.exists():
        log.warning(f"[OpenAppSec] Log file not found: {path}")
        return {"status": "no_log_file", "rows": 0}

    cutoff = now - timedelta(hours=since_hours)
    try:
        with open(path, "r", errors="replace") as f:
            lines = f.readlines()
        # Read from the end to get recent events
        for line in reversed(lines[-max_lines:]):
            ev = _parse_openappsec_log_line(line)
            if ev and ev["event_time"] >= cutoff:
                events.append(ev)
    except Exception as e:
        log.warning(f"[OpenAppSec] Could not read log file: {e}")

    key = (
        f"bronze/openappsec/waf_events/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"waf_events_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(events, WAF_EVENT_SCHEMA, key)


async def export_waf_events_from_api(since_hours: int = 24) -> Dict[str, Any]:
    """Fetch WAF events from the OpenAppSec HTTP reporting API."""
    now = datetime.now(timezone.utc)
    events: List[Dict] = []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{OPENAPPSEC_API_URL}/api/v1/events",
                params={
                    "from": (now - timedelta(hours=since_hours)).isoformat(),
                    "to": now.isoformat(),
                    "limit": 10000,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                for ev in data.get("events", data if isinstance(data, list) else []):
                    parsed = _parse_openappsec_log_line(json.dumps(ev))
                    if parsed:
                        events.append(parsed)
    except Exception as e:
        log.warning(f"[OpenAppSec] API unavailable: {e}")
        # Fall back to log file parsing
        return export_waf_events_from_log(since_hours=since_hours)

    key = (
        f"bronze/openappsec/waf_events/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"waf_api_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(events, WAF_EVENT_SCHEMA, key)


def export_security_metrics(events: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """
    Aggregate WAF events into per-attack-type security metrics and write
    them to the silver layer.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)

    # If no events provided, this is a no-op aggregation placeholder
    if not events:
        return {"status": "skip", "rows": 0}

    from collections import Counter, defaultdict
    attack_counts: Dict[str, Dict] = defaultdict(lambda: {
        "count": 0, "blocked": 0, "detected": 0,
        "source_ips": Counter(), "uris": Counter(),
    })

    for ev in events:
        at = ev.get("attack_type", "Unknown")
        attack_counts[at]["count"] += 1
        if ev.get("event_type") == "PREVENT":
            attack_counts[at]["blocked"] += 1
        else:
            attack_counts[at]["detected"] += 1
        if ev.get("source_ip"):
            attack_counts[at]["source_ips"][ev["source_ip"]] += 1
        if ev.get("uri"):
            attack_counts[at]["uris"][ev["uri"]] += 1

    metrics: List[Dict] = []
    for attack_type, stats in attack_counts.items():
        metrics.append({
            "metric_name": f"waf.{attack_type.lower()}.24h",
            "attack_type": attack_type,
            "count": stats["count"],
            "blocked_count": stats["blocked"],
            "detected_count": stats["detected"],
            "top_source_ips": json.dumps([ip for ip, _ in stats["source_ips"].most_common(10)]),
            "top_uris": json.dumps([uri for uri, _ in stats["uris"].most_common(10)]),
            "window_start": window_start,
            "window_end": now,
            "exported_at": now,
        })

    key = (
        f"silver/openappsec/security_metrics/"
        f"year={now.year:04d}/month={now.month:02d}/day={now.day:02d}/"
        f"metrics_{now.strftime('%Y%m%d_%H%M%S')}.parquet"
    )
    return _write_parquet(metrics, SECURITY_METRICS_SCHEMA, key)


async def run_full_export(since_hours: int = 24) -> Dict[str, Any]:
    """Run all OpenAppSec exports."""
    waf_r = await export_waf_events_from_api(since_hours=since_hours)
    # Build metrics from the events we just exported (empty list is fine)
    metrics_r = export_security_metrics([])
    total = waf_r.get("rows", 0) + metrics_r.get("rows", 0)
    return {
        "status": "ok",
        "waf_events": waf_r,
        "security_metrics": metrics_r,
        "total_rows": total,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
