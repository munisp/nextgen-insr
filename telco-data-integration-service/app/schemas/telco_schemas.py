"""
Telco Data Schemas (Pydantic)
"""
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class TelcoProvider(str, Enum):
    MTN = "MTN"
    AIRTEL = "AIRTEL"
    GLO = "GLO"
    NINE_MOBILE = "9MOBILE"

class TelcoDataRequest(BaseModel):
    """Request to fetch telco data"""
    customer_id: str = Field(..., description="Customer ID")
    phone_number: str = Field(..., description="Phone number (e.g., 08012345678)")
    provider: Optional[TelcoProvider] = Field(None, description="Telco provider (auto-detected if not provided)")
    consent: bool = Field(..., description="Customer consent to fetch telco data")

    @validator('phone_number')
    def validate_phone_number(cls, v):
        # Remove spaces and dashes
        v = v.replace(" ", "").replace("-", "")
        # Check if it starts with 0 or +234
        if v.startswith("+234"):
            v = "0" + v[4:]
        # Must be 11 digits starting with 0
        if not (len(v) == 11 and v.startswith("0") and v.isdigit()):
            raise ValueError("Invalid Nigerian phone number format")
        return v

class TelcoDataResponse(BaseModel):
    """Response with telco data"""
    id: str
    customer_id: str
    phone_number: str
    provider: str
    account_age_months: Optional[int]
    account_status: Optional[str]
    avg_monthly_airtime: Optional[float]
    avg_monthly_data: Optional[float]
    total_spend_6months: Optional[float]
    total_spend_12months: Optional[float]
    payment_consistency_score: Optional[float]
    late_payment_count: Optional[int]
    failed_payment_count: Optional[int]
    prepaid_vs_postpaid: Optional[str]
    transaction_count_30days: Optional[int]
    avg_transaction_amount: Optional[float]
    status: str
    fetched_at: datetime

    class Config:
        from_attributes = True

class CreditScoreRequest(BaseModel):
    """Request to calculate credit score"""
    customer_id: str = Field(..., description="Customer ID")
    phone_number: str = Field(..., description="Phone number")
    fetch_fresh_data: bool = Field(False, description="Fetch fresh telco data before scoring")

class CreditScoreResponse(BaseModel):
    """Credit score response"""
    id: str
    customer_id: str
    phone_number: str
    credit_score: int = Field(..., ge=300, le=850, description="Credit score (300-850)")
    score_category: str = Field(..., description="EXCELLENT, GOOD, FAIR, POOR, VERY_POOR")
    payment_history_score: float
    account_age_score: float
    spending_consistency_score: float
    usage_pattern_score: float
    account_health_score: float
    risk_level: str = Field(..., description="LOW, MEDIUM, HIGH, VERY_HIGH")
    risk_factors: List[str]
    positive_factors: List[str]
    max_loan_amount: float = Field(..., description="Maximum recommended loan amount (₦)")
    recommended_interest_rate: float = Field(..., description="Recommended interest rate (%)")
    approval_probability: float = Field(..., ge=0, le=1, description="Approval probability (0-1)")
    calculated_at: datetime
    expires_at: datetime

    class Config:
        from_attributes = True

class CreditScoreBreakdown(BaseModel):
    """Detailed credit score breakdown"""
    credit_score: int
    score_category: str
    components: Dict[str, float] = Field(..., description="Score components with weights")
    risk_assessment: Dict[str, Any]
    recommendations: Dict[str, Any]
    telco_data_summary: Dict[str, Any]

class BulkCreditScoreRequest(BaseModel):
    """Bulk credit score request"""
    customers: List[Dict[str, str]] = Field(..., description="List of {customer_id, phone_number}")
    fetch_fresh_data: bool = Field(False)

class BulkCreditScoreResponse(BaseModel):
    """Bulk credit score response"""
    total: int
    successful: int
    failed: int
    results: List[CreditScoreResponse]
    errors: List[Dict[str, str]]
