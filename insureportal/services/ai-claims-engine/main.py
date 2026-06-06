"""AI Claims Engine - Automated claims processing with ML-based decision making."""
import os
import json
import logging
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional
from http.server import HTTPServer, BaseHTTPRequestHandler


import os
import psycopg2
import psycopg2.extras
import logging

logger = logging.getLogger(__name__)

# ── Database Connection ──────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            _db_conn = psycopg2.connect(DATABASE_URL)
            _db_conn.autocommit = True
            logger.info(f"Connected to PostgreSQL for {svc_name}")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {svc_name} (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{{}}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table {svc_name} initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-claims-engine")

PORT = int(os.getenv("PORT", "8090"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


class ClaimDecision(str, Enum):
    AUTO_APPROVED = "auto_approved"
    ESCALATED = "escalated"
    PENDING_REVIEW = "pending_review"
    REJECTED = "rejected"


@dataclass
class ClaimAssessment:
    claim_id: str
    decision: ClaimDecision
    confidence: float
    risk_score: float
    fraud_indicators: list
    recommended_payout: float
    reasoning: str


def assess_claim(claim: dict) -> ClaimAssessment:
    """ML-based claim assessment with rule engine fallback."""
    amount = claim.get("amount", 0)
    has_evidence = claim.get("has_evidence", False)
    claim_history = claim.get("claim_history_count", 0)
    policy_age_days = claim.get("policy_age_days", 0)

    # Risk scoring
    risk_score = 0.0
    fraud_indicators = []

    # Amount-based risk
    if amount > 5000000:  # >₦5M
        risk_score += 0.3
        fraud_indicators.append("high_value_claim")
    elif amount > 1000000:  # >₦1M
        risk_score += 0.15

    # History-based risk
    if claim_history >= 5:
        risk_score += 0.25
        fraud_indicators.append("frequent_claimant")
    elif claim_history >= 3:
        risk_score += 0.1

    # Policy age (very new policies claiming = suspicious)
    if policy_age_days < 30:
        risk_score += 0.3
        fraud_indicators.append("new_policy_claim")
    elif policy_age_days < 90:
        risk_score += 0.1

    # Evidence assessment
    if not has_evidence:
        risk_score += 0.2
        fraud_indicators.append("no_supporting_evidence")

    # Decision logic
    confidence = 1.0 - risk_score
    if risk_score <= 0.2 and amount <= 50000 and has_evidence:
        decision = ClaimDecision.AUTO_APPROVED
        recommended_payout = amount
        reasoning = "Low risk, small amount, evidence provided"
    elif risk_score >= 0.6:
        decision = ClaimDecision.ESCALATED
        recommended_payout = 0
        reasoning = f"High risk score ({risk_score:.2f}): {', '.join(fraud_indicators)}"
    elif risk_score >= 0.4:
        decision = ClaimDecision.PENDING_REVIEW
        recommended_payout = amount * 0.8
        reasoning = "Medium risk, requires manual review"
    else:
        decision = ClaimDecision.PENDING_REVIEW
        recommended_payout = amount
        reasoning = "Standard processing required"

    return ClaimAssessment(
        claim_id=claim.get("id", "unknown"),
        decision=decision,
        confidence=confidence,
        risk_score=risk_score,
        fraud_indicators=fraud_indicators,
        recommended_payout=recommended_payout,
        reasoning=reasoning,
    )


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "service": "ai-claims-engine"}).encode())
        elif self.path == "/api/v1/claims/model-info":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "model": "rule-based-v1",
                "version": "1.0.0",
                "features": ["amount", "has_evidence", "claim_history", "policy_age"],
                "thresholds": {"auto_approve_max": 50000, "escalation_risk": 0.6},
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/v1/claims/assess":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))
            assessment = assess_claim(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(asdict(assessment), default=str).encode())
        elif self.path == "/api/v1/claims/batch-assess":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))
            results = [asdict(assess_claim(claim)) for claim in body.get("claims", [])]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"assessments": results}, default=str).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        logger.info(f"{self.client_address[0]} - {format % args}")


init_db()

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    logger.info(f"AI Claims Engine running on port {PORT}")
    server.serve_forever()
