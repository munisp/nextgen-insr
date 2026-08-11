"""Actuarial Data Platform — actuarial analysis, pricing models, reserving, and experience studies.

Loss triangles, chain-ladder IBNR, and experience studies are computed from a
real claims data source:
  1. PostgreSQL claims table (via DATABASE_URL; table name from
     ACTUARIAL_CLAIMS_TABLE, default "claims"), or
  2. a JSON data file at ACTUARIAL_CLAIMS_FILE / ACTUARIAL_EXPERIENCE_FILE.

When no data source is configured the reserving/experience endpoints return
HTTP 503 instead of serving canned numbers. Mortality tables are explicitly
labelled as illustrative/reference rates, not official published tables.
"""

import csv
import json
import logging
import os
from datetime import datetime, timezone
from typing import List, Optional

import psycopg2
import psycopg2.extras
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
    status: str = "illustrative_reference"
    official: bool = False


class MortalityTableResponse(BaseModel):
    tables: List[MortalityTableEntry]
    disclaimer: str = (
        "These tables are illustrative/reference rates for demonstration and "
        "calibration only. They are NOT official published mortality tables and "
        "must not be used for statutory valuation or pricing filings."
    )


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
    data_source: str


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
    data_source: str


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


class DataSourceUnavailableError(ActuarialPlatformError):
    """Raised when no claims/experience data source is configured."""

    def __init__(self, what: str):
        super().__init__(
            f"{what} unavailable: no data source configured. Set "
            f"ACTUARIAL_CLAIMS_FILE/ACTUARIAL_EXPERIENCE_FILE or provide a "
            f"reachable PostgreSQL claims table via DATABASE_URL.",
            status_code=503,
        )


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


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Actuarial Data Platform",
    description=(
        "Actuarial analysis, reserving, and experience studies computed from "
        "real claims data. Reserving endpoints fail closed (503) when no data "
        "source is configured."
    ),
    version="1.0.0",
)


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


# ── Claims Data Loading ──────────────────────────────────────────────────────

CLAIMS_FILE = os.environ.get("ACTUARIAL_CLAIMS_FILE", "").strip()
CLAIMS_TABLE = os.environ.get("ACTUARIAL_CLAIMS_TABLE", "claims").strip()
EXPERIENCE_FILE = os.environ.get("ACTUARIAL_EXPERIENCE_FILE", "").strip()


