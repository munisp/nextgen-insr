"""
ART (Adversarial Robustness Toolbox) Integration for Insurance ML Models

This module provides adversarial robustness testing and defense mechanisms
for insurance ML models including fraud detection, risk scoring, and claims prediction.

NO FABRICATED METRICS: robustness evaluations require the ART library. When
ART is unavailable the evaluators raise RuntimeError — unless
ALLOW_SIMULATED_DATA=true is explicitly set, in which case the report is
clearly stamped simulated=true and labelled as demo-only.
"""

import os
import json
import numpy as np
from typing import List, Dict, Any, Optional, Tuple, Union
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging

# ART imports (would be installed via pip install adversarial-robustness-toolbox)
try:
    from art.attacks.evasion import FastGradientMethod, ProjectedGradientDescent, DeepFool
    from art.attacks.poisoning import PoisoningAttackBackdoor
    from art.defences.preprocessor import FeatureSqueezing, SpatialSmoothing
    from art.defences.postprocessor import ReverseSigmoid, HighConfidence
    from art.defences.trainer import AdversarialTrainer
    from art.estimators.classification import SklearnClassifier, XGBoostClassifier
    from art.metrics import empirical_robustness, loss_sensitivity
    ART_AVAILABLE = True
except ImportError:
    ART_AVAILABLE = False

ALLOW_SIMULATED_DATA = os.environ.get("ALLOW_SIMULATED_DATA", "").strip().lower() == "true"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AttackType(Enum):
    """Types of adversarial attacks"""
    FGSM = "fast_gradient_sign_method"
    PGD = "projected_gradient_descent"
    DEEPFOOL = "deepfool"
    POISONING = "poisoning"
    EVASION = "evasion"


class DefenseType(Enum):
    """Types of adversarial defenses"""
    FEATURE_SQUEEZING = "feature_squeezing"
    SPATIAL_SMOOTHING = "spatial_smoothing"
    ADVERSARIAL_TRAINING = "adversarial_training"
    INPUT_VALIDATION = "input_validation"
    ENSEMBLE = "ensemble"


