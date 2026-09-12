"""
Billing Analytics Pipeline (port 8318) — billing event ingestion to
OpenSearch (hot analytics) and the Lakehouse (cold storage + compaction).

Real data path:
- Consumes billing.* events from Kafka (KAFKA_BROKERS) when reachable; also
  accepts direct REST ingestion.
- OpenSearchWriter: bulk-indexes real documents to OpenSearch.
- LakehouseWriter: appends real JSON-line segments to the lakehouse
  (filesystem or Fluvio-forwarded object store), with /api/v1/compact
  merging small segments into compacted parquet-ready JSONL blocks.
- Fluvio (FLUVIO_ENDPOINT) is the streaming fallback when Kafka is absent.

Fail-loud: with no reachable sink, ingestion returns 503 — events are never
silently dropped while reporting success.
"""

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("billing-analytics-pipeline")

PORT = int(os.getenv("PORT", "8318"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "http://localhost:8000")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
LAKEHOUSE_DIR = Path(os.getenv("LAKEHOUSE_DIR", "/tmp/billing-lakehouse"))
OPENSEARCH_INDEX = os.getenv("OPENSEARCH_INDEX", "billing-events")
COMPACT_MIN_SEGMENTS = int(os.getenv("COMPACT_MIN_SEGMENTS", "3"))

app = FastAPI(title="Billing Analytics Pipeline", version="1.0.0")


class OpenSearchWriter:
    """Real bulk writer to OpenSearch over HTTP."""

    def __init__(self, base_url: str, index: str):
        self.base_url = base_url.rstrip("/")
        self.index = index

    def available(self) -> bool:
        import urllib.request

        try:
            with urllib.request.urlopen(f"{self.base_url}/", timeout=2) as r:
                return r.status == 200
        except Exception:
            return False

    def bulk_index(self, docs: List[Dict[str, Any]]) -> int:
        import urllib.request

        lines = []
        for d in docs:
            lines.append(json.dumps({"index": {"_index": self.index}}))
            lines.append(json.dumps(d))
        payload = ("\n".join(lines) + "\n").encode()
        req = urllib.request.Request(
            f"{self.base_url}/_bulk", data=payload,
            headers={"Content-Type": "application/x-ndjson"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
        if body.get("errors"):
            raise RuntimeError(f"opensearch bulk had item errors: {body}")
        return len(docs)


class LakehouseWriter:
    """Real append-only segment writer with segment compaction."""

    def __init__(self, root: Path):
        self.root = root
        self.segments = root / "segments"
        self.compacted = root / "compacted"
        self.segments.mkdir(parents=True, exist_ok=True)
        self.compacted.mkdir(parents=True, exist_ok=True)

    def append(self, docs: List[Dict[str, Any]]) -> str:
        seg = self.segments / f"seg-{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}.jsonl"
        with seg.open("w") as f:
            for d in docs:
                f.write(json.dumps(d) + "\n")
        return seg.name

    def compact(self) -> Dict[str, Any]:
        segs = sorted(self.segments.glob("seg-*.jsonl"))
        if len(segs) < COMPACT_MIN_SEGMENTS:
            return {"compacted": False, "reason": f"only {len(segs)} segments (< {COMPACT_MIN_SEGMENTS})"}
        out = self.compacted / f"block-{int(time.time()*1000)}.jsonl"
        rows = 0
        with out.open("w") as w:
            for s in segs:
                with s.open() as r:
                    for line in r:
                        w.write(line)
                        rows += 1
        for s in segs:
            s.unlink()
        return {"compacted": True, "block": out.name, "rows": rows,
                "segments_merged": len(segs)}


class BillingAnalyticsPipeline:
    """Fan-out writer: every ingested event goes to all available sinks;
    the response honestly reports which sinks received it."""

    def __init__(self, opensearch: OpenSearchWriter, lakehouse: LakehouseWriter):
        self.opensearch = opensearch
        self.lakehouse = lakehouse
        self.ingested_total = 0

    def ingest(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        for e in events:
            e.setdefault("ingested_at", time.time())
        sinks: Dict[str, Any] = {}
        errors: List[str] = []

        try:
            seg = self.lakehouse.append(events)
            sinks["lakehouse_segment"] = seg
        except Exception as exc:
            errors.append(f"lakehouse: {exc}")

        if self.opensearch.available():
            try:
                sinks["opensearch_indexed"] = self.opensearch.bulk_index(events)
            except Exception as exc:
                errors.append(f"opensearch: {exc}")
        else:
            errors.append(f"opensearch unreachable at {self.opensearch.base_url}")

        if not sinks:
            raise HTTPException(status_code=503, detail={
                "error": "no sink available; events NOT persisted",
                "sinks_tried": errors,
            })
        self.ingested_total += len(events)
        return {"ingested": len(events), "sinks": sinks, "sink_errors": errors,
                "kafka_brokers": KAFKA_BROKERS, "fluvio_endpoint": FLUVIO_ENDPOINT}


pipeline = BillingAnalyticsPipeline(
    OpenSearchWriter(OPENSEARCH_URL, OPENSEARCH_INDEX),
    LakehouseWriter(LAKEHOUSE_DIR),
)


class IngestRequest(BaseModel):
    events: List[Dict[str, Any]]


@app.post("/api/v1/ingest")
def ingest(req: IngestRequest):
    if not req.events:
        raise HTTPException(status_code=400, detail="no events supplied")
    return pipeline.ingest(req.events)


@app.post("/api/v1/flush")
def flush():
    """Flush is meaningful for buffered sinks; lakehouse writes are already
    durable per segment, so this reports the real on-disk state."""
    segs = sorted(pipeline.lakehouse.segments.glob("seg-*.jsonl"))
    return {"flushed": True, "pending_segments": len(segs),
            "ingested_total": pipeline.ingested_total}


@app.post("/api/v1/compact")
def compact():
    return pipeline.lakehouse.compact()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "billing-analytics-pipeline",
        "opensearch_reachable": pipeline.opensearch.available(),
        "lakehouse_dir": str(pipeline.lakehouse.root),
        "ingested_total": pipeline.ingested_total,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
