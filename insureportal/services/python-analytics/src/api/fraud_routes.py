"""Fraud ML Scoring API routes."""
from typing import List, Any, Dict
from fastapi import APIRouter
from pydantic import BaseModel
from src.fraud.scorer import FraudScorer

router = APIRouter()
scorer = FraudScorer()

class ClaimScoreRequest(BaseModel):
    claim_amount: float
    annual_premium: float
    policy_inception_date: str
    claim_date: str
    prior_claims_12m: int = 0
    doc_completeness_score: float = 1.0
    geo_risk_score: float = 0.1
    claim_type: str = ""
    policy_type: str = ""

class BatchScoreRequest(BaseModel):
    claims: List[Dict[str, Any]]

@router.get("/health")
def health(): return {"status": scorer.health()}

@router.post("/score")
def score_claim(req: ClaimScoreRequest):
    return scorer.score_claim(req.model_dump())

@router.post("/score/batch")
def batch_score(req: BatchScoreRequest):
    return {"results": scorer.batch_score(req.claims)}
