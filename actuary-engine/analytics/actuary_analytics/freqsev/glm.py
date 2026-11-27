"""Frequency-severity GLMs on statsmodels (real fits, no mocks).

Poisson frequency with a log-exposure offset; Gamma severity on
claim-positive rows; optional Tweedie pure premium. Deterministic: given
the same dataset and versions, IRLS converges to identical coefficients,
which is what the byte-identical artefact acceptance test pins down.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf


@dataclass(frozen=True)
class GLMConfig:
    product_line: str = "motor"
    version: str = "2026.09"
    exposure_unit: str = "vehicle_year"
    cat_vars: tuple = ("age_band", "vehicle_class", "territory")
    tweedie_var_power: float = 1.6


def _formula(target: str, cat_vars) -> str:
    return f"{target} ~ " + " + ".join(f"C({v})" for v in cat_vars)


def fit_poisson_frequency(
    df: pd.DataFrame, config: GLMConfig = GLMConfig()
) -> sm.genmod.generalized_linear_model.GLMResultsWrapper:
    """Poisson frequency GLM (log link) with log-exposure offset."""
    return smf.glm(
        _formula("claims", config.cat_vars),
        data=df,
        family=sm.families.Poisson(link=sm.families.links.Log()),
        offset=np.log(df["exposure"].astype(float)),
    ).fit()


def fit_gamma_severity(
    df: pd.DataFrame, config: GLMConfig = GLMConfig()
) -> sm.genmod.generalized_linear_model.GLMResultsWrapper:
    """Gamma severity GLM (log link) on claim-positive rows."""
    pos = df[df["claims"] > 0]
    return smf.glm(
        _formula("severity", config.cat_vars),
        data=pos,
        family=sm.families.Gamma(link=sm.families.links.Log()),
    ).fit()


def fit_tweedie_pure_premium(
    df: pd.DataFrame, config: GLMConfig = GLMConfig()
) -> sm.genmod.generalized_linear_model.GLMResultsWrapper:
    """Tweedie pure-premium GLM (log link, variance power from config)."""
    return smf.glm(
        _formula("severity", config.cat_vars),
        data=df,
        family=sm.families.Tweedie(
            link=sm.families.links.Log(), var_power=config.tweedie_var_power
        ),
        offset=np.log(df["exposure"].astype(float)),
    ).fit()


@dataclass
class FittedGLMs:
    freq: sm.genmod.generalized_linear_model.GLMResultsWrapper
    sev: sm.genmod.generalized_linear_model.GLMResultsWrapper
    tweedie: sm.genmod.generalized_linear_model.GLMResultsWrapper | None
    config: GLMConfig


def train_freq_sev(
    df: pd.DataFrame, config: GLMConfig = GLMConfig(), fit_tweedie: bool = False
) -> FittedGLMs:
    """Train the frequency and severity GLMs (real statsmodels fits)."""
    return FittedGLMs(
        freq=fit_poisson_frequency(df, config),
        sev=fit_gamma_severity(df, config),
        tweedie=fit_tweedie_pure_premium(df, config) if fit_tweedie else None,
        config=config,
    )
