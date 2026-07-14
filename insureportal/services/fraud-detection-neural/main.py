"""Fraud Detection Neural Network Service - Real-time transaction fraud scoring."""
import os
import json
import logging
import math
from dataclasses import dataclass, asdict
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
            logger.info(f"Connected to PostgreSQL for fraud_detection_neural")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS fraud_detection_neural (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table fraud_detection_neural initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


@dataclass
class FraudScore:
    transaction_id: str
    score: float
    is_fraudulent: bool
    risk_level: str
    signals: list
    recommendation: str


def sigmoid(x: float) -> float:
    """Sigmoid activation for score normalization."""
    return 1.0 / (1.0 + math.exp(-x))


def score_transaction(txn: dict) -> FraudScore:
    """Neural-inspired fraud scoring with weighted feature analysis."""
    amount = txn.get("amount", 0)
    velocity = txn.get("transactions_last_hour", 0)
    device_changed = txn.get("device_changed", False)
    location_changed = txn.get("location_changed", False)
    time_of_day = txn.get("hour_of_day", 12)
    customer_age_days = txn.get("customer_age_days", 365)

    # Feature weights (simulating trained neural network)
    weights = {
        "amount": 0.0000003,  # normalized for Naira amounts
        "velocity": 0.15,
        "device": 0.25,
        "location": 0.20,
        "time": 0.1,
        "age": 0.2,
    }

    # Compute weighted sum
    z = 0.0
    signals = []

    # Amount signal
    if amount > 2000000:  # >₦2M
        z += weights["amount"] * amount
        signals.append(f"high_amount:₦{amount:,.0f}")

    # Velocity signal
    if velocity > 5:
        z += weights["velocity"] * velocity
        signals.append(f"high_velocity:{velocity}_txns/hour")

    # Device change
    if device_changed:
        z += weights["device"] * 3.0
        signals.append("device_fingerprint_changed")

    # Location anomaly
    if location_changed:
        z += weights["location"] * 2.5
        signals.append("location_anomaly")

    # Unusual time (late night: 11PM-5AM)
    if time_of_day >= 23 or time_of_day <= 5:
        z += weights["time"] * 2.0
        signals.append(f"unusual_time:{time_of_day}:00")

    # New account
    if customer_age_days < 30:
        z += weights["age"] * 3.0
        signals.append(f"new_account:{customer_age_days}_days")

    score = sigmoid(z)
    is_fraudulent = score >= 0.7
    risk_level = "critical" if score >= 0.85 else "high" if score >= 0.7 else "medium" if score >= 0.4 else "low"

    if is_fraudulent:
        recommendation = "BLOCK_TRANSACTION"
    elif score >= 0.4:
        recommendation = "REQUIRE_2FA_VERIFICATION"
    else:
        recommendation = "ALLOW"

    return FraudScore(
        transaction_id=txn.get("id", "unknown"),
        score=round(score, 4),
        is_fraudulent=is_fraudulent,
        risk_level=risk_level,
        signals=signals,
        recommendation=recommendation,
    )


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "service": "fraud-detection-neural"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/v1/fraud/score":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))
            result = score_transaction(body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(asdict(result)).encode())
        elif self.path == "/api/v1/fraud/batch-score":
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length))
            results = [asdict(score_transaction(t)) for t in body.get("transactions", [])]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"scores": results}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        logger.info(f"{self.client_address[0]} - {format % args}")


init_db()

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), RequestHandler)
    logger.info(f"Fraud Detection Neural Service running on port {PORT}")
    server.serve_forever()
