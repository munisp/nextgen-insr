//! Acceptance test `ffi_panic_safety` (design doc Appendix H): garbage
//! pointers/lengths produce `AK_ERR_INPUT` (or a fail-closed
//! `AK_ERR_DOMAIN`/`AK_ERR_NUMERIC` where the arguments pass structural
//! validation but fail semantically) and the process survives 10⁴ calls.
//!
//! Honest scope note: as with every C ABI, a non-null pointer that does not
//! actually reference `len` valid elements is undetectable; "garbage" here
//! means null pointers, zero lengths, mismatched lengths, absurd lengths
//! (with null pointers so nothing can be dereferenced), and garbage
//! *values* (NaN, negatives, wrong magnitudes). All of these are rejected
//! before any dereference or compute.
//!
//! Also asserts `AK_ERR_PANIC` is never observed.

use actuary_kernels::ffi;
use actuary_kernels::montecarlo::{DIST_GAMMA, DIST_POISSON};
use actuary_kernels::status::*;
use std::ptr;

const CALLS: usize = 10_000;

#[test]
fn ffi_panic_safety() {
    let tri = [1.0f64; 16]; // 4x4 valid triangle buffer
    let mut f_out = [0.0f64; 3];
    let mut u_out = [0.0f64; 4];
    let mut se_total = 0.0f64;
    let mut se_origin = [0.0f64; 4];
    let mut d_out = 0.0f64;
    let mut d_out2 = 0.0f64;
    let mut i64_out = 0i64;
    let mut i64_out2 = 0i64;
    let mut i64_out3 = 0i64;

    let mut codes = std::collections::HashMap::new();
    for iter in 0..CALLS {
        // Rotate through a battery of invalid call shapes.
        let rc = match iter % 8 {
            // null triangle pointer, non-zero dims
            0 => ffi::ak_chainladder(
                ptr::null(),
                4,
                4,
                f_out.as_mut_ptr(),
                3,
                u_out.as_mut_ptr(),
                4,
            ),
            // null out-pointers
            1 => ffi::ak_chainladder(tri.as_ptr(), 4, 4, ptr::null_mut(), 3, ptr::null_mut(), 4),
            // length mismatches (factors_len must be devs-1, ult_len origins)
            2 => ffi::ak_chainladder(
                tri.as_ptr(),
                4,
                4,
                f_out.as_mut_ptr(),
                2,
                u_out.as_mut_ptr(),
                4,
            ),
            // absurd lengths with null pointers (must not be dereferenced)
            3 => ffi::ak_mack_se(
                ptr::null(),
                usize::MAX,
                usize::MAX,
                ptr::null_mut(),
                ptr::null_mut(),
            ),
            // null mortality inputs
            4 => ffi::ak_annuity_pv(
                ptr::null(),
                100,
                0,
                0.0,
                ptr::null(),
                30,
                1000.0,
                5,
                &mut d_out,
                &mut d_out2,
            ),
            // garbage values: NaN and negative premium inputs
            5 => ffi::ak_premium_compose(
                f64::NAN,
                ptr::null(),
                0,
                0.1,
                0.1,
                0.1,
                ptr::null(),
                0,
                -5, // negative minimum premium
                i64::MAX,
                &mut i64_out,
                &mut i64_out2,
                &mut i64_out3,
            ),
            // montecarlo with null lines
            6 => ffi::ak_montecarlo_aggregate(
                ptr::null(),
                3,
                ptr::null(),
                0,
                1000,
                42,
                &mut d_out,
                &mut d_out2,
                &mut se_total,
                ptr::null_mut(),
            ),
            // mack on a non-square triangle (structurally valid, semantically not)
            _ => ffi::ak_mack_se(tri.as_ptr(), 4, 2, &mut se_total, se_origin.as_mut_ptr()),
        };
        assert_ne!(rc, AK_ERR_PANIC, "AK_ERR_PANIC observed at iter {iter}");
        assert_ne!(
            rc, AK_OK,
            "garbage call unexpectedly succeeded at iter {iter}"
        );
        assert!(
            matches!(rc, AK_ERR_INPUT | AK_ERR_DOMAIN | AK_ERR_NUMERIC),
            "unexpected code {rc} at iter {iter}"
        );
        *codes.entry(rc).or_insert(0usize) += 1;
    }
    // The vast majority of garbage shapes must be rejected as invalid input.
    let input_rejections = codes.get(&AK_ERR_INPUT).copied().unwrap_or(0);
    assert!(
        input_rejections as f64 >= 0.7 * CALLS as f64,
        "only {input_rejections}/{CALLS} rejected as AK_ERR_INPUT"
    );
}

