"""
Credit Score Service - Alternative credit scoring using telco data
"""
import uuid
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
from app.models.telco_data import TelcoData, CreditScore
from app.services.telco_service import TelcoService

logger = logging.getLogger(__name__)

class CreditScoreService:
    """Service for calculating credit scores from telco data"""

    def __init__(self):
        self.telco_service = TelcoService()
        # Score weights (must sum to 1.0)
        self.weights = {
            "payment_history": 0.35,  # 35%
            "account_age": 0.15,  # 15%
            "spending_consistency": 0.30,  # 30%
            "usage_pattern": 0.10,  # 10%
            "account_health": 0.10  # 10%
        }

    async def calculate_credit_score(
        self,
        customer_id: str,
        phone_number: str,
        telco_data: TelcoData,
        db_session
    ) -> CreditScore:
        """Calculate credit score from telco data"""

        # Calculate component scores
        payment_history_score = self._calculate_payment_history_score(telco_data)
        account_age_score = self._calculate_account_age_score(telco_data)
        spending_consistency_score = self._calculate_spending_consistency_score(telco_data)
        usage_pattern_score = self._calculate_usage_pattern_score(telco_data)
        account_health_score = self._calculate_account_health_score(telco_data)

        # Calculate weighted credit score (0-100 scale)
        weighted_score = (
            payment_history_score * self.weights["payment_history"] +
            account_age_score * self.weights["account_age"] +
            spending_consistency_score * self.weights["spending_consistency"] +
            usage_pattern_score * self.weights["usage_pattern"] +
            account_health_score * self.weights["account_health"]
        )

        # Convert to FICO-like scale (300-850)
        credit_score = int(300 + (weighted_score / 100) * 550)

        # Determine score category
        score_category = self._get_score_category(credit_score)

        # Assess risk
        risk_level, risk_factors, positive_factors = self._assess_risk(telco_data, credit_score)

        # Calculate recommendations
        max_loan_amount, recommended_interest_rate, approval_probability = self._calculate_recommendations(
            credit_score, risk_level, telco_data
        )

        # Create credit score record
        credit_score_record = CreditScore(
            id=str(uuid.uuid4()),
            customer_id=customer_id,
            phone_number=phone_number,
            credit_score=credit_score,
            score_category=score_category,
            payment_history_score=round(payment_history_score, 2),
            account_age_score=round(account_age_score, 2),
            spending_consistency_score=round(spending_consistency_score, 2),
            usage_pattern_score=round(usage_pattern_score, 2),
            account_health_score=round(account_health_score, 2),
            risk_level=risk_level,
            risk_factors=risk_factors,
            positive_factors=positive_factors,
            max_loan_amount=max_loan_amount,
            recommended_interest_rate=recommended_interest_rate,
            approval_probability=approval_probability,
            telco_data_id=telco_data.id,
            calculated_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=90)  # Valid for 90 days
        )

        # Save to database
        db_session.add(credit_score_record)
        db_session.commit()
        db_session.refresh(credit_score_record)

        logger.info(f"Calculated credit score {credit_score} ({score_category}) for customer {customer_id}")

        return credit_score_record

    def _calculate_payment_history_score(self, telco_data: TelcoData) -> float:
        """Calculate payment history score (0-100)"""
        if not telco_data.payment_consistency_score:
            return 50.0  # Neutral score if no data

        # Start with consistency score
        score = telco_data.payment_consistency_score

        # Penalize late payments
        if telco_data.late_payment_count:
            penalty = min(telco_data.late_payment_count * 5, 30)  # Max 30 point penalty
            score -= penalty

        # Penalize failed payments more heavily
        if telco_data.failed_payment_count:
            penalty = min(telco_data.failed_payment_count * 10, 40)  # Max 40 point penalty
            score -= penalty

        # Ensure score is between 0-100
        return max(0, min(100, score))

    def _calculate_account_age_score(self, telco_data: TelcoData) -> float:
        """Calculate account age score (0-100)"""
        if not telco_data.account_age_months:
            return 30.0  # Low score for new accounts

        # Score increases with account age
        # 6 months = 40, 12 months = 60, 24 months = 80, 36+ months = 100
        if telco_data.account_age_months >= 36:
            return 100.0
        elif telco_data.account_age_months >= 24:
            return 80.0 + ((telco_data.account_age_months - 24) / 12) * 20
        elif telco_data.account_age_months >= 12:
            return 60.0 + ((telco_data.account_age_months - 12) / 12) * 20
        elif telco_data.account_age_months >= 6:
            return 40.0 + ((telco_data.account_age_months - 6) / 6) * 20
        else:
            return 30.0 + (telco_data.account_age_months / 6) * 10

    def _calculate_spending_consistency_score(self, telco_data: TelcoData) -> float:
        """Calculate spending consistency score (0-100)"""
        score = 50.0  # Start neutral

        # Higher spending indicates ability to pay
        if telco_data.avg_monthly_airtime and telco_data.avg_monthly_data:
            total_monthly_spend = telco_data.avg_monthly_airtime + telco_data.avg_monthly_data

            # Score based on monthly spend
            if total_monthly_spend >= 10000:  # ₦10,000+
                score = 90.0
            elif total_monthly_spend >= 5000:  # ₦5,000+
                score = 75.0
            elif total_monthly_spend >= 2000:  # ₦2,000+
                score = 60.0
            elif total_monthly_spend >= 1000:  # ₦1,000+
                score = 45.0
            else:
                score = 30.0

        # Bonus for consistent spending over time
        if telco_data.total_spend_6months and telco_data.total_spend_12months:
            # Check if 6-month average matches 12-month average (consistency)
            avg_6mo = telco_data.total_spend_6months / 6
            avg_12mo = telco_data.total_spend_12months / 12

            if avg_12mo > 0:
                consistency_ratio = avg_6mo / avg_12mo
                if 0.8 <= consistency_ratio <= 1.2:  # Within 20% variance
                    score += 10.0  # Bonus for consistency

        return min(100, score)

    def _calculate_usage_pattern_score(self, telco_data: TelcoData) -> float:
        """Calculate usage pattern score (0-100)"""
        score = 50.0

        # Data-heavy users (higher data to airtime ratio) tend to be more tech-savvy
        if telco_data.data_to_airtime_ratio:
            if telco_data.data_to_airtime_ratio >= 0.8:  # Heavy data user
                score = 80.0
            elif telco_data.data_to_airtime_ratio >= 0.5:
                score = 70.0
            elif telco_data.data_to_airtime_ratio >= 0.3:
                score = 60.0
            else:
                score = 50.0

        # Regular transaction patterns indicate stability
        if telco_data.transaction_count_30days:
            if telco_data.transaction_count_30days >= 30:  # Daily user
                score += 10
            elif telco_data.transaction_count_30days >= 15:  # Regular user
                score += 5

        # Postpaid customers are generally more creditworthy
        if telco_data.prepaid_vs_postpaid == "POSTPAID":
            score += 10

        return min(100, score)

    def _calculate_account_health_score(self, telco_data: TelcoData) -> float:
        """Calculate account health score (0-100)"""
        if telco_data.account_status == "ACTIVE":
            score = 100.0
        elif telco_data.account_status == "SUSPENDED":
            score = 30.0
        else:  # INACTIVE
            score = 10.0

        # Penalize if there are many failed payments
        if telco_data.failed_payment_count:
            penalty = min(telco_data.failed_payment_count * 15, 50)
            score -= penalty

        return max(0, score)

    def _get_score_category(self, credit_score: int) -> str:
        """Get score category from credit score"""
        if credit_score >= 750:
            return "EXCELLENT"
        elif credit_score >= 700:
            return "GOOD"
        elif credit_score >= 650:
            return "FAIR"
        elif credit_score >= 600:
            return "POOR"
        else:
            return "VERY_POOR"

    def _assess_risk(self, telco_data: TelcoData, credit_score: int) -> Tuple[str, List[str], List[str]]:
        """Assess risk level and identify factors"""
        risk_factors = []
        positive_factors = []

        # Analyze risk factors
        if telco_data.late_payment_count and telco_data.late_payment_count > 3:
            risk_factors.append(f"Multiple late payments ({telco_data.late_payment_count})")

        if telco_data.failed_payment_count and telco_data.failed_payment_count > 2:
            risk_factors.append(f"Multiple failed payments ({telco_data.failed_payment_count})")

        if telco_data.account_age_months and telco_data.account_age_months < 6:
            risk_factors.append("New account (less than 6 months)")

        if telco_data.account_status != "ACTIVE":
            risk_factors.append(f"Account status: {telco_data.account_status}")

        if telco_data.avg_monthly_airtime and telco_data.avg_monthly_data:
            total_spend = telco_data.avg_monthly_airtime + telco_data.avg_monthly_data
            if total_spend < 1000:
                risk_factors.append("Low monthly spending (< ₦1,000)")

        # Analyze positive factors
        if telco_data.account_age_months and telco_data.account_age_months >= 24:
            positive_factors.append(f"Long account history ({telco_data.account_age_months} months)")

        if telco_data.payment_consistency_score and telco_data.payment_consistency_score >= 80:
            positive_factors.append("Excellent payment consistency")

        if telco_data.prepaid_vs_postpaid == "POSTPAID":
            positive_factors.append("Postpaid customer")

        if telco_data.avg_monthly_airtime and telco_data.avg_monthly_data:
            total_spend = telco_data.avg_monthly_airtime + telco_data.avg_monthly_data
            if total_spend >= 5000:
                positive_factors.append(f"High monthly spending (₦{total_spend:,.0f})")

        if telco_data.account_status == "ACTIVE":
            positive_factors.append("Active account in good standing")

        # Determine risk level
        if credit_score >= 750:
            risk_level = "LOW"
        elif credit_score >= 700:
            risk_level = "LOW" if len(risk_factors) == 0 else "MEDIUM"
        elif credit_score >= 650:
            risk_level = "MEDIUM"
        elif credit_score >= 600:
            risk_level = "MEDIUM" if len(risk_factors) <= 2 else "HIGH"
        else:
            risk_level = "HIGH" if len(risk_factors) <= 3 else "VERY_HIGH"

        return risk_level, risk_factors, positive_factors

    def _calculate_recommendations(
        self,
        credit_score: int,
        risk_level: str,
        telco_data: TelcoData
    ) -> Tuple[float, float, float]:
        """Calculate loan recommendations"""

        # Base loan amount on monthly spending
        if telco_data.avg_monthly_airtime and telco_data.avg_monthly_data:
            monthly_spend = telco_data.avg_monthly_airtime + telco_data.avg_monthly_data
            # Loan amount = 3-6 months of spending based on credit score
            multiplier = 3 + (credit_score - 300) / 550 * 3  # 3x to 6x
            max_loan_amount = monthly_spend * multiplier
        else:
            max_loan_amount = 10000.0  # Minimum ₦10,000

        # Cap loan amount based on risk level
        if risk_level == "LOW":
            max_loan_amount = min(max_loan_amount, 500000)  # ₦500k max
        elif risk_level == "MEDIUM":
            max_loan_amount = min(max_loan_amount, 200000)  # ₦200k max
        elif risk_level == "HIGH":
            max_loan_amount = min(max_loan_amount, 50000)  # ₦50k max
        else:  # VERY_HIGH
            max_loan_amount = min(max_loan_amount, 20000)  # ₦20k max

        # Interest rate based on risk
        if risk_level == "LOW":
            recommended_interest_rate = 15.0  # 15% per annum
        elif risk_level == "MEDIUM":
            recommended_interest_rate = 22.0  # 22% per annum
        elif risk_level == "HIGH":
            recommended_interest_rate = 30.0  # 30% per annum
        else:  # VERY_HIGH
            recommended_interest_rate = 40.0  # 40% per annum

        # Approval probability based on credit score and risk
        if credit_score >= 750:
            approval_probability = 0.95
        elif credit_score >= 700:
            approval_probability = 0.85
        elif credit_score >= 650:
            approval_probability = 0.70
        elif credit_score >= 600:
            approval_probability = 0.50
        else:
            approval_probability = 0.25

        # Adjust for risk factors
        if risk_level == "HIGH":
            approval_probability *= 0.7
        elif risk_level == "VERY_HIGH":
            approval_probability *= 0.4

        return round(max_loan_amount, 2), round(recommended_interest_rate, 2), round(approval_probability, 3)

    async def get_credit_score(self, customer_id: str, db_session) -> Optional[CreditScore]:
        """Get latest valid credit score for customer"""
        return db_session.query(CreditScore).filter(
            CreditScore.customer_id == customer_id,
            CreditScore.expires_at > datetime.utcnow()
        ).order_by(CreditScore.calculated_at.desc()).first()
