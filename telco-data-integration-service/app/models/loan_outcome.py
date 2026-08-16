"""
Loan Outcome Models - Phase 1: Data Collection
Track loan outcomes for ML model training
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class LoanApplication(Base):
    """Track all loan applications with credit scores"""
    __tablename__ = "loan_applications"

    id = Column(String(50), primary_key=True)
    customer_id = Column(String(50), nullable=False, index=True)
    phone_number = Column(String(20), nullable=False)
    credit_score_id = Column(String(50), nullable=False)  # Link to credit_scores table

    # Loan details
    loan_amount = Column(Float, nullable=False)
    loan_purpose = Column(String(50))  # PREMIUM_FINANCING, CLAIM_ADVANCE, etc.
    interest_rate = Column(Float)
    loan_term_months = Column(Integer)

    # Application decision
    application_status = Column(String(20), nullable=False)  # APPROVED, REJECTED, PENDING
    approval_date = Column(DateTime)
    rejection_reason = Column(Text)

    # Disbursement
    disbursed = Column(Boolean, default=False)
    disbursement_date = Column(DateTime)
    disbursement_amount = Column(Float)

    # Repayment tracking
    total_amount_due = Column(Float)  # Principal + interest
    total_amount_paid = Column(Float, default=0.0)
    payment_count = Column(Integer, default=0)
    late_payment_count = Column(Integer, default=0)
    missed_payment_count = Column(Integer, default=0)

    # Outcome (for ML training)
    loan_status = Column(String(20))  # ACTIVE, COMPLETED, DEFAULTED, WRITTEN_OFF
    default_occurred = Column(Boolean, default=False)
    days_to_default = Column(Integer)  # Days from disbursement to default
    default_amount = Column(Float)  # Amount unpaid at default

    # Completion
    completed_date = Column(DateTime)
    final_payment_date = Column(DateTime)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Telco features at time of application (for ML training)
    telco_features_snapshot = Column(JSON)  # Store all telco features

    # Credit score components at time of application
    credit_score_components = Column(JSON)  # Store component scores


class LoanPayment(Base):
    """Track individual loan payments"""
    __tablename__ = "loan_payments"

    id = Column(String(50), primary_key=True)
    loan_application_id = Column(String(50), nullable=False, index=True)
    customer_id = Column(String(50), nullable=False, index=True)

    # Payment details
    payment_amount = Column(Float, nullable=False)
    payment_date = Column(DateTime, nullable=False)
    due_date = Column(DateTime, nullable=False)

    # Payment status
    payment_status = Column(String(20), nullable=False)  # ON_TIME, LATE, MISSED
    days_late = Column(Integer, default=0)

    # Payment method
    payment_method = Column(String(50))  # BANK_TRANSFER, CARD, MOBILE_MONEY, AIRTIME
    transaction_reference = Column(String(100))

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ModelTrainingDataset(Base):
    """Prepared datasets for ML model training"""
    __tablename__ = "model_training_datasets"

    id = Column(String(50), primary_key=True)
    dataset_name = Column(String(100), nullable=False)
    dataset_version = Column(String(20), nullable=False)

    # Dataset statistics
    total_records = Column(Integer, nullable=False)
    positive_class_count = Column(Integer)  # Number of defaults
    negative_class_count = Column(Integer)  # Number of non-defaults
    class_imbalance_ratio = Column(Float)

    # Date range
    data_start_date = Column(DateTime)
    data_end_date = Column(DateTime)

    # Features
    feature_count = Column(Integer)
    feature_list = Column(JSON)  # List of feature names

    # File location
    file_path = Column(Text)  # Path to CSV/parquet file
    file_size_mb = Column(Float)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String(50))
    notes = Column(Text)


class ModelPerformanceMetrics(Base):
    """Track model performance over time"""
    __tablename__ = "model_performance_metrics"

    id = Column(String(50), primary_key=True)
    model_version = Column(String(50), nullable=False, index=True)
    model_type = Column(String(50), nullable=False)  # RULES_BASED, XGBOOST, NEURAL_NET, HYBRID

    # Performance metrics
    accuracy = Column(Float)
    precision = Column(Float)
    recall = Column(Float)
    f1_score = Column(Float)
    auc_roc = Column(Float)
    gini_coefficient = Column(Float)

    # Calibration metrics
    brier_score = Column(Float)
    log_loss = Column(Float)

    # Business metrics
    approval_rate = Column(Float)
    default_rate_predicted = Column(Float)
    default_rate_actual = Column(Float)
    prediction_error = Column(Float)  # |predicted - actual|

    # Score band analysis
    score_band_metrics = Column(JSON)  # Metrics by score band (EXCELLENT, GOOD, etc.)

    # Evaluation period
    evaluation_start_date = Column(DateTime)
    evaluation_end_date = Column(DateTime)
    evaluation_record_count = Column(Integer)

    # Metadata
    evaluated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    evaluated_by = Column(String(50))
    notes = Column(Text)


class FeatureImportance(Base):
    """Track feature importance for ML models"""
    __tablename__ = "feature_importance"

    id = Column(String(50), primary_key=True)
    model_version = Column(String(50), nullable=False, index=True)
    feature_name = Column(String(100), nullable=False)

    # Importance scores
    importance_score = Column(Float, nullable=False)
    importance_rank = Column(Integer)
    importance_percentage = Column(Float)  # % of total importance

    # SHAP values (for explainability)
    shap_mean_abs_value = Column(Float)
    shap_std = Column(Float)

    # Metadata
    calculated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
