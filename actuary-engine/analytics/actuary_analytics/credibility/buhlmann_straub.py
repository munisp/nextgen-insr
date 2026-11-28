"""Bühlmann-Straub credibility — exposure-weighted empirical-Bayes
estimator (F3).

Implements the nonparametric Bühlmann-Straub estimator exactly as
presented in Loss Data Analytics, Chapter 9 §"Estimating Credibility
Parameters" (openacttexts.github.io/Loss-Data-Analytics/ChapCredibility.html,
author Gary Dean; the open text itself is listed in the genedan/
actuarial-foss curated list):

* X_ij   loss per exposure for risk i in period j
* m_ij   exposure for risk i in period j (m_ij = 0 → period dropped)
* x̄_i = Σ_j m_ij X_ij / m_i,  m_i = Σ_j m_ij
* x̄   = Σ_i m_i x̄_i / m,      m = Σ_i m_i
* EPV̂  = Σ_i Σ_j m_ij (X_ij − x̄_i)² / Σ_i (n_i − 1)
* VHM̂  = [Σ_i m_i (x̄_i − x̄)² − (r−1) EPV̂] / (m − m⁻¹ Σ_i m_i²)
* K = EPV̂ / VHM̂,  Z_i = m_i / (m_i + K)
* μ̂_i = Z_i x̄_i + (1−Z_i) x̄

Optional balancing (LDA §"Balancing Credibility Estimators"):
M̂_X = Σ_i Z_i x̄_i / Σ_i Z_i, replacing x̄ in the complement so the
credibility-weighted portfolio stays in balance with the observed
collective mean.

Fail-closed posture (no silent defaults):
* fewer than two risks → VHM is not identifiable (single risk: no
  between-risk variance) — honest error;
* a risk left with fewer than two observed periods contributes zero
  degrees of freedom to EPV̂; if total Σ_i(n_i−1) = 0 → error;
* negative or non-finite exposure, non-finite loss rate, or a non-zero
  loss rate recorded against a zero-exposure period → error;
* EPV̂ ≤ 0 (no within-risk variance) or VHM̂ ≤ 0 (process variance
  swallows the between-risk variance — the degenerate case Loss Data
  Analytics flags explicitly, §9.6) → honest error instead of a silent
  clamp.

Golden provenance: tests/data/buhlmann_straub_golden.json pins both the
published rounded values of Loss Data Analytics Examples 9.6.3 and 9.6.6
(two-policyholder dataset) and full-precision values recomputed
independently with exact rational arithmetic (Python fractions) in a
scratch script — receipt in tests/test_buhlmann_straub.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RiskExperience:
    """One risk's multi-period experience.

    loss_per_exposure[j] = X_ij (loss per exposure unit, period j);
    exposure[j] = m_ij (>= 0; a zero exposure means the period was not
    observed and is dropped, matching the Loss Data Analytics Example
    9.6.3 convention where policyholder B has 0 vehicles in year 1).
    """

    name: str
    loss_per_exposure: list[float]
    exposure: list[float]


def _observed_periods(risk: RiskExperience) -> tuple[list[float], list[float]]:
    """Drop zero-exposure periods; fail closed on inconsistent data."""
    x = risk.loss_per_exposure
    m = risk.exposure
    if len(x) != len(m):
        raise ValueError(
            f"risk {risk.name!r}: loss_per_exposure length {len(x)} != "
            f"exposure length {len(m)}"
        )
    xs: list[float] = []
    ms: list[float] = []
    for j, (xv, mv) in enumerate(zip(x, m)):
        mv = float(mv)
        xv = float(xv)
        if not math.isfinite(mv) or not math.isfinite(xv):
            raise ValueError(f"risk {risk.name!r} period {j}: non-finite value")
        if mv < 0.0:
            raise ValueError(f"risk {risk.name!r} period {j}: negative exposure")
        if mv == 0.0:
            if xv != 0.0:
                raise ValueError(
                    f"risk {risk.name!r} period {j}: non-zero loss rate with "
                    "zero exposure is inconsistent"
                )
            continue  # unobserved period — dropped
        xs.append(xv)
        ms.append(mv)
    return xs, ms


def buhlmann_straub(
    risks: list[RiskExperience], *, balance: bool = False
) -> dict[str, Any]:
    """Nonparametric Bühlmann-Straub credibility estimator.

    Returns the collective mean, EPV, VHM, credibility parameter K,
    per-risk exposure/mean/credibility/estimate, and (optionally) the
    balanced complement M̂_X with balanced per-risk estimates.
    """
    if len(risks) < 2:
        raise ValueError(
            f"Bühlmann-Straub needs >= 2 risks (between-risk variance is not "
            f"identifiable for a single risk), got {len(risks)}"
        )
    x_lists: list[list[float]] = []
    m_lists: list[list[float]] = []
    m_i: list[float] = []
    x_bar_i: list[float] = []
    dof = 0
    for risk in risks:
        xs, ms = _observed_periods(risk)
        if not ms:
            raise ValueError(f"risk {risk.name!r}: no observed (non-zero exposure) period")
        x_lists.append(xs)
        m_lists.append(ms)
        total_m = sum(ms)
        m_i.append(total_m)
        x_bar_i.append(sum(mv * xv for xv, mv in zip(xs, ms)) / total_m)
        dof += len(ms) - 1
    if dof < 1:
        raise ValueError(
            "Bühlmann-Straub needs at least one risk with >= 2 observed "
            "periods (EPV̂ has zero degrees of freedom)"
        )
    m = sum(m_i)
    denom = m - sum(mi * mi for mi in m_i) / m
    if denom <= 0.0:
        raise ValueError(
            f"VHM̂ denominator m − Σ m_i²/m is non-positive ({denom}); "
            "between-risk variance is not estimable for this portfolio"
        )
    x_bar = sum(mi * xi for mi, xi in zip(m_i, x_bar_i)) / m
    epv_num = sum(
        sum(mv * (xv - xb) ** 2 for xv, mv in zip(xs, ms))
        for xs, ms, xb in zip(x_lists, m_lists, x_bar_i)
    )
    epv = epv_num / dof
    if epv <= 0.0:
        raise ValueError(
            f"EPV̂ = {epv} <= 0: no within-risk variance in the data; "
            "the Bühlmann-Straub model is degenerate for this portfolio"
        )
    vhm_num = sum(mi * (xi - x_bar) ** 2 for mi, xi in zip(m_i, x_bar_i)) - (
        len(risks) - 1
    ) * epv
    vhm = vhm_num / denom
    if vhm <= 0.0:
        raise ValueError(
            f"VHM̂ = {vhm} <= 0: process variance overwhelms the variance "
            "between risks (Loss Data Analytics §9.6 degenerate case); "
            "Bühlmann-Straub parameters cannot be determined from this data"
        )
    k = epv / vhm
    z = [mi / (mi + k) for mi in m_i]
    estimate = [zi * xi + (1.0 - zi) * x_bar for zi, xi in zip(z, x_bar_i)]
    result: dict[str, Any] = {
        "collective_mean": float(x_bar),
        "epv": float(epv),
        "vhm": float(vhm),
        "k": float(k),
        "risks": [
            {
                "name": risk.name,
                "n_periods": len(m_lists[i]),
                "exposure_total": float(m_i[i]),
                "mean_per_exposure": float(x_bar_i[i]),
                "credibility_z": float(z[i]),
                "credibility_estimate": float(estimate[i]),
            }
            for i, risk in enumerate(risks)
        ],
        "method": "buhlmann_straub",
    }
    if balance:
        m_hat = sum(zi * xi for zi, xi in zip(z, x_bar_i)) / sum(z)
        balanced = [zi * xi + (1.0 - zi) * m_hat for zi, xi in zip(z, x_bar_i)]
        result["balanced_complement"] = float(m_hat)
        for i, entry in enumerate(result["risks"]):
            entry["balanced_estimate"] = float(balanced[i])
    return result
