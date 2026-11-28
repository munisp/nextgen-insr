"""Lee-Carter mortality model (F3).

SVD-based fit of the Lee & Carter (1992) model on a central death-rate
matrix m_x,t (ages × years):

    log m_x,t = α_x + β_x κ_t + ε_x,t

* α_x = mean over years of log m_x,t  (age profile);
* A = log m − α;  first singular triplet of A gives β and κ with the
  standard normalization Σ_x β_x = 1 (κ absorbs the scale) and the sign
  convention Σ_x β_x > 0 before scaling (β sums to +1; for the fixture,
  all β_x > 0);
* κ_t is forecast as a random walk with drift
  δ = (κ_T − κ_1)/(T − 1), κ̂_{T+h} = κ_T + h·δ; forecast rates
  m̂_x,T+h = exp(α_x + β_x κ̂_{T+h}).

The fixture and the goldens are fully deterministic (no network, no
random draws): the golden JSON pins values recomputed independently via
an eigendecomposition of AᵀA (np.linalg.eigh on the Gram matrix — a
different linear-algebra path than np.linalg.svd used here), receipt in
tests/test_lee_carter.py. Tolerance justification is documented there.

Fail-closed: non-positive or non-finite m_x,t (log undefined), fewer
than two ages/years, or a rank-deficient centred matrix (rank < 1, i.e.
log-mortality identical across all ages — the model is not identifiable)
raise honest errors; no silent defaults.
"""

from __future__ import annotations

from typing import Any

import numpy as np

RANK_TOL = 1e-10


def lee_carter_fit(mx: np.ndarray) -> dict[str, Any]:
    """Fit the Lee-Carter model on a central death-rate matrix.

    mx: (n_ages, n_years) array of strictly positive central death rates.
    Returns alpha, beta (Σβ = 1), kappa, the random-walk drift, and the
    rank-1 reconstruction error as an honest fit-quality diagnostic.
    """
    m = np.asarray(mx, dtype=float)
    if m.ndim != 2:
        raise ValueError(f"mortality matrix must be 2-D, got ndim={m.ndim}")
    n_ages, n_years = m.shape
    if n_ages < 2 or n_years < 2:
        raise ValueError(
            f"Lee-Carter needs >= 2 ages and >= 2 years, got {n_ages}x{n_years}"
        )
    if np.any(~np.isfinite(m)) or np.any(m <= 0.0):
        raise ValueError(
            "mortality rates must be finite and strictly positive "
            "(log m is undefined otherwise)"
        )
    logm = np.log(m)
    alpha = logm.mean(axis=1)
    a_centered = logm - alpha[:, None]
    # Fail-closed identifiability check: a rank-0 centred matrix means the
    # age profile explains everything and β/κ are not identifiable.
    rank = int(np.linalg.matrix_rank(a_centered, tol=RANK_TOL))
    if rank < 1:
        raise ValueError(
            "centred log-mortality matrix is rank-deficient (rank < 1): "
            "log rates are identical across ages, so the Lee-Carter "
            "decomposition is not identifiable"
        )
    u, s, vt = np.linalg.svd(a_centered)
    beta_raw = u[:, 0] * s[0]
    kappa_raw = vt[0, :]
    scale = beta_raw.sum()
    if scale == 0.0:  # fail-closed: normalization would divide by zero
        raise ValueError(
            "Lee-Carter normalization is degenerate: Σ_x β_x = 0; the "
            "Σβ = 1 identification is unavailable for this matrix"
        )
    if scale < 0.0:  # sign convention: Σ_x β_x > 0 (Σβ = 1 after scaling)
        beta_raw = -beta_raw
        kappa_raw = -kappa_raw
        scale = -scale
    beta = beta_raw / scale
    kappa = kappa_raw * scale
    drift = float((kappa[-1] - kappa[0]) / (n_years - 1))
    recon = alpha[:, None] + np.outer(beta, kappa)
    resid = logm - recon
    return {
        "alpha": [float(v) for v in alpha],
        "beta": [float(v) for v in beta],
        "kappa": [float(v) for v in kappa],
        "drift": drift,
        "rank": rank,
        "residual_rmse": float(np.sqrt(np.mean(resid**2))),
        "n_ages": n_ages,
        "n_years": n_years,
        "method": "lee_carter",
    }


def lee_carter_forecast(fit: dict[str, Any], horizon: int) -> dict[str, Any]:
    """Random-walk-with-drift forecast of κ and the implied death rates."""
    if horizon < 1:
        raise ValueError(f"horizon must be >= 1, got {horizon}")
    alpha = np.asarray(fit["alpha"], dtype=float)
    beta = np.asarray(fit["beta"], dtype=float)
    kappa = np.asarray(fit["kappa"], dtype=float)
    drift = float(fit["drift"])
    h = np.arange(1, horizon + 1, dtype=float)
    kappa_fc = kappa[-1] + h * drift
    logm_fc = alpha[:, None] + np.outer(beta, kappa_fc)
    return {
        "horizon": horizon,
        "kappa_forecast": [float(v) for v in kappa_fc],
        "mx_forecast": [[float(v) for v in row] for row in np.exp(logm_fc)],
    }
