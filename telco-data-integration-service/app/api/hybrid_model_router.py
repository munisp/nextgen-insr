"""
Hybrid Model API Router - Phase 3
Endpoints for hybrid credit scoring (rules + ML ensemble)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.services.hybrid_model_service import HybridModelService
from app.services.database import get_db
from app.models.telco_data import TelcoData

router = APIRouter()

class HybridScoreRequest(BaseModel):
    customer_id: str
    phone_number: str
    telco_data: dict
    use_dynamic_weighting: bool = True

@router.post("/score")
async def calculate_hybrid_score(
    request: HybridScoreRequest,
    db: Session = Depends(get_db)
):
    """Calculate credit score using hybrid approach (rules + ML)"""
    service = HybridModelService()

    # Load ML model (use latest version)
    service.load_ml_model("latest", "xgboost")

    # Convert dict to TelcoData
    telco_data = TelcoData(**request.telco_data)

    result = await service.calculate_hybrid_credit_score(
        request.customer_id,
        request.phone_number,
        telco_data,
        db,
        request.use_dynamic_weighting
    )
    return result

@router.post("/weights")
async def set_ensemble_weights(
    rules_weight: float,
    ml_weight: float
):
    """Set custom ensemble weights"""
    service = HybridModelService()
    service.set_ensemble_weights(rules_weight, ml_weight)
    return {"status": "weights_updated", "rules": rules_weight, "ml": ml_weight}

@router.get("/models/compare")
async def compare_scoring_methods(
    customer_id: str,
    phone_number: str,
    db: Session = Depends(get_db)
):
    """Compare rules-based, ML, and hybrid scoring"""
    service = HybridModelService()
    comparison = await service.compare_scoring_methods(customer_id, phone_number, db)
    return comparison
