"""Actuarial Data Platform — actuarial analysis, pricing models, reserving, and experience studies."""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ── Pydantic Models ───────────────────────────────────────────────────────────


class MortalityTableEntry(BaseModel):
    id: str
    name: str
    type: str
    gender: str
    age_range: List[int]
    sample_rates: Optional[dict] = None
    source: str


class MortalityTableResponse(BaseModel):
    tables: List[MortalityTableEntry]


class TriangleData(BaseModel):
    year: str
    values: List[float]


class LossTriangleResponse(BaseModel):
    product: str
    as_of: str
    method: str
    development_factors: List[float]
    triangle: dict
    ultimate_claims: dict
    ibnr_reserve: float


class RatingCategory(BaseModel):
    factor: str
    weight: float
    categories: dict


class RatingFactor(BaseModel):
    factor: str
    weight: float
    categories: dict


class PricingModel(BaseModel):
    product: str
    base_premium: float
    rating_factors: List[RatingFactor]
    expected_loss_ratio: float
    expense_ratio: float
    profit_margin: float
    commission_rate: Optional[float] = None


class ExperienceResult(BaseModel):
    product: str
    expected_claims_frequency: Optional[float] = None
    actual_claims_frequency: Optional[float] = None
    expected_mortality: Optional[float] = None
    actual_mortality: Optional[float] = None
    ae_ratio: float
    avg_claim_severity: float
    recommendation: str


class ExperienceStudyResponse(BaseModel):
    study_period: str
    products_analyzed: int
    results: List[ExperienceResult]


# ── Custom Exceptions ─────────────────────────────────────────────────────────


class ActuarialPlatformError(Exception):
    """Base exception for the actuarial platform."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class ProductNotFoundError(ActuarialPlatformError):
    """Raised when a requested product type is not found."""

    def __init__(self, product_type: str):
        super().__init__(
            f"Product type '{product_type}' not found", status_code=404
        )


# ── FastAPI App ───────────────────────────────────────────────────────────────


import os
import psycopg2
import psycopg2.extras
import logging

logger = logging.getLogger(__name__)

# ── Database Connection ──────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            _db_conn = psycopg2.connect(DATABASE_URL)
            _db_conn.autocommit = True
            logger.info(f"Connected to PostgreSQL for actuarial_platform")
        except Exception as e:
            logger.warning(f"Database connection failed: {e} (running in degraded mode)")
            return None
    return _db_conn

def init_db():
    conn = get_db()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS actuarial_platform (
                        id SERIAL PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        status VARCHAR(50) DEFAULT 'active',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        tenant_id INTEGER DEFAULT 1
                    )
                """)
            logger.info(f"Table actuarial_platform initialized")
        except Exception as e:
            logger.warning(f"Table creation failed: {e}")


