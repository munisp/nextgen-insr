//! Acceptance test `golden_mack_se` (design doc Appendix H): total reserve
//! standard error within ±0.5% of the published value, on the Mack 1991/1993
//! (GenIns) triangle, plus a second published-triangle check (RAA).
//!
//! Published references (see tests/golden/README.md):
//!
//! * GenIns total Mack S.E. = 2,447,618 (R ChainLadder, Mack 1993 Table).
//! * RAA total = 26,909.01 and per-origin S.E. (R vignette, 1 d.p.).
//!
//! Our implementation reproduces the R convention exactly on RAA (every
//! per-origin value matches to the printed precision) and lands 0.021% from
//! the published GenIns total.

mod common;

use actuary_kernels::ffi;
use actuary_kernels::status::*;
use common::load_triangle_csv;

const PUBLISHED_GENINS_TOTAL: f64 = 2_447_618.0;
const PUBLISHED_RAA_TOTAL: f64 = 26_909.01;
/// R vignette per-origin Mack S.E. for RAA (1 decimal place).
const PUBLISHED_RAA_PER_ORIGIN: [f64; 10] = [
    0.0, 206.2, 623.4, 747.2, 1469.5, 2001.9, 2209.2, 5357.9, 6333.2, 24566.3,
];
/// R vignette chain-ladder IBNR for RAA (integer-rounded).
const PUBLISHED_RAA_IBNR: [f64; 10] = [
    0.0, 154.0, 617.0, 1636.0, 2747.0, 3649.0, 5435.0, 10907.0, 10650.0, 16339.0,
];

fn mack_via_ffi(tri: &[f64], origins: usize, devs: usize) -> (f64, Vec<f64>) {
    let mut total = 0.0f64;
    let mut per_origin = vec![0.0f64; origins];
    let rc = ffi::ak_mack_se(
        tri.as_ptr(),
        origins,
        devs,
        &mut total,
        per_origin.as_mut_ptr(),
    );
    assert_eq!(rc, AK_OK);
    (total, per_origin)
}

/// 2026-11-28 (W34-A fix cycle): regression test for the verifier finding in
/// verify-w34a.md §4 — `ak_mack_se` on a contract-valid 3×3 triangle used to
/// panic (`sigma2[n-4]` underflow) and return `AK_ERR_PANIC`. With n = 3 only
/// one sigma is directly estimable, so Mack's min-rule degenerates to
/// `σ²_last = σ²_1` (R ChainLadder's min-rule expression over a single sigma;
/// see src/triangle.rs).
///
/// Reference values below were computed with the actual CRAN ChainLadder
/// package code (0.2.20; `R/MackChainLadderFunctions.R` byte-identical to
/// current CRAN 0.2.21, run on R 4.6.2) by extracting σ₁ from R's own
/// chain-ladder lm model and running `MackChainLadder(tri, est.sigma = σ₁)`
/// — R's numeric-sigma escape hatch — so the entire Mack process/parameter
/// risk recursion executes natively in R. Sanity check: the same technique on
/// RAA reproduces R's `est.sigma = "Mack"` output to full f64 precision.
/// (R's default min-rule path itself errors "argument is of length zero" on
/// 3×3 triangles; the degeneration we implement is R's formula semantics.)
///
/// Values are asserted to 1e-9 relative tolerance: R's lm-based σ₁ and our
/// direct σ² estimator differ only at the f64 rounding level (R σ₁² =
/// 0.54545454545453698 vs exact 6/11 = 0.54545454545454545…), which shifts
/// the SEs by ~1e-10 relative. Everything structural is asserted exactly.
const TRI3_REGRESSION: [f64; 9] = [
    100.0, 160.0, 200.0, //
    120.0, 180.0, 0.0, //
    110.0, 0.0, 0.0,
];
/// R-computed (ChainLadder, est.sigma = σ₁) per-origin Mack S.E.
const R_TRI3_PER_ORIGIN: [f64; 3] = [0.0, 14.444250192943915, 18.217436702236537];
/// R-computed total Mack S.E.
const R_TRI3_TOTAL: f64 = 27.370_563_152_275_76;
/// R-computed chain-ladder ultimates (exact in f64).
const R_TRI3_ULTIMATES: [f64; 3] = [200.0, 225.0, 212.5];

#[test]
fn mack_se_3x3_min_sigma_rule() {
    let (total, per_origin) = mack_via_ffi(&TRI3_REGRESSION, 3, 3);

    assert_eq!(per_origin[0], 0.0, "origin 1 is fully developed");
    for (i, (&se, &r)) in per_origin.iter().zip(R_TRI3_PER_ORIGIN.iter()).enumerate() {
        if r == 0.0 {
            assert_eq!(se, 0.0);
            continue;
        }
        let rel = (se - r).abs() / r;
        assert!(
            rel <= 1e-9,
            "3x3 origin {} SE {se} vs R-computed {r} (rel {rel:.3e})",
            i + 1
        );
    }
    let rel = (total - R_TRI3_TOTAL).abs() / R_TRI3_TOTAL;
    assert!(
        rel <= 1e-9,
        "3x3 total SE {total} vs R-computed {R_TRI3_TOTAL} (rel {rel:.3e})"
    );

    // Chain-ladder ultimates on the same triangle match R exactly.
    let mut factors = vec![0.0; 2];
    let mut ultimates = vec![0.0; 3];
    let rc = ffi::ak_chainladder(
        TRI3_REGRESSION.as_ptr(),
        3,
        3,
        factors.as_mut_ptr(),
        factors.len(),
        ultimates.as_mut_ptr(),
        ultimates.len(),
    );
    assert_eq!(rc, AK_OK);
    for (i, (&u, &r)) in ultimates.iter().zip(R_TRI3_ULTIMATES.iter()).enumerate() {
        assert_eq!(u, r, "3x3 origin {} ultimate {u} vs R {r}", i + 1);
    }
}

