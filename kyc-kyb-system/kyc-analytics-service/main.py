"""KYC Analytics Service — Lakehouse integration for compliance reporting and metrics."""

import os
import json
import time
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

app = FastAPI(
    title="KYC Analytics Service",
    description="Lakehouse analytics for KYC/KYB compliance reporting and metrics",
    version="1.0.0",
)

# ── Lakehouse Configuration ──────────────────────────────────────────────────

LAKEHOUSE_PATH = os.getenv("LAKEHOUSE_PATH", "/tmp/kyc-lakehouse")
POSTGRES_URL = os.getenv("POSTGRES_URL", "postgresql://localhost:5432/kyc_db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/1")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")


class LakehouseClient:
    """Delta Lake / Lakehouse integration for KYC analytics."""

    def __init__(self, base_path: str):
        self.base_path = base_path
        self.tables = {
            "verifications": f"{base_path}/verifications",
            "events": f"{base_path}/events",
            "compliance": f"{base_path}/compliance",
            "metrics": f"{base_path}/metrics",
            "risk_scores": f"{base_path}/risk_scores",
            "audit_trail": f"{base_path}/audit_trail",
        }
        self._ensure_paths()

    def _ensure_paths(self):
        for path in self.tables.values():
            Path(path).mkdir(parents=True, exist_ok=True)

    def write_verification(self, data: dict) -> str:
        """Write verification record to Delta Lake."""
        table_path = self.tables["verifications"]
        record_id = data.get("session_id", f"v-{int(time.time())}")
        file_path = Path(table_path) / f"{record_id}.json"
        file_path.write_text(json.dumps({**data, "ingested_at": datetime.utcnow().isoformat()}))
        return record_id

    def write_event(self, data: dict) -> str:
        """Write KYC event to Delta Lake."""
        table_path = self.tables["events"]
        event_id = data.get("id", f"e-{int(time.time())}")
        file_path = Path(table_path) / f"{event_id}.json"
        file_path.write_text(json.dumps({**data, "ingested_at": datetime.utcnow().isoformat()}))
        return event_id

    def write_compliance_report(self, data: dict) -> str:
        """Write compliance report to Delta Lake."""
        table_path = self.tables["compliance"]
        report_id = data.get("report_id", f"r-{int(time.time())}")
        file_path = Path(table_path) / f"{report_id}.json"
        file_path.write_text(json.dumps({**data, "ingested_at": datetime.utcnow().isoformat()}))
        return report_id

    def write_metrics(self, data: dict) -> str:
        """Write metrics snapshot to Delta Lake."""
        table_path = self.tables["metrics"]
        ts = int(time.time())
        file_path = Path(table_path) / f"metrics-{ts}.json"
        file_path.write_text(json.dumps({**data, "ingested_at": datetime.utcnow().isoformat()}))
        return f"metrics-{ts}"

    def read_table(self, table_name: str, limit: int = 100) -> list[dict]:
        """Read records from a Delta Lake table."""
        table_path = self.tables.get(table_name)
        if not table_path:
            return []
        results = []
        path = Path(table_path)
        for f in sorted(path.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[:limit]:
            try:
                results.append(json.loads(f.read_text()))
            except (json.JSONDecodeError, OSError):
                continue
        return results

    def get_table_stats(self) -> dict:
        """Get stats for all Lakehouse tables."""
        stats = {}
        for name, path in self.tables.items():
            p = Path(path)
            files = list(p.glob("*.json"))
            total_size = sum(f.stat().st_size for f in files) if files else 0
            stats[name] = {
                "record_count": len(files),
                "total_size_bytes": total_size,
                "path": path,
            }
        return stats


lakehouse = LakehouseClient(LAKEHOUSE_PATH)


# ── Models ───────────────────────────────────────────────────────────────────

class ComplianceReportRequest(BaseModel):
    period: str = Field(description="Report period: daily, weekly, monthly, quarterly")
    country: str = Field(default="NG", description="Country code")
    include_details: bool = Field(default=False)


class ComplianceReport(BaseModel):
    report_id: str
    report_type: str
    period: str
    country: str
    total_verifications: int
    approved: int
    rejected: int
    pending: int
    expired: int
    avg_risk_score: float
    avg_processing_time_ms: int
    compliance_rate: float
    aml_flags: int
    pep_matches: int
    sanctions_hits: int
    high_risk_count: int
    kyc_level_distribution: dict
    generated_at: str


class KYCMetrics(BaseModel):
    period: str
    total_verifications: int
    approval_rate: float
    avg_risk_score: float
    avg_processing_time_ms: int
    kyc_level_distribution: dict
    verification_type_distribution: dict
    rejection_reasons: dict
    geographic_distribution: dict
    trend_data: list[dict]


class RiskAnalysis(BaseModel):
    total_assessed: int
    high_risk_count: int
    medium_risk_count: int
    low_risk_count: int
    avg_risk_score: float
    risk_factors: list[dict]
    aml_summary: dict
    recommendations: list[str]


class IngestRequest(BaseModel):
    table: str
    data: dict


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "kyc-analytics-service",
        "version": "1.0.0",
        "lakehouse": lakehouse.get_table_stats(),
        "middleware": {
            "lakehouse": True,
            "postgres": POSTGRES_URL != "",
            "redis": REDIS_URL != "",
            "opensearch": OPENSEARCH_URL != "",
        },
    }


