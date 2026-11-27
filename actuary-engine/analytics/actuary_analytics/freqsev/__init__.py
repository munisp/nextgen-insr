"""Frequency-severity GLM training (statsmodels) and artefact export."""

from .artefact import (
    ARTEFACT_TYPE,
    artefact_from_bytes,
    artefact_to_bytes,
    build_artefact,
)
from .glm import (
    GLMConfig,
    fit_gamma_severity,
    fit_poisson_frequency,
    fit_tweedie_pure_premium,
    train_freq_sev,
)

__all__ = [
    "ARTEFACT_TYPE",
    "GLMConfig",
    "artefact_from_bytes",
    "artefact_to_bytes",
    "build_artefact",
    "fit_gamma_severity",
    "fit_poisson_frequency",
    "fit_tweedie_pure_premium",
    "train_freq_sev",
]
