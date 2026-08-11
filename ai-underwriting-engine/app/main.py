"""AI Underwriting Engine — rules-based underwriting with alternative data scoring.

HONESTY NOTE: this engine is a deterministic rules engine ("rules_engine_v1").
It does NOT run XGBoost/LightGBM models. Responses identify the engine by
name, confidence is a disclosed heuristic (not a model metric), and the
/models endpoint reports the real model registry state — empty until a
trained model registry is provided via UNDERWRITING_MODEL_REGISTRY.
"""

import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)


# ── Custom Exceptions ─────────────────────────────────────────────────────────


class UnderwritingError(Exception):
    """Base exception for underwriting engine errors."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class InvalidRequestError(UnderwritingError):
    """Raised when request validation fails."""

    def __init__(self, message: str):
        super().__init__(message, status_code=422)


class ModelUnavailableError(UnderwritingError):
    """Raised when the underwriting model is unavailable."""

    def __init__(self, model_id: str):
        super().__init__(f"Underwriting model '{model_id}' is unavailable", status_code=503)


# ── Pydantic Models ──────────────────────────────────────────────────────────


class UnderwritingRequest(BaseModel):
    """Request payload for underwriting decision."""

    product_id: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Product identifier",
    )
    applicant_name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Applicant full name",
    )
    phone: str = Field(
        ...,
        min_length=10,
        max_length=20,
        description="Phone number",
    )
    date_of_birth: Optional[str] = Field(
        None,
        description="Date of birth in YYYY-MM-DD format",
    )
    gender: Optional[str] = Field(None, description="M or F")
    occupation: Optional[str] = Field(None, max_length=100)
    income_declared: Optional[float] = Field(None, ge=0)
    location_state: Optional[str] = Field(None, max_length=100)
    location_lga: Optional[str] = Field(None, max_length=100)
    # Alternative data signals
    mobile_money_active: Optional[bool] = None
    airtime_spend_monthly: Optional[float] = Field(None, ge=0)
    smartphone_user: Optional[bool] = None
    social_media_active: Optional[bool] = None
    existing_policies: int = Field(0, ge=0)
    claims_history: int = Field(0, ge=0)
    credit_score: Optional[float] = Field(None, ge=300, le=850)

    @field_validator("date_of_birth")
    @classmethod
    def validate_date_of_birth(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        pattern = r"^\d{4}-\d{2}-\d{2}$"
        if not re.match(pattern, v):
            raise ValueError("date_of_birth must be in YYYY-MM-DD format")
        return v

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v.upper() not in ("M", "F"):
            raise ValueError("gender must be 'M' or 'F'")
        return v.upper()

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        cleaned = re.sub(r"[\s\-\(\)]", "", v)
        if len(cleaned) < 10 or len(cleaned) > 20:
            raise ValueError("phone number must be between 10 and 20 digits")
        if not re.match(r"^\+?\d+$", cleaned):
            raise ValueError("phone number must contain only digits and optional leading +")
        return cleaned


class UnderwritingDecision(BaseModel):
    """Underwriting decision response."""

    decision_id: str
    decision: str  # accept, decline, refer, accept_with_loading
    risk_score: float = Field(..., ge=0.0, le=1.0)
    risk_class: str  # preferred, standard, substandard, decline
    premium_loading: float = Field(..., ge=0.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    confidence_method: str = "heuristic_rules_coverage"
    model: str = "rules_engine_v1"
    factors: List[dict]
    alternative_data_used: bool
    processing_time_ms: int
    recommended_coverage: float
    max_coverage: float


class UnderwritingModelInfo(BaseModel):
    """Metadata about an underwriting model."""

    id: str
    product_type: str
    algorithm: str
    accuracy: float
    features: int
    last_trained: str
    alternative_data_features: int


class ModelListResponse(BaseModel):
    """Response containing a list of underwriting models."""

    models: List[UnderwritingModelInfo]
    note: str = (
        "Decisions are currently produced by rules_engine_v1 (deterministic "
        "rules, no trained ML model). Models listed here come from the real "
        "model registry; it is empty until trained models are registered."
    )


class ErrorResponse(BaseModel):
    """Standard error response."""

    error: str
    detail: Optional[str] = None


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="AI Underwriting Engine",
    description=(
        "Rules-based underwriting (rules_engine_v1) with alternative data "
        "scoring for thin-file customers. No trained ML model is currently "
        "deployed; /api/v1/underwrite/models reflects the real registry."
    ),
    version="1.0.0",
)


@app.exception_handler(InvalidRequestError)
async def invalid_request_handler(request: Request, exc: InvalidRequestError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.args[0]},
    )


@app.exception_handler(ModelUnavailableError)
async def model_unavailable_handler(request: Request, exc: ModelUnavailableError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.args[0]},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception in %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "internal server error", "detail": "An unexpected error occurred"},
    )


# ── Model Registry (real state — no fabricated entries) ──────────────────────

MODEL_REGISTRY_FILE = os.environ.get("UNDERWRITING_MODEL_REGISTRY", "").strip()


def _load_model_registry() -> List[UnderwritingModelInfo]:
    """Load the real underwriting model registry.

    Reads a JSON file ({"models": [...]} or a bare list) from the path in
    UNDERWRITING_MODEL_REGISTRY. Returns an empty list when no registry is
    configured — fabricated model metadata has been removed.
    """
    if not MODEL_REGISTRY_FILE:
        return []
    path = Path(MODEL_REGISTRY_FILE)
    if not path.exists():
        logger.warning("Model registry file not found: %s", MODEL_REGISTRY_FILE)
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = data.get("models", []) if isinstance(data, dict) else data
        return [UnderwritingModelInfo(**entry) for entry in entries]
    except Exception as exc:
        logger.error("Failed to parse model registry %s: %s", MODEL_REGISTRY_FILE, exc)
        return []


# ── Underwriting Logic (rules_engine_v1) ──────────────────────────────────────

HIGH_RISK_STATES = ["Borno", "Yobe", "Adamawa", "Zamfara"]

HIGH_RISK_OCCUPATIONS = ["okada_rider", "truck_driver", "miner"]


def _score_risk(request: UnderwritingRequest) -> tuple[float, List[dict], bool]:
    """Compute a risk score from 0.0 (lowest risk) to 1.0 (highest risk).

    Deterministic additive rules (rules_engine_v1) — disclosed, not an ML model.

    Returns:
        Tuple of (risk_score, factors_list, alternative_data_used).
    """
    risk_score = 0.5
    factors: List[dict] = []
    alt_data_used = False

    # Traditional signals
    if request.claims_history > 2:
        risk_score += 0.15
        factors.append(
            {
                "factor": "claims_history",
                "impact": "+0.15",
                "detail": f"{request.claims_history} prior claims",
            }
        )

    if request.existing_policies > 0:
        risk_score -= 0.05
        factors.append(
            {
                "factor": "existing_customer",
                "impact": "-0.05",
                "detail": "Loyalty discount",
            }
        )

    if request.credit_score is not None:
        if request.credit_score > 700:
            risk_score -= 0.1
            factors.append(
                {
                    "factor": "credit_score",
                    "impact": "-0.10",
                    "detail": f"Good credit: {request.credit_score}",
                }
            )
        elif request.credit_score < 500:
            risk_score += 0.1
            factors.append(
                {
                    "factor": "credit_score",
                    "impact": "+0.10",
                    "detail": f"Poor credit: {request.credit_score}",
                }
            )

    # Alternative data signals
    if request.mobile_money_active is not None:
        alt_data_used = True
        if request.mobile_money_active:
            risk_score -= 0.08
            factors.append(
                {
                    "factor": "mobile_money_active",
                    "impact": "-0.08",
                    "detail": "Active mobile money user indicates financial engagement",
                }
            )

    if request.airtime_spend_monthly is not None:
        alt_data_used = True
        if request.airtime_spend_monthly > 5000:
            risk_score -= 0.05
            factors.append(
                {
                    "factor": "airtime_spend",
                    "impact": "-0.05",
                    "detail": f"Monthly airtime N{request.airtime_spend_monthly:,.0f} indicates stable income",
                }
            )

    if request.smartphone_user is not None:
        alt_data_used = True
        if request.smartphone_user:
            risk_score -= 0.03
            factors.append(
                {
                    "factor": "smartphone_user",
                    "impact": "-0.03",
                    "detail": "Smartphone ownership correlates with lower risk",
                }
            )

    # Location risk
    if request.location_state and request.location_state in HIGH_RISK_STATES:
        risk_score += 0.10
        factors.append(
            {
                "factor": "location_risk",
                "impact": "+0.10",
                "detail": f"High-risk state: {request.location_state}",
            }
        )

    # Occupation risk
    if request.occupation and request.occupation.lower() in HIGH_RISK_OCCUPATIONS:
        risk_score += 0.08
        factors.append(
            {
                "factor": "occupation",
                "impact": "+0.08",
                "detail": f"Higher-risk occupation: {request.occupation}",
            }
        )

    # Clamp
    risk_score = max(0.0, min(1.0, risk_score))

    return round(risk_score, 3), factors, alt_data_used


def _decision_from_score(risk_score: float) -> tuple[str, str, float]:
    """Map a risk score to decision, risk class, and loading percentage."""
    if risk_score <= 0.3:
        return "accept", "preferred", 0.0
    elif risk_score <= 0.5:
        return "accept", "standard", 0.0
    elif risk_score <= 0.7:
        loading = (risk_score - 0.5) * 100
        return "accept_with_loading", "substandard", loading
    else:
        return "refer", "substandard", 25.0


def _heuristic_confidence(factors: List[dict], alt_data_used: bool) -> float:
    """Disclosed heuristic confidence for rules_engine_v1.

    NOT a model-calibrated probability. It reflects how much information the
    rules engine had to work with: a 0.55 base, +0.05 per contributing rule
    factor, +0.10 when alternative data was available, capped at 0.90.
    """
    confidence = 0.55 + 0.05 * len(factors) + (0.10 if alt_data_used else 0.0)
    return round(min(confidence, 0.90), 3)


def _coverage_guidance(request: UnderwritingRequest) -> tuple[float, float]:
    """Disclosed heuristic coverage guidance.

    When income is declared: recommended = 5x annual income, max = 10x.
    Otherwise product-line defaults of N1,000,000 / N5,000,000 are used.
    """
    if request.income_declared and request.income_declared > 0:
        recommended = request.income_declared * 5
        max_coverage = request.income_declared * 10
        return float(recommended), float(max_coverage)
    return 1000000.0, 5000000.0


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.post(
    "/api/v1/underwrite",
    response_model=UnderwritingDecision,
    summary="Submit an underwriting request",
    responses={
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def underwrite(request: UnderwritingRequest):
    """Rules-based underwriting decision (rules_engine_v1).

    Evaluates the applicant using a deterministic, disclosed set of rules
    over traditional credit signals and alternative data (mobile money,
    airtime spend, etc.). This is NOT an ML model; the confidence value is a
    disclosed heuristic (see confidence_method).
    """
    start_time = time.monotonic()

    try:
        risk_score, factors, alt_data_used = _score_risk(request)
        decision, risk_class, loading = _decision_from_score(risk_score)
        confidence = _heuristic_confidence(factors, alt_data_used)
        recommended_coverage, max_coverage = _coverage_guidance(request)
    except Exception as exc:
        logger.exception("Underwriting scoring failed for applicant %s", request.applicant_name)
        raise ModelUnavailableError("rules_engine_v1") from exc

    processing_ms = int((time.monotonic() - start_time) * 1000)

    return UnderwritingDecision(
        decision_id=f"UW-{uuid.uuid4().hex[:8].upper()}",
        decision=decision,
        risk_score=risk_score,
        risk_class=risk_class,
        premium_loading=round(loading, 1),
        confidence=confidence,
        confidence_method="heuristic_rules_coverage",
        model="rules_engine_v1",
        factors=factors,
        alternative_data_used=alt_data_used,
        processing_time_ms=processing_ms,
        recommended_coverage=recommended_coverage,
        max_coverage=max_coverage,
    )


@app.get(
    "/api/v1/underwrite/models",
    response_model=ModelListResponse,
    summary="List registered underwriting models",
)
async def list_models():
    """Retrieve the real underwriting model registry.

    Empty until trained models are registered via the registry file pointed
    to by UNDERWRITING_MODEL_REGISTRY. Fabricated model entries have been
    removed.
    """
    return ModelListResponse(models=_load_model_registry())


@app.get("/health", summary="Health check")
async def health():
    """Liveness / readiness probe."""
    return {
        "status": "healthy",
        "service": "ai-underwriting-engine",
        "engine": "rules_engine_v1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=False)
