"""
Telco Data Models
"""
from sqlalchemy import Column, String, Integer, Float, DateTime, JSON, Enum as SQLEnum
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import enum

Base = declarative_base()

class TelcoProvider(str, enum.Enum):
    """Nigerian telco providers"""
    MTN = "MTN"
    AIRTEL = "AIRTEL"
    GLO = "GLO"
    NINE_MOBILE = "9MOBILE"

class TelcoDataStatus(str, enum.Enum):
    """Status of telco data fetch"""
    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"

class TelcoData(Base):
    """Telco data from provider"""
    __tablename__ = "telco_data"

    id = Column(String(36), primary_key=True)
    customer_id = Column(String(36), nullable=False, index=True)
    phone_number = Column(String(20), nullable=False, index=True)
    provider = Column(SQLEnum(TelcoProvider), nullable=False)

    # Account information
    account_age_months = Column(Integer)  # How long they've been a customer
    account_status = Column(String(20))  # ACTIVE, SUSPENDED, INACTIVE

    # Usage patterns
    avg_monthly_airtime = Column(Float)  # Average monthly airtime purchase (₦)
    avg_monthly_data = Column(Float)  # Average monthly data purchase (₦)
    total_spend_6months = Column(Float)  # Total spend in last 6 months
    total_spend_12months = Column(Float)  # Total spend in last 12 months

    # Payment behavior
    payment_consistency_score = Column(Float)  # 0-100, how consistent are payments
    late_payment_count = Column(Integer)  # Number of late payments
    failed_payment_count = Column(Integer)  # Number of failed payments
    prepaid_vs_postpaid = Column(String(10))  # PREPAID or POSTPAID

    # Transaction patterns
    transaction_count_30days = Column(Integer)  # Number of transactions in 30 days
    avg_transaction_amount = Column(Float)  # Average transaction amount
    max_transaction_amount = Column(Float)  # Maximum transaction amount
    min_transaction_amount = Column(Float)  # Minimum transaction amount

    # Behavioral indicators
    night_usage_percentage = Column(Float)  # % of usage at night (11pm-6am)
    weekend_usage_percentage = Column(Float)  # % of usage on weekends
    data_to_airtime_ratio = Column(Float)  # Ratio of data to airtime spend

    # Raw data
    raw_data = Column(JSON)  # Complete raw response from telco

    # Metadata
    status = Column(SQLEnum(TelcoDataStatus), default=TelcoDataStatus.PENDING)
    fetched_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class CreditScore(Base):
    """Alternative credit score based on telco data"""
    __tablename__ = "credit_scores"

    id = Column(String(36), primary_key=True)
    customer_id = Column(String(36), nullable=False, index=True, unique=True)
    phone_number = Column(String(20), nullable=False)

    # Credit score components
    credit_score = Column(Integer)  # 300-850 (FICO-like scale)
    score_category = Column(String(20))  # EXCELLENT, GOOD, FAIR, POOR, VERY_POOR

    # Component scores (0-100 each)
    payment_history_score = Column(Float)  # 35% weight
    account_age_score = Column(Float)  # 15% weight
    spending_consistency_score = Column(Float)  # 30% weight
    usage_pattern_score = Column(Float)  # 10% weight
    account_health_score = Column(Float)  # 10% weight

    # Risk indicators
    risk_level = Column(String(20))  # LOW, MEDIUM, HIGH, VERY_HIGH
    risk_factors = Column(JSON)  # List of risk factors
    positive_factors = Column(JSON)  # List of positive factors

    # Recommendations
    max_loan_amount = Column(Float)  # Maximum recommended loan amount (₦)
    recommended_interest_rate = Column(Float)  # Recommended interest rate (%)
    approval_probability = Column(Float)  # Probability of loan approval (0-1)

    # Metadata
    telco_data_id = Column(String(36))  # Reference to telco data
    calculated_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)  # Score validity (usually 30-90 days)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
