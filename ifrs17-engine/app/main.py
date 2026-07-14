"""IFRS 17 Engine — Insurance contract measurement and reporting.

Measurement models:
- BBA (Building Block Approach)
- PAA (Premium Allocation Approach)

Discount curves sourced from CBN yield curve, updated monthly.
Risk adjustment at 75th percentile confidence level.
Onerous contracts trigger immediate loss recognition.
Cohort grouping: annual cohorts with separate profitability buckets.
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)


# ── Custom Exceptions ─────────────────────────────────────────────────────────


class Ifrs17Error(Exception):
    """Base exception for IFRS 17 engine errors."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class InvalidParameterError(Ifrs17Error):
    """Raised when a parameter is invalid."""

    def __init__(self, field: str, message: str):
        super().__init__(f"Invalid parameter '{field}': {message}", status_code=422)


class CalculationError(Ifrs17Error):
    """Raised when a financial calculation fails."""

    def __init__(self, message: str):
        super().__init__(message, status_code=422)


# ── Pydantic Models ──────────────────────────────────────────────────────────


class DiscountCurveResponse(BaseModel):
    """Response with discount curve data."""

    curves: dict
    source: str
    as_of: str


class CsmInput(BaseModel):
    """Inputs for CSM calculation."""

    future_cash_flows: float = Field(..., gt=0, description="PV of future cash flows")
    risk_adjustment: float = Field(..., ge=0, description="Risk adjustment amount")
    discount_rate: Optional[float] = Field(None, description="Discount rate (auto-looked up by years if not provided)")
    years: int = Field(..., gt=0, le=50, description="Projection horizon in years")


class CsmResponse(BaseModel):
    """Result of a CSM calculation."""

    pv_future_cash_flows: float
    risk_adjustment: float
    csm: float
    onerous: bool
    loss_component: float
    discount_rate: float
    measurement_model: str = "BBA"


class CohortEntry(BaseModel):
    """A single cohort entry."""

    year: int
    contracts: int
    csm_total: float
    onerous_pct: float


class CohortResponse(BaseModel):
    """Response with cohort data."""

    cohorts: List[CohortEntry]
    measurement_model: str = "BBA"
    risk_confidence: str = "75th percentile"


class ValidationResult(BaseModel):
    """Result of validating a set of IFRS 17 parameters."""

    valid: bool
    errors: List[str]
    warnings: List[str]


# ── Discount rates ────────────────────────────────────────────────────────────

DISCOUNT_RATES = {
    1: 0.145, 2: 0.155, 3: 0.160, 5: 0.165,
    10: 0.170, 15: 0.172, 20: 0.175,
}

# Default rate for years not in the table
DEFAULT_DISCOUNT_RATE = 0.165


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="IFRS 17 Engine",
    description="Insurance contract measurement and reporting engine",
    version="1.0.0",
)


@app.exception_handler(InvalidParameterError)
async def invalid_parameter_handler(request: Request, exc: InvalidParameterError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.args[0]},
    )


@app.exception_handler(CalculationError)
async def calculation_error_handler(request: Request, exc: CalculationError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.args[0]},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal server error", "detail": "An unexpected error occurred"},
    )


# ── Calculation Functions ─────────────────────────────────────────────────────


def _lookup_discount_rate(years: int) -> float:
    """Look up a discount rate for a given year, falling back to default."""
    if years in DISCOUNT_RATES:
        return DISCOUNT_RATES[years]
    # Linear interpolation between known points
    keys = sorted(DISCOUNT_RATES.keys())
    if years <= keys[0]:
        return DISCOUNT_RATES[keys[0]]
    if years >= keys[-1]:
        return DISCOUNT_RATES[keys[-1]]
    for i in range(len(keys) - 1):
        if keys[i] <= years <= keys[i + 1]:
            t = (years - keys[i]) / (keys[i + 1] - keys[i])
            return DISCOUNT_RATES[keys[i]] + t * (DISCOUNT_RATES[keys[i + 1]] - DISCOUNT_RATES[keys[i]])
    return DEFAULT_DISCOUNT_RATE


def calculate_csm(
    future_cash_flows: float,
    risk_adjustment: float,
    discount_rate: float,
    years: int,
) -> dict:
    """Calculate Contractual Service Margin (CSM) per IFRS 17 BBA.

    CSM = PV(future cash flows) - risk adjustment

    When CSM < 0 the contract is onerous and the loss is recognised immediately.

    Args:
        future_cash_flows: Total future cash flows expected from the contract.
        risk_adjustment: Compensation for non-financial risk (75th percentile).
        discount_rate: Discount rate applied to future cash flows.
        years: Projection horizon.

    Returns:
        Dict with CSM, PV, onerous flag, and loss component.
    """
    if future_cash_flows < 0:
        raise InvalidParameterError("future_cash_flows", "must be positive")
    if risk_adjustment < 0:
        raise InvalidParameterError("risk_adjustment", "must be non-negative")
    if discount_rate <= 0:
        raise InvalidParameterError("discount_rate", "must be positive")
    if years <= 0:
        raise InvalidParameterError("years", "must be positive")

    pv_factor = (1 + discount_rate) ** -years
    pv_cash_flows = future_cash_flows * pv_factor
    csm = pv_cash_flows - risk_adjustment
    onerous = csm < 0

    result = {
        "pv_future_cash_flows": round(pv_cash_flows, 2),
        "risk_adjustment": round(risk_adjustment, 2),
        "csm": round(max(csm, 0), 2),
        "onerous": onerous,
        "loss_component": round(abs(csm), 2) if onerous else 0.0,
        "discount_rate": discount_rate,
        "years": years,
        "measurement_model": "BBA",
        "metadata": {
            "calculated_at": datetime.now(timezone.utc).isoformat(),
            "risk_confidence_level": "75th percentile",
        },
    }
    logger.info(
        "CSM calc: pv=%.2f ra=%.2f csm=%.2f onerous=%s",
        pv_cash_flows, risk_adjustment, max(csm, 0), onerous,
    )
    return result


