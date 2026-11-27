"""FastAPI app — see app/__init__.py docstring for the absorbed contract."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from actuary_analytics.jobs.reserve_run import (
    PgReserveRunStore,
    ReserveRunStore,
    run_monthly_reserve,
)
from actuary_analytics.life.mortality import DISCLAIMER, illustrate_bases
from actuary_analytics.reserving.data_source import (
    ClaimsSourceConfig,
    DataSourceUnavailableError,
    load_claims,
)
from actuary_analytics.reserving.methods import (
    chain_ladder,
    triangle_dict_to_chainladder,
)
from actuary_analytics.reserving.triangles import cumulative_triangle_dict

logger = logging.getLogger(__name__)

# ── Pydantic models (preserved verbatim from actuarial-platform) ────────────


class MortalityTableEntry(BaseModel):
    id: str
    name: str
    type: str
    gender: str
    age_range: list[int]
    sample_rates: dict | None = None
    source: str
    status: str = "illustrative_reference"
    official: bool = False


class MortalityTableResponse(BaseModel):
    tables: list[MortalityTableEntry]
    disclaimer: str = DISCLAIMER


class LossTriangleResponse(BaseModel):
    product: str
    as_of: str
    method: str
    development_factors: list[float]
    triangle: dict
    ultimate_claims: dict
    ibnr_reserve: float
    data_source: str


class RatingFactor(BaseModel):
    factor: str
    weight: float
    categories: dict


class PricingModel(BaseModel):
    product: str
    base_premium: float
    rating_factors: list[RatingFactor]
    expected_loss_ratio: float
    expense_ratio: float
    profit_margin: float
    commission_rate: float | None = None


class ExperienceResult(BaseModel):
    product: str
    expected_claims_frequency: float | None = None
    actual_claims_frequency: float | None = None
    expected_mortality: float | None = None
    actual_mortality: float | None = None
    ae_ratio: float
    avg_claim_severity: float
    recommendation: str


class ExperienceStudyResponse(BaseModel):
    study_period: str
    products_analyzed: int
    results: list[ExperienceResult]
    data_source: str


class ReserveRunRequest(BaseModel):
    product_line: str
    as_of: str
    method: str = "chainladder"
    apriori_ultimates: list[float] | None = None
    assumption_set_id: int | None = None


class ReserveRunResponse(BaseModel):
    run_id: int
    product_line: str
    as_of: str
    method: str
    ultimate_by_origin: dict[str, float]
    ibnr: float
    mack_sd: dict[str, float | None] | None
    status: str
    data_source: str


class AdequacyRequest(BaseModel):
    product_line: str
    period: str
    paid_claims: float
    case_reserves: float
    ibnr_share: float
    earned_premium: float
    priced_loss_ratio: float
    credibility: float = 1.0


# ── Errors (preserved) ──────────────────────────────────────────────────────


class ActuarialPlatformError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class ProductNotFoundError(ActuarialPlatformError):
    def __init__(self, product_type: str):
        super().__init__(f"Product type '{product_type}' not found", status_code=404)


# ── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Actuary Analytics (absorbs actuarial-platform)",
    description=(
        "Actuarial analysis, reserving, and experience studies computed from "
        "real claims data. Reserving endpoints fail closed (503) when no data "
        "source is configured. Mortality tables are illustrative reference "
        "rates only (official=false)."
    ),
    version="1.0.0",
)


@app.exception_handler(DataSourceUnavailableError)
async def data_source_handler(request: Request, exc: DataSourceUnavailableError):
    return JSONResponse(status_code=503, content={"error": str(exc), "detail": str(exc)})


@app.exception_handler(ActuarialPlatformError)
async def actuarial_error_handler(request: Request, exc: ActuarialPlatformError):
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc), "detail": str(exc)})


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal server error", "detail": "An unexpected error occurred"},
    )


# ── Reference data (preserved) ──────────────────────────────────────────────

PRICING_MODELS: dict[str, PricingModel] = {
    "motor_tp": PricingModel(
        product="Motor Third Party",
        base_premium=15000,
        rating_factors=[
            RatingFactor(factor="vehicle_age", weight=0.15,
                         categories={"0-3": 0.9, "4-7": 1.0, "8-12": 1.15, "13+": 1.3}),
            RatingFactor(factor="driver_age", weight=0.20,
                         categories={"18-25": 1.4, "26-35": 1.0, "36-50": 0.9, "51+": 1.1}),
            RatingFactor(factor="state", weight=0.25,
                         categories={"Lagos": 1.3, "Abuja": 1.2, "Rivers": 1.15, "other": 1.0}),
            RatingFactor(factor="vehicle_type", weight=0.20,
                         categories={"sedan": 1.0, "suv": 1.1, "truck": 1.3, "motorcycle": 1.5}),
            RatingFactor(factor="claims_history", weight=0.20,
                         categories={"0": 0.85, "1": 1.0, "2": 1.25, "3+": 1.5}),
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
            RatingFactor(factor="age", weight=0.40,
                         categories={"18-30": 0.8, "31-45": 1.0, "46-60": 1.4, "61+": 2.0}),
            RatingFactor(factor="gender", weight=0.15, categories={"M": 1.0, "F": 1.1}),
            RatingFactor(factor="occupation_risk", weight=0.25,
                         categories={"low": 0.9, "medium": 1.0, "high": 1.3}),
        ],
        expected_loss_ratio=0.55,
        expense_ratio=0.20,
        profit_margin=0.10,
    ),
}


def _mortality_entries() -> list[MortalityTableEntry]:
    """Map the life module's illustrative bases onto the preserved response
    shape. official=False and the disclaimer survive the absorption."""
    entries: list[MortalityTableEntry] = []
    for basis in illustrate_bases():
        samples = {str(a): q for a, q in zip(basis.ages, basis.qx) if q > 0}
        samples = dict(list(samples.items())[:: max(len(samples) // 7, 1)][:7])
        entries.append(
            MortalityTableEntry(
                id=basis.code,
                name=basis.name,
                type="period" if "2020" in basis.code else "select_and_ultimate",
                gender=basis.gender,
                age_range=[min(basis.ages), max(basis.ages)],
                sample_rates=samples or None,
                source=basis.source,
                status=basis.status,
                official=basis.official,
            )
        )
    return entries


# ── Preserved endpoints ─────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "actuary-analytics",
        "absorbs": "actuarial-platform",
        "timestamp": datetime.now(UTC).isoformat(),
    }


@app.get("/api/v1/actuarial/mortality-tables", response_model=MortalityTableResponse)
async def mortality_tables():
    """Illustrative/reference mortality tables (official=false, disclaimer)."""
    return MortalityTableResponse(tables=_mortality_entries())


@app.get("/api/v1/actuarial/loss-triangles", response_model=LossTriangleResponse)
async def loss_triangles():
    """Cumulative loss triangle + chain-ladder IBNR from the configured
    claims source. 503 when no source is set up (preserved contract)."""
    cfg = ClaimsSourceConfig.from_env()
    rows, source = load_claims(cfg)
    triangle = cumulative_triangle_dict(rows)
    tri = triangle_dict_to_chainladder(triangle)
    result = chain_ladder(tri)
    as_of = max(triangle.keys())
    return LossTriangleResponse(
        product=cfg.product,
        as_of=as_of,
        method="chain_ladder",
        development_factors=result["development_factors"],
        triangle=triangle,
        ultimate_claims=result["ultimate_by_origin"],
        ibnr_reserve=result["total_ibnr"],
        data_source=source,
    )


@app.get("/api/v1/actuarial/pricing/{product_type}")
async def pricing_model(product_type: str):
    model = PRICING_MODELS.get(product_type)
    if model is None:
        raise ProductNotFoundError(product_type)
    return model


def _compute_experience_study(cfg: ClaimsSourceConfig) -> ExperienceStudyResponse:
    """A/E experience study (logic preserved from actuarial-platform)."""
    source = ""
    data: dict[str, Any]
    if cfg.experience_file and os.path.exists(cfg.experience_file):
        with open(cfg.experience_file, encoding="utf-8") as fh:
            data = json.load(fh)
        source = f"file:{cfg.experience_file}"
    else:
        if not cfg.database_url:
            raise DataSourceUnavailableError("experience study")
        try:
            import psycopg2
            import psycopg2.extras

            conn = psycopg2.connect(cfg.database_url)
            conn.autocommit = True
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
                db_rows = [dict(r) for r in cur.fetchall()]
            conn.close()
        except Exception as exc:  # noqa: BLE001 - fail-closed at external boundary (never guess data)
            logger.info("actuarial_experience table not usable: %s", exc)
            raise DataSourceUnavailableError("experience study")
        if not db_rows:
            raise DataSourceUnavailableError("experience study")
        data = {"study_period": "from database", "products": db_rows}
        source = "postgres:actuarial_experience"

    results: list[ExperienceResult] = []
    for p in data.get("products", []):
        exp_freq = p.get("expected_claims_frequency")
        act_freq = p.get("actual_claims_frequency")
        exp_mort = p.get("expected_mortality")
        act_mort = p.get("actual_mortality")
        if exp_mort is not None and act_mort is not None and exp_mort:
            ae_ratio, kind = act_mort / exp_mort, "mortality"
        elif exp_freq is not None and act_freq is not None and exp_freq:
            ae_ratio, kind = act_freq / exp_freq, "frequency"
        else:
            logger.warning(
                "experience study: skipping product %r — insufficient expected/actual data",
                p.get("product"),
            )
            continue
        results.append(
            ExperienceResult(
                product=p.get("product", "unknown"),
                expected_claims_frequency=exp_freq,
                actual_claims_frequency=act_freq,
                expected_mortality=exp_mort,
                actual_mortality=act_mort,
                ae_ratio=round(ae_ratio, 4),
                avg_claim_severity=float(p.get("avg_claim_severity", 0.0)),
                recommendation=_ae_recommendation(p.get("product", "unknown"), ae_ratio, kind),
            )
        )
    if not results:
        raise DataSourceUnavailableError("experience study (no usable product records)")
    return ExperienceStudyResponse(
        study_period=str(data.get("study_period", "unspecified")),
        products_analyzed=len(results),
        results=results,
        data_source=source,
    )


def _ae_recommendation(product: str, ae_ratio: float, kind: str) -> str:
    metric = "mortality" if kind == "mortality" else "claim frequency"
    if ae_ratio > 1.15:
        return (f"A/E {metric} ratio {ae_ratio:.3f} significantly above 1.0 for {product}: "
                "review pricing assumptions and consider rate increases.")
    if ae_ratio > 1.05:
        return (f"A/E {metric} ratio {ae_ratio:.3f} moderately above 1.0 for {product}: "
                "monitor experience and validate assumptions at next review.")
    if ae_ratio < 0.85:
        return (f"A/E {metric} ratio {ae_ratio:.3f} well below 1.0 for {product}: "
                "experience is favourable; consider premium relief or profit review.")
    return (f"A/E {metric} ratio {ae_ratio:.3f} within tolerance for {product}: "
            "no pricing action indicated.")


@app.get("/api/v1/actuarial/experience-study", response_model=ExperienceStudyResponse)
async def experience_study():
    """A/E experience study from the configured source (503 fail-closed)."""
    return _compute_experience_study(ClaimsSourceConfig.from_env())


# ── New batch endpoints ─────────────────────────────────────────────────────


def _reserve_run_store() -> ReserveRunStore:
    """Store resolution: PG via DATABASE_URL when reachable, else fail
    closed (503). Tests override this dependency with an in-memory store."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise DataSourceUnavailableError("reserve run persistence store")
    try:
        return PgReserveRunStore(url)
    except Exception as exc:  # noqa: BLE001 - fail-closed at external boundary (never guess data)
        raise DataSourceUnavailableError(f"reserve run persistence store ({exc})")


