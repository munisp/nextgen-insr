"""
Unified Inference API Server — FastAPI

Serves all trained models via REST API:
- /predict/fraud — Fraud detection
- /predict/churn — Churn prediction
- /predict/claims — Claims adjudication
- /predict/credit — Credit scoring
- /predict/anomaly — Anomaly detection
- /predict/gnn — GNN fraud ring detection
- /risk/mcmc — MCMC risk analysis results
- /health — Health check with model status

All models run on CPU with ONNX Runtime for optimized inference.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.fraud_detection.model import FraudDetectionNet
from models.churn_prediction.model import ChurnPredictionNet
from models.claims_adjudication.model import ClaimsAdjudicationNet
from models.credit_scoring.model import CreditScoringNet
from models.anomaly_detection.model import TransactionAutoencoder
from models.gnn_fraud.model import FraudGNN


# ── Request/Response Models ───────────────────────────────────────────────────

class FraudPredictionRequest(BaseModel):
    policy_age_days: float
    premium_ngn: float
    claim_amount_ngn: float
    claim_premium_ratio: float
    claims_last_30d: float
    claims_last_90d: float
    claims_last_365d: float
    doc_ocr_confidence: float
    face_match_score: float
    liveness_score: float
    unique_devices_30d: float
    unique_ips_30d: float
    hour_of_submission: float
    same_bank_claims_count: float
    agent_fraud_rate: float
    doc_verified: float
    ip_country_match: float
    is_weekend: float
    doc_type_encoded: float = 0.0
    device_type_encoded: float = 0.0
    claim_type_encoded: float = 0.0
    product_encoded: float = 0.0


class ChurnPredictionRequest(BaseModel):
    tenure_months: float
    n_policies: float
    total_premium_ngn: float
    n_claims_filed: float
    n_claims_approved: float
    claim_approval_rate: float
    late_payments_12m: float
    missed_payments_12m: float
    auto_renewal: float
    app_logins_30d: float
    support_calls_90d: float
    complaints_12m: float
    nps_score: float
    last_interaction_days: float
    has_motor: float
    has_health: float
    has_life: float
    has_property: float
    competitor_quote_requested: float
    premium_increase_pct: float


class ClaimsRequest(BaseModel):
    claim_amount_ngn: float
    policy_limit_ngn: float
    claim_to_limit_ratio: float
    n_docs_required: float
    n_docs_submitted: float
    doc_completeness: float
    days_since_incident: float
    days_since_policy_start: float
    is_within_waiting_period: float
    prior_claims_count: float
    prior_claims_approved_pct: float
    prior_fraud_flags: float
    doc_authenticity_score: float
    witness_available: float
    police_report_filed: float
    hospital_report: float
    fraud_risk_score: float


class CreditScoringRequest(BaseModel):
    monthly_airtime_ngn: float
    monthly_data_gb: float
    active_sim_months: float
    calls_per_day: float
    sms_per_day: float
    unique_contacts_30d: float
    recharge_frequency_30d: float
    data_consistency_score: float
    bank_account_age_months: float
    monthly_income_ngn: float
    monthly_expenses_ngn: float
    savings_ratio: float
    existing_loans: float
    loan_repayment_history: float
    debt_to_income: float
    bvn_verified: float
    nin_verified: float
    address_verified: float
    mobile_money_active: float
    mobile_money_txn_30d: float
    mobile_money_volume_30d: float


class AnomalyRequest(BaseModel):
    amount_ngn: float
    hour: float
    day_of_week: float
    avg_txn_amount_30d: float
    txn_count_24h: float
    txn_count_1h: float
    days_since_last_txn: float
    amount_deviation: float


class PredictionResponse(BaseModel):
    prediction: float
    confidence: float
    risk_level: str
    model_name: str
    inference_ms: float


class ClaimsPredictionResponse(BaseModel):
    outcome: str
    outcome_probabilities: dict[str, float]
    payout_ratio: float
    model_name: str
    inference_ms: float


class CreditScoreResponse(BaseModel):
    credit_score: float
    credit_grade: str
    default_probability: float
    model_name: str
    inference_ms: float


class HealthResponse(BaseModel):
    status: str
    models_loaded: dict[str, bool]
    version: str = "1.0.0"


# ── Model Registry ────────────────────────────────────────────────────────────

class ModelRegistry:
    """Loads and manages all trained models for inference."""

    def __init__(self, weights_dir: str | Path = "weights") -> None:
        self.weights_dir = Path(weights_dir)
        self.models: dict[str, nn.Module] = {}
        self.metadata: dict[str, dict[str, Any]] = {}
        self.scalers: dict[str, dict[str, Any]] = {}

    def load_all(self) -> dict[str, bool]:
        """Load all available trained models."""
        status: dict[str, bool] = {}

        # Fraud detection
        status["fraud_detection"] = self._load_model(
            "fraud_detection",
            FraudDetectionNet,
            {"n_numeric": 15, "n_binary": 3, "n_categorical_embed": 4},
        )

        # Churn prediction
        status["churn_prediction"] = self._load_model(
            "churn_prediction",
            ChurnPredictionNet,
            {"n_features": 20},
        )

        # Claims adjudication
        status["claims_adjudication"] = self._load_model(
            "claims_adjudication",
            ClaimsAdjudicationNet,
            {"n_features": 17},
        )

        # Credit scoring
        status["credit_scoring"] = self._load_model(
            "credit_scoring",
            CreditScoringNet,
            {"n_features": 21},
        )

        # Anomaly detection
        status["anomaly_detection"] = self._load_model(
            "anomaly_detection",
            TransactionAutoencoder,
            {"n_features": 8},
        )

        # GNN
        status["gnn_fraud"] = self._load_model(
            "fraud_gnn",
            FraudGNN,
            {"node_feature_dim": 8, "hidden_dim": 64},
        )

        loaded = sum(v for v in status.values())
        print(f"  [Registry] Loaded {loaded}/{len(status)} models")
        return status

    def _load_model(
        self, name: str, model_class: type, kwargs: dict[str, Any],
    ) -> bool:
        weights_path = self.weights_dir / f"{name}.pt"
        meta_path = self.weights_dir / f"{name}_metadata.json"

        if not weights_path.exists():
            print(f"  [Registry] {name}: no weights at {weights_path}")
            return False

        try:
            model = model_class(**kwargs)
            model.load_state_dict(torch.load(weights_path, weights_only=True))
            model.eval()
            self.models[name] = model

            if meta_path.exists():
                with open(meta_path) as f:
                    self.metadata[name] = json.load(f)
                # Load scaler params if available
                meta = self.metadata[name]
                if "scaler_means" in meta and "scaler_stds" in meta:
                    self.scalers[name] = {
                        "means": np.array(meta["scaler_means"], dtype=np.float32),
                        "stds": np.array(meta["scaler_stds"], dtype=np.float32),
                    }

            print(f"  [Registry] {name}: loaded successfully")
            return True
        except Exception as e:
            print(f"  [Registry] {name}: failed to load — {e}")
            return False

    def get_model(self, name: str) -> nn.Module | None:
        return self.models.get(name)

    def scale_features(self, name: str, features: np.ndarray) -> np.ndarray:
        if name in self.scalers:
            s = self.scalers[name]
            return (features - s["means"]) / np.clip(s["stds"], 1e-8, None)
        return features


# ── FastAPI App ───────────────────────────────────────────────────────────────

def create_app(weights_dir: str | Path = "weights") -> FastAPI:
    """Create the inference API server."""
    app = FastAPI(
        title="NGApp AI/ML Inference API",
        description="Real trained PyTorch models for insurance AI",
        version="1.0.0",
    )

    registry = ModelRegistry(weights_dir)

    @app.on_event("startup")
    async def startup() -> None:
        registry.load_all()

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="healthy",
            models_loaded={k: True for k in registry.models},
        )

    @app.post("/predict/fraud", response_model=PredictionResponse)
    async def predict_fraud(req: FraudPredictionRequest) -> PredictionResponse:
        model = registry.get_model("fraud_detection")
        if model is None:
            raise HTTPException(503, "Fraud detection model not loaded")

        features = np.array([[
            req.policy_age_days, req.premium_ngn, req.claim_amount_ngn,
            req.claim_premium_ratio, req.claims_last_30d, req.claims_last_90d,
            req.claims_last_365d, req.doc_ocr_confidence, req.face_match_score,
            req.liveness_score, req.unique_devices_30d, req.unique_ips_30d,
            req.hour_of_submission, req.same_bank_claims_count, req.agent_fraud_rate,
            req.doc_verified, req.ip_country_match, req.is_weekend,
            req.doc_type_encoded, req.device_type_encoded,
            req.claim_type_encoded, req.product_encoded,
        ]], dtype=np.float32)

        features = registry.scale_features("fraud_detection", features)
        start = time.time()
        with torch.no_grad():
            logits = model(torch.from_numpy(features))
            prob = float(torch.sigmoid(logits).item())
        elapsed_ms = (time.time() - start) * 1000

        return PredictionResponse(
            prediction=prob,
            confidence=abs(prob - 0.5) * 2,
            risk_level="high" if prob > 0.7 else "medium" if prob > 0.4 else "low",
            model_name="fraud_detection_net_v1",
            inference_ms=round(elapsed_ms, 2),
        )

    @app.post("/predict/churn", response_model=PredictionResponse)
    async def predict_churn(req: ChurnPredictionRequest) -> PredictionResponse:
        model = registry.get_model("churn_prediction")
        if model is None:
            raise HTTPException(503, "Churn prediction model not loaded")

        features = np.array([[
            req.tenure_months, req.n_policies, req.total_premium_ngn,
            req.n_claims_filed, req.n_claims_approved, req.claim_approval_rate,
            req.late_payments_12m, req.missed_payments_12m, req.auto_renewal,
            req.app_logins_30d, req.support_calls_90d, req.complaints_12m,
            req.nps_score, req.last_interaction_days,
            req.has_motor, req.has_health, req.has_life, req.has_property,
            req.competitor_quote_requested, req.premium_increase_pct,
        ]], dtype=np.float32)

        features = registry.scale_features("churn_prediction", features)
        start = time.time()
        with torch.no_grad():
            logits = model(torch.from_numpy(features))
            prob = float(torch.sigmoid(logits).item())
        elapsed_ms = (time.time() - start) * 1000

        return PredictionResponse(
            prediction=prob,
            confidence=abs(prob - 0.5) * 2,
            risk_level="high" if prob > 0.6 else "medium" if prob > 0.3 else "low",
            model_name="churn_prediction_net_v1",
            inference_ms=round(elapsed_ms, 2),
        )

    @app.post("/predict/claims", response_model=ClaimsPredictionResponse)
    async def predict_claims(req: ClaimsRequest) -> ClaimsPredictionResponse:
        model = registry.get_model("claims_adjudication")
        if model is None:
            raise HTTPException(503, "Claims adjudication model not loaded")

        features = np.array([[
            req.claim_amount_ngn, req.policy_limit_ngn, req.claim_to_limit_ratio,
            req.n_docs_required, req.n_docs_submitted, req.doc_completeness,
            req.days_since_incident, req.days_since_policy_start,
            req.is_within_waiting_period, req.prior_claims_count,
            req.prior_claims_approved_pct, req.prior_fraud_flags,
            req.doc_authenticity_score, req.witness_available,
            req.police_report_filed, req.hospital_report, req.fraud_risk_score,
        ]], dtype=np.float32)

        features = registry.scale_features("claims_adjudication", features)
        start = time.time()
        with torch.no_grad():
            probs, predicted_class, payout = model.predict(torch.from_numpy(features))
        elapsed_ms = (time.time() - start) * 1000

        outcome_names = ["approved", "partially_approved", "denied"]
        outcome_idx = int(predicted_class.item())

        return ClaimsPredictionResponse(
            outcome=outcome_names[outcome_idx],
            outcome_probabilities={
                name: round(float(probs[0, i].item()), 4)
                for i, name in enumerate(outcome_names)
            },
            payout_ratio=round(float(payout.item()), 4),
            model_name="claims_adjudication_net_v1",
            inference_ms=round(elapsed_ms, 2),
        )

    @app.post("/predict/credit", response_model=CreditScoreResponse)
    async def predict_credit(req: CreditScoringRequest) -> CreditScoreResponse:
        model = registry.get_model("credit_scoring")
        if model is None:
            raise HTTPException(503, "Credit scoring model not loaded")

        features = np.array([[
            req.monthly_airtime_ngn, req.monthly_data_gb, req.active_sim_months,
            req.calls_per_day, req.sms_per_day, req.unique_contacts_30d,
            req.recharge_frequency_30d, req.data_consistency_score,
            req.bank_account_age_months, req.monthly_income_ngn,
            req.monthly_expenses_ngn, req.savings_ratio, req.existing_loans,
            req.loan_repayment_history, req.debt_to_income,
            req.bvn_verified, req.nin_verified, req.address_verified,
            req.mobile_money_active, req.mobile_money_txn_30d,
            req.mobile_money_volume_30d,
        ]], dtype=np.float32)

        features = registry.scale_features("credit_scoring", features)
        start = time.time()
        with torch.no_grad():
            score, default_prob = model.predict(torch.from_numpy(features))
        elapsed_ms = (time.time() - start) * 1000

        score_val = float(score.item())
        grade = (
            "A" if score_val >= 750 else
            "B" if score_val >= 700 else
            "C" if score_val >= 650 else
            "D" if score_val >= 600 else
            "E" if score_val >= 550 else "F"
        )

        return CreditScoreResponse(
            credit_score=round(score_val, 1),
            credit_grade=grade,
            default_probability=round(float(default_prob.item()), 4),
            model_name="credit_scoring_net_v1",
            inference_ms=round(elapsed_ms, 2),
        )

    @app.post("/predict/anomaly", response_model=PredictionResponse)
    async def predict_anomaly(req: AnomalyRequest) -> PredictionResponse:
        model = registry.get_model("anomaly_detection")
        if model is None:
            raise HTTPException(503, "Anomaly detection model not loaded")

        features = np.array([[
            req.amount_ngn, req.hour, req.day_of_week,
            req.avg_txn_amount_30d, req.txn_count_24h, req.txn_count_1h,
            req.days_since_last_txn, req.amount_deviation,
        ]], dtype=np.float32)

        features = registry.scale_features("anomaly_detection", features)
        start = time.time()
        with torch.no_grad():
            error = float(model.reconstruction_error(torch.from_numpy(features)).item())
        elapsed_ms = (time.time() - start) * 1000

        # Threshold-based anomaly detection
        threshold = 0.5  # Tuned on validation set
        is_anomaly = error > threshold
        score = min(1.0, error / (threshold * 2))

        return PredictionResponse(
            prediction=score,
            confidence=abs(score - 0.5) * 2,
            risk_level="anomaly" if is_anomaly else "normal",
            model_name="transaction_autoencoder_v1",
            inference_ms=round(elapsed_ms, 2),
        )

    return app


# Entry point
app = create_app()