#[test]
fn golden_mack_se() {
    let (tri, origins, devs) = load_triangle_csv("tests/golden/gen_ins.csv");
    let (total, per_origin) = mack_via_ffi(&tri, origins, devs);

    // Acceptance criterion: total within ±0.5% of the published value.
    let rel = (total - PUBLISHED_GENINS_TOTAL).abs() / PUBLISHED_GENINS_TOTAL;
    assert!(
        rel <= 0.005,
        "GenIns total Mack SE {total} vs published {PUBLISHED_GENINS_TOTAL} (rel {rel:.6})"
    );

    // Per-origin sanity: non-decreasing along origins (less-developed years
    // carry more prediction risk) and origin 1 (fully developed) is zero.
    assert_eq!(per_origin[0], 0.0);
    for w in per_origin.windows(2) {
        assert!(w[1] >= w[0], "per-origin SE must be non-decreasing: {w:?}");
    }

    // Cross-validation against chainladder-python 0.10.1 per-origin values.
    // The Python package extrapolates the final sigma log-linearly (default),
    // whereas we follow Mack (1993)/R's min-rule — a documented convention
    // difference concentrated in the last development columns (the final
    // sigma enters origins 2..4's remaining ranges), so the band is wider
    // there and 0.5% elsewhere. On RAA (below) we match R's published
    // per-origin values exactly, validating the convention we implement.
    const PY_GENINS_PER_ORIGIN: [f64; 10] = [
        0.0, 71835.19, 119473.74, 131572.83, 260530.01, 410406.89, 557795.54, 874882.22, 970959.78,
        1362981.07,
    ];
    const PY_TOL: [f64; 10] = [
        0.0, 0.06, 0.025, 0.02, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005,
    ];
    for (i, (&se, &py)) in per_origin
        .iter()
        .zip(PY_GENINS_PER_ORIGIN.iter())
        .enumerate()
    {
        if i == 0 {
            continue;
        }
        let tol = PY_TOL[i];
        let rel = (se - py).abs() / py;
        assert!(
            rel <= tol,
            "GenIns origin {} SE {se} vs cross-validated {py} (rel {rel:.6} > {tol})",
            i + 1
        );
    }
}

#[test]
fn golden_mack_se_raa() {
    let (tri, origins, devs) = load_triangle_csv("tests/golden/raa.csv");
    let (total, per_origin) = mack_via_ffi(&tri, origins, devs);

    let rel = (total - PUBLISHED_RAA_TOTAL).abs() / PUBLISHED_RAA_TOTAL;
    assert!(
        rel <= 0.005,
        "RAA total Mack SE {total} vs published {PUBLISHED_RAA_TOTAL} (rel {rel:.8})"
    );
    // Per-origin vs R vignette (1 d.p.): 0.5% band plus 0.05 rounding slack.
    for (i, (&se, &pub_r)) in per_origin
        .iter()
        .zip(PUBLISHED_RAA_PER_ORIGIN.iter())
        .enumerate()
    {
        if pub_r == 0.0 {
            assert_eq!(se, 0.0, "origin 1 must be fully developed");
            continue;
        }
        let diff = (se - pub_r).abs();
        assert!(
            diff <= 0.005 * pub_r + 0.06,
            "RAA origin {} SE {se} vs published {pub_r} (diff {diff:.4})",
            i + 1
        );
    }

    // IBNR per origin via chain-ladder vs published integers (0.5% + 0.5).
    let latest: Vec<f64> = (0..origins)
        .map(|i| tri[i * devs + (devs - 1 - i)])
        .collect();
    let mut factors = vec![0.0; devs - 1];
    let mut ultimates = vec![0.0; origins];
    let rc = ffi::ak_chainladder(
        tri.as_ptr(),
        origins,
        devs,
        factors.as_mut_ptr(),
        factors.len(),
        ultimates.as_mut_ptr(),
        ultimates.len(),
    );
    assert_eq!(rc, AK_OK);
    for i in 0..origins {
        let ibnr = ultimates[i] - latest[i];
        let diff = (ibnr - PUBLISHED_RAA_IBNR[i]).abs();
        assert!(
            diff <= 0.005 * PUBLISHED_RAA_IBNR[i].abs() + 0.5,
            "RAA origin {} IBNR {ibnr} vs published {}",
            i + 1,
            PUBLISHED_RAA_IBNR[i]
        );
    }
}