def _load_triangle_rows_from_db() -> tuple[list, str]:
    """Load cumulative paid-claim cells from PostgreSQL.

    Expects a claims table with columns: accident_year, development_period,
    paid_amount (incremental). Cells are aggregated per (year, period).
    Returns ([{accident_year, development_period, amount}], source).
    """
    conn = get_db()
    if not conn:
        return [], ""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT accident_year, development_period,
                       SUM(paid_amount) AS amount
                FROM {CLAIMS_TABLE}
                GROUP BY accident_year, development_period
                ORDER BY accident_year, development_period
                """
            )
            rows = [dict(r) for r in cur.fetchall()]
        return rows, f"postgres:{CLAIMS_TABLE}"
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.info(f"claims table '{CLAIMS_TABLE}' not usable: {e}")
        return [], ""


def _load_triangle_rows_from_file() -> tuple[list, str]:
    """Load claim cells from a JSON file.

    Accepted shapes:
      {"claims": [{"accident_year": 2023, "development_period": 0, "amount": 123.0}, ...]}
      {"triangle": {"2021": [c0, c1, ...], "2022": [...]}}  (cumulative rows)
    """
    if not CLAIMS_FILE or not os.path.exists(CLAIMS_FILE):
        return [], ""
    with open(CLAIMS_FILE, encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "triangle" in data:
        rows = []
        for year, values in data["triangle"].items():
            prev = 0.0
            for dev, cum in enumerate(values):
                rows.append({
                    "accident_year": str(year),
                    "development_period": dev,
                    "amount": float(cum) - prev,
                    "cumulative": float(cum),
                })
                prev = float(cum)
        return rows, f"file:{CLAIMS_FILE}"

    claims = data.get("claims", data if isinstance(data, list) else [])
    rows = [
        {
            "accident_year": str(c["accident_year"]),
            "development_period": int(c["development_period"]),
            "amount": float(c.get("amount", c.get("paid_amount", 0.0))),
        }
        for c in claims
    ]
    return rows, f"file:{CLAIMS_FILE}"


def _build_cumulative_triangle() -> tuple[dict, str]:
    """Build a cumulative loss triangle {year_label: [cum_paid_dev0, ...]}.

    Raises DataSourceUnavailableError (503) when no source yields data.
    """
    rows, source = _load_triangle_rows_from_file()
    if not rows:
        rows, source = _load_triangle_rows_from_db()
    if not rows:
        raise DataSourceUnavailableError("loss triangle")

    # Aggregate incremental amounts per (year, dev)
    cells: dict = {}
    for r in rows:
        if "cumulative" in r:
            cells[(r["accident_year"], r["development_period"])] = r["cumulative"]
        else:
            key = (r["accident_year"], r["development_period"])
            cells[key] = cells.get(key, 0.0) + float(r["amount"])

    years = sorted({k[0] for k in cells})
    max_dev = max(k[1] for k in cells)

    triangle: dict = {}
    for year in years:
        cumulative = []
        running = 0.0
        is_cumulative_input = any(
            "cumulative" in r for r in rows if r["accident_year"] == year
        )
        for dev in range(max_dev + 1):
            key = (year, dev)
            if key not in cells:
                break
            if is_cumulative_input:
                running = cells[key]
            else:
                running += cells[key]
            cumulative.append(round(running, 2))
        if cumulative:
            triangle[year] = cumulative

    if len(triangle) < 2:
        raise DataSourceUnavailableError(
            "loss triangle (fewer than 2 accident years of claims data)"
        )
    return triangle, source


# ── Chain-Ladder Reserving (adapted from actuarial-module/main.py) ───────────


def _chain_ladder(triangle: dict) -> dict:
    """Volume-weighted chain-ladder on a cumulative triangle.

    Returns development factors, per-year ultimate claims, per-year IBNR,
    and total IBNR reserve. All values are computed from the input triangle.
    """
    rows = [triangle[y] for y in sorted(triangle)]
    labels = sorted(triangle)
    num_cols = max(len(r) for r in rows)
    if num_cols < 2:
        raise ActuarialPlatformError(
            "chain-ladder requires at least 2 development periods", status_code=422
        )

    # Volume-weighted age-to-age factors
    dev_factors: list[float] = []
    for col in range(num_cols - 1):
        sum_next = 0.0
        sum_curr = 0.0
        for row in rows:
            if col + 1 < len(row):
                sum_next += row[col + 1]
                sum_curr += row[col]
        if sum_curr > 0:
            dev_factors.append(round(sum_next / sum_curr, 6))
        else:
            dev_factors.append(1.0)
            logger.warning("chain-ladder: zero base for dev period %d, using 1.0", col)

    # Tail factor = 1.0 (no tail extrapolation without additional data)
    cumulative_to_ultimate = []
    for i in range(num_cols):
        cdf = 1.0
        for f in dev_factors[i:]:
            cdf *= f
        cumulative_to_ultimate.append(cdf)

    ultimate_claims: dict = {}
    ibnr_by_year: dict = {}
    total_ibnr = 0.0
    for label, row in zip(labels, rows):
        latest = row[-1]
        cdf = cumulative_to_ultimate[len(row) - 1]
        ultimate = latest * cdf
        ibnr = max(ultimate - latest, 0.0)
        ultimate_claims[label] = round(ultimate, 2)
        ibnr_by_year[label] = round(ibnr, 2)
        total_ibnr += ibnr

    return {
        "development_factors": dev_factors,
        "ultimate_claims": ultimate_claims,
        "ibnr_by_year": ibnr_by_year,
        "total_ibnr": round(total_ibnr, 2),
        "as_of": max(labels),
    }


def _ae_recommendation(product: str, ae_ratio: float, kind: str) -> str:
    """Rule-based (disclosed) recommendation from the A/E ratio."""
    metric = "mortality" if kind == "mortality" else "claim frequency"
    if ae_ratio > 1.15:
        return (
            f"A/E {metric} ratio {ae_ratio:.3f} significantly above 1.0 for {product}: "
            f"review pricing assumptions and consider rate increases."
        )
    if ae_ratio > 1.05:
        return (
            f"A/E {metric} ratio {ae_ratio:.3f} moderately above 1.0 for {product}: "
            f"monitor experience and validate assumptions at next review."
        )
    if ae_ratio < 0.85:
        return (
            f"A/E {metric} ratio {ae_ratio:.3f} well below 1.0 for {product}: "
            f"experience is favourable; consider premium relief or profit review."
        )
    return (
        f"A/E {metric} ratio {ae_ratio:.3f} within tolerance for {product}: "
        f"no pricing action indicated."
    )


def _compute_experience_study() -> ExperienceStudyResponse:
    """Compute an experience study from a configured data source.

    Data file shape (ACTUARIAL_EXPERIENCE_FILE):
      {"study_period": "2023-2025",
       "products": [{"product": "Motor TP",
                     "expected_claims_frequency": 0.12,
                     "actual_claims_frequency": 0.135,
                     "avg_claim_severity": 185000}, ...]}
    A/E ratios and recommendations are computed here, not stored.
    """
    if EXPERIENCE_FILE and os.path.exists(EXPERIENCE_FILE):
        with open(EXPERIENCE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        source = f"file:{EXPERIENCE_FILE}"
    else:
        conn = get_db()
        if not conn:
            raise DataSourceUnavailableError("experience study")
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT product,
                           expected_claims_frequency, actual_claims_frequency,
                           expected_mortality, actual_mortality,
                           avg_claim_severity
                    FROM actuarial_experience
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            logger.info(f"actuarial_experience table not usable: {e}")
            raise DataSourceUnavailableError("experience study")
        if not rows:
            raise DataSourceUnavailableError("experience study")
        data = {"study_period": "from database", "products": rows}
        source = "postgres:actuarial_experience"

    results: List[ExperienceResult] = []
    for p in data.get("products", []):
        exp_freq = p.get("expected_claims_frequency")
        act_freq = p.get("actual_claims_frequency")
        exp_mort = p.get("expected_mortality")
        act_mort = p.get("actual_mortality")

        if exp_mort is not None and act_mort is not None and exp_mort:
            ae_ratio = act_mort / exp_mort
            kind = "mortality"
        elif exp_freq is not None and act_freq is not None and exp_freq:
            ae_ratio = act_freq / exp_freq
            kind = "frequency"
        else:
            logger.warning(
                "experience study: skipping product %r — insufficient expected/actual data",
                p.get("product"),
            )
            continue

        results.append(ExperienceResult(
            product=p.get("product", "unknown"),
            expected_claims_frequency=exp_freq,
            actual_claims_frequency=act_freq,
            expected_mortality=exp_mort,
            actual_mortality=act_mort,
            ae_ratio=round(ae_ratio, 4),
            avg_claim_severity=float(p.get("avg_claim_severity", 0.0)),
            recommendation=_ae_recommendation(p.get("product", "unknown"), ae_ratio, kind),
        ))

    if not results:
        raise DataSourceUnavailableError("experience study (no usable product records)")

    return ExperienceStudyResponse(
        study_period=str(data.get("study_period", "unspecified")),
        products_analyzed=len(results),
        results=results,
        data_source=source,
    )


# ── Reference Data ───────────────────────────────────────────────────────────

# NOTE: These are ILLUSTRATIVE reference rates for demonstration/calibration,
# not official published mortality tables.
MORTALITY_TABLES = [
    MortalityTableEntry(
        id="ILLUSTRATIVE-NGA-2020",
        name="Illustrative Nigerian Mortality Reference 2020 (not an official table)",
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
        source="Illustrative reference rates — NOT published by NBS/NAICOM",
        status="illustrative_reference",
        official=False,
    ),
    MortalityTableEntry(
        id="ILLUSTRATIVE-AFRI-STD-2023",
        name="Illustrative Pan-African Mortality Reference 2023 (not an official table)",
        type="select_and_ultimate",
        gender="separate",
        age_range=[15, 85],
        source="Illustrative reference rates — NOT an official published table",
        status="illustrative_reference",
        official=False,
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


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "service": "actuarial-platform", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get(
    "/api/v1/actuarial/mortality-tables",
    response_model=MortalityTableResponse,
    summary="Get available mortality tables (illustrative reference rates)",
)
async def mortality_tables():
    """Retrieve actuarial mortality reference tables.

    All served tables are labelled illustrative/reference; none are presented
    as official published tables.
    """
    return MortalityTableResponse(tables=MORTALITY_TABLES)


@app.get(
    "/api/v1/actuarial/loss-triangles",
    response_model=LossTriangleResponse,
    summary="Get loss triangle data and chain-ladder IBNR",
)
async def loss_triangles():
    """Compute the cumulative loss triangle and chain-ladder IBNR reserve
    from the configured claims data source. Returns 503 when none is set up.
    """
    triangle, source = _build_cumulative_triangle()
    result = _chain_ladder(triangle)
    return LossTriangleResponse(
        product=os.environ.get("ACTUARIAL_PRODUCT", "all_products"),
        as_of=result["as_of"],
        method="chain_ladder",
        development_factors=result["development_factors"],
        triangle=triangle,
        ultimate_claims=result["ultimate_claims"],
        ibnr_reserve=result["total_ibnr"],
        data_source=source,
    )


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
        raise ProductNotFoundError(product_type)
    return model


@app.get(
    "/api/v1/actuarial/experience-study",
    response_model=ExperienceStudyResponse,
    summary="Get experience study results computed from actuals",
)
async def experience_study():
    """Compute actuarial experience study results (A/E ratios) from the
    configured data source. Returns 503 when none is set up.
    """
    return _compute_experience_study()


# ── Entry Point ───────────────────────────────────────────────────────────────

init_db()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8095, reload=False)
