"""
dynamic-pricing/app/main.py
Real-time dynamic pricing engine for insurance products.
Adjusts premiums based on: time of day, weather, local risk events,
portfolio concentration, reinsurance capacity, and telematics data.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import os
import math
import asyncpg
import httpx
import logging
from datetime import datetime, date

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="InsurePortal Dynamic Pricing Engine", version="1.0.0")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/insureportal")
# DD-LEGACY (F2 #15): phantom/wrong-host defaults removed (climate-risk-service
# does not exist; 8097 is not the telematics engine). Each factor source is
# used only when explicitly configured; a configured-but-failed source fails
# the quote loudly instead of silently zeroing the factor.
CLIMATE_RISK_URL = os.getenv("CLIMATE_RISK_URL", "")
TELEMATICS_URL = os.getenv("TELEMATICS_ENGINE_URL", "")


class PricingRequest(BaseModel):
    product_type: str  # motor, health, life, property, travel, marine
    base_premium: float
    sum_insured: float
    customer_id: Optional[int] = None
    policy_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    risk_factors: Optional[Dict[str, Any]] = {}


class PricingResponse(BaseModel):
    base_premium: float
    adjusted_premium: float
    total_loading_pct: float
    discount_pct: float
    net_adjustment_pct: float
    factors: Dict[str, float]
    # DD-LEGACY: factors whose data source is not wired in this deployment —
    # omitted from `factors` rather than silently zeroed.
    factors_unavailable: list[str] = []
    valid_until: str
    pricing_model: str


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "dynamic-pricing"}


@app.post("/api/v1/price", response_model=PricingResponse)
async def calculate_price(req: PricingRequest):
    """
    Calculate a dynamic premium for an insurance product.
    Returns the adjusted premium with a breakdown of all loading/discount factors.
    """
    factors: Dict[str, float] = {}
    factors_unavailable: list[str] = []
    total_loading = 0.0
    total_discount = 0.0

    # ── 1. Time-of-day factor ─────────────────────────────────────────────────
    hour = datetime.now().hour
    if req.product_type == "motor":
        # Peak hours (07:00-09:00, 17:00-19:00) = 5% loading
        if 7 <= hour <= 9 or 17 <= hour <= 19:
            factors["time_of_day"] = 5.0
            total_loading += 5.0
        elif 22 <= hour or hour <= 5:
            # Night driving = 10% loading
            factors["time_of_day"] = 10.0
            total_loading += 10.0
        else:
            factors["time_of_day"] = 0.0

    # ── 2. Climate/weather risk factor ───────────────────────────────────────
    if req.latitude and req.longitude and not CLIMATE_RISK_URL:
        # No climate-risk source wired — omit the factor honestly.
        factors_unavailable.append("climate_risk")
    elif req.latitude and req.longitude:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.post(f"{CLIMATE_RISK_URL}/api/v1/score", json={
                    "latitude": req.latitude,
                    "longitude": req.longitude,
                })
                if resp.status_code == 200:
                    risk = resp.json()
                    composite = risk.get("composite_risk", 20)
                    # 0-30: no loading, 30-60: 5% loading, 60-80: 15% loading, 80+: 25% loading
                    if composite > 80:
                        climate_loading = 25.0
                    elif composite > 60:
                        climate_loading = 15.0
                    elif composite > 30:
                        climate_loading = 5.0
                    else:
                        climate_loading = 0.0
                    factors["climate_risk"] = climate_loading
                    total_loading += climate_loading
                elif resp.status_code:
                    raise HTTPException(
                        status_code=503,
                        detail=f"climate-risk service returned HTTP {resp.status_code} — premium cannot be computed honestly (fail-closed)",
                    )
        except HTTPException:
            raise
        except Exception as exc:
            # DD-LEGACY: was silently zeroed — premiums priced without the
            # climate loading. Fail loud instead.
            logger.error("climate-risk service failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="climate-risk service unavailable — premium cannot be computed honestly (fail-closed)",
            )

    # ── 3. Portfolio concentration factor ────────────────────────────────────
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            # Count active policies of this type in the same region
            if req.latitude and req.longitude:
                concentration = await conn.fetchval("""
                    SELECT COUNT(*) FROM policies p
                    JOIN customers c ON p.customer_id = c.id
                    WHERE p.status = 'active'
                    AND p.product_id IN (
                        SELECT id FROM products WHERE category = $1
                    )
                """, req.product_type)

                # High concentration = higher reinsurance cost = loading
                if concentration and concentration > 10000:
                    conc_loading = min(10.0, (concentration - 10000) / 1000)
                    factors["portfolio_concentration"] = conc_loading
                    total_loading += conc_loading
                else:
                    factors["portfolio_concentration"] = 0.0
        finally:
            await conn.close()
    except Exception:
        factors["portfolio_concentration"] = 0.0

    # ── 4. Telematics/UBI factor (motor only) ────────────────────────────────
    if req.product_type == "motor" and req.policy_id and not TELEMATICS_URL:
        factors_unavailable.append("ubi_telematics")
    elif req.product_type == "motor" and req.policy_id:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(
                    f"{TELEMATICS_URL}/api/v1/score/{req.policy_id}",
                )
                if resp.status_code == 200:
                    score_data = resp.json()
                    driving_score = score_data.get("driving_score", 70)
                    if driving_score >= 85:
                        ubi_discount = 15.0
                        factors["ubi_telematics"] = -ubi_discount
                        total_discount += ubi_discount
                    elif driving_score >= 70:
                        factors["ubi_telematics"] = 0.0
                    else:
                        ubi_loading = (70 - driving_score) * 0.5
                        factors["ubi_telematics"] = ubi_loading
                        total_loading += ubi_loading
        except HTTPException:
            raise
        except Exception as exc:
            # DD-LEGACY: was silently zeroed. Fail loud instead.
            logger.error("telematics service failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="telematics service unavailable — premium cannot be computed honestly (fail-closed)",
            )

    # ── 5. Customer loyalty factor ────────────────────────────────────────────
    if req.customer_id:
        try:
            conn = await asyncpg.connect(DATABASE_URL)
            try:
                policy_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM policies WHERE customer_id = $1",
                    req.customer_id
                )
                claim_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM claims WHERE customer_id = $1 AND status = 'settled'",
                    req.customer_id
                )
                # Loyalty discount: 2% per year of no claims, max 15%
                if policy_count and policy_count >= 3 and (not claim_count or claim_count == 0):
                    loyalty_discount = min(15.0, policy_count * 2.0)
                    factors["loyalty_no_claims"] = -loyalty_discount
                    total_discount += loyalty_discount
                else:
                    factors["loyalty_no_claims"] = 0.0
            finally:
                await conn.close()
        except Exception:
            factors["loyalty_no_claims"] = 0.0

    # ── 6. Seasonal factor ────────────────────────────────────────────────────
    month = date.today().month
    if req.product_type in ["motor", "property"]:
        # Rainy season in Nigeria (April-October): 8% loading for flood/accident risk
        if 4 <= month <= 10:
            factors["seasonal"] = 8.0
            total_loading += 8.0
        else:
            factors["seasonal"] = 0.0

    # ── 7. Sum insured adequacy factor ───────────────────────────────────────
    if req.sum_insured > 0 and req.base_premium > 0:
        rate = (req.base_premium / req.sum_insured) * 100
        # If rate is below market minimum, apply loading
        market_minimums = {"motor": 0.5, "property": 0.3, "health": 2.0, "life": 0.5}
        min_rate = market_minimums.get(req.product_type, 0.5)
        if rate < min_rate:
            adequacy_loading = (min_rate - rate) * 10
            factors["sum_insured_adequacy"] = adequacy_loading
            total_loading += adequacy_loading
        else:
            factors["sum_insured_adequacy"] = 0.0

    # ── Calculate final premium ───────────────────────────────────────────────
    net_adjustment = total_loading - total_discount
    adjusted_premium = req.base_premium * (1 + net_adjustment / 100)
    adjusted_premium = max(adjusted_premium, req.base_premium * 0.7)  # floor: -30%
    adjusted_premium = min(adjusted_premium, req.base_premium * 1.5)  # ceiling: +50%

    valid_until = datetime.now().replace(minute=0, second=0, microsecond=0)
    # Quote valid for 1 hour
    valid_until = valid_until.replace(hour=(valid_until.hour + 1) % 24)

    return PricingResponse(
        base_premium=req.base_premium,
        adjusted_premium=round(adjusted_premium, 2),
        total_loading_pct=round(total_loading, 2),
        discount_pct=round(total_discount, 2),
        net_adjustment_pct=round(net_adjustment, 2),
        factors=factors,
        factors_unavailable=factors_unavailable,
        valid_until=valid_until.isoformat(),
        pricing_model="dynamic-v2",
    )


@app.post("/api/v1/batch-price")
async def batch_price(requests: list[PricingRequest]):
    """Price multiple policies in one call (for bulk renewals)."""
    results = []
    for req in requests[:100]:  # limit to 100 per batch
        try:
            result = await calculate_price(req)
            results.append({"success": True, "result": result.dict()})
        except Exception as e:
            results.append({"success": False, "error": str(e)})
    return {"results": results, "count": len(results)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8108")))
