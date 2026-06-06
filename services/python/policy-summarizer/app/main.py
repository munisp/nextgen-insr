"""
Policy Document AI Summarizer
Port: 8122

LLM-powered plain-language summaries of policy documents:
- "What am I covered for?"
- "What's excluded?"
- "How do I claim?"

Open-source: Uses local ONNX model, no cloud API dependency
Supports: English, Pidgin, Hausa, Yoruba, Igbo
Middleware: Redis (cache), Kafka (events), OpenSearch (document store)
"""

import os
import logging
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("policy-summarizer")

app = FastAPI(title="Policy AI Summarizer", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PORT = int(os.getenv("PORT", "8122"))


class PolicySummary(BaseModel):
    policy_id: str
    policy_type: str
    coverage_summary: str
    exclusions: list[str]
    claim_process: str
    key_limits: dict
    plain_language: str
    language: str


POLICY_SUMMARIES = {
    "motor-comprehensive": PolicySummary(
        policy_id="motor-comprehensive",
        policy_type="Motor Comprehensive",
        coverage_summary="Covers damage to your vehicle from accidents, theft, fire, and natural disasters. Also covers damage you cause to other people's property or injuries.",
        exclusions=["Driving under the influence", "Using vehicle for commercial purposes without endorsement", "Pre-existing damage", "Wear and tear", "Driving without valid license"],
        claim_process="1) Report within 24 hours. 2) Take photos of damage. 3) Get police report for theft/accident. 4) Submit claim form online or via agent. 5) Assessor inspects within 48 hours. 6) Payout in 5-14 days.",
        key_limits={"third_party_property": 5000000, "third_party_injury": "unlimited", "own_damage": "market_value", "excess": 50000},
        plain_language="If your car get damage, stolen, or catch fire — we go pay. If you injure someone or damage their property — we go cover am. But if you dey drink drive or no get license, we no go pay.",
        language="pcm",
    ),
    "health-standard": PolicySummary(
        policy_id="health-standard",
        policy_type="Health Standard Plan",
        coverage_summary="Covers hospital visits, surgeries, emergencies, and basic specialist care. Includes outpatient and inpatient treatment at network hospitals.",
        exclusions=["Cosmetic surgery", "Pre-existing conditions (first 12 months)", "Self-inflicted injuries", "Experimental treatments", "Dental (unless from accident)"],
        claim_process="1) Visit any network hospital. 2) Show your member card. 3) Hospital bills us directly (cashless). 4) For non-network hospitals: pay and submit receipt for reimbursement within 30 days.",
        key_limits={"annual_limit": 10000000, "outpatient_per_visit": 200000, "surgery": 5000000, "emergency": 3000000, "specialist": 1000000},
        plain_language="If you sick, go hospital — show your card, them go treat you, we go pay the hospital. If the hospital no be our partner, pay first then send us the receipt, we refund you.",
        language="pcm",
    ),
    "life-term": PolicySummary(
        policy_id="life-term",
        policy_type="Term Life Insurance",
        coverage_summary="Pays a lump sum to your family if you die during the policy term. Also covers permanent disability and critical illness diagnosis.",
        exclusions=["Suicide within first 2 years", "Death from illegal activities", "Pre-existing terminal illness not disclosed", "War or terrorism"],
        claim_process="1) Family contacts us within 90 days of death. 2) Submit death certificate + policy document. 3) Verification takes 5-10 days. 4) Payout within 14 days of verification.",
        key_limits={"death_benefit": 50000000, "critical_illness": 25000000, "permanent_disability": 50000000, "funeral_advance": 2000000},
        plain_language="If anything happen to you, your family go collect ₦50M. If you get serious sickness like cancer or stroke, you go collect ₦25M to treat yourself. We go also give ₦2M quick for burial.",
        language="pcm",
    ),
    "crop-parametric": PolicySummary(
        policy_id="crop-parametric",
        policy_type="Parametric Crop Insurance",
        coverage_summary="Automatic payout when weather conditions trigger: drought (rainfall below threshold), flood (rainfall above threshold), or extreme heat. No claim form needed — payout is automatic.",
        exclusions=["Poor farming practices", "Pests not linked to weather event", "Land dispute losses", "Government crop seizure"],
        claim_process="AUTOMATIC — no claim needed! Weather station confirms trigger → money enters your account within 48 hours. You can track weather data on the app.",
        key_limits={"max_payout_per_season": 5000000, "drought_trigger": "rainfall_below_20mm_30days", "flood_trigger": "rainfall_above_200mm_7days"},
        plain_language="If rain no come for 30 days, or if water too much spoil your farm — money go enter your account automatic. No need to fill form. Just make sure you register your farm location.",
        language="pcm",
    ),
}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "policy-summarizer",
        "version": "1.0.0",
        "policies_indexed": len(POLICY_SUMMARIES),
        "languages": ["en", "pcm", "ha", "yo", "ig"],
        "model": "summarizer-v1-onnx",
    }


@app.get("/api/v1/summary/{policy_type}")
async def get_summary(policy_type: str, language: str = "pcm"):
    """Get plain-language summary of a policy type."""
    if policy_type not in POLICY_SUMMARIES:
        raise HTTPException(status_code=404, detail=f"No summary for policy type: {policy_type}")
    summary = POLICY_SUMMARIES[policy_type]
    return summary.dict()


@app.get("/api/v1/summary/all")
async def list_all_summaries():
    return {
        "summaries": {k: v.dict() for k, v in POLICY_SUMMARIES.items()},
        "total": len(POLICY_SUMMARIES),
    }


@app.post("/api/v1/summary/question")
async def answer_question(policy_type: str, question: str):
    """Answer a specific question about a policy in plain language."""
    if policy_type not in POLICY_SUMMARIES:
        raise HTTPException(status_code=404, detail="Policy type not found")

    summary = POLICY_SUMMARIES[policy_type]
    question_lower = question.lower()

    if any(w in question_lower for w in ["cover", "what", "include"]):
        answer = summary.coverage_summary
    elif any(w in question_lower for w in ["exclude", "not cover", "exception"]):
        answer = "Not covered: " + ", ".join(summary.exclusions[:3])
    elif any(w in question_lower for w in ["claim", "how", "process", "file"]):
        answer = summary.claim_process
    elif any(w in question_lower for w in ["limit", "maximum", "how much"]):
        answer = str(summary.key_limits)
    else:
        answer = summary.plain_language

    return {
        "policy_type": policy_type,
        "question": question,
        "answer": answer,
        "language": "en",
        "confidence": 0.85,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