@app.exception_handler(ActuarialPlatformError)
async def actuarial_error_handler(request, exc: ActuarialPlatformError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": str(exc), "detail": str(exc)},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request, exc: Exception):
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal server error", "detail": "An unexpected error occurred"},
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


MORTALITY_TABLES = [
    MortalityTableEntry(
        id="NGA-2020",
        name="Nigeria National Mortality Table 2020",
        type="period",
        gender="unisex",
        age_range=[0, 100],
        sample_rates={
            "20": 0.00120,
            "30": 0.00180,
            "40": 0.00350,
            "50": 0.00780,
            "60": 0.01650,
            "70": 0.03800,
        },
        source="National Bureau of Statistics / NAICOM",
    ),
    MortalityTableEntry(
        id="AFRI-STD-2023",
        name="Pan-African Standard Mortality Table 2023",
        type="select_and_ultimate",
        gender="separate",
        age_range=[15, 85],
        source="Pan-African Actuarial Association",
    ),
]

PRICING_MODELS = {
    "motor_tp": PricingModel(
        product="Motor Third Party",
        base_premium=15000,
        rating_factors=[
            RatingFactor(
                factor="vehicle_age",
                weight=0.15,
                categories={"0-3": 0.9, "4-7": 1.0, "8-12": 1.15, "13+": 1.3},
            ),
            RatingFactor(
                factor="driver_age",
                weight=0.20,
                categories={"18-25": 1.4, "26-35": 1.0, "36-50": 0.9, "51+": 1.1},
            ),
            RatingFactor(
                factor="state",
                weight=0.25,
                categories={"Lagos": 1.3, "Abuja": 1.2, "Rivers": 1.15, "other": 1.0},
            ),
            RatingFactor(
                factor="vehicle_type",
                weight=0.20,
                categories={"sedan": 1.0, "suv": 1.1, "truck": 1.3, "motorcycle": 1.5},
            ),
            RatingFactor(
                factor="claims_history",
                weight=0.20,
                categories={"0": 0.85, "1": 1.0, "2": 1.25, "3+": 1.5},
            ),
        ],
        expected_loss_ratio=0.62,
        expense_ratio=0.25,
        profit_margin=0.08,
        commission_rate=0.15,
    ),
    "hospital_cash": PricingModel(
        product="Hospital Cash",
        base_premium=500,
        rating_factors=[
            RatingFactor(
                factor="age",
                weight=0.40,
                categories={"18-30": 0.8, "31-45": 1.0, "46-60": 1.4, "61+": 2.0},
            ),
            RatingFactor(
                factor="gender",
                weight=0.15,
                categories={"M": 1.0, "F": 1.1},
            ),
            RatingFactor(
                factor="occupation_risk",
                weight=0.25,
                categories={"low": 0.9, "medium": 1.0, "high": 1.3},
            ),
        ],
        expected_loss_ratio=0.55,
        expense_ratio=0.20,
        profit_margin=0.10,
    ),
}

LOSS_TRIANGLE = {
    "product": "motor_third_party",
    "as_of": "2026-03-31",
    "method": "chain_ladder",
    "development_factors": [1.85, 1.35, 1.12, 1.05, 1.02, 1.01],
    "triangle": {
        "2021": [450000000, 832500000, 1123875000, 1258740000, 1321677000, 1348110540],
        "2022": [520000000, 962000000, 1298700000, 1454544000, 1527271200],
        "2023": [580000000, 1073000000, 1448550000, 1622376000],
        "2024": [650000000, 1202500000, 1623375000],
        "2025": [720000000, 1332000000],
        "2026": [380000000],
    },
    "ultimate_claims": {
        "2021": 1348110540,
        "2022": 1557816624,
        "2023": 1658724480,
        "2024": 1829974875,
        "2025": 2443308000,
        "2026": 1299870000,
    },
    "ibnr_reserve": 3250000000,
}

EXPERIENCE_STUDY = ExperienceStudyResponse(
    study_period="2023-2025",
    products_analyzed=5,
    results=[
        ExperienceResult(
            product="Motor TP",
            expected_claims_frequency=0.12,
            actual_claims_frequency=0.135,
            ae_ratio=1.125,
            avg_claim_severity=185000,
            recommendation="Increase base rate by 8% for Lagos, Rivers",
        ),
        ExperienceResult(
            product="Term Life",
            expected_mortality=0.0025,
            actual_mortality=0.0022,
            ae_ratio=0.88,
            avg_claim_severity=2500000,
            recommendation="Mortality experience favorable; consider premium reduction for preferred lives",
        ),
        ExperienceResult(
            product="Hospital Cash",
            expected_claims_frequency=0.08,
            actual_claims_frequency=0.095,
            ae_ratio=1.1875,
            avg_claim_severity=45000,
            recommendation="Review waiting period; consider increasing from 30 to 45 days",
        ),
    ],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "service": "actuarial-platform", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get(
    "/api/v1/actuarial/mortality-tables",
    response_model=MortalityTableResponse,
    summary="Get available mortality tables",
)
async def mortality_tables():
    """Retrieve available actuarial mortality tables."""
    return MortalityTableResponse(tables=MORTALITY_TABLES)


@app.get(
    "/api/v1/actuarial/loss-triangles",
    response_model=LossTriangleResponse,
    summary="Get loss triangle data",
)
async def loss_triangles():
    """Retrieve loss triangle data for IBNR calculation."""
    return LOSS_TRIANGLE


@app.get(
    "/api/v1/actuarial/pricing/{product_type}",
    summary="Get pricing model for a product type",
)
async def pricing_model(product_type: str):
    """Get the pricing model and rating factors for a specific product type.

    Args:
        product_type: The product type identifier (e.g., 'motor_tp', 'hospital_cash').
    """
    model = PRICING_MODELS.get(product_type)
    if model is None:
        available = list(PRICING_MODELS.keys())
        raise ProductNotFoundError(product_type)
    return model


@app.get(
    "/api/v1/actuarial/experience-study",
    response_model=ExperienceStudyResponse,
    summary="Get experience study results",
)
async def experience_study():
    """Retrieve actuarial experience study results."""
    return EXPERIENCE_STUDY


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8095, reload=False)
