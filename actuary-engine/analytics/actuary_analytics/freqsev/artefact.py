"""GLM model artefact (design Appendix F schema) with deterministic export.

Canonical JSON: sorted keys, compact separators, floats rounded to 12
decimals. A fixed-seed refit reproduces the artefact byte-for-byte — that
is the Leg C acceptance property; trainedAt must be pinned by the caller
for byte-identity (the job pins it from config, never from the clock).
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

import numpy as np
import pandas as pd

from .glm import FittedGLMs

ARTEFACT_TYPE = "freq_sev_glm"
FLOAT_DECIMALS = 12


def _canonical_param_name(raw: str) -> str:
    """Map statsmodels formula names to the Appendix F naming style:
    Intercept -> intercept; C(age_band)[T.a2] -> age_band[a2]."""
    if raw == "Intercept":
        return "intercept"
    if raw.startswith("C(") and ")[T." in raw:
        var = raw[2 : raw.index(")")]
        level = raw[raw.index("[T.") + 3 : -1]
        return f"{var}[{level}]"
    return raw


def _coef_dict(params) -> dict[str, float]:
    out: dict[str, float] = {}
    for name, value in params.items():
        out[_canonical_param_name(str(name))] = round(float(value), FLOAT_DECIMALS)
    return out


def _relativities(params, cat_vars) -> dict[str, dict[str, float]]:
    """exp(beta) per category with baseline = 1.0 (reference level)."""
    coefs = _coef_dict(params)
    rels: dict[str, dict[str, float]] = {v: {} for v in cat_vars}
    for name, beta in coefs.items():
        if name == "intercept" or "[" not in name:
            continue
        var, level = name.split("[", 1)
        level = level.rstrip("]")
        if var in rels:
            rels[var][level] = round(float(math.exp(beta)), FLOAT_DECIMALS)
    for var, levels in rels.items():
        if levels:
            baseline = min(levels)
            levels.setdefault(baseline, 1.0)
    return {k: v for k, v in rels.items() if v}


def _gini(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Gini concentration of the severity fit on claim-positive rows."""
    order = np.argsort(predicted)
    sorted_actual = np.asarray(actual, dtype=float)[order]
    n = len(sorted_actual)
    cum = np.cumsum(sorted_actual)
    if n == 0 or cum[-1] == 0:
        return 0.0
    lorenz = cum / cum[-1]
    return round(float(1.0 - 2.0 * (np.sum(lorenz) / n - 0.5)), FLOAT_DECIMALS)


def dataset_hash(df: pd.DataFrame) -> str:
    """sha256 over canonical CSV bytes of the training dataframe."""
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(csv_bytes).hexdigest()


def build_artefact(
    fitted: FittedGLMs,
    df: pd.DataFrame,
    *,
    trained_at: str,
    provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the Appendix F artefact dict from real fitted GLMs."""
    freq_coefs = _coef_dict(fitted.freq.params)
    sev_coefs = _coef_dict(fitted.sev.params)
    base_frequency = round(float(math.exp(freq_coefs["intercept"])), FLOAT_DECIMALS)
    base_severity_kobo = round(math.exp(sev_coefs["intercept"]) * 100)
    pos = df[df["claims"] > 0]
    gini_sev = _gini(pos["severity"].to_numpy(), np.asarray(fitted.sev.fittedvalues))
    artefact: dict[str, Any] = {
        "artefactType": ARTEFACT_TYPE,
        "productLine": fitted.config.product_line,
        "version": fitted.config.version,
        "frequency": {
            "family": "poisson",
            "link": "log",
            "coefficients": freq_coefs,
            "base_frequency": base_frequency,
        },
        "severity": {
            "family": "gamma",
            "link": "log",
            "coefficients": sev_coefs,
            "base_severity_kobo": base_severity_kobo,
        },
        "relativities": {
            "frequency": _relativities(fitted.freq.params, fitted.config.cat_vars),
            "severity": _relativities(fitted.sev.params, fitted.config.cat_vars),
        },
        "exposureUnit": fitted.config.exposure_unit,
        "training": {
            "datasetHash": dataset_hash(df),
            "trainedAt": trained_at,
            "metrics": {
                "devianceFreq": round(float(fitted.freq.deviance), FLOAT_DECIMALS),
                "giniSev": gini_sev,
                "nObs": len(df),
                "nClaims": int(df["claims"].gt(0).sum()),
            },
        },
        "provenance": provenance
        or {"modelRegistryId": None, "approvedBy": None, "naicomFilingRef": None},
    }
    if fitted.tweedie is not None:
        artefact["tweedie"] = {
            "family": "tweedie",
            "link": "log",
            "varPower": fitted.config.tweedie_var_power,
            "coefficients": _coef_dict(fitted.tweedie.params),
        }
    return artefact


def artefact_to_bytes(artefact: dict[str, Any]) -> bytes:
    """Canonical JSON bytes (sorted keys, compact separators, trailing \n)."""
    return (
        json.dumps(artefact, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def artefact_from_bytes(payload: bytes) -> dict[str, Any]:
    return json.loads(payload.decode("utf-8"))
