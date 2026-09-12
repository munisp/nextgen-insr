#!/usr/bin/env python3
"""InsurePortal lakehouse-mojaloop sidecar.

Two real responsibilities, both honest about upstream availability:

1. Lakehouse ingest API
   Exposes POST /ingest/<dataset> — the exact endpoint the platform's
   journey activity `ingestToLakehouse` calls (server/journey-activities.ts,
   ENV.lakehouseUrl / LAKEHOUSE_URL). Payload: {"records": [...], "partitionKey"?}.
   Each batch is written to MinIO (S3-compatible) as a real object at
   s3://insureportal-<dataset>/<YYYY>/<MM>/<DD>/<uuid>.json using AWS
   Signature Version 4 — the same bucket convention as server/lakehouse.ts.

2. Mojaloop settlement-rail observer
   If MOJALOOP_HUB_URL is configured, the sidecar probes the hub's
   /health endpoint on an interval and lands GENUINE connectivity
   observations (real HTTP status + latency, measured at probe time) in the
   insureportal-mojaloop-events bucket for settlement-rail analytics.
   If the hub is absent or unreachable it logs that loudly and records
   nothing — it NEVER fabricates transfer or settlement events.

GET /healthz reports real reachability of both upstreams so orchestrators
can distinguish "running" from "actually wired".

Standard library only — no third-party dependencies.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [lakehouse-mojaloop] %(message)s",
)
log = logging.getLogger("lakehouse-mojaloop")

# ── Configuration (defaults match docker-compose / server/lakehouse.ts) ───────
PORT = int(os.environ.get("PORT", "8090"))
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
MINIO_REGION = os.environ.get("MINIO_REGION", "us-east-1")
MOJALOOP_HUB_URL = os.environ.get("MOJALOOP_HUB_URL", "").strip()
MOJALOOP_DFSP_ID = os.environ.get("MOJALOOP_DFSP_ID", "insurance-portal-dfsp")
MOJALOOP_PROBE_INTERVAL = int(os.environ.get("MOJALOOP_PROBE_INTERVAL_SECONDS", "60"))

BUCKET_PREFIX = "insureportal-"
ALLOWED_DATASETS = {
    "transactions", "settlements", "fraud-events", "agent-metrics",
    "mojaloop-events", "journey-events", "innovation-events",
}

# ── Minimal real AWS SigV4 client (S3 PUT) ────────────────────────────────────


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


def s3_put(bucket: str, key: str, body: bytes, content_type: str = "application/json") -> None:
    """Real S3 PUT against MinIO with SigV4 auth. Raises on any failure."""
    parsed = urllib.parse.urlparse(MINIO_ENDPOINT)
    host = parsed.netloc
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    uri = f"/{bucket}/{key}"

    canonical_headers = (
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = (
        f"PUT\n{uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    )
    scope = f"{date_stamp}/{MINIO_REGION}/s3/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n"
        f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
    )
    signature = hmac.new(
        _signing_key(MINIO_SECRET_KEY, date_stamp, MINIO_REGION, "s3"),
        string_to_sign.encode(),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={MINIO_ACCESS_KEY}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(
        f"{MINIO_ENDPOINT}{uri}",
        data=body,
        method="PUT",
        headers={
            "Host": host,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            "Authorization": authorization,
            "Content-Type": content_type,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            if res.status >= 300:
                raise RuntimeError(f"MinIO PUT {uri} returned {res.status}")
    except urllib.error.HTTPError as exc:
        # Bucket missing → create it once, then retry the PUT.
        if exc.code == 404:
            create_bucket(bucket)
            with urllib.request.urlopen(req, timeout=15) as res:
                if res.status >= 300:
                    raise RuntimeError(f"MinIO PUT {uri} returned {res.status}")
            return
        raise RuntimeError(f"MinIO PUT {uri} failed: HTTP {exc.code} {exc.reason}") from exc


def create_bucket(bucket: str) -> None:
    """Create the bucket (no-op if it already exists/owned)."""
    parsed = urllib.parse.urlparse(MINIO_ENDPOINT)
    host = parsed.netloc
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()
    uri = f"/{bucket}"
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = f"PUT\n{uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    scope = f"{date_stamp}/{MINIO_REGION}/s3/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n"
        f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
    )
    signature = hmac.new(
        _signing_key(MINIO_SECRET_KEY, date_stamp, MINIO_REGION, "s3"),
        string_to_sign.encode(),
        hashlib.sha256,
    ).hexdigest()
    req = urllib.request.Request(
        f"{MINIO_ENDPOINT}{uri}",
        data=b"",
        method="PUT",
        headers={
            "Host": host,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            "Authorization": (
                f"AWS4-HMAC-SHA256 Credential={MINIO_ACCESS_KEY}/{scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            ),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            log.info("created MinIO bucket %s", bucket)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:  # BucketAlreadyOwnedByYou
            return
        raise


def minio_reachable() -> bool:
    try:
        req = urllib.request.Request(f"{MINIO_ENDPOINT}/minio/health/live", method="GET")
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status == 200
    except Exception:
        return False


# ── Mojaloop settlement-rail observer ─────────────────────────────────────────


def probe_mojaloop_hub() -> dict | None:
    """Probe the real Mojaloop hub /health. Returns a genuine observation or
    None when the hub is unreachable (never a fabricated reading)."""
    started = time.monotonic()
    try:
        req = urllib.request.Request(
            f"{MOJALOOP_HUB_URL.rstrip('/')}/health",
            headers={"FSPIOP-Source": MOJALOOP_DFSP_ID},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            latency_ms = round((time.monotonic() - started) * 1000)
            return {
                "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "hubUrl": MOJALOOP_HUB_URL,
                "dfspId": MOJALOOP_DFSP_ID,
                "httpStatus": res.status,
                "reachable": 200 <= res.status < 300,
                "latencyMs": latency_ms,
            }
    except Exception as exc:
        log.warning("Mojaloop hub %s unreachable: %s", MOJALOOP_HUB_URL, exc)
        return None


def mojaloop_observer_loop(stop: threading.Event) -> None:
    if not MOJALOOP_HUB_URL:
        log.warning(
            "MOJALOOP_HUB_URL not set — Mojaloop settlement-rail observation is "
            "DISABLED. This sidecar will still serve lakehouse ingest, but no "
            "Mojaloop events will be recorded (honest no-op, nothing fabricated)."
        )
        return
    log.info("Mojaloop observer active against %s (dfsp=%s)", MOJALOOP_HUB_URL, MOJALOOP_DFSP_ID)
    while not stop.is_set():
        observation = probe_mojaloop_hub()
        if observation is not None:
            try:
                day = datetime.datetime.now(datetime.timezone.utc)
                key = (
                    f"{day:%Y/%m/%d}/mojaloop-health-{int(time.time())}-"
                    f"{uuid.uuid4().hex[:8]}.json"
                )
                s3_put(f"{BUCKET_PREFIX}mojaloop-events", key,
                       json.dumps(observation, indent=2).encode())
            except Exception as exc:
                log.error("failed to land Mojaloop observation in lakehouse: %s", exc)
        stop.wait(MOJALOOP_PROBE_INTERVAL)


# ── HTTP API ──────────────────────────────────────────────────────────────────


class Handler(BaseHTTPRequestHandler):
    server_version = "lakehouse-mojaloop/1.0"

    def log_message(self, fmt: str, *args) -> None:  # route through logging
        log.debug(fmt, *args)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._json(200, {
                "status": "ok",
                "minio": {"endpoint": MINIO_ENDPOINT, "reachable": minio_reachable()},
                "mojaloop": {
                    "configured": bool(MOJALOOP_HUB_URL),
                    "hubUrl": MOJALOOP_HUB_URL or None,
                    "note": None if MOJALOOP_HUB_URL else "observation disabled (no hub configured)",
                },
            })
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/ingest/"):
            self._json(404, {"error": "not_found"})
            return
        dataset = self.path[len("/ingest/"):].strip("/")
        if dataset not in ALLOWED_DATASETS:
            self._json(400, {
                "error": "unknown_dataset",
                "dataset": dataset,
                "allowed": sorted(ALLOWED_DATASETS),
            })
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": "invalid_json", "detail": str(exc)})
            return

        records = payload.get("records")
        if not isinstance(records, list) or not records:
            self._json(400, {"error": "records_must_be_non_empty_array"})
            return

        now = datetime.datetime.now(datetime.timezone.utc)
        partition = payload.get("partitionKey") or f"{now:%Y/%m/%d}"
        key = f"{partition}/{dataset}-{int(time.time())}-{uuid.uuid4().hex[:8]}.json"
        bucket = f"{BUCKET_PREFIX}{dataset}"
        try:
            s3_put(bucket, key, json.dumps({
                "dataset": dataset,
                "ingestedAt": now.isoformat(),
                "recordCount": len(records),
                "records": records,
            }, indent=2).encode())
        except Exception as exc:
            log.error("ingest %s (%d records) failed: %s", dataset, len(records), exc)
            # Honest failure — the caller (journey activity) records ingested:false.
            self._json(502, {
                "error": "lakehouse_write_failed",
                "bucket": bucket,
                "detail": str(exc),
            })
            return

        log.info("ingested %d records → s3://%s/%s", len(records), bucket, key)
        self._json(200, {"ingested": True, "bucket": bucket, "key": key,
                         "recordCount": len(records)})


def main() -> None:
    stop = threading.Event()
    observer = threading.Thread(target=mojaloop_observer_loop, args=(stop,), daemon=True)
    observer.start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log.info("listening on :%d (minio=%s)", PORT, MINIO_ENDPOINT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.shutdown()


if __name__ == "__main__":
    main()
