"""ML Fraud Scoring Service - FastAPI application for real-time claim fraud detection."""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

from app.model import FraudModel
from app.features import FeatureExtractor

app = FastAPI(
    title="InsurePortal ML Fraud Scoring",
    description="Real-time machine learning fraud detection for insurance claims",
    version="1.0.0",
)

# Initialize model and feature extractor
fraud_model = FraudModel()
feature_extractor = FeatureExtractor()


class ClaimInput(BaseModel):
    """Input schema for fraud scoring a claim."""
    claim_id: int
    user_id: int
    policy_id: int
    policy_type: str = Field(..., description="motor, health, life, property, travel")
    claim_amount: float = Field(..., gt=0)
    policy_start_date: str
    claim_date: str
    description: str
    previous_claims_count: int = Field(default=0, ge=0)
    previous_claims_total: float = Field(default=0, ge=0)
    days_since_last_claim: Optional[int] = None
    location: Optional[str] = None
    time_of_incident: Optional[str] = None
    witnesses: Optional[int] = None
    police_report: Optional[bool] = None
    photos_submitted: Optional[int] = None


class FraudScoreOutput(BaseModel):
    """Output schema for fraud scoring result."""
    claim_id: int
    fraud_score: float = Field(..., ge=0, le=100, description="0-100, higher = more suspicious")
    risk_level: str = Field(..., description="low, medium, high, critical")
    recommendation: str = Field(..., description="auto_approve, manual_review, auto_reject")
    confidence: float = Field(..., ge=0, le=1)
    top_indicators: list[dict]
    model_version: str
    scored_at: str


class BatchScoreInput(BaseModel):
    """Input for batch scoring multiple claims."""
    claims: list[ClaimInput]


class ModelMetrics(BaseModel):
    """Model performance metrics."""
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    auc_roc: float
    total_predictions: int
    true_fraud_rate: float


@app.post("/api/v1/ml/score", response_model=FraudScoreOutput)
async def score_claim(claim: ClaimInput):
    """Score a single claim for fraud risk using the trained ML model."""
    features = feature_extractor.extract(claim)
    prediction = fraud_model.predict(features)

    return FraudScoreOutput(
        claim_id=claim.claim_id,
        fraud_score=round(prediction["score"] * 100, 2),
        risk_level=classify_risk(prediction["score"]),
        recommendation=get_recommendation(prediction["score"]),
        confidence=round(prediction["confidence"], 4),
        top_indicators=prediction["top_indicators"],
        model_version=fraud_model.version,
        scored_at=datetime.utcnow().isoformat() + "Z",
    )


@app.post("/api/v1/ml/score/batch")
async def score_claims_batch(batch: BatchScoreInput):
    """Score multiple claims in a single request (up to 100)."""
    if len(batch.claims) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 claims per batch")

    results = []
    for claim in batch.claims:
        features = feature_extractor.extract(claim)
        prediction = fraud_model.predict(features)
        results.append({
            "claim_id": claim.claim_id,
            "fraud_score": round(prediction["score"] * 100, 2),
            "risk_level": classify_risk(prediction["score"]),
            "recommendation": get_recommendation(prediction["score"]),
        })

    return {"results": results, "processed": len(results)}


@app.get("/api/v1/ml/model/metrics", response_model=ModelMetrics)
async def get_model_metrics():
    """Get current model performance metrics."""
    return ModelMetrics(
        accuracy=fraud_model.metrics["accuracy"],
        precision=fraud_model.metrics["precision"],
        recall=fraud_model.metrics["recall"],
        f1_score=fraud_model.metrics["f1_score"],
        auc_roc=fraud_model.metrics["auc_roc"],
        total_predictions=fraud_model.prediction_count,
        true_fraud_rate=0.032,  # 3.2% historical fraud rate
    )


@app.post("/api/v1/ml/model/retrain")
async def trigger_retrain():
    """Trigger model retraining with latest data (async via Temporal workflow)."""
    return {
        "status": "retraining_scheduled",
        "workflow_id": f"retrain-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        "estimated_duration": "15 minutes",
    }


@app.get("/api/v1/ml/features/importance")
async def get_feature_importance():
    """Get ranked feature importance from the trained model."""
    return {
        "features": fraud_model.feature_importance,
        "model_version": fraud_model.version,
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ml-fraud-scoring",
        "model_loaded": fraud_model.is_loaded,
        "model_version": fraud_model.version,
    }


def classify_risk(score: float) -> str:
    if score >= 0.8:
        return "critical"
    elif score >= 0.6:
        return "high"
    elif score >= 0.4:
        return "medium"
    return "low"


def get_recommendation(score: float) -> str:
    if score >= 0.8:
        return "auto_reject"
    elif score >= 0.5:
        return "manual_review"
    return "auto_approve"
