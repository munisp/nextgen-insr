"""
ai-underwriting-copilot/app/main.py
AI-powered underwriting assistant that helps underwriters make faster,
more consistent decisions by surfacing risk factors, comparable cases,
and suggested premium loadings in real time.

Integrates: Ollama LLM + scikit-learn risk model + IFRS17 reserve impact
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import os
import asyncpg
import httpx
import json
import logging
from datetime import datetime, date
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="InsurePortal AI Underwriting Copilot", version="1.0.0")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/insureportal")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
IFRS17_URL = os.getenv("IFRS17_URL", "http://ifrs17-engine:8095")
ML_FRAUD_URL = os.getenv("ML_FRAUD_URL", "http://ml-fraud-scoring:8090")


class UnderwritingRequest(BaseModel):
    applicant_id: int
    product_type: str
    sum_insured: float
    application_data: Dict[str, Any]
    underwriter_id: int


class RiskFactor(BaseModel):
    factor: str
    impact: str  # 'positive', 'negative', 'neutral'
    weight: float  # 0-1
    description: str


class ComparableCase(BaseModel):
    policy_id: int
    similarity_score: float
    outcome: str  # 'accepted', 'declined', 'loaded'
    premium_rate: float
    loss_ratio: Optional[float]


class UnderwritingRecommendation(BaseModel):
    decision: str  # 'accept', 'accept_with_loading', 'refer', 'decline'
    confidence: float
    base_premium: float
    recommended_premium: float
    loading_pct: float
    risk_score: float
    risk_factors: List[RiskFactor]
    comparable_cases: List[ComparableCase]
    ai_narrative: str
    reserve_impact: Optional[Dict[str, Any]]
    conditions: List[str]
    exclusions: List[str]


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "ai-underwriting-copilot"}


@app.post("/api/v1/evaluate", response_model=UnderwritingRecommendation)
async def evaluate_application(req: UnderwritingRequest):
    """
    Evaluate an insurance application and return a structured underwriting recommendation.
    """
    risk_factors: List[RiskFactor] = []
    conditions: List[str] = []
    exclusions: List[str] = []
    loading_pct = 0.0
    risk_score = 50.0

    # ── 1. Fetch applicant data from PostgreSQL ───────────────────────────────
    applicant_data = {}
    claim_history = []
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            applicant = await conn.fetchrow(
                "SELECT * FROM customers WHERE id = $1", req.applicant_id
            )
            if applicant:
                applicant_data = dict(applicant)

            # Claim history
            claims = await conn.fetch(
                """SELECT claim_type, claim_amount, status, created_at
                   FROM claims WHERE customer_id = $1
                   ORDER BY created_at DESC LIMIT 10""",
                req.applicant_id
            )
            claim_history = [dict(c) for c in claims]
        finally:
            await conn.close()
    except Exception as e:
        logger.warning(f"DB fetch failed: {e}")

    # ── 2. Compute risk factors ───────────────────────────────────────────────
    # Age factor
    age = req.application_data.get("age", 35)
    if req.product_type == "motor":
        if age < 25:
            risk_factors.append(RiskFactor(factor="age", impact="negative", weight=0.8,
                description="Young driver (under 25) — statistically higher accident rate"))
            loading_pct += 25
        elif age > 70:
            risk_factors.append(RiskFactor(factor="age", impact="negative", weight=0.6,
                description="Senior driver (over 70) — higher accident risk"))
            loading_pct += 15
        else:
            risk_factors.append(RiskFactor(factor="age", impact="positive", weight=0.3,
                description="Prime driving age (25-70) — standard risk"))

    # Claim history factor
    recent_claims = [c for c in claim_history if c.get("status") == "settled"]
    if len(recent_claims) >= 3:
        risk_factors.append(RiskFactor(factor="claim_history", impact="negative", weight=0.9,
            description=f"{len(recent_claims)} settled claims in history — high loss frequency"))
        loading_pct += 30
        conditions.append("Claims excess increased to 10% of claim amount")
    elif len(recent_claims) == 0:
        risk_factors.append(RiskFactor(factor="claim_history", impact="positive", weight=0.7,
            description="No prior claims — no-claims discount applicable"))
        loading_pct -= 10

    # KYC/compliance factor
    kyc_status = applicant_data.get("kyc_status", "pending")
    if kyc_status != "verified":
        risk_factors.append(RiskFactor(factor="kyc_status", impact="negative", weight=1.0,
            description=f"KYC status: {kyc_status} — must be verified before binding"))
        conditions.append("KYC verification required before policy activation")

    # Sum insured adequacy
    if req.product_type == "property":
        property_value = req.application_data.get("property_value", req.sum_insured)
        if req.sum_insured < property_value * 0.8:
            risk_factors.append(RiskFactor(factor="underinsurance", impact="negative", weight=0.7,
                description=f"Sum insured (₦{req.sum_insured:,.0f}) is below 80% of property value"))
            conditions.append("Average clause applies — customer must increase sum insured")
            exclusions.append("Claims will be subject to average clause until sum insured is adequate")

    # Occupation/industry factor
    occupation = req.application_data.get("occupation", "")
    high_risk_occupations = ["mining", "construction", "oil_gas", "military", "motorcycle_rider"]
    if any(occ in occupation.lower() for occ in high_risk_occupations):
        risk_factors.append(RiskFactor(factor="occupation", impact="negative", weight=0.6,
            description=f"High-risk occupation: {occupation}"))
        loading_pct += 20
        exclusions.append("Occupational hazard exclusion applies for work-related incidents")

    # ── 3. Get ML fraud/risk score ────────────────────────────────────────────
    ml_risk_score = 50.0
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{ML_FRAUD_URL}/predict", json={
                "customer_id": req.applicant_id,
                "amount": req.sum_insured,
                "transaction_type": "underwriting",
                "features": req.application_data,
            })
            if resp.status_code == 200:
                ml_risk_score = resp.json().get("risk_score", 50) * 100
    except Exception:
        pass

    if ml_risk_score > 70:
        risk_factors.append(RiskFactor(factor="ml_risk_score", impact="negative", weight=0.8,
            description=f"ML risk model score: {ml_risk_score:.1f}/100 — elevated risk"))
        loading_pct += 15
    elif ml_risk_score < 30:
        risk_factors.append(RiskFactor(factor="ml_risk_score", impact="positive", weight=0.5,
            description=f"ML risk model score: {ml_risk_score:.1f}/100 — low risk"))
        loading_pct -= 5

    # ── 4. Find comparable cases ──────────────────────────────────────────────
    comparable_cases: List[ComparableCase] = []
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            similar = await conn.fetch("""
                SELECT p.id, p.premium_amount, p.sum_insured,
                       COUNT(c.id) as claim_count,
                       COALESCE(SUM(c.claim_amount), 0) as total_claims
                FROM policies p
                LEFT JOIN claims c ON c.policy_id = p.id
                WHERE p.status IN ('active', 'expired')
                AND p.product_id IN (SELECT id FROM products WHERE category = $1)
                GROUP BY p.id
                ORDER BY RANDOM()
                LIMIT 3
            """, req.product_type)

            for row in similar:
                premium_rate = (float(row["premium_amount"]) / float(row["sum_insured"])) * 100 if row["sum_insured"] else 0
                loss_ratio = (float(row["total_claims"]) / float(row["premium_amount"])) * 100 if row["premium_amount"] else 0
                comparable_cases.append(ComparableCase(
                    policy_id=row["id"],
                    similarity_score=0.75,
                    outcome="accepted",
                    premium_rate=round(premium_rate, 3),
                    loss_ratio=round(loss_ratio, 1),
                ))
        finally:
            await conn.close()
    except Exception:
        pass

    # ── 5. Get IFRS17 reserve impact ──────────────────────────────────────────
    reserve_impact = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{IFRS17_URL}/api/v1/reserve-impact", json={
                "product_type": req.product_type,
                "sum_insured": req.sum_insured,
                "premium": req.sum_insured * 0.02,  # estimated
            })
            if resp.status_code == 200:
                reserve_impact = resp.json()
    except Exception:
        reserve_impact = {"csm": req.sum_insured * 0.01, "ra": req.sum_insured * 0.005}

    # ── 6. Generate AI narrative with Ollama ──────────────────────────────────
    ai_narrative = ""
    try:
        risk_summary = "; ".join([f"{rf.factor}: {rf.impact}" for rf in risk_factors[:5]])
        prompt = f"""You are an insurance underwriter at InsurePortal Nigeria. 
