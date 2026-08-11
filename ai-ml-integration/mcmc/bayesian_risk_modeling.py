"""
MCMC (Markov Chain Monte Carlo) Bayesian Risk Modeling for Insurance

This module implements Bayesian risk modeling using MCMC methods for
uncertainty quantification in insurance risk assessment, pricing, and reserving.

NO SIMULATED POSTERIORS: every model requires a real MCMC sampler — PyMC
(preferred) or NumPyro. If neither is installed, model builders raise
RuntimeError("PyMC/NumPyro required; simulated MCMC disabled") instead of
fabricating posterior summaries, convergence diagnostics, or credible
intervals. All r_hat / ESS values are computed from actual chains.
"""

import os
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging

# PyMC imports (pip install pymc)
try:
    import pymc as pm
    import arviz as az
    PYMC_AVAILABLE = True
except ImportError:
    PYMC_AVAILABLE = False

# NumPyro fallback sampler (pip install numpyro jax)
try:
    import jax
    import jax.numpy as jnp
    import numpyro
    import numpyro.distributions as dist
    from numpyro.infer import MCMC as _NumpyroMCMC, NUTS as _NUTS
    numpyro.set_platform("cpu")
    NUMPYRO_AVAILABLE = True
except ImportError:
    NUMPYRO_AVAILABLE = False

SAMPLER_AVAILABLE = PYMC_AVAILABLE or NUMPYRO_AVAILABLE

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RiskModelType(Enum):
    """Types of risk models"""
    CLAIM_FREQUENCY = "claim_frequency"
    CLAIM_SEVERITY = "claim_severity"
    LOSS_RATIO = "loss_ratio"
    PREMIUM_PRICING = "premium_pricing"
    RESERVE_ESTIMATION = "reserve_estimation"
    FRAUD_PROBABILITY = "fraud_probability"


@dataclass
class MCMCConfig:
    """Configuration for MCMC sampling"""
    num_samples: int = 2000
    num_chains: int = 4
    tune: int = 1000
    target_accept: float = 0.9
    random_seed: int = 42


@dataclass
class PosteriorSummary:
    """Summary of posterior distribution"""
    parameter_name: str
    mean: float
    std: float
    hdi_3: float  # 3% HDI
    hdi_97: float  # 97% HDI
    median: float
    ess: float  # Effective sample size
    r_hat: float  # Convergence diagnostic


