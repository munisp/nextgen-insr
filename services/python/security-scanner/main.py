"""
Security scanner service — wraps SecurityRemediationEngine (auto_remediation.py)
behind an HTTP API. Scans and remediations are real AST analysis of the
submitted source; apply=true returns the rewritten source plus an honest
before/after verification (re-scan of the actual output).
"""

import os

from fastapi import FastAPI
from pydantic import BaseModel

from auto_remediation import SecurityRemediationEngine

app = FastAPI(title="Security Scanner", version="1.0.0")
engine = SecurityRemediationEngine()


class ScanRequest(BaseModel):
    source: str
    filename: str = "<submission>"
    apply: bool = False


@app.get("/health")
async def health():
    return {"status": "ok", "service": "security-scanner"}


@app.post("/api/v1/scan")
async def scan(req: ScanRequest):
    if not req.apply:
        result = engine.scan_code(req.source, req.filename)
        return {
            "lines_scanned": result.lines_scanned,
            "findings": [f.__dict__ for f in result.findings],
            "counts": result.counts(),
        }
    remediated, result = engine.remediate(req.source)
    return {
        "lines_scanned": result.lines_scanned,
        "findings": [f.__dict__ for f in result.findings],
        "counts": result.counts(),
        "remediated_source": remediated,
        "verification": engine.verify(req.source, remediated),
    }


@app.post("/api/v1/remediate")
async def remediate(req: ScanRequest):
    remediated, result = engine.remediate(req.source)
    return {
        "remediated_source": remediated,
        "findings": [f.__dict__ for f in result.findings],
        "verification": engine.verify(req.source, remediated),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8113")))
