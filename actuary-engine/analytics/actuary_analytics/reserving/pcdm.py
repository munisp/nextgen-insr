"""PCDM — Paid Chain-ladder Development Method (F3).

Reserve estimator on the *paid* cumulative triangle (the Drizzle claims
subset: cumulative paid-to-date per origin × development period). Unlike
the incurred chain-ladder, the PCDM reserve is the full remaining-payment
estimate, ultimate_paid − paid_to_date, i.e. case outstanding + IBNR on a
payment basis. Ultimate projections come from real chainladder calls
(cl.Development + cl.Chainladder), consistent with the F1/F2 methods
modules; the paid-specific validation here is fail-closed:

* cumulative paid amounts must be non-negative and non-decreasing across
  development periods within each origin (a decrease implies a negative
  incremental payment — salvage/recovery triangles are out of scope and
  must not pass silently);
* at least two origins and two development periods are required, and
  every adjacent development pair must be observed by at least one
  origin, otherwise no age-to-age factor can be formed.

Golden provenance: tests/data/pcdm_golden.json pins values recomputed by
an independent direct-numpy textbook loop (volume-weighted LDFs, CDF
cumproducts, ultimate = latest × CDF) — see tests/test_pcdm.py for the
exact receipt. No self-referential goldens.
"""

from __future__ import annotations

from typing import Any, Literal

import chainladder as cl
import numpy as np


def _paid_cumulative_array(paid_tri: cl.Triangle) -> np.ndarray:
    """(n_origins, n_devs) cumulative paid array, NaN in the unobserved
    lower triangle."""
    frame = paid_tri.to_frame(origin_as_datetime=False)
    return np.asarray(frame, dtype=float)


def _validate_paid_triangle(values: np.ndarray) -> None:
    """Fail-closed paid-triangle validation (see module docstring)."""
    if values.ndim != 2:
        raise ValueError(f"paid triangle must be 2-D, got ndim={values.ndim}")
    n_origins, n_devs = values.shape
    if n_origins < 2 or n_devs < 2:
        raise ValueError(
            f"PCDM needs >= 2 origins and >= 2 development periods, "
            f"got {n_origins}x{n_devs}"
        )
    observed = ~np.isnan(values)
    if np.any(values[observed] < 0.0):
        raise ValueError("paid triangle contains negative paid amounts")
    if observed.sum(axis=1).min() < 1:
        raise ValueError("every origin needs >= 1 observed paid amount")
    for j in range(n_devs - 1):
        both = observed[:, j] & observed[:, j + 1]
        if not both.any():
            raise ValueError(
                f"no origin has both development periods {j} and {j + 1} "
                "observed; the age-to-age factor cannot be formed"
            )
    for i in range(n_origins):
        row = values[i, observed[i]]
        if np.any(np.diff(row) < 0.0):
            raise ValueError(
                f"origin {i}: cumulative paid decreases across development "
                "periods (negative incremental payment); salvage/recovery "
                "triangles are out of PCDM scope"
            )


def pcdm(
    paid_tri: cl.Triangle,
    *,
    average: Literal["volume", "simple", "regression", "geometric"] = "volume",
) -> dict[str, Any]:
    """Paid Chain-ladder Development Method reserve estimator.

    paid_tri: cumulative *paid* triangle (payment basis). Returns
    development factors, CDFs, per-origin paid-to-date, ultimate and
    reserve (ultimate − paid-to-date — remaining payments, i.e. case
    outstanding + IBNR on a payment basis), plus the total reserve.
    """
    values = _paid_cumulative_array(paid_tri)
    _validate_paid_triangle(values)
    dev = cl.Development(average=average).fit_transform(paid_tri)
    model = cl.Chainladder().fit(dev)
    origins = [str(o) for o in model.ultimate_.origin]
    latest = np.asarray(paid_tri.latest_diagonal.values, dtype=float).ravel()
    ultimate = np.asarray(model.ultimate_.values, dtype=float).ravel()
    reserve = ultimate - latest
    return {
        "development_factors": [float(f) for f in dev.ldf_.values.ravel()],
        "cdfs": [float(c) for c in dev.cdf_.values.ravel()],
        "paid_to_date_by_origin": {o: float(v) for o, v in zip(origins, latest)},
        "ultimate_by_origin": {o: float(u) for o, u in zip(origins, ultimate)},
        "reserve_by_origin": {o: float(r) for o, r in zip(origins, reserve)},
        "total_reserve": float(np.sum(reserve)),
        "average": average,
        "method": "pcdm",
    }
