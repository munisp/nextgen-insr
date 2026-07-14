"""
MCMC Bayesian Risk Modeling — NumPyro

Real Bayesian hierarchical model for insurance risk estimation:
- Hierarchical loss frequency model (Poisson-Gamma)
- Loss severity model (Lognormal)
- Combined aggregate loss distribution
- VaR and CVaR estimation from posterior samples

Uses NumPyro + JAX for efficient MCMC sampling (NUTS).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

import jax
import jax.numpy as jnp
import numpyro
import numpyro.distributions as dist
from numpyro.infer import MCMC, NUTS, Predictive


# Use CPU
numpyro.set_platform("cpu")


def loss_frequency_model(
    exposure: jnp.ndarray,
    product_idx: jnp.ndarray,
    n_products: int,
    observed_counts: jnp.ndarray | None = None,
) -> None:
    """Hierarchical Poisson-Gamma frequency model.

    Each product line has its own loss rate, drawn from a shared Gamma prior.
    """
    # Hyperpriors for the Gamma distribution of loss rates
    mu_rate = numpyro.sample("mu_rate", dist.Gamma(2.0, 5.0))
    sigma_rate = numpyro.sample("sigma_rate", dist.HalfNormal(1.0))

    # Per-product loss rates
    with numpyro.plate("products", n_products):
        alpha = mu_rate ** 2 / sigma_rate ** 2
        beta_param = mu_rate / sigma_rate ** 2
        loss_rate = numpyro.sample("loss_rate", dist.Gamma(alpha, beta_param))

    # Expected counts = rate * exposure
    expected = loss_rate[product_idx] * exposure

    # Observed loss counts
    numpyro.sample("n_losses", dist.Poisson(expected), obs=observed_counts)


def loss_severity_model(
    product_idx: jnp.ndarray,
    n_products: int,
    observed_losses: jnp.ndarray | None = None,
) -> None:
    """Hierarchical Lognormal severity model.

    Each product line has its own loss severity distribution.
    """
    # Hyperpriors
    mu_severity = numpyro.sample("mu_severity", dist.Normal(10.0, 2.0))
    sigma_severity = numpyro.sample("sigma_severity", dist.HalfNormal(2.0))

    # Per-product severity parameters
    with numpyro.plate("products", n_products):
        product_mu = numpyro.sample(
            "product_mu", dist.Normal(mu_severity, sigma_severity)
        )
        product_sigma = numpyro.sample(
            "product_sigma", dist.HalfNormal(1.0)
        )

    # Observed losses
    numpyro.sample(
        "loss_amount",
        dist.LogNormal(product_mu[product_idx], product_sigma[product_idx]),
        obs=observed_losses,
    )


def aggregate_loss_model(
    exposure: jnp.ndarray,
    product_idx: jnp.ndarray,
    n_products: int,
    observed_counts: jnp.ndarray | None = None,
    observed_total_loss: jnp.ndarray | None = None,
) -> None:
    """Combined frequency-severity model for aggregate loss."""
    # Frequency component
    mu_rate = numpyro.sample("mu_rate", dist.Gamma(2.0, 5.0))
    sigma_rate = numpyro.sample("sigma_rate", dist.HalfNormal(1.0))

    with numpyro.plate("products_freq", n_products):
        alpha = mu_rate ** 2 / (sigma_rate ** 2 + 1e-6)
        beta_param = mu_rate / (sigma_rate ** 2 + 1e-6)
        loss_rate = numpyro.sample("loss_rate", dist.Gamma(alpha + 0.1, beta_param + 0.1))

    expected = loss_rate[product_idx] * exposure
    numpyro.sample("n_losses", dist.Poisson(expected + 0.01), obs=observed_counts)

    # Severity component
    mu_sev = numpyro.sample("mu_severity", dist.Normal(10.0, 2.0))
    sigma_sev = numpyro.sample("sigma_severity", dist.HalfNormal(2.0))

    with numpyro.plate("products_sev", n_products):
        prod_mu = numpyro.sample("product_mu", dist.Normal(mu_sev, sigma_sev))
        prod_sigma = numpyro.sample("product_sigma", dist.HalfNormal(1.0))

    # Total loss ~ LogNormal approximation
    total_mu = jnp.log(expected + 0.01) + prod_mu[product_idx]
    total_sigma = prod_sigma[product_idx] + 0.1
    numpyro.sample(
        "total_loss",
        dist.LogNormal(total_mu, total_sigma),
        obs=observed_total_loss,
    )


def run_mcmc_risk_analysis(
    risk_df: pd.DataFrame,
    n_warmup: int = 500,
    n_samples: int = 2000,
    n_chains: int = 2,
    save_dir: Path = Path("weights"),
    model_name: str = "mcmc_risk",
) -> dict[str, Any]:
    """Run full MCMC risk analysis on actuarial data.

    Returns posterior samples, VaR, CVaR, and loss distributions.
    """
    save_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Running MCMC Risk Analysis: {model_name}")
    print(f"{'='*60}")

    # Encode products
    products = risk_df["product"].unique().tolist()
    product_map = {p: i for i, p in enumerate(products)}
    n_products = len(products)

    product_idx = jnp.array([product_map[p] for p in risk_df["product"]])
    exposure = jnp.array(risk_df["exposure_years"].values, dtype=jnp.float32)
    n_losses = jnp.array(risk_df["n_losses"].values, dtype=jnp.float32)
    total_loss = jnp.array(
        risk_df["total_loss_ngn"].values.clip(min=1.0), dtype=jnp.float32
    )

    print(f"  Policies: {len(risk_df)}, Products: {n_products}")
    print(f"  Avg loss ratio: {risk_df['loss_ratio'].mean():.2%}")

    # Run MCMC
    start_time = time.time()
    rng_key = jax.random.PRNGKey(42)

    print(f"\n  Running NUTS sampler ({n_warmup} warmup + {n_samples} samples × {n_chains} chains)...")

    kernel = NUTS(aggregate_loss_model, max_tree_depth=8)
    mcmc = MCMC(kernel, num_warmup=n_warmup, num_samples=n_samples, num_chains=n_chains)
    mcmc.run(
        rng_key,
        exposure=exposure,
        product_idx=product_idx,
        n_products=n_products,
        observed_counts=n_losses,
        observed_total_loss=total_loss,
    )

    elapsed = time.time() - start_time
    print(f"  MCMC sampling complete in {elapsed:.1f}s")

    # Extract posterior samples
    samples = mcmc.get_samples()
    loss_rates = np.array(samples["loss_rate"])      # [n_samples, n_products]
    product_mus = np.array(samples["product_mu"])     # [n_samples, n_products]
    product_sigmas = np.array(samples["product_sigma"])

    # Compute VaR and CVaR for each product
    print("\n  Risk metrics per product:")
    product_metrics: list[dict[str, Any]] = []

    for i, product in enumerate(products):
        rates = loss_rates[:, i]
        mus = product_mus[:, i]
        sigmas = product_sigmas[:, i]

        # Simulate aggregate losses
        sim_counts = np.random.poisson(rates * 1.0)  # Per unit exposure
        sim_severities = np.random.lognormal(mus, np.abs(sigmas) + 0.01)
        sim_aggregate = sim_counts * sim_severities

        var_95 = float(np.percentile(sim_aggregate, 95))
        var_99 = float(np.percentile(sim_aggregate, 99))
        cvar_95 = float(np.mean(sim_aggregate[sim_aggregate >= var_95])) if np.any(sim_aggregate >= var_95) else var_95
        cvar_99 = float(np.mean(sim_aggregate[sim_aggregate >= var_99])) if np.any(sim_aggregate >= var_99) else var_99

        metrics = {
            "product": product,
            "mean_loss_rate": float(np.mean(rates)),
            "std_loss_rate": float(np.std(rates)),
            "mean_severity_mu": float(np.mean(mus)),
            "mean_severity_sigma": float(np.mean(np.abs(sigmas))),
            "var_95_ngn": round(var_95, 2),
            "var_99_ngn": round(var_99, 2),
            "cvar_95_ngn": round(cvar_95, 2),
            "cvar_99_ngn": round(cvar_99, 2),
            "expected_loss_ngn": round(float(np.mean(sim_aggregate)), 2),
        }
        product_metrics.append(metrics)
        print(
            f"    {product:30s} | rate={metrics['mean_loss_rate']:.4f} "
            f"VaR95={var_95:>12,.0f} NGN  CVaR99={cvar_99:>12,.0f} NGN"
        )

    # Overall portfolio metrics
    all_rates = loss_rates.flatten()
    overall_var_99 = float(np.percentile(all_rates, 99))

    result = {
        "model_name": model_name,
        "n_policies": len(risk_df),
        "n_products": n_products,
        "n_warmup": n_warmup,
        "n_samples": n_samples,
        "n_chains": n_chains,
        "total_time_s": round(elapsed, 2),
        "products": products,
        "product_metrics": product_metrics,
        "portfolio_mean_loss_rate": round(float(np.mean(all_rates)), 6),
        "portfolio_std_loss_rate": round(float(np.std(all_rates)), 6),
        "portfolio_var_99": round(overall_var_99, 6),
        "mu_rate_posterior_mean": round(float(np.mean(np.array(samples["mu_rate"]))), 6),
        "sigma_rate_posterior_mean": round(float(np.mean(np.array(samples["sigma_rate"]))), 6),
    }

    # Save results
    with open(save_dir / f"{model_name}_results.json", "w") as f:
        json.dump(result, f, indent=2, default=str)

    # Save posterior samples as numpy arrays
    np.savez(
        save_dir / f"{model_name}_posteriors.npz",
        loss_rates=loss_rates,
        product_mus=product_mus,
        product_sigmas=product_sigmas,
        mu_rate=np.array(samples["mu_rate"]),
        sigma_rate=np.array(samples["sigma_rate"]),
    )

    print(f"\n  Results saved to {save_dir}/{model_name}_results.json")
    return result
