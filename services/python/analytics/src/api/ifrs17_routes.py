"""IFRS 17 Reserve Engine API routes."""
from typing import List, Optional, Any, Dict
from fastapi import APIRouter
from pydantic import BaseModel
from src.ifrs17.engine import IFRS17Engine

router = APIRouter()
engine = IFRS17Engine()

class BBARequest(BaseModel):
    future_cash_outflows: List[float]
    future_cash_inflows: List[float]
    risk_adjustment: float
    csm_opening: float = 0.0
    coverage_units_remaining: float = 1.0
    coverage_units_total: float = 1.0

class PAARequest(BaseModel):
    written_premium: float
    coverage_period_days: int
    days_elapsed: int
    incurred_claims: float
    claims_handling_expenses: float = 0.0
    acquisition_costs: float = 0.0

class VFARequest(BaseModel):
    underlying_items_fair_value: float
    expected_variable_fee: float
    risk_adjustment: float
    csm_opening: float
    investment_return: float = 0.0
    experience_adjustment: float = 0.0

class PortfolioRequest(BaseModel):
    contracts: List[Dict[str, Any]]

@router.get("/health")
def health(): return {"status": engine.health()}

@router.post("/bba")
def calculate_bba(req: BBARequest):
    return engine.calculate_bba(
        req.future_cash_outflows, req.future_cash_inflows,
        req.risk_adjustment, req.csm_opening,
        req.coverage_units_remaining, req.coverage_units_total
    )

@router.post("/paa")
def calculate_paa(req: PAARequest):
    return engine.calculate_paa(
        req.written_premium, req.coverage_period_days, req.days_elapsed,
        req.incurred_claims, req.claims_handling_expenses, req.acquisition_costs
    )

@router.post("/vfa")
def calculate_vfa(req: VFARequest):
    return engine.calculate_vfa(
        req.underlying_items_fair_value, req.expected_variable_fee,
        req.risk_adjustment, req.csm_opening,
        req.investment_return, req.experience_adjustment
    )

@router.post("/portfolio")
def portfolio_reserve(req: PortfolioRequest):
    return engine.portfolio_reserve(req.contracts)
