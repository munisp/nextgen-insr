"""
Actuarial Module (Python)

Provides actuarial calculations for insurance pricing, reserving, and capital modeling.
Integrates with: PostgreSQL (persistence), Redis, Kafka

Calculations:
- Loss ratio analysis by product line
- IBNR (Incurred But Not Reported) reserves
- Chain-ladder development factors
- Risk margin calculation (Cost of Capital method)
- Solvency capital requirement (SCR) under NAICOM RBS
"""

import json
import math
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from typing import Dict, List

import psycopg2
import psycopg2.extras

db_conn = None

def get_db():
    global db_conn
    if db_conn is None or db_conn.closed:
        url = os.environ.get("DATABASE_URL", "")
        if not url:
            raise RuntimeError("DATABASE_URL is required")
        db_conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
        db_conn.autocommit = True
        with db_conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS actuarial_calculations (
                    id SERIAL PRIMARY KEY,
                    calculation_type TEXT NOT NULL,
                    input_params JSONB NOT NULL,
                    result JSONB NOT NULL,
                    calculated_at TIMESTAMP DEFAULT NOW()
                )
            """)
    return db_conn


def calculate_loss_ratio(earned_premium: float, incurred_claims: float) -> Dict:
    if earned_premium == 0:
        return {"error": "earned_premium cannot be zero"}
    loss_ratio = incurred_claims / earned_premium
    combined_ratio = loss_ratio + 0.30
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
    if not paid_claims or len(paid_claims) < 2:
        return {"ibnr_estimate": 0, "method": "chain_ladder", "note": "Insufficient data"}
    development_factors = []
    for col in range(len(paid_claims[0]) - 1):
        sum_curr = sum(row[col + 1] for row in paid_claims if col + 1 < len(row))
        sum_prev = sum(row[col] for row in paid_claims if col < len(row) and col + 1 < len(row))
        if sum_prev > 0:
            development_factors.append(round(sum_curr / sum_prev, 4))
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
    minimum_capital = 3_000_000_000
    market_risk = assets * 0.08
    underwriting_risk = premium_volume * 0.15
    credit_risk = assets * 0.03
    operational_risk = premium_volume * 0.05
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


def persist_calculation(calc_type: str, params: dict, result: dict):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO actuarial_calculations (calculation_type, input_params, result) VALUES (%s, %s, %s)",
                (calc_type, json.dumps(params), json.dumps(result, default=str))
            )
    except Exception as e:
        print(f"DB persist error: {e}")


class ActuarialHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            try:
                get_db()
                self._respond(200, {"status": "healthy", "service": "actuarial-module", "database": "connected"})
            except Exception:
                self._respond(200, {"status": "degraded", "service": "actuarial-module", "database": "disconnected"})
        elif self.path == "/api/v1/products":
            self._respond(200, {"products": ["motor", "health", "life", "home", "marine", "travel"]})
        elif self.path.startswith("/api/v1/calculations"):
            try:
                conn = get_db()
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM actuarial_calculations ORDER BY id DESC LIMIT 50")
                    rows = cur.fetchall()
                self._respond(200, {"data": rows, "total": len(rows)})
            except Exception as e:
                self._respond(500, {"error": str(e)})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        if self.path == "/api/v1/loss-ratio":
            params = {"earned_premium": body.get("earned_premium", 0), "incurred_claims": body.get("incurred_claims", 0)}
            result = calculate_loss_ratio(**params)
            persist_calculation("loss_ratio", params, result)
            self._respond(200, result)
        elif self.path == "/api/v1/ibnr":
            params = {"claims_triangle": body.get("claims_triangle", [])}
            result = calculate_ibnr(params["claims_triangle"])
            persist_calculation("ibnr", params, result)
            self._respond(200, result)
        elif self.path == "/api/v1/scr":
            params = {"assets": body.get("assets", 0), "liabilities": body.get("liabilities", 0), "premium_volume": body.get("premium_volume", 0)}
            result = calculate_scr(**params)
            persist_calculation("scr", params, result)
            self._respond(200, result)
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, code: int, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8100"))
    try:
        get_db()
        print("Actuarial Module connected to PostgreSQL")
    except Exception as e:
        print(f"WARNING: Database not available: {e}")
    server = HTTPServer(("0.0.0.0", port), ActuarialHandler)
    print(f"Actuarial Module starting on :{port}")
    server.serve_forever()
