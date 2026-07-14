"""
Credit Score API Router
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.schemas.telco_schemas import (
    CreditScoreRequest, CreditScoreResponse, CreditScoreBreakdown,
    BulkCreditScoreRequest, BulkCreditScoreResponse, TelcoDataRequest
)
from app.services.credit_score_service import CreditScoreService
from app.services.telco_service import TelcoService
import logging

logger = logging.getLogger(__name__)

router = APIRouter()
credit_score_service = CreditScoreService()
telco_service = TelcoService()

# Database dependency
def get_db():
    import os
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    database_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/insureportal")
    engine = create_engine(database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/calculate", response_model=CreditScoreResponse, status_code=201)
async def calculate_credit_score(
    request: CreditScoreRequest,
    db: Session = Depends(get_db)
):
    """
    Calculate credit score from telco data
    
    If fetch_fresh_data=True, will fetch new telco data before scoring
    Otherwise, uses most recent telco data (if available)
    """
    try:
        # Get or fetch telco data
        if request.fetch_fresh_data:
            telco_request = TelcoDataRequest(
                customer_id=request.customer_id,
                phone_number=request.phone_number,
                consent=True  # Assuming consent already obtained
            )
            telco_data = await telco_service.fetch_telco_data(telco_request, db)
        else:
            telco_data = await telco_service.get_telco_data(request.customer_id, db)
            if not telco_data:
                raise HTTPException(
                    status_code=404, 
                    detail="No telco data found. Set fetch_fresh_data=true to fetch new data"
                )
        
        # Calculate credit score
        credit_score = await credit_score_service.calculate_credit_score(
            request.customer_id,
            request.phone_number,
            telco_data,
            db
        )
        
        return credit_score
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating credit score: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to calculate credit score: {str(e)}")

@router.get("/customer/{customer_id}", response_model=CreditScoreResponse)
async def get_customer_credit_score(
    customer_id: str,
    db: Session = Depends(get_db)
):
    """Get latest valid credit score for customer"""
    credit_score = await credit_score_service.get_credit_score(customer_id, db)
    if not credit_score:
        raise HTTPException(
            status_code=404, 
            detail="No valid credit score found. Use POST /calculate to generate one"
        )
    return credit_score

@router.get("/customer/{customer_id}/breakdown", response_model=CreditScoreBreakdown)
async def get_credit_score_breakdown(
    customer_id: str,
    db: Session = Depends(get_db)
):
    """Get detailed credit score breakdown with explanations"""
    credit_score = await credit_score_service.get_credit_score(customer_id, db)
    if not credit_score:
        raise HTTPException(status_code=404, detail="No credit score found")
    
    # Get telco data for context
    telco_data = await telco_service.get_telco_data(customer_id, db)
    
    breakdown = {
        "credit_score": credit_score.credit_score,
        "score_category": credit_score.score_category,
        "components": {
            "Payment History (35%)": credit_score.payment_history_score,
            "Account Age (15%)": credit_score.account_age_score,
            "Spending Consistency (30%)": credit_score.spending_consistency_score,
            "Usage Pattern (10%)": credit_score.usage_pattern_score,
            "Account Health (10%)": credit_score.account_health_score
        },
        "risk_assessment": {
            "risk_level": credit_score.risk_level,
            "risk_factors": credit_score.risk_factors,
            "positive_factors": credit_score.positive_factors
        },
        "recommendations": {
            "max_loan_amount": credit_score.max_loan_amount,
            "recommended_interest_rate": credit_score.recommended_interest_rate,
            "approval_probability": credit_score.approval_probability
        },
        "telco_data_summary": {
            "provider": telco_data.provider if telco_data else None,
            "account_age_months": telco_data.account_age_months if telco_data else None,
            "avg_monthly_spend": (
                (telco_data.avg_monthly_airtime or 0) + (telco_data.avg_monthly_data or 0)
            ) if telco_data else None,
            "payment_consistency": telco_data.payment_consistency_score if telco_data else None
        }
    }
    
    return breakdown

@router.post("/bulk", response_model=BulkCreditScoreResponse)
async def bulk_calculate_credit_scores(
    request: BulkCreditScoreRequest,
    db: Session = Depends(get_db)
):
    """Calculate credit scores for multiple customers"""
    results = []
    errors = []
    successful = 0
    
    for customer in request.customers:
        try:
            score_request = CreditScoreRequest(
                customer_id=customer["customer_id"],
                phone_number=customer["phone_number"],
                fetch_fresh_data=request.fetch_fresh_data
            )
            
            # Get or fetch telco data
            if request.fetch_fresh_data:
                telco_request = TelcoDataRequest(
                    customer_id=customer["customer_id"],
                    phone_number=customer["phone_number"],
                    consent=True
                )
                telco_data = await telco_service.fetch_telco_data(telco_request, db)
            else:
                telco_data = await telco_service.get_telco_data(customer["customer_id"], db)
            
            if telco_data:
                credit_score = await credit_score_service.calculate_credit_score(
                    customer["customer_id"],
                    customer["phone_number"],
                    telco_data,
                    db
                )
                results.append(credit_score)
                successful += 1
            else:
                errors.append({
                    "customer_id": customer["customer_id"],
                    "error": "No telco data available"
                })
                
        except Exception as e:
            errors.append({
                "customer_id": customer["customer_id"],
                "error": str(e)
            })
    
    return {
        "total": len(request.customers),
        "successful": successful,
        "failed": len(errors),
        "results": results,
        "errors": errors
    }
