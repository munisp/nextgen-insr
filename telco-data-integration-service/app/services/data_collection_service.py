"""
Data Collection Service - Phase 1
Track loan applications and outcomes for ML model training
"""
import uuid
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session

from app.models.loan_outcome import (
    LoanApplication, LoanPayment, ModelTrainingDataset,
    ModelPerformanceMetrics, FeatureImportance
)
from app.models.telco_data import TelcoData, CreditScore

logger = logging.getLogger(__name__)


class DataCollectionService:
    """Service for collecting and managing loan outcome data"""

    async def record_loan_application(
        self,
        customer_id: str,
        phone_number: str,
        credit_score_record: CreditScore,
        telco_data: TelcoData,
        loan_amount: float,
        loan_purpose: str,
        interest_rate: float,
        loan_term_months: int,
        db_session: Session
    ) -> LoanApplication:
        """Record a new loan application with credit score"""

        # Snapshot telco features at time of application
        telco_features_snapshot = {
            "account_age_months": telco_data.account_age_months,
            "avg_monthly_airtime": telco_data.avg_monthly_airtime,
            "avg_monthly_data": telco_data.avg_monthly_data,
            "total_spend_6months": telco_data.total_spend_6months,
            "total_spend_12months": telco_data.total_spend_12months,
            "payment_consistency_score": telco_data.payment_consistency_score,
            "late_payment_count": telco_data.late_payment_count,
            "failed_payment_count": telco_data.failed_payment_count,
            "data_to_airtime_ratio": telco_data.data_to_airtime_ratio,
            "transaction_count_30days": telco_data.transaction_count_30days,
            "prepaid_vs_postpaid": telco_data.prepaid_vs_postpaid,
            "account_status": telco_data.account_status,
            "provider": telco_data.provider
        }

        # Snapshot credit score components
        credit_score_components = {
            "credit_score": credit_score_record.credit_score,
            "score_category": credit_score_record.score_category,
            "payment_history_score": credit_score_record.payment_history_score,
            "account_age_score": credit_score_record.account_age_score,
            "spending_consistency_score": credit_score_record.spending_consistency_score,
            "usage_pattern_score": credit_score_record.usage_pattern_score,
            "account_health_score": credit_score_record.account_health_score,
            "risk_level": credit_score_record.risk_level,
            "approval_probability": credit_score_record.approval_probability
        }

        # Calculate total amount due
        total_amount_due = loan_amount * (1 + interest_rate / 100)

        loan_app = LoanApplication(
            id=str(uuid.uuid4()),
            customer_id=customer_id,
            phone_number=phone_number,
            credit_score_id=credit_score_record.id,
            loan_amount=loan_amount,
            loan_purpose=loan_purpose,
            interest_rate=interest_rate,
            loan_term_months=loan_term_months,
            application_status="PENDING",
            total_amount_due=total_amount_due,
            loan_status="ACTIVE",
            telco_features_snapshot=telco_features_snapshot,
            credit_score_components=credit_score_components
        )

        db_session.add(loan_app)
        db_session.commit()
        db_session.refresh(loan_app)

        logger.info(f"Recorded loan application {loan_app.id} for customer {customer_id}")
        return loan_app

    async def update_loan_decision(
        self,
        loan_application_id: str,
        approved: bool,
        rejection_reason: Optional[str],
        db_session: Session
    ) -> LoanApplication:
        """Update loan application decision"""
        loan_app = db_session.query(LoanApplication).filter(
            LoanApplication.id == loan_application_id
        ).first()

        if not loan_app:
            raise ValueError(f"Loan application {loan_application_id} not found")

        loan_app.application_status = "APPROVED" if approved else "REJECTED"
        loan_app.approval_date = datetime.utcnow() if approved else None
        loan_app.rejection_reason = rejection_reason
        loan_app.updated_at = datetime.utcnow()

        db_session.commit()
        db_session.refresh(loan_app)

        logger.info(f"Updated loan application {loan_application_id}: {loan_app.application_status}")
        return loan_app

    async def record_loan_disbursement(
        self,
        loan_application_id: str,
        disbursement_amount: float,
        db_session: Session
    ) -> LoanApplication:
        """Record loan disbursement"""
        loan_app = db_session.query(LoanApplication).filter(
            LoanApplication.id == loan_application_id
        ).first()

        if not loan_app:
            raise ValueError(f"Loan application {loan_application_id} not found")

        loan_app.disbursed = True
        loan_app.disbursement_date = datetime.utcnow()
        loan_app.disbursement_amount = disbursement_amount
        loan_app.updated_at = datetime.utcnow()

        db_session.commit()
        db_session.refresh(loan_app)

        logger.info(f"Recorded disbursement for loan {loan_application_id}: ₦{disbursement_amount:,.2f}")
        return loan_app

    async def record_loan_payment(
        self,
        loan_application_id: str,
        customer_id: str,
        payment_amount: float,
        payment_date: datetime,
        due_date: datetime,
        payment_method: str,
        transaction_reference: str,
        db_session: Session
    ) -> LoanPayment:
        """Record a loan payment"""

        # Calculate if payment is late
        days_late = max(0, (payment_date - due_date).days)
        payment_status = "LATE" if days_late > 0 else "ON_TIME"

        payment = LoanPayment(
            id=str(uuid.uuid4()),
            loan_application_id=loan_application_id,
            customer_id=customer_id,
            payment_amount=payment_amount,
            payment_date=payment_date,
            due_date=due_date,
            payment_status=payment_status,
            days_late=days_late,
            payment_method=payment_method,
            transaction_reference=transaction_reference
        )

        db_session.add(payment)

        # Update loan application
        loan_app = db_session.query(LoanApplication).filter(
            LoanApplication.id == loan_application_id
        ).first()

        if loan_app:
            loan_app.total_amount_paid += payment_amount
            loan_app.payment_count += 1
            if payment_status == "LATE":
                loan_app.late_payment_count += 1
            loan_app.final_payment_date = payment_date

            # Check if loan is completed
            if loan_app.total_amount_paid >= loan_app.total_amount_due:
                loan_app.loan_status = "COMPLETED"
                loan_app.completed_date = datetime.utcnow()

            loan_app.updated_at = datetime.utcnow()

        db_session.commit()
        db_session.refresh(payment)

        logger.info(f"Recorded payment for loan {loan_application_id}: ₦{payment_amount:,.2f} ({payment_status})")
        return payment

    async def record_missed_payment(
        self,
        loan_application_id: str,
        customer_id: str,
        due_date: datetime,
        expected_amount: float,
        db_session: Session
    ) -> LoanPayment:
        """Record a missed payment"""

        payment = LoanPayment(
            id=str(uuid.uuid4()),
            loan_application_id=loan_application_id,
            customer_id=customer_id,
            payment_amount=0.0,
            payment_date=datetime.utcnow(),
            due_date=due_date,
            payment_status="MISSED",
            days_late=(datetime.utcnow() - due_date).days,
            payment_method="NONE",
            transaction_reference="MISSED"
        )

        db_session.add(payment)

        # Update loan application
        loan_app = db_session.query(LoanApplication).filter(
            LoanApplication.id == loan_application_id
        ).first()

        if loan_app:
            loan_app.missed_payment_count += 1
            loan_app.updated_at = datetime.utcnow()

            # Check if loan should be marked as defaulted
            # Default criteria: 3+ missed payments or 90+ days overdue
            if loan_app.missed_payment_count >= 3 or (datetime.utcnow() - due_date).days >= 90:
                await self.mark_loan_as_defaulted(loan_application_id, db_session)

        db_session.commit()
        db_session.refresh(payment)

        logger.warning(f"Recorded missed payment for loan {loan_application_id}")
        return payment

    async def mark_loan_as_defaulted(
        self,
        loan_application_id: str,
        db_session: Session
    ) -> LoanApplication:
        """Mark a loan as defaulted"""
        loan_app = db_session.query(LoanApplication).filter(
            LoanApplication.id == loan_application_id
        ).first()

        if not loan_app:
            raise ValueError(f"Loan application {loan_application_id} not found")

        loan_app.loan_status = "DEFAULTED"
        loan_app.default_occurred = True

        if loan_app.disbursement_date:
            loan_app.days_to_default = (datetime.utcnow() - loan_app.disbursement_date).days

        loan_app.default_amount = loan_app.total_amount_due - loan_app.total_amount_paid
        loan_app.updated_at = datetime.utcnow()

        db_session.commit()
        db_session.refresh(loan_app)

        logger.error(f"Marked loan {loan_application_id} as DEFAULTED (₦{loan_app.default_amount:,.2f} unpaid)")
        return loan_app

    async def get_training_data_statistics(self, db_session: Session) -> Dict[str, Any]:
        """Get statistics on collected training data"""

        total_applications = db_session.query(LoanApplication).count()
        approved_applications = db_session.query(LoanApplication).filter(
            LoanApplication.application_status == "APPROVED"
        ).count()
        disbursed_loans = db_session.query(LoanApplication).filter(
            LoanApplication.disbursed.is_(True)
        ).count()
        completed_loans = db_session.query(LoanApplication).filter(
            LoanApplication.loan_status == "COMPLETED"
        ).count()
        defaulted_loans = db_session.query(LoanApplication).filter(
            LoanApplication.loan_status == "DEFAULTED"
        ).count()
        active_loans = db_session.query(LoanApplication).filter(
            LoanApplication.loan_status == "ACTIVE"
        ).count()

        # Calculate default rate
        default_rate = (defaulted_loans / disbursed_loans * 100) if disbursed_loans > 0 else 0

        # Get oldest and newest loan dates
        oldest_loan = db_session.query(LoanApplication).order_by(
            LoanApplication.created_at.asc()
        ).first()
        newest_loan = db_session.query(LoanApplication).order_by(
            LoanApplication.created_at.desc()
        ).first()

        return {
            "total_applications": total_applications,
            "approved_applications": approved_applications,
            "disbursed_loans": disbursed_loans,
            "completed_loans": completed_loans,
            "defaulted_loans": defaulted_loans,
            "active_loans": active_loans,
            "default_rate": round(default_rate, 2),
            "data_collection_start_date": oldest_loan.created_at if oldest_loan else None,
            "data_collection_end_date": newest_loan.created_at if newest_loan else None,
            "ready_for_ml_training": disbursed_loans >= 10000,  # Need 10k+ records
            "ml_training_readiness_percentage": min(100, disbursed_loans / 10000 * 100)
        }

    async def export_training_dataset(
        self,
        dataset_name: str,
        dataset_version: str,
        output_path: str,
        db_session: Session
    ) -> ModelTrainingDataset:
        """Export loan data as training dataset for ML"""
        import pandas as pd

        # Get all disbursed loans with outcomes (completed or defaulted)
        loans = db_session.query(LoanApplication).filter(
            LoanApplication.disbursed.is_(True),
            LoanApplication.loan_status.in_(["COMPLETED", "DEFAULTED"])
        ).all()

        if len(loans) < 100:
            raise ValueError(f"Insufficient data for training: {len(loans)} records (need 100+)")

        # Prepare training data
        training_data = []
        for loan in loans:
            # Extract features from telco snapshot
            features = loan.telco_features_snapshot.copy() if loan.telco_features_snapshot else {}

            # Add credit score components
            if loan.credit_score_components:
                features.update(loan.credit_score_components)

            # Add loan details
            features['loan_amount'] = loan.loan_amount
            features['interest_rate'] = loan.interest_rate
            features['loan_term_months'] = loan.loan_term_months

            # Add target variable
            features['default_occurred'] = 1 if loan.default_occurred else 0
            features['days_to_default'] = loan.days_to_default if loan.days_to_default else 0

            training_data.append(features)

        # Create DataFrame
        df = pd.DataFrame(training_data)

        # Save to file
        df.to_csv(output_path, index=False)
        file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

        # Record dataset metadata
        positive_class = df['default_occurred'].sum()
        negative_class = len(df) - positive_class

        dataset = ModelTrainingDataset(
            id=str(uuid.uuid4()),
            dataset_name=dataset_name,
            dataset_version=dataset_version,
            total_records=len(df),
            positive_class_count=int(positive_class),
            negative_class_count=int(negative_class),
            class_imbalance_ratio=round(negative_class / positive_class, 2) if positive_class > 0 else 0,
            data_start_date=loans[0].created_at,
            data_end_date=loans[-1].created_at,
            feature_count=len(df.columns) - 2,  # Exclude target variables
            feature_list=list(df.columns),
            file_path=output_path,
            file_size_mb=round(file_size_mb, 2),
            created_by="data_collection_service"
        )

        db_session.add(dataset)
        db_session.commit()
        db_session.refresh(dataset)

        logger.info(f"Exported training dataset: {len(df)} records, {len(df.columns)} features")
        return dataset
