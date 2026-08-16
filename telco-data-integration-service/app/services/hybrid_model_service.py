"""
Hybrid Model Service - Phase 3
Combine rules-based and ML models for optimal credit scoring
"""
import os
import logging
import joblib
import numpy as np
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

from app.services.credit_score_service import CreditScoreService
from app.models.telco_data import TelcoData, CreditScore

logger = logging.getLogger(__name__)


class HybridModelService:
    """Service for hybrid credit scoring (rules + ML ensemble)"""

    def __init__(self, model_dir: str = "/app/models"):
        self.model_dir = model_dir
        self.rules_engine = CreditScoreService()
        self.ml_model = None
        self.ml_model_type = None
        self.scaler = None

        # Ensemble weights (can be adjusted based on performance)
        self.ensemble_weights = {
            "rules": 0.5,  # Start with 50/50
            "ml": 0.5
        }

        # Confidence thresholds for dynamic weighting
        self.confidence_thresholds = {
            "high": 0.9,    # 90%+ confidence -> 80% ML, 20% rules
            "medium": 0.7,  # 70-90% confidence -> 50% ML, 50% rules
            "low": 0.5      # <70% confidence -> 20% ML, 80% rules
        }

    def load_ml_model(self, model_version: str, model_type: str = "xgboost"):
        """Load trained ML model"""

        if model_type == "xgboost":
            model_path = os.path.join(self.model_dir, f"xgboost_{model_version}.pkl")
            self.ml_model = joblib.load(model_path)
            self.ml_model_type = "xgboost"
            logger.info(f"Loaded XGBoost model from {model_path}")

        elif model_type == "neural_net":
            import tensorflow as tf
            model_path = os.path.join(self.model_dir, f"neural_net_{model_version}.h5")
            scaler_path = os.path.join(self.model_dir, f"scaler_{model_version}.pkl")

            self.ml_model = tf.keras.models.load_model(model_path)
            self.scaler = joblib.load(scaler_path)
            self.ml_model_type = "neural_net"
            logger.info(f"Loaded Neural Network model from {model_path}")

        else:
            raise ValueError(f"Unsupported model type: {model_type}")

    def set_ensemble_weights(self, rules_weight: float, ml_weight: float):
        """Set custom ensemble weights"""
        if rules_weight + ml_weight != 1.0:
            raise ValueError("Weights must sum to 1.0")

        self.ensemble_weights = {
            "rules": rules_weight,
            "ml": ml_weight
        }
        logger.info(f"Updated ensemble weights: Rules={rules_weight:.2f}, ML={ml_weight:.2f}")

    async def calculate_hybrid_credit_score(
        self,
        customer_id: str,
        phone_number: str,
        telco_data: TelcoData,
        db_session,
        use_dynamic_weighting: bool = True
    ) -> Dict[str, Any]:
        """Calculate credit score using hybrid approach"""

        # 1. Calculate rules-based score
        rules_score_record = await self.rules_engine.calculate_credit_score(
            customer_id, phone_number, telco_data, db_session
        )
        rules_score = rules_score_record.credit_score

        # 2. Calculate ML score (if model loaded)
        ml_score = None
        ml_confidence = 0.0

        if self.ml_model is not None:
            ml_score, ml_confidence = self._predict_ml_score(telco_data)

        # 3. Determine ensemble weights
        if use_dynamic_weighting and ml_score is not None:
            weights = self._get_dynamic_weights(ml_confidence)
        else:
            weights = self.ensemble_weights

        # 4. Calculate hybrid score
        if ml_score is not None:
            hybrid_score = int(
                rules_score * weights["rules"] +
                ml_score * weights["ml"]
            )
        else:
            # Fall back to rules-based if ML not available
            hybrid_score = rules_score
            weights = {"rules": 1.0, "ml": 0.0}

        # 5. Determine final score category
        score_category = self._get_score_category(hybrid_score)

        # 6. Assess risk using hybrid approach
        risk_level, risk_factors, positive_factors = self._assess_hybrid_risk(
            telco_data, hybrid_score, rules_score_record
        )

        # 7. Calculate recommendations
        max_loan_amount, recommended_interest_rate, approval_probability = self._calculate_recommendations(
            hybrid_score, risk_level, telco_data
        )

        # 8. Build response
        result = {
            "credit_score": hybrid_score,
            "score_category": score_category,
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "positive_factors": positive_factors,
            "max_loan_amount": max_loan_amount,
            "recommended_interest_rate": recommended_interest_rate,
            "approval_probability": approval_probability,

            # Model breakdown
            "model_breakdown": {
                "rules_based_score": rules_score,
                "ml_score": ml_score,
                "ml_confidence": round(ml_confidence, 3) if ml_score else None,
                "ensemble_weights": weights,
                "model_type": "hybrid"
            },

            # Component scores (from rules-based)
            "component_scores": {
                "payment_history": rules_score_record.payment_history_score,
                "account_age": rules_score_record.account_age_score,
                "spending_consistency": rules_score_record.spending_consistency_score,
                "usage_pattern": rules_score_record.usage_pattern_score,
                "account_health": rules_score_record.account_health_score
            }
        }

        logger.info(f"Hybrid score for {customer_id}: {hybrid_score} "
                   f"(Rules: {rules_score}, ML: {ml_score}, Weights: {weights})")

        return result

    def _predict_ml_score(self, telco_data: TelcoData) -> Tuple[int, float]:
        """Predict credit score using ML model"""

        # Prepare features
        features = self._extract_features(telco_data)

        # Predict default probability
        if self.ml_model_type == "xgboost":
            default_prob = self.ml_model.predict_proba([features])[0][1]

            # Get prediction confidence (distance from 0.5)
            confidence = abs(default_prob - 0.5) * 2  # Scale to 0-1

        elif self.ml_model_type == "neural_net":
            # Scale features
            features_scaled = self.scaler.transform([features])
            default_prob = self.ml_model.predict(features_scaled)[0][0]

            # Get prediction confidence
            confidence = abs(default_prob - 0.5) * 2

        else:
            raise ValueError(f"Unknown model type: {self.ml_model_type}")

        # Convert default probability to credit score (inverse relationship)
        ml_score = int(850 - (default_prob * 550))

        return ml_score, confidence

    def _extract_features(self, telco_data: TelcoData) -> list:
        """Extract features from telco data for ML model"""

        features = [
            telco_data.account_age_months or 0,
            telco_data.avg_monthly_airtime or 0,
            telco_data.avg_monthly_data or 0,
            telco_data.total_spend_6months or 0,
            telco_data.total_spend_12months or 0,
            telco_data.payment_consistency_score or 50,
            telco_data.late_payment_count or 0,
            telco_data.failed_payment_count or 0,
            telco_data.data_to_airtime_ratio or 0,
            telco_data.transaction_count_30days or 0,
            1 if telco_data.prepaid_vs_postpaid == "POSTPAID" else 0,
            1 if telco_data.account_status == "ACTIVE" else 0,
            # Add more features as needed
        ]

        return features

    def _get_dynamic_weights(self, ml_confidence: float) -> Dict[str, float]:
        """Calculate dynamic ensemble weights based on ML confidence"""

        if ml_confidence >= self.confidence_thresholds["high"]:
            # High confidence -> trust ML more
            return {"rules": 0.2, "ml": 0.8}

        elif ml_confidence >= self.confidence_thresholds["medium"]:
            # Medium confidence -> balanced
            return {"rules": 0.5, "ml": 0.5}

        else:
            # Low confidence -> trust rules more
            return {"rules": 0.8, "ml": 0.2}

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

    def _assess_hybrid_risk(
        self,
        telco_data: TelcoData,
        hybrid_score: int,
        rules_score_record: CreditScore
    ) -> Tuple[str, list, list]:
        """Assess risk using hybrid approach"""

        # Start with rules-based risk factors
        risk_factors = rules_score_record.risk_factors or []
        positive_factors = rules_score_record.positive_factors or []

        # Add ML-specific insights if available
        if self.ml_model is not None:
            # Add confidence-based factors
            _, ml_confidence = self._predict_ml_score(telco_data)

            if ml_confidence >= 0.9:
                positive_factors.append(f"High ML prediction confidence ({ml_confidence:.1%})")
            elif ml_confidence < 0.6:
                risk_factors.append(f"Low ML prediction confidence ({ml_confidence:.1%})")

        # Determine risk level
        if hybrid_score >= 750:
            risk_level = "LOW"
        elif hybrid_score >= 700:
            risk_level = "LOW" if len(risk_factors) == 0 else "MEDIUM"
        elif hybrid_score >= 650:
            risk_level = "MEDIUM"
        elif hybrid_score >= 600:
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
            multiplier = 3 + (credit_score - 300) / 550 * 3  # 3x to 6x
            max_loan_amount = monthly_spend * multiplier
        else:
            max_loan_amount = 10000.0

        # Cap based on risk level
        risk_caps = {
            "LOW": 500000,
            "MEDIUM": 200000,
            "HIGH": 50000,
            "VERY_HIGH": 20000
        }
        max_loan_amount = min(max_loan_amount, risk_caps.get(risk_level, 50000))

        # Interest rate based on risk
        interest_rates = {
            "LOW": 15.0,
            "MEDIUM": 22.0,
            "HIGH": 30.0,
            "VERY_HIGH": 40.0
        }
        recommended_interest_rate = interest_rates.get(risk_level, 30.0)

        # Approval probability
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

        # Adjust for risk
        if risk_level == "HIGH":
            approval_probability *= 0.7
        elif risk_level == "VERY_HIGH":
            approval_probability *= 0.4

        return round(max_loan_amount, 2), round(recommended_interest_rate, 2), round(approval_probability, 3)

    def compare_models(
        self,
        customer_id: str,
        telco_data: TelcoData
    ) -> Dict[str, Any]:
        """Compare rules-based vs ML vs hybrid scores"""

        # Get rules-based score
        rules_score_record = self.rules_engine._calculate_credit_score_sync(telco_data)
        rules_score = rules_score_record.credit_score

        # Get ML score
        ml_score, ml_confidence = None, 0.0
        if self.ml_model is not None:
            ml_score, ml_confidence = self._predict_ml_score(telco_data)

        # Get hybrid score
        if ml_score is not None:
            weights = self._get_dynamic_weights(ml_confidence)
            hybrid_score = int(rules_score * weights["rules"] + ml_score * weights["ml"])
        else:
            hybrid_score = rules_score
            weights = {"rules": 1.0, "ml": 0.0}

        comparison = {
            "customer_id": customer_id,
            "rules_based_score": rules_score,
            "ml_score": ml_score,
            "hybrid_score": hybrid_score,
            "ml_confidence": round(ml_confidence, 3) if ml_score else None,
            "ensemble_weights": weights,
            "score_difference": {
                "rules_vs_ml": abs(rules_score - ml_score) if ml_score else None,
                "rules_vs_hybrid": abs(rules_score - hybrid_score),
                "ml_vs_hybrid": abs(ml_score - hybrid_score) if ml_score else None
            }
        }

        return comparison

    def get_model_info(self) -> Dict[str, Any]:
        """Get information about loaded models"""

        return {
            "rules_engine": {
                "status": "active",
                "type": "rules_based",
                "version": "1.0"
            },
            "ml_model": {
                "status": "active" if self.ml_model is not None else "inactive",
                "type": self.ml_model_type,
                "loaded": self.ml_model is not None
            },
            "hybrid_model": {
                "status": "active" if self.ml_model is not None else "rules_only",
                "ensemble_weights": self.ensemble_weights,
                "dynamic_weighting_enabled": True
            }
        }