@dataclass
class RobustnessReport:
    """Report from robustness evaluation"""
    model_name: str
    attack_type: str
    original_accuracy: float
    adversarial_accuracy: float
    robustness_score: float
    perturbation_magnitude: float
    samples_tested: int
    successful_attacks: int
    failed_attacks: int
    average_perturbation: float
    recommendations: List[str]
    simulated: bool = False
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class DefenseReport:
    """Report from defense evaluation"""
    model_name: str
    defense_type: str
    original_accuracy: float
    defended_accuracy: float
    attack_success_rate_before: float
    attack_success_rate_after: float
    defense_effectiveness: float
    overhead_ms: float
    recommendations: List[str]
    simulated: bool = False
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class AdversarialRobustnessService:
    """
    Service for testing and improving adversarial robustness of insurance ML models.

    Requires the ART library for attack/defense evaluation. When ART is not
    installed, evaluation methods raise RuntimeError unless
    ALLOW_SIMULATED_DATA=true (demo mode, reports stamped simulated=true).
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        epsilon: float = 0.1,
        max_iter: int = 100,
    ):
        self.model_path = model_path
        self.epsilon = epsilon
        self.max_iter = max_iter
        self.art_available = ART_AVAILABLE

        # Insurance-specific attack configurations
        self.attack_configs = {
            "fraud_detection": {
                "epsilon": 0.05,  # Small perturbations for fraud evasion
                "max_iter": 50,
                "targeted": True,
                "target_class": 0,  # Non-fraud
            },
            "risk_scoring": {
                "epsilon": 0.1,
                "max_iter": 100,
                "targeted": True,
                "target_class": 0,  # Low risk
            },
            "claims_prediction": {
                "epsilon": 0.15,
                "max_iter": 75,
                "targeted": False,
            },
        }

    def _require_art(self) -> None:
        """Raise unless ART is available or simulation is explicitly allowed."""
        if self.art_available:
            return
        if not ALLOW_SIMULATED_DATA:
            raise RuntimeError(
                "ART (adversarial-robustness-toolbox) is required for robustness "
                "evaluation; fabricated robustness metrics are disabled. Install "
                "adversarial-robustness-toolbox, or set ALLOW_SIMULATED_DATA=true "
                "for clearly-labelled demo reports."
            )
        logger.warning(
            "ALLOW_SIMULATED_DATA=true: producing SIMULATED robustness report "
            "(demo only — not a real security evaluation)."
        )

    def _create_art_classifier(self, model: Any, model_type: str = "sklearn") -> Any:
        """Create ART classifier wrapper"""
        if not self.art_available:
            raise RuntimeError("ART library not available")

        if model_type == "sklearn":
            return SklearnClassifier(model=model)
        elif model_type == "xgboost":
            return XGBoostClassifier(model=model)
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

    def evaluate_robustness_fgsm(
        self,
        model: Any,
        X_test: np.ndarray,
        y_test: np.ndarray,
        model_type: str = "sklearn",
        epsilon: float = None,
    ) -> RobustnessReport:
        """Evaluate model robustness against FGSM attack.

        Raises RuntimeError when ART is unavailable and ALLOW_SIMULATED_DATA
        is not set.
        """
        epsilon = epsilon or self.epsilon
        self._require_art()

        if not self.art_available:
            return self._simulate_robustness_evaluation(
                "FGSM", X_test, y_test, epsilon
            )

        classifier = self._create_art_classifier(model, model_type)

        # Original accuracy
        predictions = classifier.predict(X_test)
        original_accuracy = np.mean(np.argmax(predictions, axis=1) == y_test)

        # Create FGSM attack
        attack = FastGradientMethod(estimator=classifier, eps=epsilon)

        # Generate adversarial examples
        X_adv = attack.generate(x=X_test)

        # Adversarial accuracy
        adv_predictions = classifier.predict(X_adv)
        adversarial_accuracy = np.mean(np.argmax(adv_predictions, axis=1) == y_test)

        # Calculate metrics
        successful_attacks = np.sum(np.argmax(predictions, axis=1) != np.argmax(adv_predictions, axis=1))
        perturbation = np.mean(np.abs(X_adv - X_test))

        robustness_score = adversarial_accuracy / original_accuracy if original_accuracy > 0 else 0

        recommendations = self._generate_recommendations(
            robustness_score, "FGSM", epsilon
        )

        return RobustnessReport(
            model_name=model_type,
            attack_type="FGSM",
            original_accuracy=original_accuracy,
            adversarial_accuracy=adversarial_accuracy,
            robustness_score=robustness_score,
            perturbation_magnitude=epsilon,
            samples_tested=len(X_test),
            successful_attacks=int(successful_attacks),
            failed_attacks=len(X_test) - int(successful_attacks),
            average_perturbation=float(perturbation),
            recommendations=recommendations,
        )

    def evaluate_robustness_pgd(
        self,
        model: Any,
        X_test: np.ndarray,
        y_test: np.ndarray,
        model_type: str = "sklearn",
        epsilon: float = None,
        max_iter: int = None,
    ) -> RobustnessReport:
        """Evaluate model robustness against PGD attack.

        Raises RuntimeError when ART is unavailable and ALLOW_SIMULATED_DATA
        is not set.
        """
        epsilon = epsilon or self.epsilon
        max_iter = max_iter or self.max_iter
        self._require_art()

        if not self.art_available:
            return self._simulate_robustness_evaluation(
                "PGD", X_test, y_test, epsilon
            )

        classifier = self._create_art_classifier(model, model_type)

        # Original accuracy
        predictions = classifier.predict(X_test)
        original_accuracy = np.mean(np.argmax(predictions, axis=1) == y_test)

        # Create PGD attack
        attack = ProjectedGradientDescent(
            estimator=classifier,
            eps=epsilon,
            max_iter=max_iter,
            eps_step=epsilon / 10,
        )

        # Generate adversarial examples
        X_adv = attack.generate(x=X_test)

        # Adversarial accuracy
        adv_predictions = classifier.predict(X_adv)
        adversarial_accuracy = np.mean(np.argmax(adv_predictions, axis=1) == y_test)

        # Calculate metrics
        successful_attacks = np.sum(np.argmax(predictions, axis=1) != np.argmax(adv_predictions, axis=1))
        perturbation = np.mean(np.abs(X_adv - X_test))

        robustness_score = adversarial_accuracy / original_accuracy if original_accuracy > 0 else 0

        recommendations = self._generate_recommendations(
            robustness_score, "PGD", epsilon
        )

        return RobustnessReport(
            model_name=model_type,
            attack_type="PGD",
            original_accuracy=original_accuracy,
            adversarial_accuracy=adversarial_accuracy,
            robustness_score=robustness_score,
            perturbation_magnitude=epsilon,
            samples_tested=len(X_test),
            successful_attacks=int(successful_attacks),
            failed_attacks=len(X_test) - int(successful_attacks),
            average_perturbation=float(perturbation),
            recommendations=recommendations,
        )

    def _simulate_robustness_evaluation(
        self,
        attack_type: str,
        X_test: np.ndarray,
        y_test: np.ndarray,
        epsilon: float,
    ) -> RobustnessReport:
        """Simulated robustness evaluation — DEMO MODE ONLY.

        Only reachable when ALLOW_SIMULATED_DATA=true. The report is stamped
        simulated=True and must never be treated as a real security
        evaluation.
        """
        if not ALLOW_SIMULATED_DATA:
            raise RuntimeError(
                "Simulated robustness reports require ALLOW_SIMULATED_DATA=true"
            )

        # Simulated robustness metrics (heuristic formulas, clearly labelled)
        original_accuracy = 0.92  # assumed demo baseline, NOT measured

        if attack_type == "FGSM":
            adversarial_accuracy = original_accuracy * (1 - epsilon * 2)
        elif attack_type == "PGD":
            adversarial_accuracy = original_accuracy * (1 - epsilon * 3)
        else:
            adversarial_accuracy = original_accuracy * (1 - epsilon * 2.5)

        adversarial_accuracy = max(0.1, adversarial_accuracy)
        robustness_score = adversarial_accuracy / original_accuracy

        samples = len(X_test) if X_test is not None else 1000
        successful_attacks = int(samples * (1 - robustness_score))

        recommendations = [
            "SIMULATED REPORT (ALLOW_SIMULATED_DATA=true) — metrics are NOT "
            "from a real ART evaluation and must not be used for security sign-off.",
        ] + self._generate_recommendations(robustness_score, attack_type, epsilon)

        return RobustnessReport(
            model_name="SIMULATED_demo_only",
            attack_type=attack_type,
            original_accuracy=original_accuracy,
            adversarial_accuracy=adversarial_accuracy,
            robustness_score=robustness_score,
            perturbation_magnitude=epsilon,
            samples_tested=samples,
            successful_attacks=successful_attacks,
            failed_attacks=samples - successful_attacks,
            average_perturbation=epsilon * 0.8,
            recommendations=recommendations,
            simulated=True,
        )

    def _generate_recommendations(
        self,
        robustness_score: float,
        attack_type: str,
        epsilon: float,
    ) -> List[str]:
        """Generate recommendations based on robustness evaluation"""
        recommendations = []

        if robustness_score < 0.5:
            recommendations.append("CRITICAL: Model is highly vulnerable to adversarial attacks")
            recommendations.append("Implement adversarial training immediately")
            recommendations.append("Add input validation and anomaly detection")
            recommendations.append("Consider ensemble methods for improved robustness")
        elif robustness_score < 0.7:
            recommendations.append("WARNING: Model has moderate vulnerability")
            recommendations.append("Implement feature squeezing defense")
            recommendations.append("Add confidence thresholding for predictions")
            recommendations.append("Monitor for unusual input patterns")
        elif robustness_score < 0.85:
            recommendations.append("Model has acceptable robustness but can be improved")
            recommendations.append("Consider adversarial training for further hardening")
            recommendations.append("Implement input sanitization")
        else:
            recommendations.append("Model demonstrates good adversarial robustness")
            recommendations.append("Continue monitoring for new attack vectors")
            recommendations.append("Regularly re-evaluate with updated attack methods")

        # Attack-specific recommendations
        if attack_type == "FGSM":
            recommendations.append("FGSM is a fast attack - consider PGD for stronger evaluation")
        elif attack_type == "PGD":
            recommendations.append("PGD is a strong attack - good robustness here indicates solid defense")

        return recommendations

    def apply_feature_squeezing_defense(
        self,
        X: np.ndarray,
        bit_depth: int = 8,
    ) -> Tuple[np.ndarray, float]:
        """Apply feature squeezing defense"""
        start_time = datetime.utcnow()

        if self.art_available:
            defense = FeatureSqueezing(bit_depth=bit_depth)
            X_defended = defense(X)[0]
        else:
            # Deterministic quantization (real transformation, no ART needed)
            levels = 2 ** bit_depth
            X_defended = np.round(X * levels) / levels

        overhead_ms = (datetime.utcnow() - start_time).total_seconds() * 1000

        return X_defended, overhead_ms

    def apply_input_validation_defense(
        self,
        X: np.ndarray,
        feature_ranges: Dict[str, Tuple[float, float]],
    ) -> Tuple[np.ndarray, List[int]]:
        """Apply input validation defense for insurance data"""
        X_validated = X.copy()
        flagged_samples = []

        for i, sample in enumerate(X):
            is_valid = True
            for j, (feature_name, (min_val, max_val)) in enumerate(feature_ranges.items()):
                if j < len(sample):
                    if sample[j] < min_val or sample[j] > max_val:
                        is_valid = False
                        # Clip to valid range
                        X_validated[i, j] = np.clip(sample[j], min_val, max_val)

            if not is_valid:
                flagged_samples.append(i)

        return X_validated, flagged_samples

    def evaluate_defense_effectiveness(
        self,
        model: Any,
        X_test: np.ndarray,
        y_test: np.ndarray,
        defense_type: DefenseType,
        model_type: str = "sklearn",
    ) -> DefenseReport:
        """Evaluate effectiveness of a defense mechanism.

        Raises RuntimeError when ART is unavailable and ALLOW_SIMULATED_DATA
        is not set — attack success rates cannot be measured without ART.
        """
        self._require_art()
        simulated = not self.art_available

        # Original accuracy
        if self.art_available:
            classifier = self._create_art_classifier(model, model_type)
            predictions = classifier.predict(X_test)
            original_accuracy = np.mean(np.argmax(predictions, axis=1) == y_test)
        else:
            original_accuracy = 0.92  # assumed demo baseline, NOT measured

        # Apply defense
        if defense_type == DefenseType.FEATURE_SQUEEZING:
            X_defended, overhead_ms = self.apply_feature_squeezing_defense(X_test)
        elif defense_type == DefenseType.INPUT_VALIDATION:
            feature_ranges = {
                "amount": (0, 10000000),
                "risk_score": (0, 1),
                "age": (18, 100),
            }
            X_defended, _ = self.apply_input_validation_defense(X_test, feature_ranges)
            overhead_ms = 1.0
        else:
            X_defended = X_test
            overhead_ms = 0.0

        # Evaluate defended accuracy
        if self.art_available:
            defended_predictions = classifier.predict(X_defended)
            defended_accuracy = np.mean(np.argmax(defended_predictions, axis=1) == y_test)
        else:
            defended_accuracy = original_accuracy * 0.98  # heuristic demo estimate

        if self.art_available:
            # Measure attack success before/after defense with a real attack
            attack = FastGradientMethod(estimator=classifier, eps=self.epsilon)
            X_adv = attack.generate(x=X_test)
            adv_preds = np.argmax(classifier.predict(X_adv), axis=1)
            clean_preds = np.argmax(classifier.predict(X_test), axis=1)
            attack_success_before = float(np.mean(adv_preds != clean_preds))

            X_adv_defended, _ = self.apply_feature_squeezing_defense(X_adv)
            adv_def_preds = np.argmax(classifier.predict(X_adv_defended), axis=1)
            attack_success_after = float(np.mean(adv_def_preds != clean_preds))

            defense_effectiveness = (
                1 - (attack_success_after / attack_success_before)
                if attack_success_before > 0 else 0.0
            )
            recommendations = [
                f"{defense_type.value} reduces attack success by {defense_effectiveness*100:.1f}%",
                f"Overhead of {overhead_ms:.2f}ms per sample is acceptable for production",
                "Consider combining with other defenses for layered protection",
            ]
        else:
            # Demo-mode heuristic estimates (clearly stamped simulated)
            attack_success_before = 0.35
            attack_success_after = attack_success_before * 0.4
            defense_effectiveness = 1 - (attack_success_after / attack_success_before)
            recommendations = [
                "SIMULATED REPORT (ALLOW_SIMULATED_DATA=true) — attack success "
                "rates are heuristic estimates, NOT measured with ART.",
                f"{defense_type.value} reduces attack success by {defense_effectiveness*100:.1f}% (estimated)",
            ]

        return DefenseReport(
            model_name="SIMULATED_demo_only" if simulated else model_type,
            defense_type=defense_type.value,
            original_accuracy=original_accuracy,
            defended_accuracy=defended_accuracy,
            attack_success_rate_before=attack_success_before,
            attack_success_rate_after=attack_success_after,
            defense_effectiveness=defense_effectiveness,
            overhead_ms=overhead_ms,
            recommendations=recommendations,
            simulated=simulated,
        )

    def evaluate_fraud_detection_robustness(
        self,
        model: Any,
        X_test: np.ndarray,
        y_test: np.ndarray,
    ) -> Dict[str, RobustnessReport]:
        """Comprehensive robustness evaluation for fraud detection model"""
        config = self.attack_configs["fraud_detection"]

        reports = {}

        # FGSM attack
        reports["fgsm"] = self.evaluate_robustness_fgsm(
            model, X_test, y_test, epsilon=config["epsilon"]
        )

        # PGD attack
        reports["pgd"] = self.evaluate_robustness_pgd(
            model, X_test, y_test,
            epsilon=config["epsilon"],
            max_iter=config["max_iter"]
        )

        return reports

    def evaluate_risk_scoring_robustness(
        self,
        model: Any,
        X_test: np.ndarray,
        y_test: np.ndarray,
    ) -> Dict[str, RobustnessReport]:
        """Comprehensive robustness evaluation for risk scoring model"""
        config = self.attack_configs["risk_scoring"]

        reports = {}

        # FGSM attack
        reports["fgsm"] = self.evaluate_robustness_fgsm(
            model, X_test, y_test, epsilon=config["epsilon"]
        )

        # PGD attack
        reports["pgd"] = self.evaluate_robustness_pgd(
            model, X_test, y_test,
            epsilon=config["epsilon"],
            max_iter=config["max_iter"]
        )

        return reports

    def generate_comprehensive_report(
        self,
        robustness_reports: Dict[str, RobustnessReport],
        defense_reports: List[DefenseReport],
    ) -> Dict[str, Any]:
        """Generate comprehensive security report"""

        # Calculate overall robustness score
        robustness_scores = [r.robustness_score for r in robustness_reports.values()]
        overall_robustness = np.mean(robustness_scores) if robustness_scores else 0

        # Calculate defense effectiveness
        defense_scores = [d.defense_effectiveness for d in defense_reports]
        overall_defense = np.mean(defense_scores) if defense_scores else 0

        # Risk assessment
        if overall_robustness < 0.5:
            risk_level = "CRITICAL"
        elif overall_robustness < 0.7:
            risk_level = "HIGH"
        elif overall_robustness < 0.85:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        any_simulated = (
            any(r.simulated for r in robustness_reports.values())
            or any(d.simulated for d in defense_reports)
        )

        report = {
            "summary": {
                "overall_robustness_score": overall_robustness,
                "overall_defense_effectiveness": overall_defense,
                "risk_level": risk_level,
                "models_evaluated": len(robustness_reports),
                "defenses_evaluated": len(defense_reports),
            },
            "robustness_evaluations": {
                name: {
                    "attack_type": r.attack_type,
                    "original_accuracy": r.original_accuracy,
                    "adversarial_accuracy": r.adversarial_accuracy,
                    "robustness_score": r.robustness_score,
                    "successful_attacks": r.successful_attacks,
                    "simulated": r.simulated,
                }
                for name, r in robustness_reports.items()
            },
            "defense_evaluations": [
                {
                    "defense_type": d.defense_type,
                    "effectiveness": d.defense_effectiveness,
                    "overhead_ms": d.overhead_ms,
                    "simulated": d.simulated,
                }
                for d in defense_reports
            ],
            "simulated": any_simulated,
            "recommendations": self._aggregate_recommendations(
                robustness_reports, defense_reports
            ),
            "timestamp": datetime.utcnow().isoformat(),
        }

        return report

    def _aggregate_recommendations(
        self,
        robustness_reports: Dict[str, RobustnessReport],
        defense_reports: List[DefenseReport],
    ) -> List[str]:
        """Aggregate and prioritize recommendations"""
        all_recommendations = []

        for report in robustness_reports.values():
            all_recommendations.extend(report.recommendations)

        for report in defense_reports:
            all_recommendations.extend(report.recommendations)

        # Deduplicate and prioritize
        unique_recommendations = list(set(all_recommendations))

        # Sort by priority (CRITICAL first)
        priority_order = {"CRITICAL": 0, "WARNING": 1}
        unique_recommendations.sort(
            key=lambda x: priority_order.get(x.split(":")[0], 2)
        )

        return unique_recommendations[:10]  # Top 10 recommendations


# Factory function
def create_robustness_service(
    epsilon: float = 0.1,
    max_iter: int = 100,
) -> AdversarialRobustnessService:
    """Create adversarial robustness service"""
    return AdversarialRobustnessService(epsilon=epsilon, max_iter=max_iter)


# Temporal Activity for robustness evaluation
async def robustness_evaluation_activity(
    model_path: str,
    X_test: List[List[float]],
    y_test: List[int],
    attack_types: List[str],
) -> Dict[str, Any]:
    """Temporal activity for adversarial robustness evaluation.

    Raises RuntimeError when ART is unavailable and ALLOW_SIMULATED_DATA is
    not set.
    """
    service = AdversarialRobustnessService()

    X = np.array(X_test)
    y = np.array(y_test)

    reports = {}

    if "fgsm" in attack_types:
        reports["fgsm"] = service.evaluate_robustness_fgsm(None, X, y)

    if "pgd" in attack_types:
        reports["pgd"] = service.evaluate_robustness_pgd(None, X, y)

    return {
        name: {
            "robustness_score": r.robustness_score,
            "adversarial_accuracy": r.adversarial_accuracy,
            "recommendations": r.recommendations,
            "simulated": r.simulated,
        }
        for name, r in reports.items()
    }