/// 2026-11-28 (W34-A fix cycle): the independent verifier's exact repro from
/// verify-w34a.md §4 — a contract-valid 3×3 triangle (`devs >= 3` is valid per
/// the frozen Appendix C contract) previously panicked inside `mack_se`
/// (`sigma2[n-4]` underflow) and surfaced as `AK_ERR_PANIC`, the code the
/// contract marks "must be unreachable". After the n=3 fix the same call must
/// return `AK_OK` and never trip the catch_unwind armor.
///
/// This triangle has identical link ratios (1.5, 1.5, …), so the single
/// directly estimable sigma² is exactly zero and every standard error is
/// exactly zero — the degenerate zero-variance case.
#[test]
fn ffi_mack_se_3x3_no_panic() {
    // Verifier's exact input: [100,150,180, 120,180,0, 110,0,0].
    let tri3 = [
        100.0f64, 150.0, 180.0, //
        120.0, 180.0, 0.0, //
        110.0, 0.0, 0.0,
    ];
    let mut total = f64::NAN;
    let mut per_origin = [f64::NAN; 3];
    let rc = ffi::ak_mack_se(tri3.as_ptr(), 3, 3, &mut total, per_origin.as_mut_ptr());
    assert_eq!(rc, AK_OK, "contract-valid 3x3 triangle must not panic");
    assert_eq!(total, 0.0);
    assert_eq!(per_origin, [0.0; 3]);
}

#[test]
fn ffi_valid_calls_still_work_after_garbage() {
    // A valid call before/after garbage barrage must succeed and be stable.
    let tri = [
        100.0f64, 150.0, 180.0, 190.0, //
        120.0, 180.0, 216.0, 0.0, //
        110.0, 165.0, 0.0, 0.0, //
        130.0, 0.0, 0.0, 0.0,
    ];
    let mut f_out = [0.0f64; 3];
    let mut u_out = [0.0f64; 4];
    for _ in 0..100 {
        // garbage
        assert_eq!(
            ffi::ak_chainladder(ptr::null(), 4, 4, ptr::null_mut(), 0, ptr::null_mut(), 0),
            AK_ERR_INPUT
        );
        let rc = ffi::ak_chainladder(
            tri.as_ptr(),
            4,
            4,
            f_out.as_mut_ptr(),
            3,
            u_out.as_mut_ptr(),
            4,
        );
        assert_eq!(rc, AK_OK);
        assert!((u_out[0] - 190.0).abs() < 1e-12);
        assert!((f_out[0] - 1.5).abs() < 1e-15);
    }
}

#[test]
fn ffi_premium_kobo_boundaries() {
    // Clamps, rounding and decomposition through the C ABI.
    let mut total = 0i64;
    let mut pure = 0i64;
    let mut loadings = 0i64;
    // 0.005 naira rounds half away from zero to 1 kobo.
    let rc = ffi::ak_premium_compose(
        0.005,
        ptr::null(),
        0,
        0.0,
        0.0,
        0.0,
        ptr::null(),
        0,
        0,
        i64::MAX,
        &mut total,
        &mut pure,
        &mut loadings,
    );
    assert_eq!(rc, AK_OK);
    assert_eq!(total, 1);
    // Minimum clamp lifts the total to the floor.
    let rc = ffi::ak_premium_compose(
        10.0,
        ptr::null(),
        0,
        0.0,
        0.0,
        0.0,
        ptr::null(),
        0,
        50_000,
        i64::MAX,
        &mut total,
        &mut pure,
        &mut loadings,
    );
    assert_eq!(rc, AK_OK);
    assert_eq!(total, 50_000);
}

#[test]
fn ffi_version_and_mc_smoke() {
    assert_eq!(ffi::ak_version(), actuary_kernels::VERSION_PACKED);
    let line = ffi::AkLineSimSpec {
        freq_dist: DIST_POISSON,
        freq_p1: 2.0,
        freq_p2: 0.0,
        sev_dist: DIST_GAMMA,
        sev_p1: 1000.0,
        sev_p2: 0.5,
        sev_p3: 0.0,
    };
    let mut var995 = 0.0;
    let mut tvar99 = 0.0;
    let mut mean = 0.0;
    let rc = ffi::ak_montecarlo_aggregate(
        &line,
        1,
        ptr::null(),
        0,
        10_000,
        7,
        &mut var995,
        &mut tvar99,
        &mut mean,
        ptr::null_mut(),
    );
    assert_eq!(rc, AK_OK);
    assert!(mean > 0.0 && tvar99 >= var995 && var995 >= mean);
}
