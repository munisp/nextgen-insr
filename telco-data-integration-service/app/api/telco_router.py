"""
Telco Data API Router
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.schemas.telco_schemas import TelcoDataRequest, TelcoDataResponse
from app.services.telco_service import TelcoService
from app.models.telco_data import TelcoData
import logging

logger = logging.getLogger(__name__)

router = APIRouter()
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

@router.post("/fetch", response_model=TelcoDataResponse, status_code=201)
async def fetch_telco_data(
    request: TelcoDataRequest,
    db: Session = Depends(get_db)
):
    """
    Fetch telco data from provider

    Requires customer consent to access telco data
    """
    if not request.consent:
        raise HTTPException(status_code=400, detail="Customer consent is required")

    try:
        telco_data = await telco_service.fetch_telco_data(request, db)
        return telco_data
    except Exception as e:
        logger.error(f"Error fetching telco data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch telco data: {str(e)}")

@router.get("/customer/{customer_id}", response_model=TelcoDataResponse)
async def get_customer_telco_data(
    customer_id: str,
    db: Session = Depends(get_db)
):
    """Get latest telco data for customer"""
    telco_data = await telco_service.get_telco_data(customer_id, db)
    if not telco_data:
        raise HTTPException(status_code=404, detail="Telco data not found for customer")
    return telco_data

@router.get("/phone/{phone_number}", response_model=TelcoDataResponse)
async def get_phone_telco_data(
    phone_number: str,
    db: Session = Depends(get_db)
):
    """Get latest telco data by phone number"""
    telco_data = await telco_service.get_telco_data_by_phone(phone_number, db)
    if not telco_data:
        raise HTTPException(status_code=404, detail="Telco data not found for phone number")
    return telco_data