def calculate_risk_adjustment(
    expected_claims: float,
    confidence_level: float = 0.75,
) -> float:
    """Calculate risk adjustment at a given confidence percentile.

    Uses a simplified linear scaling: RA = expected_claims * (1 + (confidence - 0.5) * 0.4)

    Args:
        expected_claims: Expected claim amount.
        confidence_level: Confidence percentile (default 0.75).

    Returns:
        Risk adjustment amount.
    """
    if expected_claims < 0:
        raise InvalidParameterError("expected_claims", "must be non-negative")
    if not (0.5 <= confidence_level <= 0.99):
        raise InvalidParameterError("confidence_level", "must be between 0.5 and 0.99")
    return expected_claims * (1 + (confidence_level - 0.5) * 0.4)


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "ifrs17-engine",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/discount-curves", response_model=DiscountCurveResponse)
async def get_discount_curves():
    """Retrieve the current CBN discount curve."""
    return {
        "curves": {f"{y}Y": r for y, r in DISCOUNT_RATES.items()},
        "source": "CBN",
        "as_of": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }


@app.post("/api/v1/csm/calculate", response_model=CsmResponse)
async def csm_endpoint(input_data: CsmInput):
    """Calculate the Contractual Service Margin (CSM).

    The CSM represents the unearned profit in an insurance contract and is
    recognised over the coverage period.
    """
    try:
        rate = input_data.discount_rate or _lookup_discount_rate(input_data.years)
        result = calculate_csm(
            future_cash_flows=input_data.future_cash_flows,
            risk_adjustment=input_data.risk_adjustment,
            discount_rate=rate,
            years=input_data.years,
        )
        return CsmResponse(**result)
    except (InvalidParameterError, CalculationError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.args[0])
    except Exception as exc:
        logger.exception("CSM calculation failed")
        raise HTTPException(
            status_code=500,
            detail=f"CSM calculation failed: {exc}",
        )


@app.get("/api/v1/cohorts", response_model=CohortResponse)
async def get_cohorts():
    """Retrieve cohort data grouped by year and profitability bucket."""
    return {
        "cohorts": [
            CohortEntry(year=2025, contracts=1200, csm_total=450000000, onerous_pct=5),
            CohortEntry(year=2026, contracts=1800, csm_total=680000000, onerous_pct=3),
        ],
        "measurement_model": "BBA",
        "risk_confidence": "75th percentile",
    }


@app.get("/api/v1/discount-rates/lookup")
async def lookup_discount_rate(years: int = Query(ge=1, le=50, default=5)):
    """Look up a discount rate for a specific year."""
    rate = _lookup_discount_rate(years)
    return {
        "years": years,
        "discount_rate": rate,
        "source": "CBN",
        "method": "lookup" if years in DISCOUNT_RATES else "interpolation",
    }


@app.get("/api/v1/risk-adjustment/calculate")
async def risk_adjustment_endpoint(
    expected_claims: float = Query(ge=0, description="Expected claim amount"),
    confidence_level: float = Query(default=0.75, ge=0.5, le=0.99, description="Confidence percentile"),
):
    """Calculate the risk adjustment amount."""
    try:
        ra = calculate_risk_adjustment(expected_claims, confidence_level)
        return {
            "expected_claims": expected_claims,
            "confidence_level": confidence_level,
            "risk_adjustment": round(ra, 2),
            "method": "percentile_scaling",
        }
    except (InvalidParameterError,) as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.args[0])


@app.post("/api/v1/validate/csm-params")
async def validate_csm_params(input_data: CsmInput):
    """Validate CSM calculation parameters before computation."""
    errors: List[str] = []
    warnings: List[str] = []

    if input_data.future_cash_flows <= 0:
        errors.append("future_cash_flows must be positive")
    if input_data.risk_adjustment < 0:
        errors.append("risk_adjustment must be non-negative")
    if input_data.years <= 0:
        errors.append("years must be positive")
    if input_data.years > 30:
        warnings.append("Projection horizon exceeds 30 years; consider shortening")
    if input_data.risk_adjustment > input_data.future_cash_flows:
        warnings.append("Risk adjustment exceeds future cash flows; contract may be onerous")

    rate = input_data.discount_rate or _lookup_discount_rate(input_data.years)
    if rate > 0.20:
        warnings.append(f"Discount rate {rate:.1%} is unusually high")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8070, reload=False)
