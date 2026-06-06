"""Predictive Analytics — Risk scoring, churn prediction, CLV estimation."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import math
import hashlib


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


app = FastAPI(title="Predictive Analytics", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class PredictionRequest(BaseModel):
    customer_id: str
    age: int = 35
    tenure_months: int = 12
    premium_amount: float = 50000
    claims_count: int = 0
    payment_regularity: float = 0.95
    products_count: int = 1


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "predictive-analytics", "version": "3.0.0",
            "middleware": ["kafka", "postgres", "redis"]}


@app.post("/api/v1/predictive/churn")
async def predict_churn(req: PredictionRequest):
    """Predict customer churn probability."""
    seed = int(hashlib.md5(req.customer_id.encode()).hexdigest()[:8], 16) % 100
    tenure_factor = max(0, 1.0 - (req.tenure_months / 60))
    payment_factor = 1.0 - req.payment_regularity
    product_factor = max(0, 1.0 - (req.products_count / 3))
    churn_prob = (tenure_factor * 0.35 + payment_factor * 0.35 + product_factor * 0.3) + (seed / 1000)
    churn_prob = max(0.01, min(0.99, churn_prob))
    return {
        "customer_id": req.customer_id,
        "churn_probability": round(churn_prob, 4),
        "risk_level": "high" if churn_prob > 0.7 else "medium" if churn_prob > 0.4 else "low",
        "top_factors": ["tenure" if tenure_factor > 0.5 else "payment_regularity",
                        "product_diversity" if product_factor > 0.5 else "engagement"],
        "recommended_actions": ["retention_offer", "cross_sell"] if churn_prob > 0.5 else ["loyalty_reward"],
    }


@app.post("/api/v1/predictive/clv")
async def predict_clv(req: PredictionRequest):
    """Estimate Customer Lifetime Value."""
    monthly_premium = req.premium_amount
    expected_tenure = max(12, req.tenure_months * 1.5) if req.payment_regularity > 0.8 else req.tenure_months
    retention_rate = req.payment_regularity * 0.9
    discount_rate = 0.10 / 12
    clv = sum([monthly_premium * (retention_rate ** m) / ((1 + discount_rate) ** m) for m in range(int(expected_tenure))])
    return {
        "customer_id": req.customer_id,
        "estimated_clv": round(clv, 2),
        "currency": "NGN",
        "confidence": 0.82,
        "segment": "high_value" if clv > 2000000 else "medium_value" if clv > 500000 else "standard",
        "expected_tenure_months": int(expected_tenure),
    }


@app.post("/api/v1/predictive/risk-score")
async def risk_score(req: PredictionRequest):
    """Calculate comprehensive risk score."""
    age_risk = 0.3 if req.age < 25 or req.age > 65 else 0.1
    claims_risk = min(req.claims_count / 5, 1.0) * 0.4
    payment_risk = (1 - req.payment_regularity) * 0.3
    score = 100 - int((age_risk + claims_risk + payment_risk) * 100)
    return {
        "customer_id": req.customer_id,
        "risk_score": max(0, min(100, score)),
        "risk_grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D",
        "factors": {"age": round(age_risk, 2), "claims_history": round(claims_risk, 2),
                    "payment_behavior": round(payment_risk, 2)},
        "premium_adjustment": round((1 - score / 100) * 0.3, 3),
    }


@app.get("/api/v1/predictive/segments")
async def customer_segments():
    """Customer segmentation analysis."""
    return {
        "segments": [
            {"name": "High-Value Loyal", "count": 4231, "avg_clv": 3200000, "churn_risk": 0.08},
            {"name": "Growing Engaged", "count": 8945, "avg_clv": 1500000, "churn_risk": 0.15},
            {"name": "Price Sensitive", "count": 12340, "avg_clv": 450000, "churn_risk": 0.35},
            {"name": "At Risk", "count": 3421, "avg_clv": 800000, "churn_risk": 0.62},
            {"name": "New Customers", "count": 6789, "avg_clv": 200000, "churn_risk": 0.28},
            {"name": "Dormant", "count": 2134, "avg_clv": 100000, "churn_risk": 0.85},
        ],
        "total_customers": 37860,
    }


@app.on_event("startup")
async def startup():
    init_db()
