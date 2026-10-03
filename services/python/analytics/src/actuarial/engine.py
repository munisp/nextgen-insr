"""
Actuarial Engine
================
Provides actuarial calculations for InsurePortal:
- Premium pricing (pure premium, loaded premium, expense loading)
- Loss ratio analysis (incurred, paid, combined)
- Reserve estimation (chain-ladder, Bornhuetter-Ferguson, Cape Cod)
- Mortality / morbidity tables (Nigerian NIA tables + WHO standard)
- Lapse rate modelling
- Reinsurance XL pricing
"""
import math
from datetime import date, datetime
from typing import Dict, Any, List, Optional
import numpy as np


class ActuarialEngine:
    """Core actuarial calculation engine."""

    # ── Nigerian NIA 2004-2008 Mortality Table (select rates per 1000) ─────────
    NIA_MORTALITY = {
        20: 1.2, 25: 1.4, 30: 1.8, 35: 2.5, 40: 3.8, 45: 6.2,
        50: 10.1, 55: 16.4, 60: 26.8, 65: 43.2, 70: 69.5, 75: 110.2,
    }

    def __init__(self):
        self.discount_rate = float(0.12)  # Nigerian risk-free rate ~12%

    # ── Premium Pricing ────────────────────────────────────────────────────────

    def calculate_pure_premium(
        self,
        expected_loss: float,
        exposure_units: float,
    ) -> float:
        """Pure premium = Expected Loss / Exposure Units."""
        if exposure_units <= 0:
            return 0.0
        return expected_loss / exposure_units

    def calculate_loaded_premium(
        self,
        pure_premium: float,
        expense_ratio: float = 0.30,
        profit_loading: float = 0.05,
        contingency: float = 0.02,
    ) -> Dict[str, float]:
        """Calculate loaded premium with all components."""
        total_loading = expense_ratio + profit_loading + contingency
        if total_loading >= 1.0:
            total_loading = 0.95
        loaded = pure_premium / (1.0 - total_loading)
        return {
            "pure_premium": round(pure_premium, 2),
            "expense_loading": round(loaded * expense_ratio, 2),
            "profit_loading": round(loaded * profit_loading, 2),
            "contingency": round(loaded * contingency, 2),
            "loaded_premium": round(loaded, 2),
            "loss_ratio_target": round(1.0 - total_loading, 4),
        }

    def calculate_life_premium(
        self,
        age: int,
        sum_assured: float,
        term_years: int,
        gender: str = "M",
    ) -> Dict[str, float]:
        """Calculate annual life insurance premium using mortality tables."""
        # Get mortality rate (interpolate if needed)
        ages = sorted(self.NIA_MORTALITY.keys())
        nearest_age = min(ages, key=lambda a: abs(a - age))
        qx = self.NIA_MORTALITY[nearest_age] / 1000.0

        # Gender adjustment
        if gender == "F":
            qx *= 0.85  # Female mortality ~15% lower

        # Simplified term life premium calculation
        # APV of death benefit = sum_assured * qx * discount_factor
        discount_factor = 1 / (1 + self.discount_rate)
        apv_death = sum_assured * qx * discount_factor

        # Annuity factor (simplified)
        annuity = (1 - (1 + self.discount_rate) ** (-term_years)) / self.discount_rate
        annual_premium = apv_death / annuity if annuity > 0 else 0

        return {
            "age": age,
            "sum_assured": sum_assured,
            "term_years": term_years,
            "mortality_rate_qx": round(qx, 6),
            "annual_premium": round(annual_premium, 2),
            "monthly_premium": round(annual_premium / 12, 2),
            "total_premium": round(annual_premium * term_years, 2),
        }

    # ── Loss Ratio Analysis ────────────────────────────────────────────────────

    def calculate_loss_ratios(
        self,
        earned_premium: float,
        incurred_losses: float,
        paid_losses: float,
        loss_adjustment_expenses: float = 0.0,
        underwriting_expenses: float = 0.0,
    ) -> Dict[str, float]:
        """Calculate key loss ratio metrics."""
        if earned_premium <= 0:
            return {"error": "earned_premium must be positive"}

        pure_loss_ratio = incurred_losses / earned_premium
        paid_loss_ratio = paid_losses / earned_premium
        lae_ratio = loss_adjustment_expenses / earned_premium
        expense_ratio = underwriting_expenses / earned_premium
        combined_ratio = pure_loss_ratio + lae_ratio + expense_ratio

        return {
            "earned_premium": round(earned_premium, 2),
            "incurred_loss_ratio": round(pure_loss_ratio, 4),
            "paid_loss_ratio": round(paid_loss_ratio, 4),
            "lae_ratio": round(lae_ratio, 4),
            "expense_ratio": round(expense_ratio, 4),
            "combined_ratio": round(combined_ratio, 4),
            "underwriting_profit_margin": round(1.0 - combined_ratio, 4),
            "profitable": combined_ratio < 1.0,
        }

    # ── Reserve Estimation (Chain-Ladder) ─────────────────────────────────────

    def chain_ladder_reserve(
        self,
        triangle: List[List[Optional[float]]],
    ) -> Dict[str, Any]:
        """
        Chain-ladder reserve development.
        triangle: List of accident year rows, each row is cumulative paid losses
                  by development period. None = not yet developed.
        """
        n = len(triangle)
        if n == 0:
            return {"error": "empty triangle"}

        # Fill triangle with numpy
        max_cols = max(len(row) for row in triangle)
        arr = np.full((n, max_cols), np.nan)
        for i, row in enumerate(triangle):
            for j, val in enumerate(row):
                if val is not None:
                    arr[i, j] = float(val)

        # Calculate development factors
        factors = []
        for j in range(max_cols - 1):
            col_curr = arr[:, j]
            col_next = arr[:, j + 1]
            mask = ~np.isnan(col_curr) & ~np.isnan(col_next)
            if mask.sum() > 0:
                factor = col_next[mask].sum() / col_curr[mask].sum()
                factors.append(round(float(factor), 4))
            else:
                factors.append(1.0)

        # Project to ultimate
        ultimates = []
        for i in range(n):
            row = arr[i]
            last_known_idx = max(j for j in range(max_cols) if not np.isnan(row[j]))
            last_known = row[last_known_idx]
            ultimate = last_known
            for j in range(last_known_idx, max_cols - 1):
                ultimate *= factors[j]
            ultimates.append(round(float(ultimate), 2))

        # IBNR = Ultimate - Paid to date
        ibnr = []
        for i in range(n):
            row = arr[i]
            paid = float(row[~np.isnan(row)][-1])
            ibnr.append(round(ultimates[i] - paid, 2))

        return {
            "development_factors": factors,
            "ultimates": ultimates,
            "ibnr_by_year": ibnr,
            "total_ibnr": round(sum(ibnr), 2),
            "total_ultimate": round(sum(ultimates), 2),
        }

    # ── Reinsurance XL Pricing ────────────────────────────────────────────────

    def xl_reinsurance_rate(
        self,
        retention: float,
        limit: float,
        expected_loss: float,
        volatility: float = 0.3,
        loading_factor: float = 1.25,
    ) -> Dict[str, float]:
        """Price an excess-of-loss reinsurance layer using log-normal model."""
        # Log-normal parameters
        mu = math.log(expected_loss) - 0.5 * volatility ** 2
        sigma = volatility

        # Expected loss in layer [retention, retention + limit]
        from scipy.stats import lognorm
        dist = lognorm(s=sigma, scale=math.exp(mu))

        prob_excess = 1 - dist.cdf(retention)
        expected_in_layer = (
            dist.expect(lambda x: min(x - retention, limit), lb=retention)
        )

        rate_on_line = expected_in_layer / limit if limit > 0 else 0
        loaded_rate = rate_on_line * loading_factor
        annual_premium = loaded_rate * limit

        return {
            "retention": retention,
            "limit": limit,
            "expected_loss_in_layer": round(expected_in_layer, 2),
            "probability_of_excess": round(prob_excess, 4),
            "rate_on_line": round(rate_on_line, 4),
            "loaded_rate_on_line": round(loaded_rate, 4),
            "annual_xl_premium": round(annual_premium, 2),
        }

    def health(self) -> str:
        return "ok"