@app.post("/api/v1/actuarial/reserve-run", response_model=ReserveRunResponse)
async def reserve_run(request: ReserveRunRequest):
    """Monthly reserve run: claims → triangle → CL/BF/Mack → persist.
    503 when the claims source is absent (preserved fail-closed contract)."""
    store = _reserve_run_store()
    import numpy as np

    result = run_monthly_reserve(
        request.product_line,
        request.as_of,
        request.method,
        store,
        apriori_ultimates=(
            np.asarray(request.apriori_ultimates, dtype=float)
            if request.apriori_ultimates is not None else None
        ),
        assumption_set_id=request.assumption_set_id,
    )
    return ReserveRunResponse(
        run_id=result.run_id,
        product_line=result.product_line,
        as_of=result.as_of,
        method=result.method,
        ultimate_by_origin=result.ultimate_by_origin,
        ibnr=result.ibnr,
        mack_sd=result.mack_sd,
        status=result.status,
        data_source=result.data_source,
    )


@app.get("/api/v1/actuarial/reserve-runs/{run_id}")
async def get_reserve_run(run_id: int):
    store = _reserve_run_store()
    try:
        return store.get_run(run_id)
    except KeyError:
        raise ActuarialPlatformError(f"reserve run {run_id} not found", status_code=404)


@app.post("/api/v1/analytics/adequacy")
async def adequacy(request: AdequacyRequest):
    """Adequacy observation: computes live LR and emits an event to the
    configured producer (in-memory producer in dev; Kafka in prod)."""
    from actuary_analytics.jobs.adequacy import run_adequacy_etl

    producer = _adequacy_producer()
    result = run_adequacy_etl(
        request.product_line,
        request.period,
        request.paid_claims,
        request.case_reserves,
        request.ibnr_share,
        request.earned_premium,
        request.priced_loss_ratio,
        request.credibility,
        producer,
    )
    return {
        "alerts": [a.__dict__ for a in result.alerts],
        "priced_loss_ratio": result.priced_loss_ratio,
        "actual_loss_ratio": result.actual_loss_ratio,
        "credibility": result.credibility,
        "events_sent": result.events_sent,
    }


def _adequacy_producer():
    class _BufferProducer:
        """In-process event buffer (dev). Production wires Kafka; the
        producer is an HTTP/messaging boundary, not a compute path."""

        def __init__(self):
            self.events = []

        def send(self, topic: str, payload: dict[str, Any]) -> None:
            self.events.append((topic, payload))

    return _BufferProducer()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=7085, reload=False)
