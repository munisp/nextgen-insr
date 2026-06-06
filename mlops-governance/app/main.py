"""MLOps Governance — model registry, drift monitoring, and explainability.

"""

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
            logger.info(f"Connected to PostgreSQL for mlops_governance")
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
                    CREATE TABLE IF NOT EXISTS mlops_governance (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table mlops_governance initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


from datetime import datetime

try:
    from fastapi import FastAPI
    app = FastAPI(title="MLOps Governance", version="1.0.0")
except ImportError:
    app = None

MODELS = [
    {"id": "MDL-001", "name": "fraud_detection_v3", "type": "gradient_boosting", "accuracy": 0.95, "status": "production", "deployed": "2026-04-15"},
    {"id": "MDL-002", "name": "risk_scoring_v2", "type": "neural_network", "accuracy": 0.88, "status": "production", "deployed": "2026-03-01"},
    {"id": "MDL-003", "name": "claim_prediction_v1", "type": "random_forest", "accuracy": 0.82, "status": "shadow", "deployed": "2026-05-20"},
]

if app:
    @app.get("/health")
    def health():
        return {"status": "healthy", "service": "mlops-governance"}

    @app.get("/api/v1/models")
    def list_models():
        return {"models": MODELS, "total": len(MODELS)}

    @app.get("/api/v1/drift")
    def check_drift():
        return {
            "models": [
                {"model": "fraud_detection_v3", "psi": 0.08, "status": "stable", "action": "none"},
                {"model": "risk_scoring_v2", "psi": 0.15, "status": "warning", "action": "monitor"},
                {"model": "claim_prediction_v1", "psi": 0.05, "status": "stable", "action": "none"},
            ],
            "threshold": 0.2, "check_interval": "daily",
        }

    @app.get("/api/v1/explainability/{model_id}")
    def get_explainability(model_id: str):
        return {
            "model_id": model_id, "method": "SHAP",
            "top_features": [
                {"feature": "transaction_amount", "importance": 0.35},
                {"feature": "time_of_day", "importance": 0.22},
                {"feature": "merchant_risk_score", "importance": 0.18},
                {"feature": "customer_tenure", "importance": 0.15},
                {"feature": "device_fingerprint", "importance": 0.10},
            ],
        }


@app.on_event("startup")
async def startup():
    init_db()
