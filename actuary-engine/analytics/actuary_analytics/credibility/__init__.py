"""Credibility estimators (F3).

buhlmann_straub: nonparametric exposure-weighted Bühlmann-Straub
empirical-Bayes credibility (Loss Data Analytics, Chapter 9 formulas and
Examples 9.6.3/9.6.6 goldens). Fail-closed on degenerate portfolios —
see the module docstring.
"""

from .buhlmann_straub import RiskExperience, buhlmann_straub

__all__ = [
    "RiskExperience",
    "buhlmann_straub",
]
