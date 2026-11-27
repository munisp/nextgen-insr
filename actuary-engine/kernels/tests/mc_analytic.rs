//! Acceptance test `mc_analytic_normal` (design doc Appendix H): single-line
//! compound Poisson–Normal Monte Carlo converges to the analytic VaR/TVaR
//! within Monte Carlo error bounds at 10⁶ paths.
//!
//! Model: frequency Poisson(50); severity Normal(1000, 500²), expressed in
//! the kernel as Tweedie(p = 0, φ = 250000). Conditional on N = n the
//! aggregate is exactly Normal(n·1000, n·500²), so the unconditional
//! distribution is a Poisson mixture of Normals. The analytic references
//! below were computed by mixture quadrature with scipy 1.16.2
//! (machine-precision normal CDF, bisection root-find):
//!
//!   VaR_99.5  = 71641.37217383638
//!   TVaR_99   = 72474.33118882046
//!
//! MC standard errors at N = 10⁶ paths (see tests/golden/README.md):
//!   SE(VaR_99.5)  = σ√(α(1−α)/N)/φ(z_α) ≈ 38.56
//!   SE(TVaR_99)   ≤ σ/√((1−α)N)      ≈ 79.06  (loose bound)
//! The assertions use 5× these bounds (plus the deterministic-seed check).

use actuary_kernels::ffi;
use actuary_kernels::montecarlo::{DIST_POISSON, DIST_TWEEDIE};
use actuary_kernels::status::*;

const ANALYTIC_VAR_995: f64 = 71641.37217383638;
const ANALYTIC_TVAR_99: f64 = 72474.33118882046;
const SE_VAR: f64 = 38.56;
const SE_TVAR: f64 = 79.06;
const N_PATHS: u64 = 1_000_000;
const SEED: u64 = 0xA2_34_11_9B;

fn spec() -> ffi::AkLineSimSpec {
    ffi::AkLineSimSpec {
        freq_dist: DIST_POISSON,
        freq_p1: 50.0,
        freq_p2: 0.0,
        sev_dist: DIST_TWEEDIE,
        sev_p1: 1000.0,
        sev_p2: 250_000.0, // φ = σ²
        sev_p3: 0.0,       // p = 0 → Normal(μ, φ)
    }
}

fn run(seed: u64) -> (f64, f64, f64) {
    let line = spec();
    let mut var995 = 0.0;
    let mut tvar99 = 0.0;
    let mut mean = 0.0;
    let rc = ffi::ak_montecarlo_aggregate(
        &line,
        1,
        std::ptr::null(),
        0,
        N_PATHS,
        seed,
        &mut var995,
        &mut tvar99,
        &mut mean,
        std::ptr::null_mut(),
    );
    assert_eq!(rc, AK_OK);
    (var995, tvar99, mean)
}

#[test]
fn mc_analytic_normal() {
    let (var995, tvar99, mean) = run(SEED);

    // Analytic mean is exact: λμ = 50,000. SE(mean) at 1e6 paths:
    // σ_agg/√N = √(50×1.25e6)/1000 ≈ 7.91; assert within 5σ.
    let se_mean = (50.0f64 * 1_250_000.0).sqrt() / 1000.0;
    assert!(
        (mean - 50_000.0).abs() < 5.0 * se_mean,
        "mean {mean} far from analytic 50000 (5σ={})",
        5.0 * se_mean
    );

    let d_var = (var995 - ANALYTIC_VAR_995).abs();
    assert!(
        d_var <= 5.0 * SE_VAR,
        "VaR_99.5 {var995} vs analytic {ANALYTIC_VAR_995}: |d|={d_var} > 5σ_MC={}",
        5.0 * SE_VAR
    );
    let d_tvar = (tvar99 - ANALYTIC_TVAR_99).abs();
    assert!(
        d_tvar <= 5.0 * SE_TVAR,
        "TVaR_99 {tvar99} vs analytic {ANALYTIC_TVAR_99}: |d|={d_tvar} > 5σ_MC={}",
        5.0 * SE_TVAR
    );
}

#[test]
fn mc_deterministic_under_seed() {
    // Same seed → bit-identical results; different seed → different results.
    let a = run(SEED);
    let b = run(SEED);
    assert_eq!(a.0.to_bits(), b.0.to_bits());
    assert_eq!(a.1.to_bits(), b.1.to_bits());
    let c = run(SEED + 1);
    assert_ne!(a.0.to_bits(), c.0.to_bits());
}