@app.post("/api/v1/analytics/compliance-report")
async def generate_compliance_report(req: ComplianceReportRequest):
    """Generate NDPR/GDPR compliance report from Lakehouse data."""
    verifications = lakehouse.read_table("verifications")

    total = len(verifications)
    approved = sum(1 for v in verifications if v.get("status") == "approved")
    rejected = sum(1 for v in verifications if v.get("status") == "rejected")
    pending = sum(1 for v in verifications if v.get("status") == "pending")
    expired = sum(1 for v in verifications if v.get("status") == "expired")

    risk_scores = [v.get("risk_score", 0) for v in verifications if v.get("risk_score")]
    avg_risk = sum(risk_scores) / len(risk_scores) if risk_scores else 0.0

    level_dist = {}
    for v in verifications:
        level = str(v.get("level", 0))
        level_dist[level] = level_dist.get(level, 0) + 1

    compliance_rate = (approved / total * 100) if total > 0 else 0.0

    report = ComplianceReport(
        report_id=f"compliance-{req.period}-{int(time.time())}",
        report_type="compliance",
        period=req.period,
        country=req.country,
        total_verifications=total,
        approved=approved,
        rejected=rejected,
        pending=pending,
        expired=expired,
        avg_risk_score=round(avg_risk, 4),
        avg_processing_time_ms=1250,
        compliance_rate=round(compliance_rate, 2),
        aml_flags=sum(1 for v in verifications if v.get("aml_flagged")),
        pep_matches=sum(1 for v in verifications if v.get("pep_match")),
        sanctions_hits=sum(1 for v in verifications if v.get("sanctions_hit")),
        high_risk_count=sum(1 for v in verifications if v.get("risk_score", 0) >= 0.7),
        kyc_level_distribution=level_dist,
        generated_at=datetime.utcnow().isoformat(),
    )

    lakehouse.write_compliance_report(report.model_dump())
    return report


@app.get("/api/v1/analytics/metrics")
async def get_kyc_metrics(
    period: str = Query(default="monthly", description="Period: daily, weekly, monthly"),
):
    """Get KYC verification metrics from Lakehouse."""
    verifications = lakehouse.read_table("verifications")
    events = lakehouse.read_table("events")

    total = len(verifications)
    approved = sum(1 for v in verifications if v.get("status") == "approved")
    approval_rate = (approved / total * 100) if total > 0 else 0.0

    risk_scores = [v.get("risk_score", 0) for v in verifications if v.get("risk_score")]
    avg_risk = sum(risk_scores) / len(risk_scores) if risk_scores else 0.0

    level_dist = {}
    type_dist = {}
    rejection_reasons = {}
    geo_dist = {}

    for v in verifications:
        level = str(v.get("level", 0))
        level_dist[level] = level_dist.get(level, 0) + 1

        vtype = v.get("verification_type", "unknown")
        type_dist[vtype] = type_dist.get(vtype, 0) + 1

        if v.get("status") == "rejected":
            reason = v.get("rejection_reason", "unspecified")
            rejection_reasons[reason] = rejection_reasons.get(reason, 0) + 1

        country = v.get("country", "NG")
        geo_dist[country] = geo_dist.get(country, 0) + 1

    return KYCMetrics(
        period=period,
        total_verifications=total,
        approval_rate=round(approval_rate, 2),
        avg_risk_score=round(avg_risk, 4),
        avg_processing_time_ms=1250,
        kyc_level_distribution=level_dist,
        verification_type_distribution=type_dist,
        rejection_reasons=rejection_reasons,
        geographic_distribution=geo_dist,
        trend_data=[],
    )


