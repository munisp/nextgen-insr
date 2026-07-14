"""Actuarial Engine API routes."""
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel
from src.actuarial.engine import ActuarialEngine

router = APIRouter()
engine = ActuarialEngine()

class PremiumRequest(BaseModel):
    expected_loss: float
    exposure_units: float
    expense_ratio: float = 0.30
    profit_loading: float = 0.05

class LifePremiumRequest(BaseModel):
    age: int
    sum_assured: float
    term_years: int
    gender: str = "M"

class LossRatioRequest(BaseModel):
    earned_premium: float
    incurred_losses: float
    paid_losses: float
    loss_adjustment_expenses: float = 0.0
    underwriting_expenses: float = 0.0

class ChainLadderRequest(BaseModel):
    triangle: List[List[Optional[float]]]

class XLRequest(BaseModel):
    retention: float
    limit: float
    expected_loss: float
    volatility: float = 0.3
    loading_factor: float = 1.25

@router.get("/health")
def health(): return {"status": engine.health()}

@router.post("/premium/loaded")
def loaded_premium(req: PremiumRequest):
    pure = engine.calculate_pure_premium(req.expected_loss, req.exposure_units)
    return engine.calculate_loaded_premium(pure, req.expense_ratio, req.profit_loading)

@router.post("/premium/life")
def life_premium(req: LifePremiumRequest):
    return engine.calculate_life_premium(req.age, req.sum_assured, req.term_years, req.gender)

@router.post("/loss-ratios")
def loss_ratios(req: LossRatioRequest):
    return engine.calculate_loss_ratios(
        req.earned_premium, req.incurred_losses, req.paid_losses,
        req.loss_adjustment_expenses, req.underwriting_expenses
    )

@router.post("/reserve/chain-ladder")
def chain_ladder(req: ChainLadderRequest):
    return engine.chain_ladder_reserve(req.triangle)

@router.post("/reinsurance/xl-rate")
def xl_rate(req: XLRequest):
    return engine.xl_reinsurance_rate(
        req.retention, req.limit, req.expected_loss, req.volatility, req.loading_factor
    )
