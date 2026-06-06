"""AML Screening Python SDK — PEP/sanctions list screening for Nigerian insurance.

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
            logger.info(f"Connected to PostgreSQL for aml_screening_python_sdk")
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
                    CREATE TABLE IF NOT EXISTS aml_screening_python_sdk (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table aml_screening_python_sdk initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from difflib import SequenceMatcher
from datetime import datetime
from typing import Optional

app = FastAPI(title="AML Screening SDK", version="1.0.0")

SANCTIONS_LIST = [
    {"name": "ABUBAKAR SHEKAU", "list": "EFCC", "type": "individual"},
    {"name": "AHMED KHALIFA", "list": "UN_SANCTIONS", "type": "individual"},
    {"name": "PETROLEUM TRADING CO", "list": "OFAC_SDN", "type": "entity"},
    {"name": "LAGOS MONEY EXCHANGE", "list": "CBN_BLACKLIST", "type": "entity"},
]

class ScreeningRequest(BaseModel):
    name: str
    bvn: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: str = "NG"

class ScreeningResult(BaseModel):
    screening_id: str
    name_searched: str
    match_score: float
    decision: str
    matches: list
    timestamp: str

def fuzzy_match(name1: str, name2: str) -> float:
    return SequenceMatcher(None, name1.upper(), name2.upper()).ratio() * 100

@app.get("/health")
def health():
    return {"status": "healthy", "service": "aml-screening-python-sdk"}

@app.post("/api/v1/screen", response_model=ScreeningResult)
def screen_customer(req: ScreeningRequest):
    matches = []
    max_score = 0.0
    for entry in SANCTIONS_LIST:
        score = fuzzy_match(req.name, entry["name"])
        if score > 50:
            matches.append({"name": entry["name"], "list": entry["list"], "score": round(score, 1)})
            max_score = max(max_score, score)

    decision = "clear" if max_score < 50 else "edd_required" if max_score < 85 else "blocked"
    return ScreeningResult(
        screening_id=f"SCR-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        name_searched=req.name, match_score=round(max_score, 1),
        decision=decision, matches=matches, timestamp=datetime.now().isoformat()
    )

@app.get("/api/v1/lists")
def get_lists():
    return {"lists": ["OFAC_SDN", "UN_SANCTIONS", "EFCC", "CBN_BLACKLIST"], "total_entries": len(SANCTIONS_LIST), "last_updated": "2026-05-01"}

@app.post("/api/v1/batch-screen")
def batch_screen(names: list[str]):
    results = []
    for name in names[:100]:
        max_score = max((fuzzy_match(name, e["name"]) for e in SANCTIONS_LIST), default=0)
        decision = "clear" if max_score < 50 else "edd_required" if max_score < 85 else "blocked"
        results.append({"name": name, "score": round(max_score, 1), "decision": decision})
    return {"results": results, "total": len(results)}


@app.on_event("startup")
async def startup():
    init_db()