@dataclass
class RiskModelResult:
    """Result from Bayesian risk model"""
    model_type: str
    posteriors: List[PosteriorSummary]
    predictions: Dict[str, Any]
    uncertainty_intervals: Dict[str, Tuple[float, float]]
    convergence_diagnostics: Dict[str, float]
    model_comparison: Optional[Dict[str, float]] = None
    simulated: bool = False
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class BayesianRiskModeling:
    """
    Bayesian risk modeling service using MCMC for insurance applications.

    Requires PyMC or NumPyro. When neither sampler is installed every
    build_* method raises RuntimeError — there is no simulated fallback.
    """

    def __init__(self, config: MCMCConfig = None):
        self.config = config or MCMCConfig()
        self.pymc_available = PYMC_AVAILABLE
        self.numpyro_available = NUMPYRO_AVAILABLE
        self.models: Dict[str, Any] = {}
        self.traces: Dict[str, Any] = {}
        self._predictive_samples: Dict[str, np.ndarray] = {}

    # ── Sampler plumbing ──────────────────────────────────────────────────

    def _require_sampler(self) -> None:
        if not SAMPLER_AVAILABLE:
            raise RuntimeError(
                "PyMC/NumPyro required; simulated MCMC disabled. "
                "Install pymc (pip install pymc) or numpyro (pip install numpyro jax)."
            )

    def _sample_pymc(self, model: "pm.Model"):
        with model:
            return pm.sample(
                draws=self.config.num_samples,
                tune=self.config.tune,
                chains=self.config.num_chains,
                target_accept=self.config.target_accept,
                random_seed=self.config.random_seed,
                return_inferencedata=True,
                progressbar=False,
            )

    def _run_numpyro(self, model_fn, **kwargs) -> Dict[str, List[np.ndarray]]:
        """Run a NumPyro NUTS model and return per-chain sample arrays."""
        kernel = _NUTS(model_fn)
        mcmc = _NumpyroMCMC(
            kernel,
            num_warmup=self.config.tune,
            num_samples=self.config.num_samples,
            num_chains=self.config.num_chains,
            chain_method="sequential",
            progress_bar=False,
        )
        mcmc.run(jax.random.PRNGKey(self.config.random_seed), **kwargs)
        grouped = mcmc.get_samples(group_by_chain=True)
        out: Dict[str, List[np.ndarray]] = {}
        for name, vals in grouped.items():
            vals = np.asarray(vals)
            n_chains = vals.shape[0]
            if vals.ndim <= 2:
                out[name] = [vals[c] for c in range(n_chains)]
            else:
                for i in range(vals.shape[2]):
                    out[f"{name}_{i}"] = [vals[c, :, i] for c in range(n_chains)]
        return out

    @staticmethod
    def _pymc_param_chains(trace, param: str) -> Dict[str, List[np.ndarray]]:
        """Extract {name: [chain0, chain1, ...]} from a PyMC trace."""
        vals = np.asarray(trace.posterior[param].values)  # (chains, draws, ...)
        n_chains = vals.shape[0]
        if vals.ndim <= 2:
            return {param: [vals[c] for c in range(n_chains)]}
        out: Dict[str, List[np.ndarray]] = {}
        for i in range(vals.shape[2]):
            out[f"{param}_{i}"] = [vals[c, :, i] for c in range(n_chains)]
        return out

    @staticmethod
    def _flat(chains: List[np.ndarray]) -> np.ndarray:
        return np.concatenate([np.asarray(c).ravel() for c in chains])

    # ── Posterior diagnostics (computed from real chains) ─────────────────

    def _compute_hdi(self, samples: np.ndarray, hdi_prob: float = 0.94) -> Tuple[float, float]:
        """Compute Highest Density Interval"""
        samples = np.sort(samples)
        n = len(samples)
        interval_size = int(np.ceil(hdi_prob * n))

        min_width = np.inf
        hdi_min = samples[0]
        hdi_max = samples[-1]

        for i in range(n - interval_size):
            width = samples[i + interval_size] - samples[i]
            if width < min_width:
                min_width = width
                hdi_min = samples[i]
                hdi_max = samples[i + interval_size]

        return float(hdi_min), float(hdi_max)

    def _compute_ess(self, samples: np.ndarray) -> float:
        """Compute effective sample size"""
        n = len(samples)
        if n < 10:
            return float(n)

        mean = np.mean(samples)
        var = np.var(samples)
        if var == 0:
            return float(n)

        # Compute autocorrelation at lag 1
        autocorr = np.corrcoef(samples[:-1], samples[1:])[0, 1]
        if np.isnan(autocorr):
            autocorr = 0

        ess = n / (1 + 2 * abs(autocorr))
        return float(ess)

    def _compute_r_hat(self, chains: List[np.ndarray]) -> float:
        """Compute R-hat convergence diagnostic"""
        if len(chains) < 2:
            return 1.0

        n = min(len(c) for c in chains)
        chains = [np.asarray(c).ravel()[:n] for c in chains]

        # Between-chain variance
        chain_means = [np.mean(chain) for chain in chains]
        B = n * np.var(chain_means, ddof=1)

        # Within-chain variance
        W = np.mean([np.var(chain, ddof=1) for chain in chains])

        if W == 0:
            return 1.0

        # Estimated variance
        var_hat = (1 - 1 / n) * W + B / n

        r_hat = np.sqrt(var_hat / W)
        return float(r_hat)

    def _summarise(
        self, param_chains: Dict[str, List[np.ndarray]]
    ) -> Tuple[List[PosteriorSummary], Dict[str, float]]:
        """Build posterior summaries and convergence diagnostics from chains."""
        posteriors: List[PosteriorSummary] = []
        for name, chains in param_chains.items():
            flat = self._flat(chains)
            hdi = self._compute_hdi(flat)
            posteriors.append(PosteriorSummary(
                parameter_name=name,
                mean=float(np.mean(flat)),
                std=float(np.std(flat)),
                hdi_3=hdi[0],
                hdi_97=hdi[1],
                median=float(np.median(flat)),
                ess=float(sum(self._compute_ess(np.asarray(c).ravel()) for c in chains)),
                r_hat=self._compute_r_hat(chains),
            ))
        convergence = {
            "r_hat_max": max(p.r_hat for p in posteriors),
            "ess_min": min(p.ess for p in posteriors),
        }
        return posteriors, convergence

    # ── Models ────────────────────────────────────────────────────────────

    def build_claim_frequency_model(
        self,
        exposure: np.ndarray,
        claims: np.ndarray,
        covariates: Optional[np.ndarray] = None,
    ) -> RiskModelResult:
        """
        Build Bayesian claim frequency model using Poisson regression.

        Models: claims ~ Poisson(exposure * exp(X @ beta))
        """
        self._require_sampler()
        exposure = np.asarray(exposure, dtype=float)
        claims = np.asarray(claims, dtype=float)
        X = None if covariates is None else np.asarray(covariates, dtype=float)

        if PYMC_AVAILABLE:
            with pm.Model() as model:
                intercept = pm.Normal("intercept", mu=0, sigma=1)
                if X is not None:
                    beta = pm.Normal("beta", mu=0, sigma=1, shape=X.shape[1])
                    mu = pm.math.exp(intercept + pm.math.dot(X, beta))
                else:
                    mu = pm.math.exp(intercept)
                pm.Poisson("claims", mu=exposure * mu, observed=claims)
                trace = self._sample_pymc(model)

            self.models["claim_frequency"] = model
            self.traces["claim_frequency"] = trace
            param_chains = self._pymc_param_chains(trace, "intercept")
            if X is not None:
                param_chains.update(self._pymc_param_chains(trace, "beta"))
        else:
            def freq_model(exposure, claims, X):
                intercept = numpyro.sample("intercept", dist.Normal(0.0, 1.0))
                if X is not None:
                    beta = numpyro.sample(
                        "beta", dist.Normal(0.0, 1.0).expand([X.shape[1]])
                    )
                    mu = jnp.exp(intercept + X @ beta)
                else:
                    mu = jnp.exp(intercept)
                numpyro.sample("claims", dist.Poisson(exposure * mu), obs=claims)

            param_chains = self._run_numpyro(
                freq_model,
                exposure=jnp.asarray(exposure),
                claims=jnp.asarray(claims),
                X=None if X is None else jnp.asarray(X),
            )

        posteriors, convergence = self._summarise(param_chains)
        intercept_samples = self._flat(param_chains["intercept"])

        predicted_rate = np.exp(np.mean(intercept_samples))
        predictions = {
            "expected_claim_rate": float(predicted_rate),
            "expected_claims_per_1000": float(predicted_rate * 1000),
            "total_expected_claims": float(predicted_rate * np.sum(exposure)),
        }

        rate_samples = np.exp(intercept_samples)
        self._predictive_samples["claim_frequency"] = rate_samples
        uncertainty_intervals = {
            "claim_rate": self._compute_hdi(rate_samples),
        }

        return RiskModelResult(
            model_type=RiskModelType.CLAIM_FREQUENCY.value,
            posteriors=posteriors,
            predictions=predictions,
            uncertainty_intervals=uncertainty_intervals,
            convergence_diagnostics=convergence,
        )

    def build_claim_severity_model(
        self,
        claim_amounts: np.ndarray,
        covariates: Optional[np.ndarray] = None,
    ) -> RiskModelResult:
        """
        Build Bayesian claim severity model using Log-Normal distribution.

        Models: log(claim_amount) ~ Normal(mu, sigma)
        """
        self._require_sampler()
        log_amounts = np.log(np.asarray(claim_amounts, dtype=float) + 1)

        if PYMC_AVAILABLE:
            with pm.Model() as model:
                mu = pm.Normal("mu", mu=10, sigma=2)
                sigma = pm.HalfNormal("sigma", sigma=2)
                pm.Normal("log_claims", mu=mu, sigma=sigma, observed=log_amounts)
                trace = self._sample_pymc(model)

            self.models["claim_severity"] = model
            self.traces["claim_severity"] = trace
            param_chains = self._pymc_param_chains(trace, "mu")
            param_chains.update(self._pymc_param_chains(trace, "sigma"))
        else:
            def sev_model(log_amounts):
                mu = numpyro.sample("mu", dist.Normal(10.0, 2.0))
                sigma = numpyro.sample("sigma", dist.HalfNormal(2.0))
                numpyro.sample("log_claims", dist.Normal(mu, sigma), obs=log_amounts)

            param_chains = self._run_numpyro(
                sev_model, log_amounts=jnp.asarray(log_amounts)
            )

        posteriors, convergence = self._summarise(param_chains)
        mu_samples = self._flat(param_chains["mu"])
        sigma_samples = np.abs(self._flat(param_chains["sigma"]))

        expected_claim = np.exp(np.mean(mu_samples) + np.mean(sigma_samples) ** 2 / 2)
        predictions = {
            "expected_claim_amount": float(expected_claim),
            "median_claim_amount": float(np.exp(np.mean(mu_samples))),
            "coefficient_of_variation": float(np.sqrt(np.exp(np.mean(sigma_samples) ** 2) - 1)),
        }

        claim_samples = np.exp(mu_samples + sigma_samples ** 2 / 2)
        self._predictive_samples["claim_severity"] = claim_samples
        uncertainty_intervals = {
            "expected_claim": self._compute_hdi(claim_samples),
        }

        return RiskModelResult(
            model_type=RiskModelType.CLAIM_SEVERITY.value,
            posteriors=posteriors,
            predictions=predictions,
            uncertainty_intervals=uncertainty_intervals,
            convergence_diagnostics=convergence,
        )

    def build_loss_ratio_model(
        self,
        premiums: np.ndarray,
        losses: np.ndarray,
        years: Optional[np.ndarray] = None,
    ) -> RiskModelResult:
        """
        Build Bayesian loss ratio model with trend.

        Models: loss_ratio ~ Beta(alpha, beta) with time trend
        """
        self._require_sampler()
        loss_ratios = np.asarray(losses, dtype=float) / np.asarray(premiums, dtype=float)
        loss_ratios = np.clip(loss_ratios, 0.01, 0.99)  # Ensure valid range

        if PYMC_AVAILABLE:
            with pm.Model() as model:
                mu = pm.Beta("mu", alpha=2, beta=2)
                kappa = pm.HalfNormal("kappa", sigma=10)
                alpha = mu * kappa
                beta = (1 - mu) * kappa
                pm.Beta("loss_ratio", alpha=alpha, beta=beta, observed=loss_ratios)
                trace = self._sample_pymc(model)

            self.models["loss_ratio"] = model
            self.traces["loss_ratio"] = trace
            mu_chains = self._pymc_param_chains(trace, "mu")
        else:
            def lr_model(loss_ratios):
                mu = numpyro.sample("mu", dist.Beta(2.0, 2.0))
                kappa = numpyro.sample("kappa", dist.HalfNormal(10.0))
                numpyro.sample(
                    "loss_ratio",
                    dist.Beta(mu * kappa, (1 - mu) * kappa),
                    obs=loss_ratios,
                )

            mu_chains = self._run_numpyro(
                lr_model, loss_ratios=jnp.asarray(loss_ratios)
            )

        mu_chains = {"expected_loss_ratio": mu_chains["mu"]}
        posteriors, convergence = self._summarise(mu_chains)
        mu_samples = self._flat(mu_chains["expected_loss_ratio"])

        predictions = {
            "expected_loss_ratio": float(np.mean(mu_samples)),
            "probability_loss_ratio_above_100": float(np.mean(mu_samples > 1.0)),
            "probability_profitable": float(np.mean(mu_samples < 0.8)),
        }

        self._predictive_samples["loss_ratio"] = mu_samples
        uncertainty_intervals = {
            "loss_ratio": self._compute_hdi(mu_samples),
        }

        return RiskModelResult(
            model_type=RiskModelType.LOSS_RATIO.value,
            posteriors=posteriors,
            predictions=predictions,
            uncertainty_intervals=uncertainty_intervals,
            convergence_diagnostics=convergence,
        )

    def build_premium_pricing_model(
        self,
        risk_factors: np.ndarray,
        historical_losses: np.ndarray,
        exposure: np.ndarray,
    ) -> RiskModelResult:
        """
        Build Bayesian premium pricing model.

        Combines frequency and severity effects for pure premium calculation:
            observed loss rate_i ~ Normal(exp(base_rate_log + X_i @ beta), sigma)
        """
        self._require_sampler()
        X = np.asarray(risk_factors, dtype=float)
        if X.ndim == 1:
            X = X.reshape(-1, 1)
        historical_losses = np.asarray(historical_losses, dtype=float)
        exposure = np.asarray(exposure, dtype=float)
        loss_rates = historical_losses / np.clip(exposure, 1e-8, None)
        n_factors = X.shape[1]
        base_mu = float(np.log(max(np.mean(loss_rates), 1e-6)))

        if PYMC_AVAILABLE:
            with pm.Model() as model:
                base_rate_log = pm.Normal("base_rate_log", mu=base_mu, sigma=1.0)
                factor_effects = pm.Normal(
                    "factor_effects", mu=0.0, sigma=0.5, shape=n_factors
                )
                sigma = pm.HalfNormal("sigma", sigma=1.0)
                mu = pm.math.exp(base_rate_log + pm.math.dot(X, factor_effects))
                pm.Normal("loss_rates", mu=mu, sigma=sigma, observed=loss_rates)
                trace = self._sample_pymc(model)

            self.models["premium_pricing"] = model
            self.traces["premium_pricing"] = trace
            base_chains = self._pymc_param_chains(trace, "base_rate_log")["base_rate_log"]
            factor_chains = self._pymc_param_chains(trace, "factor_effects")
        else:
            def pricing_model(X, loss_rates):
                base = numpyro.sample("base_rate_log", dist.Normal(base_mu, 1.0))
                beta = numpyro.sample(
                    "factor_effects", dist.Normal(0.0, 0.5).expand([X.shape[1]])
                )
                sigma = numpyro.sample("sigma", dist.HalfNormal(1.0))
                numpyro.sample(
                    "loss_rates",
                    dist.Normal(jnp.exp(base + X @ beta), sigma),
                    obs=loss_rates,
                )

            chains = self._run_numpyro(
                pricing_model, X=jnp.asarray(X), loss_rates=jnp.asarray(loss_rates)
            )
            base_chains = chains["base_rate_log"]
            factor_chains = {
                k: v for k, v in chains.items() if k.startswith("factor_effects")
            }

        param_chains: Dict[str, List[np.ndarray]] = {
            "base_rate": [np.exp(c) for c in base_chains],
        }
        for i in range(n_factors):
            key = f"factor_effects_{i}" if n_factors > 1 else "factor_effects"
            if key in factor_chains:
                param_chains[f"risk_factor_{i}_effect"] = factor_chains[key]

        posteriors, convergence = self._summarise(param_chains)

        base_rate_samples = self._flat(param_chains["base_rate"])
        # Pure premium per unit of historical loss experience (disclosed margin below)
        pure_premium_samples = base_rate_samples * float(np.mean(historical_losses))
        pure_premium = float(np.mean(pure_premium_samples))

        predictions = {
            "pure_premium": pure_premium,
            "recommended_premium_with_margin": float(pure_premium * 1.25),  # disclosed 25% margin
            "minimum_premium": float(pure_premium * 1.1),
            "maximum_premium": float(pure_premium * 1.5),
        }

        self._predictive_samples["premium_pricing"] = pure_premium_samples
        uncertainty_intervals = {
            "pure_premium": self._compute_hdi(pure_premium_samples),
        }

        return RiskModelResult(
            model_type=RiskModelType.PREMIUM_PRICING.value,
            posteriors=posteriors,
            predictions=predictions,
            uncertainty_intervals=uncertainty_intervals,
            convergence_diagnostics=convergence,
        )

    def build_reserve_estimation_model(
        self,
        paid_claims: np.ndarray,
        incurred_claims: np.ndarray,
        development_periods: np.ndarray,
    ) -> RiskModelResult:
        """
        Build Bayesian reserve estimation model using chain-ladder method.

        paid_claims must be a cumulative claims triangle (one row per accident
        year). Development factors are modeled with posterior uncertainty:
            log(link_ratio_ij) ~ Normal(mu_j, sigma_j)
        """
        self._require_sampler()
        triangle = [list(map(float, row)) for row in paid_claims]
        if len(triangle) < 2:
            raise ValueError(
                "reserve estimation requires at least 2 accident years of claims data"
            )
        n_periods = max(len(r) for r in triangle)
        if n_periods < 2:
            raise ValueError("claims triangle must have at least 2 development periods")

        # Empirical individual link ratios and volume-weighted pooled factors
        ratios_by_period: List[np.ndarray] = []
        pooled: List[float] = []
        for j in range(n_periods - 1):
            ratios = [
                row[j + 1] / row[j]
                for row in triangle
                if j + 1 < len(row) and row[j] > 0
            ]
            ratios_by_period.append(np.asarray(ratios, dtype=float))
            sum_next = sum(row[j + 1] for row in triangle if j + 1 < len(row))
            sum_curr = sum(row[j] for row in triangle if j + 1 < len(row))
            pooled.append(sum_next / sum_curr if sum_curr > 0 else 1.0)
        log_mu0 = np.log(np.clip(np.asarray(pooled), 1.0001, None))

        if PYMC_AVAILABLE:
            with pm.Model() as model:
                mu = pm.Normal("dev_log_mu", mu=log_mu0, sigma=0.5, shape=n_periods - 1)
                sigma = pm.HalfNormal("dev_log_sigma", sigma=0.3, shape=n_periods - 1)
                for j, ratios in enumerate(ratios_by_period):
                    if len(ratios) > 0:
                        pm.Normal(
                            f"dev_obs_{j}",
                            mu=mu[j],
                            sigma=sigma[j],
                            observed=np.log(np.clip(ratios, 1.0001, None)),
                        )
                trace = self._sample_pymc(model)

            self.models["reserve_estimation"] = model
            self.traces["reserve_estimation"] = trace
            mu_chains = self._pymc_param_chains(trace, "dev_log_mu")
        else:
            log_obs = [
                jnp.asarray(np.log(np.clip(r, 1.0001, None)))
                for r in ratios_by_period
                if len(r) > 0
            ]
            obs_idx = [j for j, r in enumerate(ratios_by_period) if len(r) > 0]

            def reserve_model():
                mu = numpyro.sample(
                    "dev_log_mu", dist.Normal(jnp.asarray(log_mu0), 0.5)
                )
                sigma = numpyro.sample(
                    "dev_log_sigma", dist.HalfNormal(0.3).expand([n_periods - 1])
                )
                for k, j in enumerate(obs_idx):
                    numpyro.sample(
                        f"dev_obs_{j}", dist.Normal(mu[j], sigma[j]), obs=log_obs[k]
                    )

            all_chains = self._run_numpyro(reserve_model)
            mu_chains = {
                k: v for k, v in all_chains.items() if k.startswith("dev_log_mu")
            }

        # Posterior over development factors (exp of log-ratio means)
        factor_chains: Dict[str, List[np.ndarray]] = {}
        for j in range(n_periods - 1):
            key = f"dev_log_mu_{j}" if f"dev_log_mu_{j}" in mu_chains else "dev_log_mu"
            factor_chains[f"development_factor_{j+1}_to_{j+2}"] = [
                np.exp(c) for c in mu_chains[key]
            ]

        posteriors, convergence = self._summarise(factor_chains)

        factor_means = [float(np.mean(self._flat(c))) for c in factor_chains.values()]
        current_paid = float(sum(row[-1] for row in triangle))

        # Posterior draws of total IBNR (subsampled for tractability)
        factor_draws = np.column_stack([self._flat(c) for c in factor_chains.values()])
        stride = max(1, len(factor_draws) // 2000)
        total_ibnr_samples = []
        for draw in factor_draws[::stride]:
            ibnr = 0.0
            for row in triangle:
                cdf = 1.0
                for f in draw[len(row) - 1:]:
                    cdf *= f
                ibnr += max(row[-1] * cdf - row[-1], 0.0)
            total_ibnr_samples.append(ibnr)
        total_ibnr_samples = np.asarray(total_ibnr_samples, dtype=float)

        ultimate_factor = float(np.prod(factor_means))
        ibnr_reserve = float(np.mean(total_ibnr_samples))
        ultimate_claims = current_paid + ibnr_reserve

        predictions = {
            "ultimate_claims": float(ultimate_claims),
            "ibnr_reserve": ibnr_reserve,
            "ultimate_development_factor": ultimate_factor,
            "reserve_to_paid_ratio": float(ibnr_reserve / current_paid) if current_paid > 0 else 0,
        }

        self._predictive_samples["reserve_estimation"] = total_ibnr_samples
        uncertainty_intervals = {
            "ibnr_reserve": self._compute_hdi(total_ibnr_samples),
            "ultimate_claims": self._compute_hdi(current_paid + total_ibnr_samples),
        }

        return RiskModelResult(
            model_type=RiskModelType.RESERVE_ESTIMATION.value,
            posteriors=posteriors,
            predictions=predictions,
            uncertainty_intervals=uncertainty_intervals,
            convergence_diagnostics=convergence,
        )

    def build_fraud_probability_model(
        self,
        features: np.ndarray,
        fraud_labels: np.ndarray,
    ) -> RiskModelResult:
        """
        Build Bayesian fraud probability model using logistic regression.

        Provides uncertainty in fraud predictions:
            fraud_i ~ Bernoulli(sigmoid(intercept + X_i @ beta))
        """
        self._require_sampler()
        X = np.asarray(features, dtype=float)
        if X.ndim == 1:
            X = X.reshape(-1, 1)
        y = np.asarray(fraud_labels, dtype=float)
        n_features = X.shape[1]

        if PYMC_AVAILABLE:
            with pm.Model() as model:
                intercept = pm.Normal("intercept", mu=-2.0, sigma=2.0)
                beta = pm.Normal("beta", mu=0.0, sigma=1.0, shape=n_features)
                p = pm.math.sigmoid(intercept + pm.math.dot(X, beta))
                pm.Bernoulli("y", p=p, observed=y)
                trace = self._sample_pymc(model)

            self.models["fraud_probability"] = model
            self.traces["fraud_probability"] = trace
            param_chains = self._pymc_param_chains(trace, "intercept")
            param_chains.update(self._pymc_param_chains(trace, "beta"))
        else:
            def fraud_model(X, y):
                intercept = numpyro.sample("intercept", dist.Normal(-2.0, 2.0))
                beta = numpyro.sample(
                    "beta", dist.Normal(0.0, 1.0).expand([X.shape[1]])
                )
                numpyro.sample(
                    "y", dist.Bernoulli(logits=intercept + X @ beta), obs=y
                )

            param_chains = self._run_numpyro(
                fraud_model, X=jnp.asarray(X), y=jnp.asarray(y)
            )

        # Rename beta_i -> feature_i_coefficient
        renamed: Dict[str, List[np.ndarray]] = {"intercept": param_chains["intercept"]}
        for i in range(n_features):
            key = f"beta_{i}" if f"beta_{i}" in param_chains else "beta"
            if key in param_chains:
                renamed[f"feature_{i}_coefficient"] = param_chains[key]

        posteriors, convergence = self._summarise(renamed)
        intercept_samples = self._flat(renamed["intercept"])

        base_prob_samples = 1 / (1 + np.exp(-intercept_samples))
        base_fraud_prob = float(np.mean(base_prob_samples))

        predictions = {
            "base_fraud_probability": base_fraud_prob,
            "fraud_rate_estimate": float(np.mean(y)),
            "model_uncertainty": float(np.std(intercept_samples)),
        }

        self._predictive_samples["fraud_probability"] = base_prob_samples
        uncertainty_intervals = {
            "base_fraud_probability": self._compute_hdi(base_prob_samples),
        }

        return RiskModelResult(
            model_type=RiskModelType.FRAUD_PROBABILITY.value,
            posteriors=posteriors,
            predictions=predictions,
            uncertainty_intervals=uncertainty_intervals,
            convergence_diagnostics=convergence,
        )

    def predict_with_uncertainty(
        self,
        model_type: RiskModelType,
        new_data: np.ndarray,
    ) -> Dict[str, Any]:
        """Make predictions with uncertainty quantification.

        Uses posterior/predictive samples captured at fit time. Raises
        RuntimeError if the requested model has not been fitted — fabricated
        predictions are disabled.
        """
        key = model_type.value
        samples = self._predictive_samples.get(key)
        if samples is None or len(samples) == 0:
            raise RuntimeError(
                f"Model '{key}' has not been fitted with a real MCMC sampler. "
                f"Call build_{key}_model(...) first; simulated predictions are disabled."
            )

        return {
            "mean_prediction": float(np.mean(samples)),
            "std_prediction": float(np.std(samples)),
            "prediction_interval_95": (
                float(np.percentile(samples, 2.5)),
                float(np.percentile(samples, 97.5)),
            ),
            "samples": samples[:100].tolist(),  # subset of real posterior samples
            "simulated": False,
        }

    def compare_models(
        self,
        results: List[RiskModelResult],
    ) -> Dict[str, Any]:
        """Compare multiple risk models using information criteria"""

        comparison = {
            "models": [],
            "best_model": None,
            "ranking": [],
        }

        for i, result in enumerate(results):
            model_info = {
                "model_type": result.model_type,
                "convergence_ok": result.convergence_diagnostics.get("r_hat_max", 1.0) < 1.1,
                "ess_ok": result.convergence_diagnostics.get("ess_min", 0) > 400,
            }
            comparison["models"].append(model_info)

        # Simple ranking based on convergence
        comparison["ranking"] = sorted(
            range(len(results)),
            key=lambda i: results[i].convergence_diagnostics.get("r_hat_max", 2.0)
        )

        if comparison["ranking"]:
            comparison["best_model"] = results[comparison["ranking"][0]].model_type

        return comparison


# Factory function
def create_bayesian_risk_service(
    num_samples: int = 2000,
    num_chains: int = 4,
) -> BayesianRiskModeling:
    """Create Bayesian risk modeling service"""
    config = MCMCConfig(num_samples=num_samples, num_chains=num_chains)
    return BayesianRiskModeling(config=config)


# Temporal Activity for risk modeling
async def bayesian_risk_modeling_activity(
    model_type: str,
    data: Dict[str, List[float]],
) -> Dict[str, Any]:
    """Temporal activity for Bayesian risk modeling.

    Raises RuntimeError when no real MCMC sampler (PyMC/NumPyro) is
    available — simulated posteriors are disabled.
    """
    service = BayesianRiskModeling()

    if model_type == "claim_frequency":
        result = service.build_claim_frequency_model(
            exposure=np.array(data.get("exposure", [1.0])),
            claims=np.array(data.get("claims", [0])),
        )
    elif model_type == "claim_severity":
        result = service.build_claim_severity_model(
            claim_amounts=np.array(data.get("claim_amounts", [1000])),
        )
    elif model_type == "loss_ratio":
        result = service.build_loss_ratio_model(
            premiums=np.array(data.get("premiums", [1000])),
            losses=np.array(data.get("losses", [500])),
        )
    elif model_type == "fraud_probability":
        result = service.build_fraud_probability_model(
            features=np.array(data.get("features", [[0]])),
            fraud_labels=np.array(data.get("fraud_labels", [0])),
        )
    else:
        raise ValueError(f"Unknown model type: {model_type}")

    return {
        "model_type": result.model_type,
        "predictions": result.predictions,
        "uncertainty_intervals": result.uncertainty_intervals,
        "convergence_diagnostics": result.convergence_diagnostics,
        "simulated": result.simulated,
    }
