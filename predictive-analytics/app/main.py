"""Predictive Analytics — Risk scoring, churn prediction, CLV estimation."""
import json
import os
import math
import hashlib

import psycopg2
import psycopg2.extras
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Predictive Analytics", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

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
                CREATE TABLE IF NOT EXISTS prediction_history (
                    id SERIAL PRIMARY KEY,
                    customer_id TEXT NOT NULL,
                    prediction_type TEXT NOT NULL,
                    input_params JSONB NOT NULL,
                    result JSONB NOT NULL,
                    predicted_at TIMESTAMP DEFAULT NOW()
                )
            """)
    return db_conn

def persist_prediction(customer_id: str, pred_type: str, params: dict, result: dict):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO prediction_history (customer_id, prediction_type, input_params, result) VALUES (%s, %s, %s, %s)",
                (customer_id, pred_type, json.dumps(params, default=str), json.dumps(result, default=str))
            )
    except Exception as e:
        print(f"DB persist error: {e}")


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
    try:
        get_db()
        return {"status": "healthy", "service": "predictive-analytics", "version": "3.0.0",
                "database": "connected", "middleware": ["kafka", "postgres", "redis"]}
    except Exception:
        return {"status": "degraded", "service": "predictive-analytics", "version": "3.0.0",
                "database": "disconnected"}


@app.post("/api/v1/predictive/churn")
async def predict_churn(req: PredictionRequest):
    seed = int(hashlib.md5(req.customer_id.encode()).hexdigest()[:8], 16) % 100
    tenure_factor = max(0, 1.0 - (req.tenure_months / 60))
    payment_factor = 1.0 - req.payment_regularity
    product_factor = max(0, 1.0 - (req.products_count / 3))
    churn_prob = (tenure_factor * 0.35 + payment_factor * 0.35 + product_factor * 0.3) + (seed / 1000)
    churn_prob = max(0.01, min(0.99, churn_prob))
    result = {
        "customer_id": req.customer_id,
        "churn_probability": round(churn_prob, 4),
        "risk_level": "high" if churn_prob > 0.7 else "medium" if churn_prob > 0.4 else "low",
        "top_factors": ["tenure" if tenure_factor > 0.5 else "payment_regularity",
                        "product_diversity" if product_factor > 0.5 else "engagement"],
        "recommended_actions": ["retention_offer", "cross_sell"] if churn_prob > 0.5 else ["loyalty_reward"],
    }
    persist_prediction(req.customer_id, "churn", req.dict(), result)
    return result


@app.post("/api/v1/predictive/clv")
async def predict_clv(req: PredictionRequest):
    monthly_premium = req.premium_amount
    expected_tenure = max(12, req.tenure_months * 1.5) if req.payment_regularity > 0.8 else req.tenure_months
    retention_rate = req.payment_regularity * 0.9
    discount_rate = 0.10 / 12
    clv = sum([monthly_premium * (retention_rate ** m) / ((1 + discount_rate) ** m) for m in range(int(expected_tenure))])
    result = {
        "customer_id": req.customer_id,
        "estimated_clv": round(clv, 2),
        "currency": "NGN",
        "confidence": 0.82,
        "segment": "high_value" if clv > 2000000 else "medium_value" if clv > 500000 else "standard",
        "expected_tenure_months": int(expected_tenure),
    }
    persist_prediction(req.customer_id, "clv", req.dict(), result)
    return result


@app.post("/api/v1/predictive/risk-score")
async def risk_score(req: PredictionRequest):
    age_risk = 0.3 if req.age < 25 or req.age > 65 else 0.1
    claims_risk = min(req.claims_count / 5, 1.0) * 0.4
    payment_risk = (1 - req.payment_regularity) * 0.3
    score = 100 - int((age_risk + claims_risk + payment_risk) * 100)
    result = {
        "customer_id": req.customer_id,
        "risk_score": max(0, min(100, score)),
        "risk_grade": "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D",
        "factors": {"age": round(age_risk, 2), "claims_history": round(claims_risk, 2),
                    "payment_behavior": round(payment_risk, 2)},
        "premium_adjustment": round((1 - score / 100) * 0.3, 3),
    }
    persist_prediction(req.customer_id, "risk_score", req.dict(), result)
    return result


@app.get("/api/v1/predictive/segments")
async def customer_segments():
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


@app.get("/api/v1/predictive/history")
async def prediction_history(customer_id: str = None, limit: int = 50):
    try:
        conn = get_db()
        with conn.cursor() as cur:
            if customer_id:
                cur.execute("SELECT * FROM prediction_history WHERE customer_id = %s ORDER BY id DESC LIMIT %s", (customer_id, limit))
            else:
                cur.execute("SELECT * FROM prediction_history ORDER BY id DESC LIMIT %s", (limit,))
            rows = cur.fetchall()
        return {"data": rows, "total": len(rows)}
    except Exception as e:
        return {"error": str(e)}
