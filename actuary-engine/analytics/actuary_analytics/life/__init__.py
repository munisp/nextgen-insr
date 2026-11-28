"""Life engine: lifelines-based mortality analysis, annuity PV, profit
testing, and F3: Lee-Carter mortality model (SVD fit + random-walk
forecast).

Honest-labelling posture preserved and upgraded from actuarial-platform:
every shipped mortality basis carries ``official: false`` plus the
"not for statutory valuation" disclaimer until NAICOM-approved bases are
loaded (schema-enforced default; see assumptions module).
"""

from .annuity import annuity_pv, hand_annuity_pv
from .leecarter import lee_carter_fit, lee_carter_forecast
from .mortality import (
    DISCLAIMER,
    MortalityBasis,
    fit_kaplan_meier,
    fit_weibull,
    illustrate_bases,
    simulate_cohort,
    survival_from_qx,
)
from .profit_test import ProfitTestResult, profit_test

__all__ = [
    "DISCLAIMER",
    "MortalityBasis",
    "ProfitTestResult",
    "annuity_pv",
    "fit_kaplan_meier",
    "fit_weibull",
    "hand_annuity_pv",
    "illustrate_bases",
    "lee_carter_fit",
    "lee_carter_forecast",
    "profit_test",
    "simulate_cohort",
    "survival_from_qx",
]
