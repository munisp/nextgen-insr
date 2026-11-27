"""Present-value profit testing.

Year-by-year cash-flow projection per policy/cohort: premium, mortality
cost (qx × sum assured), expenses (per-policy + premium-linked), reserves
(end-of-year net-premium style reserve roll-forward supplied by caller as a
vector), discounted at the assumption-set rate. Produces a profit margin
(PV of profits / PV of premiums) and IRR of the profit signature — the same
outputs the Rust kernel's ak_profit_test computes for the real-time path;
here it is used for offline product/cohort analysis.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ProfitTestResult:
    margin: float
    irr: float
    pv_profits: float
    pv_premiums: float
    profit_signature: list[float]


def _irr(signature: Sequence[float]) -> float:
    """IRR of the profit signature by bisection on NPV(rate)=0.

    Deterministic bracketing over (-0.99, 10); returns nan if no sign
    change exists (no meaningful IRR).
    """
    sig = np.asarray(signature, dtype=float)
    t = np.arange(1, len(sig) + 1)

    def npv(rate: float) -> float:
        return float(np.sum(sig / (1.0 + rate) ** t))

    lo, hi = -0.99, 10.0
    flo, fhi = npv(lo), npv(hi)
    if flo == 0.0:
        return lo
    if flo * fhi > 0:
        return float("nan")
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        fm = npv(mid)
        if abs(fm) < 1e-12:
            return mid
        if flo * fm < 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return 0.5 * (lo + hi)


def profit_test(
    premiums: Sequence[float],
    qx: Sequence[float],
    sum_assured: float,
    per_policy_expenses: Sequence[float],
    premium_expense_rate: float,
    reserves_end_of_year: Sequence[float],
    survival: Sequence[float],
    discount: Sequence[float],
) -> ProfitTestResult:
    """Run a deterministic profit test.

    premiums[t], qx[t], reserves_end_of_year[t] are annual vectors aligned
    to policy years 1..n. survival[t-1] = probability of surviving to year
    t (t_p_x). Profit in year t (per in-force policy at start of year):
        premium - per_policy_expense - premium_expense_rate*premium
        - qx[t]*sum_assured + (reserve_{t-1} - reserve_t)*(investment roll)
    simplified to the disclosed formula below; all inputs are explicit so
    the test is reproducible.
    """
    n = len(premiums)
    if not (len(qx) == len(reserves_end_of_year) == len(survival) == len(discount) == n):
        raise ValueError("all vectors must have equal length")
    prem = np.asarray(premiums, dtype=float)
    qx_arr = np.asarray(qx, dtype=float)
    exp_pp = np.asarray(per_policy_expenses, dtype=float)
    if len(exp_pp) != n:
        raise ValueError("per_policy_expenses must match premiums length")
    reserves = np.asarray(reserves_end_of_year, dtype=float)
    surv = np.asarray(survival, dtype=float)
    disc = np.asarray(discount, dtype=float)

    prev_reserve = np.concatenate(([0.0], reserves[:-1]))
    mortality_cost = qx_arr * sum_assured
    expense = exp_pp + premium_expense_rate * prem
    profit_per_policy = prem - expense - mortality_cost - (reserves - prev_reserve)
    # Expected profit per policy in force at inception, discounted.
    in_force = np.concatenate(([1.0], surv[:-1]))
    signature = profit_per_policy * in_force
    v = 1.0 / np.cumprod(1.0 + disc)
    pv_profits = float(np.sum(signature * v))
    pv_premiums = float(np.sum(prem * in_force * v))
    margin = pv_profits / pv_premiums if pv_premiums else float("nan")
    return ProfitTestResult(
        margin=float(margin),
        irr=_irr(signature),
        pv_profits=pv_profits,
        pv_premiums=pv_premiums,
        profit_signature=signature.tolist(),
    )
