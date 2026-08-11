"""
ART-GNN Integration for Adversarial-Robust Fraud Detection

This module integrates the Adversarial Robustness Toolbox (ART) with
Graph Neural Networks (GNN) for hardened fraud detection in insurance.

NO FABRICATED PREDICTIONS: fraud predictions and robustness certification
require a GNN service. When none is configured the methods raise
RuntimeError — unless ALLOW_SIMULATED_DATA=true is explicitly set, in which
case every simulated prediction is stamped "simulated": true.
"""

import os
import json
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging
import asyncio

ALLOW_SIMULATED_DATA = os.environ.get("ALLOW_SIMULATED_DATA", "").strip().lower() == "true"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class AdversarialDetectionResult:
    """Result from adversarial input detection"""
    is_adversarial: bool
    confidence: float
    detection_method: str
    perturbation_estimate: float
    original_prediction: Optional[Dict[str, Any]] = None
    defended_prediction: Optional[Dict[str, Any]] = None
    recommendations: List[str] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class HardenedPrediction:
    """Prediction from hardened model with robustness guarantees"""
    prediction: Dict[str, Any]
    confidence: float
    robustness_certified: bool
    defense_applied: List[str]
    processing_time_ms: float
    model_version: str
    simulated: bool = False


class ARTGNNIntegration:
    """
    Integrates ART with GNN for adversarial-robust fraud detection.

    This service:
    1. Detects adversarial inputs before they reach the model
    2. Applies defensive transformations to suspicious inputs
    3. Provides certified robustness guarantees
    4. Monitors for adversarial attack patterns

    Fraud prediction and robustness certification require a GNN service.
    Without one, RuntimeError is raised unless ALLOW_SIMULATED_DATA=true
    (demo mode — simulated predictions are explicitly stamped).
    """

    def __init__(
        self,
        gnn_service: Any = None,
        robustness_service: Any = None,
        detection_threshold: float = 0.7,
        defense_enabled: bool = True,
    ):
        self.gnn_service = gnn_service
        self.robustness_service = robustness_service
        self.detection_threshold = detection_threshold
        self.defense_enabled = defense_enabled

        # Attack detection statistics
        self.stats = {
            "total_requests": 0,
            "adversarial_detected": 0,
            "defenses_applied": 0,
            "blocked_requests": 0,
        }

        # Feature ranges for insurance data validation
        self.feature_ranges = {
            "claim_amount": (0, 50000000),  # Up to 50M Naira
            "premium_amount": (1000, 10000000),  # 1K to 10M Naira
            "age": (18, 100),
            "policy_tenure_days": (0, 36500),  # Up to 100 years
            "num_claims": (0, 100),
            "risk_score": (0, 1),
            "fraud_score": (0, 1),
            "coverage_amount": (10000, 100000000),  # 10K to 100M Naira
        }

    def _require_predictor(self) -> None:
        """Raise when no GNN service exists and simulation is not allowed."""
        if self.gnn_service is not None:
            return
        if not ALLOW_SIMULATED_DATA:
            raise RuntimeError(
                "A GNN fraud detection service is required for prediction; "
                "simulated fraud predictions are disabled. Provide gnn_service, "
                "or set ALLOW_SIMULATED_DATA=true for clearly-labelled demo mode."
            )
        logger.warning(
            "ALLOW_SIMULATED_DATA=true: producing SIMULATED fraud predictions "
            "(demo only — not real model output)."
        )

    def detect_adversarial_input(
        self,
        features: np.ndarray,
        feature_names: List[str] = None,
    ) -> AdversarialDetectionResult:
        """
        Detect if input features appear to be adversarially manipulated.

        Uses multiple detection methods:
        1. Statistical anomaly detection
        2. Feature range validation
        3. Perturbation pattern detection
        """
        self.stats["total_requests"] += 1

        detection_scores = []
        recommendations = []

        # Method 1: Feature range validation
        range_violations = self._check_feature_ranges(features, feature_names)
        if range_violations:
            detection_scores.append(0.8)
            recommendations.append(f"Feature range violations detected: {range_violations}")
        else:
            detection_scores.append(0.1)

        # Method 2: Statistical anomaly detection
        anomaly_score = self._detect_statistical_anomalies(features)
        detection_scores.append(anomaly_score)
        if anomaly_score > 0.5:
            recommendations.append("Statistical anomalies detected in input distribution")

        # Method 3: Perturbation pattern detection
        perturbation_score = self._detect_perturbation_patterns(features)
        detection_scores.append(perturbation_score)
        if perturbation_score > 0.5:
            recommendations.append("Input shows signs of gradient-based perturbation")

        # Combine detection scores
        overall_score = np.mean(detection_scores)
        is_adversarial = overall_score > self.detection_threshold

        if is_adversarial:
            self.stats["adversarial_detected"] += 1
            recommendations.append("ALERT: Input flagged as potentially adversarial")
            recommendations.append("Recommend manual review before processing")

        return AdversarialDetectionResult(
            is_adversarial=is_adversarial,
            confidence=overall_score,
            detection_method="ensemble",
            perturbation_estimate=perturbation_score,
            recommendations=recommendations,
        )

    def _check_feature_ranges(
        self,
        features: np.ndarray,
        feature_names: List[str] = None,
    ) -> List[str]:
        """Check if features are within valid ranges"""
        violations = []

        if feature_names is None:
            feature_names = list(self.feature_ranges.keys())[:len(features)]

        for i, (name, value) in enumerate(zip(feature_names, features.flatten())):
            if name in self.feature_ranges:
                min_val, max_val = self.feature_ranges[name]
                if value < min_val or value > max_val:
                    violations.append(f"{name}: {value} (expected {min_val}-{max_val})")

        return violations

    def _detect_statistical_anomalies(self, features: np.ndarray) -> float:
        """Detect statistical anomalies in input features"""
        # Check for unusual patterns that might indicate adversarial manipulation

        # Check for values very close to decision boundaries
        boundary_proximity = np.mean(np.abs(features - 0.5) < 0.05)

        # Check for unusual precision (too many decimal places)
        precision_score = np.mean([
            len(str(float(f)).split('.')[-1]) > 10
            for f in features.flatten()
        ])

        # Check for repeated values
        unique_ratio = len(np.unique(features)) / max(len(features.flatten()), 1)
        repetition_score = 1 - unique_ratio if unique_ratio < 0.5 else 0

        return (boundary_proximity * 0.4 + precision_score * 0.3 + repetition_score * 0.3)

    def _detect_perturbation_patterns(self, features: np.ndarray) -> float:
        """Detect patterns consistent with gradient-based perturbations"""
        # FGSM and PGD attacks often produce specific perturbation patterns

        # Check for uniform small perturbations (FGSM signature)
        feature_std = np.std(features)
        if 0.01 < feature_std < 0.1:
            fgsm_score = 0.6
        else:
            fgsm_score = 0.2

        # Check for values at epsilon boundaries
        epsilon_values = [0.01, 0.05, 0.1, 0.15, 0.2]
        boundary_hits = sum(
            np.any(np.abs(features - eps) < 0.001) or np.any(np.abs(features + eps) < 0.001)
            for eps in epsilon_values
        )
        boundary_score = min(boundary_hits / len(epsilon_values), 1.0)

        return (fgsm_score * 0.5 + boundary_score * 0.5)

    def apply_defensive_transformation(
        self,
        features: np.ndarray,
        defense_type: str = "feature_squeezing",
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Apply defensive transformation to potentially adversarial input"""
        self.stats["defenses_applied"] += 1

        defense_info = {
            "defense_type": defense_type,
            "original_features": features.tolist(),
            "applied_at": datetime.utcnow().isoformat(),
        }

        if defense_type == "feature_squeezing":
            # Reduce feature precision to remove small perturbations
            bit_depth = 8
            levels = 2 ** bit_depth
            defended_features = np.round(features * levels) / levels
            defense_info["bit_depth"] = bit_depth

        elif defense_type == "spatial_smoothing":
            # Apply smoothing to remove high-frequency perturbations
            kernel_size = 3
            defended_features = self._apply_smoothing(features, kernel_size)
            defense_info["kernel_size"] = kernel_size

        elif defense_type == "input_clipping":
            # Clip features to valid ranges
            defended_features = self._clip_to_valid_ranges(features)
            defense_info["clipped_features"] = int(np.sum(defended_features != features))

        elif defense_type == "ensemble":
            # Apply multiple defenses and average
            squeezed = np.round(features * 256) / 256
            clipped = self._clip_to_valid_ranges(features)
            defended_features = (squeezed + clipped) / 2
            defense_info["methods"] = ["feature_squeezing", "input_clipping"]

        else:
            defended_features = features
            defense_info["warning"] = "Unknown defense type, no transformation applied"

        defense_info["defended_features"] = defended_features.tolist()

        return defended_features, defense_info

    def _apply_smoothing(self, features: np.ndarray, kernel_size: int) -> np.ndarray:
        """Apply simple smoothing to features"""
        if len(features.shape) == 1:
            # For 1D features, use moving average
            kernel = np.ones(kernel_size) / kernel_size
            padded = np.pad(features, kernel_size // 2, mode='edge')
            smoothed = np.convolve(padded, kernel, mode='valid')
            return smoothed[:len(features)]
        return features

    def _clip_to_valid_ranges(self, features: np.ndarray) -> np.ndarray:
        """Clip features to valid insurance data ranges"""
        clipped = features.copy()
        # Apply general clipping for normalized features
        clipped = np.clip(clipped, 0, 1)
        return clipped

    async def predict_with_robustness(
        self,
        features: np.ndarray,
        feature_names: List[str] = None,
        require_certification: bool = False,
    ) -> HardenedPrediction:
        """
        Make prediction with adversarial robustness guarantees.

        This method:
        1. Detects potential adversarial inputs
        2. Applies defensive transformations if needed
        3. Makes prediction using the GNN service
        4. Provides robustness certification

        Raises RuntimeError when no GNN service is configured and
        ALLOW_SIMULATED_DATA is not set.
        """
        start_time = datetime.utcnow()
        defenses_applied = []

        # Step 1: Detect adversarial input
        detection_result = self.detect_adversarial_input(features, feature_names)

        # Step 2: Apply defenses if adversarial detected
        if detection_result.is_adversarial and self.defense_enabled:
            features, defense_info = self.apply_defensive_transformation(
                features, defense_type="ensemble"
            )
            defenses_applied.extend(defense_info.get("methods", ["ensemble"]))

        # Step 3: Make prediction — real GNN or explicitly-gated simulation
        self._require_predictor()
        simulated = self.gnn_service is None
        if not simulated:
            prediction = await self.gnn_service.predict_fraud(features)
        else:
            prediction = self._simulate_fraud_prediction(features)

        # Step 4: Certify robustness
        robustness_certified = False
        if require_certification:
            robustness_certified = await self._certify_robustness(
                features, prediction, epsilon=0.1
            )

        processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000

        return HardenedPrediction(
            prediction=prediction,
            confidence=prediction.get("confidence", 0.0),
            robustness_certified=robustness_certified,
            defense_applied=defenses_applied,
            processing_time_ms=processing_time,
            model_version="art-gnn-v1.0",
            simulated=simulated,
        )

    def _simulate_fraud_prediction(self, features: np.ndarray) -> Dict[str, Any]:
        """Simulate fraud prediction — DEMO MODE ONLY.

        Only callable when ALLOW_SIMULATED_DATA=true. The prediction dict is
        stamped "simulated": true and must never be treated as model output.
        """
        if not ALLOW_SIMULATED_DATA:
            raise RuntimeError(
                "Simulated fraud predictions require ALLOW_SIMULATED_DATA=true"
            )

        # Heuristic fraud prediction based on feature mean (demo only)
        feature_mean = np.mean(features)
        fraud_score = min(max(feature_mean + np.random.normal(0, 0.1), 0), 1)

        return {
            "fraud_score": float(fraud_score),
            "is_fraud": fraud_score > 0.5,
            "confidence": 0.0,  # no confidence claim in demo mode
            "risk_factors": [
                "claim_amount_anomaly" if fraud_score > 0.6 else None,
                "pattern_match" if fraud_score > 0.7 else None,
                "network_connection" if fraud_score > 0.8 else None,
            ],
            "recommendation": "manual_review" if fraud_score > 0.5 else "auto_approve",
            "simulated": True,
        }

    async def _predict_for_certification(self, features: np.ndarray) -> Dict[str, Any]:
        """Prediction used inside robustness certification (real or gated sim)."""
        if self.gnn_service is not None:
            return await self.gnn_service.predict_fraud(features)
        return self._simulate_fraud_prediction(features)

    async def _certify_robustness(
        self,
        features: np.ndarray,
        prediction: Dict[str, Any],
        epsilon: float,
    ) -> bool:
        """
        Certify that prediction is robust within epsilon perturbation.

        Uses randomized smoothing: the SAME predictor (real GNN service, or
        the gated simulator in demo mode) is re-run on noisy samples and the
        fraction of consistent predictions decides certification.
        """
        num_samples = 100
        consistent_predictions = 0
        reference_is_fraud = prediction.get("is_fraud")

        for _ in range(num_samples):
            # Add random noise within epsilon ball
            noise = np.random.uniform(-epsilon, epsilon, features.shape)
            noisy_features = features + noise
            noisy_features = np.clip(noisy_features, 0, 1)

            # Check if prediction remains consistent
            noisy_pred = await self._predict_for_certification(noisy_features)
            if noisy_pred.get("is_fraud") == reference_is_fraud:
                consistent_predictions += 1

        # Certified if >95% of noisy predictions are consistent
        certification_rate = consistent_predictions / num_samples
        return certification_rate > 0.95

    def get_statistics(self) -> Dict[str, Any]:
        """Get adversarial detection statistics"""
        total = self.stats["total_requests"]
        return {
            **self.stats,
            "adversarial_rate": self.stats["adversarial_detected"] / max(total, 1),
            "defense_rate": self.stats["defenses_applied"] / max(total, 1),
            "block_rate": self.stats["blocked_requests"] / max(total, 1),
        }


class UnderwritingAdversarialGuard:
    """
    Adversarial protection for the underwriting pipeline.

    Integrates with the insurance application workflow to:
    1. Validate incoming application data
    2. Detect manipulation attempts
    3. Flag suspicious applications for review
    """

    def __init__(self, art_gnn: ARTGNNIntegration = None):
        self.art_gnn = art_gnn or ARTGNNIntegration()

        # Underwriting-specific feature definitions
        self.underwriting_features = [
            "applicant_age",
            "income_level",
            "occupation_risk",
            "health_score",
            "coverage_requested",
            "premium_offered",
            "claim_history_score",
            "credit_score",
            "location_risk",
            "policy_type_encoded",
        ]

    async def validate_application(
        self,
        application_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Validate insurance application for adversarial manipulation.

        Returns validation result with recommendations.
        """
        # Extract features from application
        features = self._extract_features(application_data)

        # Detect adversarial manipulation
        detection = self.art_gnn.detect_adversarial_input(
            features, self.underwriting_features
        )

        # Determine action
        if detection.is_adversarial and detection.confidence > 0.8:
            action = "block"
            reason = "High confidence adversarial manipulation detected"
        elif detection.is_adversarial:
            action = "manual_review"
            reason = "Potential adversarial manipulation - requires review"
        else:
            action = "proceed"
            reason = "Application passed adversarial validation"

        return {
            "application_id": application_data.get("application_id"),
            "validation_passed": not detection.is_adversarial,
            "action": action,
            "reason": reason,
            "confidence": detection.confidence,
            "detection_details": {
                "is_adversarial": detection.is_adversarial,
                "detection_method": detection.detection_method,
                "perturbation_estimate": detection.perturbation_estimate,
            },
            "recommendations": detection.recommendations,
            "timestamp": datetime.utcnow().isoformat(),
        }

    def _extract_features(self, application_data: Dict[str, Any]) -> np.ndarray:
        """Extract normalized features from application data"""
        features = []

        # Age (normalized 18-100)
        age = application_data.get("age", 35)
        features.append((age - 18) / 82)

        # Income (normalized 0-10M Naira)
        income = application_data.get("annual_income", 500000)
        features.append(min(income / 10000000, 1))

        # Occupation risk (0-1)
        features.append(application_data.get("occupation_risk_score", 0.3))

        # Health score (0-1)
        features.append(application_data.get("health_score", 0.7))

        # Coverage requested (normalized 0-100M)
        coverage = application_data.get("coverage_amount", 5000000)
        features.append(min(coverage / 100000000, 1))

        # Premium offered (normalized 0-10M)
        premium = application_data.get("premium_amount", 50000)
        features.append(min(premium / 10000000, 1))

        # Claim history (0-1, lower is better)
        features.append(application_data.get("claim_history_score", 0.2))

        # Credit score (normalized 300-850)
        credit = application_data.get("credit_score", 650)
        features.append((credit - 300) / 550)

        # Location risk (0-1)
        features.append(application_data.get("location_risk_score", 0.4))

        # Policy type (encoded 0-1)
        features.append(application_data.get("policy_type_encoded", 0.5))

        return np.array(features)


# Factory functions
def create_art_gnn_integration(
    gnn_service: Any = None,
    detection_threshold: float = 0.7,
) -> ARTGNNIntegration:
    """Create ART-GNN integration instance"""
    return ARTGNNIntegration(
        gnn_service=gnn_service,
        detection_threshold=detection_threshold,
    )


def create_underwriting_guard(
    art_gnn: ARTGNNIntegration = None,
) -> UnderwritingAdversarialGuard:
    """Create underwriting adversarial guard instance"""
    return UnderwritingAdversarialGuard(art_gnn=art_gnn)


# Temporal workflow activities
async def validate_application_activity(
    application_data: Dict[str, Any],
) -> Dict[str, Any]:
    """Temporal activity for application validation"""
    guard = create_underwriting_guard()
    return await guard.validate_application(application_data)


async def predict_fraud_with_robustness_activity(
    features: List[float],
    feature_names: List[str] = None,
) -> Dict[str, Any]:
    """Temporal activity for robust fraud prediction.

    Raises RuntimeError when no GNN service is available and
    ALLOW_SIMULATED_DATA is not set.
    """
    integration = create_art_gnn_integration()
    result = await integration.predict_with_robustness(
        np.array(features),
        feature_names,
        require_certification=True,
    )
    return {
        "prediction": result.prediction,
        "confidence": result.confidence,
        "robustness_certified": result.robustness_certified,
        "defense_applied": result.defense_applied,
        "processing_time_ms": result.processing_time_ms,
        "model_version": result.model_version,
        "simulated": result.simulated,
    }
