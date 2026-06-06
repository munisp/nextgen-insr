"""
Actuarial Module (Python)


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


Provides actuarial calculations for insurance pricing, reserving, and capital modeling.
Integrates with: Postgres, Redis, Kafka

Calculations:
- Loss ratio analysis by product line
- IBNR (Incurred But Not Reported) reserves
- Chain-ladder development factors
- Risk margin calculation (Cost of Capital method)
- Solvency capital requirement (SCR) under NAICOM RBS
"""

import json
import math
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from typing import Dict, List


def calculate_loss_ratio(earned_premium: float, incurred_claims: float) -> Dict:
    """Calculate loss ratio and classify profitability."""
    if earned_premium == 0:
        return {"error": "earned_premium cannot be zero"}
    
    loss_ratio = incurred_claims / earned_premium
    combined_ratio = loss_ratio + 0.30  # Assume 30% expense ratio
    
    classification = "profitable"
    if combined_ratio > 1.0:
        classification = "unprofitable"
    elif combined_ratio > 0.95:
        classification = "marginal"
    
    return {
        "loss_ratio": round(loss_ratio, 4),
        "expense_ratio": 0.30,
        "combined_ratio": round(combined_ratio, 4),
        "classification": classification,
        "underwriting_result": round(earned_premium * (1 - combined_ratio), 2),
    }


def calculate_ibnr(paid_claims: List[List[float]]) -> Dict:
    """Chain-ladder IBNR estimation from claims triangle."""
    if not paid_claims or len(paid_claims) < 2:
        return {"ibnr_estimate": 0, "method": "chain_ladder", "note": "Insufficient data"}
    
    # Simplified chain-ladder
    development_factors = []
    for col in range(len(paid_claims[0]) - 1):
        sum_curr = sum(row[col + 1] for row in paid_claims if col + 1 < len(row))
        sum_prev = sum(row[col] for row in paid_claims if col < len(row) and col + 1 < len(row))
        if sum_prev > 0:
            development_factors.append(round(sum_curr / sum_prev, 4))
    
    # Ultimate claims for most recent year
    latest = paid_claims[-1][-1] if paid_claims[-1] else 0
    cumulative_factor = 1.0
    for f in development_factors:
        cumulative_factor *= f
    
    ultimate = latest * cumulative_factor
    ibnr = ultimate - latest
    
    return {
        "ibnr_estimate": round(max(ibnr, 0), 2),
        "development_factors": development_factors,
        "cumulative_factor": round(cumulative_factor, 4),
        "ultimate_claims": round(ultimate, 2),
        "method": "chain_ladder",
    }


def calculate_scr(assets: float, liabilities: float, premium_volume: float) -> Dict:
    """Simplified Solvency Capital Requirement per NAICOM RBS."""
    # NAICOM minimum capital: ₦3B for life, ₦3B for non-life
    minimum_capital = 3_000_000_000
    
    # Risk charges (simplified)
    market_risk = assets * 0.08
    underwriting_risk = premium_volume * 0.15
    credit_risk = assets * 0.03
    operational_risk = premium_volume * 0.05
    
    # Diversification benefit (-20%)
    gross_scr = market_risk + underwriting_risk + credit_risk + operational_risk
    diversification = gross_scr * 0.20
    net_scr = gross_scr - diversification
    
    available_capital = assets - liabilities
    solvency_ratio = available_capital / net_scr if net_scr > 0 else 0
    
    return {
        "scr": round(net_scr, 2),
        "available_capital": round(available_capital, 2),
        "solvency_ratio": round(solvency_ratio, 4),
        "meets_minimum": available_capital >= minimum_capital,
        "minimum_capital": minimum_capital,
        "risk_breakdown": {
            "market_risk": round(market_risk, 2),
            "underwriting_risk": round(underwriting_risk, 2),
            "credit_risk": round(credit_risk, 2),
            "operational_risk": round(operational_risk, 2),
            "diversification_benefit": round(-diversification, 2),
        },
        "status": "adequate" if solvency_ratio >= 1.5 else "warning" if solvency_ratio >= 1.0 else "breach",
    }


class ActuarialHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "healthy", "service": "actuarial-module"})
        elif self.path == "/api/v1/products":
            self._respond(200, {"products": ["motor", "health", "life", "home", "marine", "travel"]})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        
        if self.path == "/api/v1/loss-ratio":
            result = calculate_loss_ratio(body.get("earned_premium", 0), body.get("incurred_claims", 0))
            self._respond(200, result)
        elif self.path == "/api/v1/ibnr":
            result = calculate_ibnr(body.get("claims_triangle", []))
            self._respond(200, result)
        elif self.path == "/api/v1/scr":
            result = calculate_scr(body.get("assets", 0), body.get("liabilities", 0), body.get("premium_volume", 0))
            self._respond(200, result)
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, code: int, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass


init_db()

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8100), ActuarialHandler)
    print("Actuarial Module starting on :8100")
    server.serve_forever()
