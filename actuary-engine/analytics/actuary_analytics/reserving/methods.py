"""Chain-ladder / Bornhuetter-Ferguson / Mack wrappers on the chainladder lib.

All estimators are real chainladder calls (cl.Development, cl.Chainladder,
cl.BornhuetterFerguson, cl.MackChainladder). hand_bf_blend is the explicit
textbook blend used by acceptance tests to verify the library result
against a hand computation — it is not used on any production compute path.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

import chainladder as cl
import numpy as np
import pandas as pd

from .data_source import DataSourceUnavailableError


def triangle_dict_to_chainladder(triangle: Mapping[str, list[float]]) -> cl.Triangle:
    """Convert the absorbed platform's cumulative triangle dict
    {year_label: [cum_dev0, ...]} into a chainladder Triangle (annual grain)."""
    rows: list[dict[str, Any]] = []
    for label, values in triangle.items():
        year = int(str(label)[:4])
        for dev_idx, cum in enumerate(values):
            rows.append(
                {
                    "origin": pd.Timestamp(year=year, month=1, day=1),
                    "dev": pd.Timestamp(year=year + dev_idx, month=12, day=31),
                    "value": float(cum),
                }
            )
    if not rows:
        raise DataSourceUnavailableError("loss triangle")
    df = pd.DataFrame(rows)
    return cl.Triangle(  # type: ignore[abstract]  # chainladder stubs mark Triangle abstract; runtime constructor is real
        df, origin="origin", development="dev", columns="value", cumulative=True
    )


def development(tri: cl.Triangle, average: Literal["volume", "simple", "regression", "geometric"] = "volume") -> cl.Development:
    """Fit cl.Development (volume-weighted by default; 'simple' also supported)."""
    return cl.Development(average=average).fit_transform(tri)


def chain_ladder(
    tri: cl.Triangle, *, average: Literal["volume", "simple", "regression", "geometric"] = "volume"
) -> dict[str, Any]:
    """Deterministic chain-ladder on a cumulative triangle.

    Returns development factors, CDFs, per-origin latest/ultimate/IBNR and
    the total IBNR reserve — all computed by the chainladder library.
    """
    dev = development(tri, average=average)
    model = cl.Chainladder().fit(dev)
    origins = [str(o) for o in model.ultimate_.origin]
    ultimate = model.ultimate_.values.ravel()
    # ibnr_ is a latest-diagonal view: shape (…, n_origins, 1); ravel is safe.
    ibnr = np.nan_to_num(model.ibnr_.values.ravel(), nan=0.0)
    ibnr_list = ibnr.tolist()
    ultimate_dict = {o: float(u) for o, u in zip(origins, ultimate)}
    ibnr_dict = {o: float(v) for o, v in zip(origins, ibnr_list)}
    return {
        "development_factors": [float(f) for f in dev.ldf_.values.ravel()],
        "cdfs": [float(c) for c in dev.cdf_.values.ravel()],
        "ultimate_by_origin": ultimate_dict,
        "ibnr_by_origin": ibnr_dict,
        "total_ibnr": float(np.sum(ibnr_list)),
        "average": average,
    }


def bornhuetter_ferguson(
    tri: cl.Triangle,
    apriori_ultimates: np.ndarray,
    *,
    average: Literal["volume", "simple", "regression", "geometric"] = "volume",
) -> dict[str, Any]:
    """Bornhuetter-Ferguson with explicit a priori ultimates (e.g. priced
    loss ratio × earned premium — closes the price↔reserve loop).

    The a priori vector is handed to cl.BornhuetterFerguson via an exposure
    sample weight of 1.0 per origin with apriori = a_priori_ultimate, which
    is mathematically identical to the textbook blend
    ultimate = latest + a_priori * (1 - 1/CDF) and is verified against the
    hand computation in the acceptance tests.
    """
    n_origins = tri.shape[2]
    apriori_ultimates = np.asarray(apriori_ultimates, dtype=float)
    if apriori_ultimates.shape != (n_origins,):
        raise ValueError(
            f"apriori_ultimates length {apriori_ultimates.shape} != origins {n_origins}"
        )
    dev = development(tri, average=average)
    model = cl.BornhuetterFerguson(apriori=1.0).fit(
        dev, sample_weight=_apriori_weight_triangle(tri, apriori_ultimates)
    )
    origins = [str(o) for o in tri.origin]
    latest = tri.latest_diagonal.values.ravel()
    # BF ultimates are stored by chainladder on the first development column.
    ult_grid = np.array(model.ultimate_.values).reshape(n_origins, model.ultimate_.shape[-1])
    ultimate = ult_grid[:, 0]
    ibnr = ultimate - latest
    return {
        "development_factors": [float(f) for f in dev.ldf_.values.ravel()],
        "cdfs": [float(c) for c in dev.cdf_.values.ravel()],
        "apriori_by_origin": {o: float(a) for o, a in zip(origins, apriori_ultimates)},
        "ultimate_by_origin": {o: float(u) for o, u in zip(origins, ultimate)},
        "ibnr_by_origin": {o: float(v) for o, v in zip(origins, ibnr)},
        "total_ibnr": float(np.nansum(ibnr)),
        "average": average,
        "method": "bornhuetter_ferguson",
    }


def _apriori_weight_triangle(tri: cl.Triangle, apriori: np.ndarray) -> cl.Triangle:
    """Exposure triangle carrying one value per origin (dev 12). Used both
    for BF a priori ultimates and Cape Cod earned-premium exposure."""
    rows = []
    for origin, a in zip(tri.origin, apriori):
        year = origin.year
        rows.append(
            {
                "origin": pd.Timestamp(year=year, month=1, day=1),
                "dev": pd.Timestamp(year=year, month=12, day=31),
                "weight": float(a),
            }
        )
    return cl.Triangle(  # type: ignore[abstract]  # chainladder stubs mark Triangle abstract; runtime constructor is real
        pd.DataFrame(rows), origin="origin", development="dev", columns="weight",
        cumulative=True,
    )


def mack(tri: cl.Triangle, *, average: Literal["volume", "simple", "regression", "geometric"] = "volume") -> dict[str, Any]:
    """Mack chain-ladder: ultimates plus parameter-uncertainty standard
    errors per origin and in total (feeds the IFRS 17 risk adjustment at the
    75th percentile convention adopted by ifrs17-engine)."""
    dev = development(tri, average=average)
    model = cl.MackChainladder().fit(dev)
    summary = model.summary_.to_frame()
    latest = summary["Latest"].to_dict()
    ibnr = summary["IBNR"].to_dict()
    ultimate = summary["Ultimate"].to_dict()
    mack_se = summary["Mack Std Err"].to_dict()
    origins = [str(k.year) if hasattr(k, "year") else str(k) for k in summary.index]
    def _clean(d: dict[Any, Any]) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for (k, v) in zip(origins, d.values()):
            out[k] = None if pd.isna(v) else float(v)
        return out
    return {
        "development_factors": [float(f) for f in dev.ldf_.values.ravel()],
        "latest_by_origin": _clean(latest),
        "ultimate_by_origin": _clean(ultimate),
        "ibnr_by_origin": _clean(ibnr),
        "mack_se_by_origin": _clean(mack_se),
        "total_ibnr": float(np.nansum(list(ibnr.values()))),
        "total_mack_se": float(model.total_mack_std_err_.values.ravel()[0]),
        "average": average,
        "method": "mack",
    }


def bootstrap_odp(
    tri: cl.Triangle,
    *,
    n_sims: int = 1000,
    random_state: int = 42,
) -> dict[str, Any]:
    """Bootstrap ODP chain-ladder (reserving standard error extension, F2).

    cl.BootstrapODPSample resamples incremental residuals `n_sims` times;
    each replicate runs the chainladder pipeline (cl.Development +
    cl.Chainladder). Returns per-origin IBNR mean and bootstrap standard
    error, plus totals. Deterministic under the fixed `random_state` — the
    RAA goldens in tests/data/reserving_extensions_raa.json are pinned from
    this pipeline, with an R-reference bridge documented in the test file.
    """
    if n_sims <= 0:
        raise ValueError(f"n_sims must be positive, got {n_sims}")
    sampled = cl.BootstrapODPSample(n_sims=n_sims, random_state=random_state).fit_transform(tri)
    dev = cl.Development().fit_transform(sampled)
    model = cl.Chainladder().fit(dev)
    # ibnr_: (n_sims, 1, n_origins, 1); fully-developed origins are NaN.
    sims = np.asarray(model.ibnr_.values)
    origins = [str(o) for o in tri.origin]

    def _clean(arr: np.ndarray) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for o, v in zip(origins, arr):
            out[o] = None if np.isnan(v) else float(v)
        return out

    per_mean = np.nanmean(sims, axis=0).ravel()
    per_std = np.nanstd(sims, axis=0, ddof=1).ravel()
    totals = np.nansum(sims, axis=tuple(range(1, sims.ndim)))
    # Bootstrap ultimate = latest + mean IBNR (fully-developed origins get
    # mean IBNR = NaN from empty sims and fall back to latest).
    latest = tri.latest_diagonal.values.ravel()
    ult_mean = latest + np.where(np.isnan(per_mean), 0.0, per_mean)
    return {
        "ibnr_mean_by_origin": _clean(per_mean),
        "ibnr_std_by_origin": _clean(per_std),
        "ultimate_mean_by_origin": {o: float(v) for o, v in zip(origins, ult_mean)},
        "total_ibnr_mean": float(np.mean(totals)),
        "total_ibnr_std": float(np.std(totals, ddof=1)),
        "n_sims": n_sims,
        "random_state": random_state,
        "method": "bootstrap_odp",
    }


def cape_cod(
    tri: cl.Triangle,
    earned_premium: np.ndarray,
) -> dict[str, Any]:
    """Cape Cod reserving (F2 extension).

    cl.CapeCod derives the a priori loss ratio per origin from the
    earned-premium exposure and the chain-ladder pattern; ultimates and IBNR
    follow. `earned_premium` is a per-origin exposure vector (earned
    premium); it is documented as caller-supplied assumption data, never
    fabricated inside the module.
    """
    n_origins = tri.shape[2]
    earned_premium = np.asarray(earned_premium, dtype=float)
    if earned_premium.shape != (n_origins,):
        raise ValueError(
            f"earned_premium length {earned_premium.shape} != origins {n_origins}"
        )
    if np.any(earned_premium <= 0.0) or np.any(~np.isfinite(earned_premium)):
        raise ValueError("earned_premium must be positive and finite")
    model = cl.CapeCod().fit(
        tri, sample_weight=_apriori_weight_triangle(tri, earned_premium)
    )
    origins = [str(o) for o in tri.origin]
    latest = tri.latest_diagonal.values.ravel()
    ult_grid = np.array(model.ultimate_.values).reshape(
        n_origins, model.ultimate_.shape[-1]
    )
    ultimate = ult_grid[:, 0]
    ibnr = ultimate - latest
    apriori = np.asarray(model.apriori_.values).ravel()
    return {
        "ultimate_by_origin": {o: float(u) for o, u in zip(origins, ultimate)},
        "ibnr_by_origin": {o: float(v) for o, v in zip(origins, ibnr)},
        "total_ibnr": float(np.nansum(ibnr)),
        "apriori": float(apriori[0]),
        "earned_premium": [float(p) for p in earned_premium],
        "method": "cape_cod",
    }


def clark(tri: cl.Triangle) -> dict[str, Any]:
    """Clark LDF method (F2 extension).

    cl.ClarkLDF fits a loglogistic growth curve to the incremental losses
    (chainladder 0.10.1 defaults), producing LDFs that follow the growth
    curve instead of volume-weighted averages; ultimates come from the
    chain-ladder application of those LDFs.
    """
    clark_tri = cl.ClarkLDF().fit_transform(tri)
    model = cl.Chainladder().fit(clark_tri)
    origins = [str(o) for o in tri.origin]
    latest = tri.latest_diagonal.values.ravel()
    n_origins = tri.shape[2]
    ult_grid = np.array(model.ultimate_.values).reshape(
        n_origins, model.ultimate_.shape[-1]
    )
    ultimate = ult_grid[:, 0]
    ibnr = ultimate - latest
    return {
        "growth": "loglogistic",
        "development_factors": [
            float(f) for f in np.asarray(clark_tri.ldf_.values).ravel()
        ],
        "ultimate_by_origin": {o: float(u) for o, u in zip(origins, ultimate)},
        "ibnr_by_origin": {o: float(v) for o, v in zip(origins, ibnr)},
        "total_ibnr": float(np.nansum(ibnr)),
        "method": "clark",
    }


def hand_bf_blend(
    triangle_values: np.ndarray,
    apriori_ultimates: np.ndarray,
) -> dict[str, Any]:
    """Textbook BF blend, computed explicitly for golden verification.

    triangle_values: (n_origins, n_devs) cumulative array with np.nan in the
    unknown lower triangle. Returns hand-computed volume-weighted LDFs,
    CDFs and BF ultimates (latest + a_priori * (1 - 1/CDF)).
    """
    tri = np.asarray(triangle_values, dtype=float)
    observed = ~np.isnan(tri)
    ldf: list[float] = []
    for j in range(tri.shape[1] - 1):
        both = observed[:, j] & observed[:, j + 1]
        ldf.append(float(np.sum(tri[both, j + 1]) / np.sum(tri[both, j])))
    cdf = [float(np.prod(ldf[j:])) for j in range(len(ldf))] + [1.0]
    latest = tri[np.arange(tri.shape[0]), observed.sum(axis=1) - 1]
    n_obs = observed.sum(axis=1)
    apriori = np.asarray(apriori_ultimates, dtype=float)
    ultimate = latest + apriori * (1.0 - 1.0 / np.array(cdf)[n_obs - 1])
    return {
        "ldfs": ldf,
        "cdfs": cdf,
        "latest": latest.tolist(),
        "ultimate": ultimate.tolist(),
        "ibnr": (ultimate - latest).tolist(),
    }


def volume_weighted_ldfs(triangle_values: np.ndarray) -> list[float]:
    """Volume-weighted age-to-age factors on a raw cumulative array (used by
    tests to verify the library against the textbook formula)."""
    return hand_bf_blend(triangle_values, np.zeros(len(triangle_values)))["ldfs"]
