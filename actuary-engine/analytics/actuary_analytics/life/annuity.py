"""Annuity present values from a qx grid with improvement scalar and a
per-year discount curve (supplied by the caller — the CBN curve lives in the
assumption set, never hardcoded).

Level or escalating payments, whole-life or n-year term, with an optional
guaranteed period. The PV math is deterministic discounting; mortality
probabilities come from the qx grid (fitted/improved via the life module).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np


def survival_probabilities(
    qx: Sequence[float], start_index: int, improvement: float, n_years: int
) -> np.ndarray:
    """t_p_x with a flat mortality-improvement scalar applied to qx:
    q'x = qx * (1 - improvement), compounding survival over n_years."""
    qx_arr = np.asarray(qx, dtype=float)[start_index : start_index + n_years]
    if len(qx_arr) < n_years:
        raise ValueError("qx grid too short for requested projection")
    px = 1.0 - qx_arr * (1.0 - improvement)
    return np.cumprod(px)


def annuity_pv(
    qx: Sequence[float],
    start_age_index: int,
    improvement: float,
    discount: Sequence[float],
    payment: float,
    guarantee_years: int = 0,
    escalation: float = 0.0,
    term_years: int | None = None,
) -> dict:
    """Present value of an annuity.

    Payments in arrears (end of each year) while the annuitant survives;
    during the guaranteed period the payment is certain. Escalation is a
    constant annual rate applied from year 2 onward. discount[t-1] is the
    spot discount factor / forward rate for year t — a per-year rate is
    supplied so a real CBN curve can be plugged in.

    Returns pv, pv_guaranteed and the per-year cash-flow detail.
    """
    disc = np.asarray(discount, dtype=float)
    n_years = len(disc)
    if term_years is not None:
        n_years = min(n_years, term_years)
        disc = disc[:n_years]
    if n_years == 0:
        raise ValueError("discount curve must have at least one year")
    surv = survival_probabilities(qx, start_age_index, improvement, n_years)
    v = 1.0 / np.cumprod(1.0 + disc)
    pv_total = 0.0
    pv_guaranteed = 0.0
    flows = []
    for t in range(1, n_years + 1):
        amount = payment * (1.0 + escalation) ** (t - 1)
        certain = t <= guarantee_years
        prob = 1.0 if certain else float(surv[t - 1])
        pv = amount * prob * float(v[t - 1])
        pv_total += pv
        if certain:
            pv_guaranteed += pv
        flows.append({"year": t, "amount": amount, "survival_prob": prob, "pv": pv})
    return {
        "pv": float(pv_total),
        "pv_guaranteed": float(pv_guaranteed),
        "n_years": n_years,
        "cash_flows": flows,
    }


def hand_annuity_pv(
    survival: Sequence[float], discount: Sequence[float], payment: float
) -> float:
    """Textbook annuity PV = Σ_t payment * t_p_x * v^t (arrears). Used by
    acceptance tests to verify annuity_pv against a hand computation."""
    surv = np.asarray(survival, dtype=float)
    disc = np.asarray(discount, dtype=float)
    v = 1.0 / np.cumprod(1.0 + disc)
    return float(np.sum(payment * surv * v))
