"""Mortality bases + lifelines fits.

Every basis shipped here is ILLUSTRATIVE (official=False) — preserving the
actuarial-platform honest-labelling posture verbatim until NAICOM-approved
bases are loaded by compliance (design §6 item 3).

lifelines is used for the real fits: KaplanMeierFitter and WeibullFitter on
a synthetic cohort simulated from a qx grid (fixed seed → deterministic).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from lifelines import KaplanMeierFitter, WeibullFitter
from lifelines.utils import qth_survival_times

DISCLAIMER = (
    "These tables are illustrative/reference rates for demonstration and "
    "calibration only. They are NOT official published mortality tables and "
    "must not be used for statutory valuation or pricing filings."
)


@dataclass(frozen=True)
class MortalityBasis:
    """A versioned qx grid. ``official`` is schema-enforced False unless a
    NAICOM-approved basis is loaded through the assumptions module."""

    code: str
    name: str
    basis: str  # A67_70 | SA85_90 | NAICOM_APPROVED | INTERNAL_EXPERIENCE
    gender: str
    ages: list[int]
    qx: list[float]
    source: str
    status: str = "illustrative_reference"
    official: bool = False
    disclaimer: str = DISCLAIMER

    def survival_curve(self, entry_age: int) -> np.ndarray:
        """t_p_x for t = 1..(max_age-entry_age) derived from the qx grid."""
        idx0 = self.ages.index(entry_age) if entry_age in self.ages else None
        if idx0 is None:
            raise ValueError(f"entry age {entry_age} not in grid")
        px = 1.0 - np.asarray(self.qx, dtype=float)
        return np.cumprod(px[idx0:])

    def qx_at(self, age: int) -> float:
        if age not in self.ages:
            raise ValueError(f"age {age} not in grid")
        return float(self.qx[self.ages.index(age)])


def _makeham_style_grid(
    code: str,
    name: str,
    basis: str,
    source: str,
    ages: range,
    a: float,
    b: float,
    k: float,
) -> MortalityBasis:
    ages_list = list(ages)
    qx = np.clip(a + b * np.exp(k * (np.asarray(ages_list) - ages_list[0])), 0.0, 0.95)
    return MortalityBasis(
        code=code,
        name=name,
        basis=basis,
        gender="unisex",
        ages=ages_list,
        qx=[round(float(v), 8) for v in qx],
        source=source,
    )


def illustrate_bases() -> list[MortalityBasis]:
    """The two illustrative bases carried over from actuarial-platform plus
    the smoothed grid used by the life engine tests. ALL are official=False
    with the statutory disclaimer."""
    # Platform sample rates kept visible for the API contract.
    nga_sample = {
        "20": 0.00120, "30": 0.00180, "40": 0.00350,
        "50": 0.00780, "60": 0.01650, "70": 0.03800,
    }
    nga = MortalityBasis(
        code="ILLUSTRATIVE-NGA-2020",
        name="Illustrative Nigerian Mortality Reference 2020 (not an official table)",
        basis="INTERNAL_EXPERIENCE",
        gender="unisex",
        ages=list(range(101)),
        qx=[float(nga_sample.get(str(a), 0.0)) for a in range(101)],
        source="Illustrative reference rates — NOT published by NBS/NAICOM",
    )
    afri = _makeham_style_grid(
        code="ILLUSTRATIVE-AFRI-STD-2023",
        name="Illustrative Pan-African Mortality Reference 2023 (not an official table)",
        basis="INTERNAL_EXPERIENCE",
        source="Illustrative reference rates — NOT an official published table",
        ages=range(15, 86),
        a=0.0025, b=0.0006, k=0.092,
    )
    smoothed = _makeham_style_grid(
        code="ILLUSTRATIVE-SMOOTHED-GM",
        name="Illustrative smoothed graduation (Gompertz-Makeham shape, not official)",
        basis="INTERNAL_EXPERIENCE",
        source="Smoothed illustrative graduation for engine tests — NOT an official table",
        ages=range(20, 91),
        a=0.003, b=0.0006, k=0.095,
    )
    return [nga, afri, smoothed]


def survival_from_qx(qx: np.ndarray, entry_age: int, ages: np.ndarray) -> np.ndarray:
    """Survival probabilities t_p_x from a qx grid (deterministic)."""
    px = 1.0 - np.asarray(qx, dtype=float)
    idx = int(np.where(np.asarray(ages) == entry_age)[0][0])
    return np.cumprod(px[idx:])


def simulate_cohort(
    qx: np.ndarray,
    ages: np.ndarray,
    entry_age: int,
    n_lives: int,
    seed: int,
    max_age: int | None = None,
) -> dict[str, np.ndarray]:
    """Simulate a deterministic cohort from a qx grid.

    Each life is followed from entry_age; the annual death indicator is a
    seeded uniform draw against qx. Returns durations (years from entry) and
    an event-observed flag. Censoring happens only at max_age (end of grid).
    """
    rng = np.random.default_rng(seed)
    qx = np.asarray(qx, dtype=float)
    ages = np.asarray(ages, dtype=int)
    max_age = max_age or int(ages.max())
    idx0 = int(np.where(ages == entry_age)[0][0])
    span = ages[idx0:]
    span = span[span <= max_age]
    uniforms = rng.uniform(size=(n_lives, len(span)))
    T = np.full(n_lives, np.nan)
    alive = np.ones(n_lives, dtype=bool)
    for j, age in enumerate(span):
        i = int(np.where(ages == age)[0][0])
        die = alive & (uniforms[:, j] < qx[i])
        T[die] = (age - entry_age) + rng.uniform(0.25, 0.75, size=int(die.sum()))
        alive[die] = False
    observed = ~np.isnan(T)
    durations = np.where(observed, T, float(max_age + 1 - entry_age))
    return {"durations": durations, "event_observed": observed}


def fit_kaplan_meier(durations: np.ndarray, event_observed: np.ndarray) -> KaplanMeierFitter:
    """Real lifelines Kaplan-Meier fit."""
    return KaplanMeierFitter().fit(durations, event_observed)


def fit_weibull(durations: np.ndarray, event_observed: np.ndarray) -> WeibullFitter:
    """Real lifelines Weibull parametric fit."""
    return WeibullFitter().fit(durations, event_observed)


def km_quantiles(kmf: KaplanMeierFitter) -> dict[str, float]:
    sf = kmf.survival_function_
    return {
        "s0.75": float(qth_survival_times(0.75, sf)),
        "s0.50": float(qth_survival_times(0.50, sf)),
        "s0.25": float(qth_survival_times(0.25, sf)),
    }