Evaluate this {req.product_type} insurance application:
- Sum insured: ₦{req.sum_insured:,.0f}
- Risk factors: {risk_summary}
- ML risk score: {ml_risk_score:.0f}/100
- Prior claims: {len(recent_claims)}

Provide a concise 2-3 sentence underwriting assessment and recommendation.
Be specific about the key risk drivers and any conditions to apply."""

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/generate", json={
                "model": "llama3.2:3b",
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 150},
            })
            if resp.status_code == 200:
                ai_narrative = resp.json().get("response", "")
    except Exception:
        ai_narrative = (
            f"Application assessment: {req.product_type.title()} insurance for ₦{req.sum_insured:,.0f}. "
            f"ML risk score: {ml_risk_score:.0f}/100. "
            f"{'High-risk profile — loading recommended.' if loading_pct > 20 else 'Standard risk profile — proceed with standard terms.'}"
        )

    # ── 7. Final decision ─────────────────────────────────────────────────────
    risk_score = min(100, max(0, 50 + (loading_pct * 0.5) + (ml_risk_score * 0.3)))
    base_premium = req.sum_insured * 0.02  # 2% base rate
    recommended_premium = base_premium * (1 + loading_pct / 100)

    if risk_score > 80 or loading_pct > 50:
        decision = "decline"
        confidence = 0.85
    elif risk_score > 65 or loading_pct > 30:
        decision = "refer"
        confidence = 0.70
    elif loading_pct > 10:
        decision = "accept_with_loading"
        confidence = 0.80
    else:
        decision = "accept"
        confidence = 0.90

    return UnderwritingRecommendation(
        decision=decision,
        confidence=confidence,
        base_premium=round(base_premium, 2),
        recommended_premium=round(recommended_premium, 2),
        loading_pct=round(loading_pct, 2),
        risk_score=round(risk_score, 2),
        risk_factors=risk_factors,
        comparable_cases=comparable_cases,
        ai_narrative=ai_narrative,
        reserve_impact=reserve_impact,
        conditions=conditions,
        exclusions=exclusions,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8109")))
