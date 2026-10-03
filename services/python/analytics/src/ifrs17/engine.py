"""
IFRS 17 Reserve Engine
======================
Implements the three IFRS 17 measurement models:
- BBA (Building Block Approach) — general model for long-duration contracts
- PAA (Premium Allocation Approach) — simplified model for short-duration contracts
- VFA (Variable Fee Approach) — for direct participating contracts

Key components:
- Fulfilment Cash Flows (FCF) = PV(future cash outflows) - PV(future cash inflows)
- Risk Adjustment (RA) for non-financial risk
- Contractual Service Margin (CSM) — unearned profit
- Loss Component (LC) — onerous contracts

Reference: IFRS 17 Insurance Contracts (effective 1 January 2023)
"""
from datetime import date, datetime
from typing import Dict, Any, List, Optional
import numpy as np


class IFRS17Engine:
    """IFRS 17 measurement and reporting engine."""

    def __init__(self, discount_rate: float = 0.12):
        self.discount_rate = discount_rate

    # ── BBA (General Model) ───────────────────────────────────────────────────

    def calculate_bba(
        self,
        future_cash_outflows: List[float],   # Claims + expenses per period
        future_cash_inflows: List[float],    # Premiums per period
        risk_adjustment: float,              # RA for non-financial risk
        csm_opening: float = 0.0,            # Opening CSM balance
        coverage_units_remaining: float = 1.0,
        coverage_units_total: float = 1.0,
    ) -> Dict[str, Any]:
        """Calculate BBA insurance contract liability."""
        n = max(len(future_cash_outflows), len(future_cash_inflows))

        # Pad arrays
        outflows = list(future_cash_outflows) + [0.0] * (n - len(future_cash_outflows))
        inflows = list(future_cash_inflows) + [0.0] * (n - len(future_cash_inflows))

        # Present value of future cash flows
        pv_outflows = sum(
            cf / (1 + self.discount_rate) ** (t + 1)
            for t, cf in enumerate(outflows)
        )
        pv_inflows = sum(
            cf / (1 + self.discount_rate) ** (t + 1)
            for t, cf in enumerate(inflows)
        )

        # Fulfilment Cash Flows
        fcf = pv_outflows - pv_inflows + risk_adjustment

        # CSM = max(0, -FCF) for new contracts (no day-1 loss for profitable contracts)
        if csm_opening == 0.0:
            csm = max(0.0, -fcf)
            loss_component = max(0.0, fcf)  # Onerous if FCF > 0
        else:
            csm = csm_opening
            loss_component = 0.0

        # CSM amortisation for current period
        coverage_ratio = coverage_units_remaining / coverage_units_total if coverage_units_total > 0 else 0
        csm_release = csm * (1 - coverage_ratio)  # Released to P&L

        # Insurance contract liability
        liability = fcf + csm - csm_release

        return {
            "model": "BBA",
            "pv_future_outflows": round(pv_outflows, 2),
            "pv_future_inflows": round(pv_inflows, 2),
            "risk_adjustment": round(risk_adjustment, 2),
            "fulfilment_cash_flows": round(fcf, 2),
            "csm_opening": round(csm_opening or csm, 2),
            "csm_release_to_pl": round(csm_release, 2),
            "csm_closing": round(csm - csm_release, 2),
            "loss_component": round(loss_component, 2),
            "insurance_contract_liability": round(liability, 2),
            "is_onerous": loss_component > 0,
            "discount_rate": self.discount_rate,
        }

    # ── PAA (Premium Allocation Approach) ─────────────────────────────────────

    def calculate_paa(
        self,
        written_premium: float,
        coverage_period_days: int,
        days_elapsed: int,
        incurred_claims: float,
        claims_handling_expenses: float = 0.0,
        acquisition_costs: float = 0.0,
        amortise_acquisition_costs: bool = True,
    ) -> Dict[str, Any]:
        """Calculate PAA insurance contract liability (simplified model)."""
        if coverage_period_days <= 0:
            return {"error": "coverage_period_days must be positive"}

        # Liability for Remaining Coverage (LRC)
        unearned_fraction = max(0.0, (coverage_period_days - days_elapsed) / coverage_period_days)
        lrc = written_premium * unearned_fraction

        # Deferred acquisition costs
        dac = acquisition_costs * unearned_fraction if amortise_acquisition_costs else 0.0
        lrc_net = lrc - dac

        # Liability for Incurred Claims (LIC)
        lic = incurred_claims + claims_handling_expenses

        # Total insurance contract liability
        total_liability = lrc_net + lic

        # Earned premium
        earned_premium = written_premium * (1 - unearned_fraction)

        return {
            "model": "PAA",
            "written_premium": round(written_premium, 2),
            "earned_premium": round(earned_premium, 2),
            "unearned_premium_fraction": round(unearned_fraction, 4),
            "liability_for_remaining_coverage": round(lrc, 2),
            "deferred_acquisition_costs": round(dac, 2),
            "lrc_net_of_dac": round(lrc_net, 2),
            "liability_for_incurred_claims": round(lic, 2),
            "total_insurance_contract_liability": round(total_liability, 2),
            "days_elapsed": days_elapsed,
            "coverage_period_days": coverage_period_days,
        }

    # ── VFA (Variable Fee Approach) ───────────────────────────────────────────

    def calculate_vfa(
        self,
        underlying_items_fair_value: float,
        expected_variable_fee: float,
        risk_adjustment: float,
        csm_opening: float,
        investment_return: float = 0.0,
        experience_adjustment: float = 0.0,
    ) -> Dict[str, Any]:
        """Calculate VFA insurance contract liability for participating contracts."""
        # VFA CSM adjusts for changes in variable fee
        csm_adjustment = expected_variable_fee + investment_return + experience_adjustment
        csm_closing = csm_opening + csm_adjustment

        # Fulfilment cash flows
        fcf = underlying_items_fair_value - expected_variable_fee + risk_adjustment

        # Total liability
        liability = fcf + csm_closing

        return {
            "model": "VFA",
            "underlying_items_fair_value": round(underlying_items_fair_value, 2),
            "expected_variable_fee": round(expected_variable_fee, 2),
            "risk_adjustment": round(risk_adjustment, 2),
            "csm_opening": round(csm_opening, 2),
            "csm_adjustment": round(csm_adjustment, 2),
            "csm_closing": round(csm_closing, 2),
            "fulfilment_cash_flows": round(fcf, 2),
            "insurance_contract_liability": round(liability, 2),
        }

    # ── Portfolio-level reserve ────────────────────────────────────────────────

    def portfolio_reserve(
        self,
        contracts: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Aggregate IFRS 17 reserves across a portfolio of contracts."""
        total_fcf = 0.0
        total_csm = 0.0
        total_ra = 0.0
        total_liability = 0.0
        onerous_count = 0

        for contract in contracts:
            model = contract.get("model", "PAA")
            if model == "BBA":
                result = self.calculate_bba(
                    future_cash_outflows=contract.get("outflows", []),
                    future_cash_inflows=contract.get("inflows", []),
                    risk_adjustment=contract.get("risk_adjustment", 0),
                    csm_opening=contract.get("csm_opening", 0),
                )
                total_fcf += result["fulfilment_cash_flows"]
                total_csm += result["csm_closing"]
                total_ra += result["risk_adjustment"]
                total_liability += result["insurance_contract_liability"]
                if result["is_onerous"]:
                    onerous_count += 1
            elif model == "PAA":
                result = self.calculate_paa(
                    written_premium=contract.get("written_premium", 0),
                    coverage_period_days=contract.get("coverage_period_days", 365),
                    days_elapsed=contract.get("days_elapsed", 0),
                    incurred_claims=contract.get("incurred_claims", 0),
                )
                total_liability += result["total_insurance_contract_liability"]

        return {
            "contract_count": len(contracts),
            "onerous_contracts": onerous_count,
            "total_fulfilment_cash_flows": round(total_fcf, 2),
            "total_csm": round(total_csm, 2),
            "total_risk_adjustment": round(total_ra, 2),
            "total_insurance_contract_liability": round(total_liability, 2),
            "calculated_at": datetime.utcnow().isoformat(),
        }

    def health(self) -> str:
        return "ok"