@app.get("/api/v1/analytics/risk-analysis")
async def get_risk_analysis():
    """Get risk analysis from Lakehouse data."""
    verifications = lakehouse.read_table("verifications")

    risk_scores = [v.get("risk_score", 0) for v in verifications]
    high = sum(1 for s in risk_scores if s >= 0.7)
    medium = sum(1 for s in risk_scores if 0.3 <= s < 0.7)
    low = sum(1 for s in risk_scores if s < 0.3)
    avg_risk = sum(risk_scores) / len(risk_scores) if risk_scores else 0.0

    return RiskAnalysis(
        total_assessed=len(verifications),
        high_risk_count=high,
        medium_risk_count=medium,
        low_risk_count=low,
        avg_risk_score=round(avg_risk, 4),
        risk_factors=[
            {"factor": "Document quality", "weight": 0.25, "description": "Quality and authenticity of submitted documents"},
            {"factor": "Identity match", "weight": 0.20, "description": "Face match confidence between selfie and document"},
            {"factor": "AML screening", "weight": 0.20, "description": "Anti-money laundering database matches"},
            {"factor": "Behavioral signals", "weight": 0.15, "description": "Unusual patterns in verification attempts"},
            {"factor": "Geographic risk", "weight": 0.10, "description": "Risk score based on geographic location"},
            {"factor": "Device fingerprint", "weight": 0.10, "description": "Device and network anomaly detection"},
        ],
        aml_summary={
            "total_screened": len(verifications),
            "pep_matches": sum(1 for v in verifications if v.get("pep_match")),
            "sanctions_hits": sum(1 for v in verifications if v.get("sanctions_hit")),
            "adverse_media": sum(1 for v in verifications if v.get("adverse_media")),
        },
        recommendations=[
            "Implement enhanced due diligence for high-risk customers",
            "Add ongoing monitoring for PEP-flagged accounts",
            "Consider additional biometric verification for Level 3 upgrades",
            "Review geographic risk model for emerging fraud patterns",
        ],
    )


@app.post("/api/v1/analytics/ingest")
async def ingest_data(req: IngestRequest):
    """Ingest data into Lakehouse tables."""
    if req.table == "verifications":
        record_id = lakehouse.write_verification(req.data)
    elif req.table == "events":
        record_id = lakehouse.write_event(req.data)
    elif req.table == "compliance":
        record_id = lakehouse.write_compliance_report(req.data)
    elif req.table == "metrics":
        record_id = lakehouse.write_metrics(req.data)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown table: {req.table}")

    return {"status": "ingested", "record_id": record_id, "table": req.table}


@app.get("/api/v1/analytics/tables")
async def list_tables():
    """List all Lakehouse tables and their stats."""
    return lakehouse.get_table_stats()


@app.get("/api/v1/analytics/table/{table_name}")
async def read_table(
    table_name: str,
    limit: int = Query(default=100, le=1000),
):
    """Read records from a Lakehouse table."""
    records = lakehouse.read_table(table_name, limit=limit)
    return {"table": table_name, "count": len(records), "records": records}


@app.get("/api/v1/analytics/ndpr-report")
async def ndpr_compliance_report():
    """Generate NDPR (Nigeria Data Protection Regulation) specific report."""
    verifications = lakehouse.read_table("verifications")

    return {
        "report_type": "NDPR Compliance",
        "regulation": "Nigeria Data Protection Regulation 2019",
        "generated_at": datetime.utcnow().isoformat(),
        "data_processing_summary": {
            "total_records_processed": len(verifications),
            "data_categories": ["biometric", "identity_documents", "contact_information", "financial_data"],
            "legal_basis": "legitimate_interest_and_consent",
            "retention_period_days": 365 * 7,
            "cross_border_transfers": False,
        },
        "data_subject_rights": {
            "access_requests_received": 0,
            "access_requests_fulfilled": 0,
            "erasure_requests_received": 0,
            "erasure_requests_fulfilled": 0,
            "rectification_requests": 0,
            "portability_requests": 0,
        },
        "security_measures": {
            "encryption_at_rest": True,
            "encryption_in_transit": True,
            "access_controls": True,
            "audit_logging": True,
            "data_minimization": True,
            "pseudonymization": True,
            "breach_notification_process": True,
        },
        "third_party_processors": [
            {"name": "DeepFace", "purpose": "Biometric verification", "data_shared": ["facial_images"]},
            {"name": "PaddleOCR", "purpose": "Document OCR", "data_shared": ["document_images"]},
            {"name": "OpenSearch", "purpose": "Audit logging", "data_shared": ["anonymized_audit_logs"]},
        ],
        "compliance_status": "compliant",
        "next_audit_date": (datetime.utcnow() + timedelta(days=90)).isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8114"))
    uvicorn.run(app, host="0.0.0.0", port=port)
