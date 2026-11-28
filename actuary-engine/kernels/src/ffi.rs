//! C ABI surface — mirrors `include/actuary_kernels.h` exactly (frozen
//! cross-leg contract, design doc Appendix C).
//!
//! ## Boundary rules
//!
//! * Every `extern "C"` function wraps its whole body in
//!   [`std::panic::catch_unwind`]; a panic maps to `AK_ERR_PANIC` and must be
//!   unreachable in tests (all panics are pre-validated away).
//! * All inputs are validated **before** any compute; invalid pointers,
//!   lengths, or non-finite values return `AK_ERR_INPUT` and leave every
//!   out-param untouched.
//! * Model-domain failures (unknown distribution code, unsupported Tweedie
//!   power) return `AK_ERR_DOMAIN`; non-convergence/overflow returns
//!   `AK_ERR_NUMERIC`. The kernels never return a guess.
//!
//! ## Ownership
//!
//! The library is stateless: it allocates no heap objects that outlive a
//! call. All input arrays are borrowed for the duration of the call (caller
//! keeps ownership); all outputs are written into caller-provided buffers.
//! There is nothing to free and no `ak_free` function by design.
//!
//! ## Pointer-safety note
//!
//! Null pointers and length mismatches are detected and rejected. As with any
//! C ABI, a non-null pointer that does not actually point to `len` valid
//! elements is undetectable; callers must pass truthful (ptr, len) pairs —
//! this is documented in the header and enforced in Leg B's cgo wrappers.

// The extern "C" functions below are the frozen C signatures: they take raw
// pointers and dereference them only after validation. Declaring them
// `unsafe fn` would change the Rust-facing contract without changing the C
// ABI, so the standard FFI-crate exemption is applied module-wide.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::finmath::{self, PaymentTiming, VaryingKind};
use crate::montecarlo::{self, LineSimSpec};
use crate::mortality::{self, ProfitTestInput};
use crate::premium;
use crate::status::*;
use crate::triangle;
use crate::{AkError, VERSION_PACKED};

/// Per-line simulation spec. Layout is part of the frozen FFI contract.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct AkLineSimSpec {
    /// Frequency code: 0 = Poisson, 1 = NegBin(mean, r).
    pub freq_dist: i32,
    /// Poisson: lambda. NegBin: mean.
    pub freq_p1: f64,
    /// NegBin: size r (var = mean + mean²/r). Ignored for Poisson.
    pub freq_p2: f64,
    /// Severity code: 2 = Gamma(mean, cv), 3 = Lognormal(mu, sigma),
    /// 4 = Tweedie(mean, phi, p).
    pub sev_dist: i32,
    /// Gamma/Tweedie: mean. Lognormal: mu (log space).
    pub sev_p1: f64,
    /// Gamma: cv. Lognormal: sigma. Tweedie: dispersion phi.
    pub sev_p2: f64,
    /// Tweedie: power p. Ignored otherwise.
    pub sev_p3: f64,
}

/// Profit-testing input. Layout is part of the frozen FFI contract.
///
/// All arrays have length `n_years` unless stated otherwise. See
/// [`crate::mortality::ProfitTestInput`] for semantics.
#[repr(C)]
#[derive(Debug)]
pub struct AkProfitTestInput {
    /// Projection horizon (years). All `n_years` arrays must have this length.
    pub n_years: usize,
    /// Annual premium per in-force policy, len `n_years`.
    pub premiums: *const f64,
    /// Annual expense per in-force policy, len `n_years`.
    pub expenses: *const f64,
    /// Level death benefit (end-of-year payment on death).
    pub sum_assured: f64,
    /// qx mortality grid, len `n_ages`.
    pub qx: *const f64,
    /// Length of the qx grid.
    pub n_ages: usize,
    /// Issue age (index into the qx grid).
    pub start_age: usize,
    /// End-of-year reserve per surviving policy, len `n_years`.
    pub reserve_end: *const f64,
    /// Annual earned (investment) rate, len `n_years`.
    pub earned_rates: *const f64,
    /// Risk discount curve (annual effective rates), len `n_years`.
    pub discount: *const f64,
    /// Flat mortality improvement scalar per projection year.
    pub improvement: f64,
}

// ---------------------------------------------------------------------------
// Pointer helpers. SAFETY invariants are checked before any dereference.
// ---------------------------------------------------------------------------

/// Builds a slice from (ptr, len) after null/length validation.
/// `allow_empty` permits a null pointer when `len == 0` (optional arrays).
unsafe fn slice<'a>(ptr: *const f64, len: usize, allow_empty: bool) -> Result<&'a [f64], i32> {
    if ptr.is_null() {
        if allow_empty && len == 0 {
            return Ok(&[]);
        }
        return Err(AK_ERR_INPUT);
    }
    if len == 0 && allow_empty {
        return Ok(&[]);
    }
    if len == 0 {
        return Err(AK_ERR_INPUT);
    }
    // Length sanity: refuse absurd element counts up front (garbage lengths
    // cannot be dereferenced safely and almost certainly indicate caller
    // bugs). 1e8 f64s = 800 MB; legitimate inputs are far smaller.
    if len > 100_000_000 {
        return Err(AK_ERR_INPUT);
    }
    Ok(unsafe { std::slice::from_raw_parts(ptr, len) })
}

fn err_code(e: AkError) -> i32 {
    e.code()
}

// ---------------------------------------------------------------------------
// ak_premium_compose
// ---------------------------------------------------------------------------

/// Premium mathematics: GLM score → loadings → clamped total.
/// See `premium::compose` for the composition convention.
///
/// * `rels` may be null when `n == 0` (no relativities).
/// * `tax_rates` may be null when `n_tax == 0` (no taxes).
/// * All three out-params must be non-null.
#[no_mangle]
pub extern "C" fn ak_premium_compose(
    base_pure_premium: f64,
    rels: *const f64,
    n: usize,
    expense_ratio: f64,
    commission_rate: f64,
    profit_margin: f64,
    tax_rates: *const f64,
    n_tax: usize,
    min_premium_kobo: i64,
    max_premium_kobo: i64,
    out_total_kobo: *mut i64,
    out_pure_kobo: *mut i64,
    out_loadings_kobo: *mut i64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_total_kobo.is_null() || out_pure_kobo.is_null() || out_loadings_kobo.is_null() {
            return AK_ERR_INPUT;
        }
        let rels = match unsafe { slice(rels, n, true) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let taxes = match unsafe { slice(tax_rates, n_tax, true) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        match premium::compose(
            base_pure_premium,
            rels,
            expense_ratio,
            commission_rate,
            profit_margin,
            taxes,
            min_premium_kobo,
            max_premium_kobo,
        ) {
            Ok(q) => {
                unsafe {
                    *out_total_kobo = q.total_kobo;
                    *out_pure_kobo = q.pure_kobo;
                    *out_loadings_kobo = q.loadings_kobo;
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_chainladder
// ---------------------------------------------------------------------------

/// Chain-ladder projection on an upper-triangular cumulative triangle
/// (row-major, origin × development). Writes `devs-1` volume-weighted
/// development factors into `out_factors` (`factors_len` must equal
/// `devs-1`) and one ultimate per origin into `out_ultimates` (`ult_len`
/// must equal `origins`).
#[no_mangle]
pub extern "C" fn ak_chainladder(
    tri: *const f64,
    origins: usize,
    devs: usize,
    out_factors: *mut f64,
    factors_len: usize,
    out_ultimates: *mut f64,
    ult_len: usize,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_factors.is_null() || out_ultimates.is_null() {
            return AK_ERR_INPUT;
        }
        let t = match unsafe { slice(tri, origins.saturating_mul(devs), false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        if origins.checked_mul(devs).is_none() {
            return AK_ERR_INPUT;
        }
        if factors_len != devs.saturating_sub(1) || ult_len != origins {
            return AK_ERR_INPUT;
        }
        match triangle::chainladder(t, origins, devs, triangle::FactorMethod::VolumeWeighted) {
            Ok(r) => {
                unsafe {
                    std::ptr::copy_nonoverlapping(r.factors.as_ptr(), out_factors, r.factors.len());
                    std::ptr::copy_nonoverlapping(
                        r.ultimates.as_ptr(),
                        out_ultimates,
                        r.ultimates.len(),
                    );
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_bornhuetter_ferguson
// ---------------------------------------------------------------------------

/// Bornhuetter–Ferguson: ultimates = a priori blended with chain-ladder
/// emergence. `apriori_ultimates` has `origins` entries; `payout_patterns`
/// has `devs` entries and must sum to 1 (±1e-6).
#[no_mangle]
pub extern "C" fn ak_bornhuetter_ferguson(
    tri: *const f64,
    origins: usize,
    devs: usize,
    apriori_ultimates: *const f64,
    payout_patterns: *const f64,
    out_ultimates: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_ultimates.is_null() {
            return AK_ERR_INPUT;
        }
        let t = match unsafe { slice(tri, origins.saturating_mul(devs), false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        if origins.checked_mul(devs).is_none() {
            return AK_ERR_INPUT;
        }
        let apriori = match unsafe { slice(apriori_ultimates, origins, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let pattern = match unsafe { slice(payout_patterns, devs, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        match triangle::bornhuetter_ferguson(t, origins, devs, apriori, pattern) {
            Ok(u) => {
                unsafe {
                    std::ptr::copy_nonoverlapping(u.as_ptr(), out_ultimates, u.len());
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_mack_se
// ---------------------------------------------------------------------------

/// Mack parameter-uncertainty standard errors per origin (`devs >= 3`,
/// square triangle). Writes the total reserve standard error to
/// `out_se_total` and per-origin standard errors into `out_se_per_origin`
/// (`origins` entries).
#[no_mangle]
pub extern "C" fn ak_mack_se(
    tri: *const f64,
    origins: usize,
    devs: usize,
    out_se_total: *mut f64,
    out_se_per_origin: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_se_total.is_null() || out_se_per_origin.is_null() {
            return AK_ERR_INPUT;
        }
        let t = match unsafe { slice(tri, origins.saturating_mul(devs), false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        if origins.checked_mul(devs).is_none() {
            return AK_ERR_INPUT;
        }
        match triangle::mack_se(t, origins, devs) {
            Ok((total, per_origin)) => {
                unsafe {
                    *out_se_total = total;
                    std::ptr::copy_nonoverlapping(
                        per_origin.as_ptr(),
                        out_se_per_origin,
                        per_origin.len(),
                    );
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_montecarlo_aggregate
// ---------------------------------------------------------------------------

/// Monte Carlo aggregate-loss simulation. Deterministic under `seed`.
/// `corr` may be null when `corr_dim == 0` (independence assumed);
/// `out_per_line_tvar` is optional (nullable). See `montecarlo::simulate`.
#[no_mangle]
pub extern "C" fn ak_montecarlo_aggregate(
    lines: *const AkLineSimSpec,
    n_lines: usize,
    corr: *const f64,
    corr_dim: usize,
    n_paths: u64,
    seed: u64,
    out_var_995: *mut f64,
    out_tvar_99: *mut f64,
    out_mean: *mut f64,
    out_per_line_tvar: *mut f64, // optional, nullable
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_var_995.is_null() || out_tvar_99.is_null() || out_mean.is_null() {
            return AK_ERR_INPUT;
        }
        if lines.is_null() || n_lines == 0 {
            return AK_ERR_INPUT;
        }
        if n_lines > 1_000_000 {
            return AK_ERR_INPUT;
        }
        // Correlation matrix: null with dim 0 → independence; otherwise the
        // dim must match the line count exactly (checked again by simulate).
        let corr_slice: Option<&[f64]> = if corr_dim == 0 {
            if !corr.is_null() {
                return AK_ERR_INPUT;
            }
            None
        } else {
            if corr.is_null() {
                return AK_ERR_INPUT;
            }
            if corr_dim != n_lines {
                return AK_ERR_INPUT;
            }
            let c = match unsafe { slice(corr, corr_dim.saturating_mul(corr_dim), false) } {
                Ok(s) => s,
                Err(c) => return c,
            };
            if corr_dim.checked_mul(corr_dim).is_none() {
                return AK_ERR_INPUT;
            }
            Some(c)
        };
        let specs: Vec<LineSimSpec> = {
            let raw = unsafe { std::slice::from_raw_parts(lines, n_lines) };
            raw.iter()
                .map(|s| LineSimSpec {
                    freq_dist: s.freq_dist,
                    freq_p1: s.freq_p1,
                    freq_p2: s.freq_p2,
                    sev_dist: s.sev_dist,
                    sev_p1: s.sev_p1,
                    sev_p2: s.sev_p2,
                    sev_p3: s.sev_p3,
                })
                .collect()
        };
        let want_per_line = !out_per_line_tvar.is_null();
        match montecarlo::simulate(&specs, corr_slice, n_paths, seed, want_per_line) {
            Ok(r) => {
                unsafe {
                    *out_var_995 = r.var_995;
                    *out_tvar_99 = r.tvar_99;
                    *out_mean = r.mean;
                }
                if want_per_line {
                    if r.per_line_tvar.len() != n_lines {
                        return AK_ERR_PANIC; // invariant violation, unreachable
                    }
                    unsafe {
                        std::ptr::copy_nonoverlapping(
                            r.per_line_tvar.as_ptr(),
                            out_per_line_tvar,
                            r.per_line_tvar.len(),
                        );
                    }
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_annuity_pv
// ---------------------------------------------------------------------------

/// Life: survival/annuity present values from a qx grid with a flat
/// improvement scalar and caller-supplied discount curve. See
/// `mortality::annuity_pv` for conventions.
#[no_mangle]
pub extern "C" fn ak_annuity_pv(
    qx: *const f64,
    n_ages: usize,
    start_age: usize,
    improvement: f64,
    discount: *const f64,
    n_years: usize,
    payment: f64,
    guarantee_years: u32,
    out_pv: *mut f64,
    out_pv_guaranteed: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_pv.is_null() || out_pv_guaranteed.is_null() {
            return AK_ERR_INPUT;
        }
        let q = match unsafe { slice(qx, n_ages, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let disc = match unsafe { slice(discount, n_years, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        match mortality::annuity_pv(
            q,
            start_age,
            improvement,
            disc,
            n_years,
            payment,
            guarantee_years,
        ) {
            Ok(r) => {
                unsafe {
                    *out_pv = r.pv;
                    *out_pv_guaranteed = r.pv_guaranteed;
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_profit_test
// ---------------------------------------------------------------------------

/// Profit testing: year-by-year cash-flow projection → margin + IRR.
/// See `mortality::profit_test`. `input` must be non-null and all of its
/// array members must be non-null.
#[no_mangle]
pub extern "C" fn ak_profit_test(
    input: *const AkProfitTestInput,
    out_margin: *mut f64,
    out_irr: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if input.is_null() || out_margin.is_null() || out_irr.is_null() {
            return AK_ERR_INPUT;
        }
        let inp = unsafe { &*input };
        let n = inp.n_years;
        if n == 0 || n > 10_000 {
            return AK_ERR_INPUT;
        }
        let premiums = match unsafe { slice(inp.premiums, n, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let expenses = match unsafe { slice(inp.expenses, n, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let reserve_end = match unsafe { slice(inp.reserve_end, n, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let earned = match unsafe { slice(inp.earned_rates, n, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let discount = match unsafe { slice(inp.discount, n, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let qx = match unsafe { slice(inp.qx, inp.n_ages, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        let owned = ProfitTestInput {
            premiums: premiums.to_vec(),
            expenses: expenses.to_vec(),
            sum_assured: inp.sum_assured,
            qx: qx.to_vec(),
            start_age: inp.start_age,
            reserve_end: reserve_end.to_vec(),
            earned_rates: earned.to_vec(),
            discount: discount.to_vec(),
            improvement: inp.improvement,
        };
        match mortality::profit_test(&owned) {
            Ok(r) => {
                unsafe {
                    *out_margin = r.margin;
                    *out_irr = r.irr;
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

// ---------------------------------------------------------------------------
// ak_version
// ---------------------------------------------------------------------------

/// Packed semver: `major << 16 | minor << 8 | patch`.
#[no_mangle]
pub extern "C" fn ak_version() -> u32 {
    VERSION_PACKED
}

// ---------------------------------------------------------------------------
// F2 amendment (2026-11-28, F2 wave): financial-mathematics exports.
//
// ADDITIVE ONLY: the 8 symbols above and their semantics are untouched.
// New `ak_fin_*` exports mirror the `finmath` core module and follow the
// same boundary rules (catch_unwind armor, validate-before-compute, no
// fabricated results). The full amendment is documented in the design
// addendum (actuary-engine FOSS program, F2, 2026-11-28).
// ---------------------------------------------------------------------------

/// Wraps a scalar finmath computation in the boundary armor: validates the
/// out-pointer, runs the computation, and maps errors to status codes.
fn fin_scalar(out: *mut f64, f: impl FnOnce() -> Result<f64, AkError>) -> i32 {
    if out.is_null() {
        return AK_ERR_INPUT;
    }
    match f() {
        Ok(v) => {
            unsafe {
                *out = v;
            }
            AK_OK
        }
        Err(e) => err_code(e),
    }
}

fn timing(code: u32) -> Result<PaymentTiming, AkError> {
    PaymentTiming::from_code(code)
}

fn kind(code: u32) -> Result<VaryingKind, AkError> {
    VaryingKind::from_code(code)
}

/// TVM: present value. `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_pv(
    rate: f64,
    nper: f64,
    pmt: f64,
    fv: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::pv(rate, nper, pmt, fv, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// TVM: future value. `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_fv(
    rate: f64,
    nper: f64,
    pmt: f64,
    pv: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::fv(rate, nper, pmt, pv, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// TVM: level payment. `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_pmt(
    rate: f64,
    nper: f64,
    pv: f64,
    fv: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::pmt(rate, nper, pv, fv, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// TVM: number of periods. `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_nper(
    rate: f64,
    pmt: f64,
    pv: f64,
    fv: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::nper(rate, pmt, pv, fv, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// TVM: effective rate (Newton + bisection fallback, fail-closed).
/// `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_rate(
    nper: f64,
    pmt: f64,
    pv: f64,
    fv: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::tvm_rate(nper, pmt, pv, fv, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Annuity-certain PV, optionally deferred by `defer` whole periods.
/// `timing`: 0 = arrears (immediate), 1 = advance (due).
#[no_mangle]
pub extern "C" fn ak_fin_annuity_pv(
    rate: f64,
    nper: f64,
    payment: f64,
    timing_code: u32,
    defer: f64,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::annuity_pv(rate, nper, payment, timing(timing_code)?, defer)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Annuity-certain accumulated value at the last payment date.
/// `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_annuity_fv(
    rate: f64,
    nper: f64,
    payment: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::annuity_fv(rate, nper, payment, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Perpetuity PV. `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_perpetuity_pv(
    rate: f64,
    payment: f64,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::perpetuity_pv(rate, payment, timing(timing_code)?)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Varying annuity-certain PV. `kind`: 0 = arithmetic increasing
/// (P, P+Q, …), 1 = arithmetic decreasing (P, P−Q, …), 2 = geometric
/// (P, P(1+step), …). `timing`: 0 = arrears, 1 = advance.
#[no_mangle]
pub extern "C" fn ak_fin_varying_annuity_pv(
    rate: f64,
    nper: f64,
    first_payment: f64,
    step: f64,
    kind_code: u32,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::varying_annuity_pv(
                rate,
                nper,
                first_payment,
                step,
                kind(kind_code)?,
                timing(timing_code)?,
            )
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Varying annuity-certain accumulated value at the last payment date.
/// `kind`/`timing` codes as for `ak_fin_varying_annuity_pv`.
#[no_mangle]
pub extern "C" fn ak_fin_varying_annuity_fv(
    rate: f64,
    nper: f64,
    first_payment: f64,
    step: f64,
    kind_code: u32,
    timing_code: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::varying_annuity_fv(
                rate,
                nper,
                first_payment,
                step,
                kind(kind_code)?,
                timing(timing_code)?,
            )
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Bullet-bond clean price as a percentage of face. `nper_coupons` = coupon
/// periods remaining; `freq` = coupons per year; `ytm` = bond-equivalent
/// yield.
#[no_mangle]
pub extern "C" fn ak_fin_bond_price(
    face: f64,
    coupon_rate: f64,
    ytm: f64,
    nper_coupons: u32,
    freq: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::bond_price(face, coupon_rate, ytm, nper_coupons, freq)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Bond-equivalent yield solved from clean price (percentage of face) via
/// Newton + bisection fallback; fail-closed on non-convergence.
#[no_mangle]
pub extern "C" fn ak_fin_bond_yield(
    face: f64,
    coupon_rate: f64,
    price_pct: f64,
    nper_coupons: u32,
    freq: u32,
    out: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        fin_scalar(out, || {
            finmath::bond_yield(face, coupon_rate, price_pct, nper_coupons, freq)
        })
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Bullet-bond Macaulay duration (years), modified duration (years), and
/// convexity (years²) under its bond-equivalent yield.
#[no_mangle]
pub extern "C" fn ak_fin_bond_duration_convexity(
    face: f64,
    coupon_rate: f64,
    ytm: f64,
    nper_coupons: u32,
    freq: u32,
    out_mac_years: *mut f64,
    out_mod_years: *mut f64,
    out_conv_years: *mut f64,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_mac_years.is_null() || out_mod_years.is_null() || out_conv_years.is_null() {
            return AK_ERR_INPUT;
        }
        match finmath::bond_duration_convexity(face, coupon_rate, ytm, nper_coupons, freq) {
            Ok((mac, modd, conv)) => {
                unsafe {
                    *out_mac_years = mac;
                    *out_mod_years = modd;
                    *out_conv_years = conv;
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// IRR of a cash-flow signature at uniform times t = 0..n-1. Newton +
/// grid-scan bisection fallback; returns AK_ERR_NUMERIC when no root exists
/// in (-1, 10] — never a guess.
#[no_mangle]
pub extern "C" fn ak_fin_irr(cfs: *const f64, n: usize, out: *mut f64) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        let c = match unsafe { slice(cfs, n, false) } {
            Ok(s) => s,
            Err(c) => return c,
        };
        fin_scalar(out, || finmath::irr(c))
    }))
    .unwrap_or(AK_ERR_PANIC)
}

/// Level-payment amortization schedule. `nper` must be integral and equal
/// to `n` (the length of the three out arrays). Writes the level payment
/// and per-period interest/principal/balance rows.
#[no_mangle]
pub extern "C" fn ak_fin_amort_schedule(
    principal: f64,
    rate: f64,
    nper: f64,
    out_payment: *mut f64,
    out_interest: *mut f64,
    out_principal: *mut f64,
    out_balance: *mut f64,
    n: usize,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if out_payment.is_null()
            || out_interest.is_null()
            || out_principal.is_null()
            || out_balance.is_null()
        {
            return AK_ERR_INPUT;
        }
        match finmath::amort_schedule(principal, rate, nper) {
            Ok(rows) => {
                if rows.len() != n {
                    return AK_ERR_INPUT;
                }
                unsafe {
                    *out_payment = rows[0].payment;
                    for (i, r) in rows.iter().enumerate() {
                        *out_interest.add(i) = r.interest;
                        *out_principal.add(i) = r.principal;
                        *out_balance.add(i) = r.balance;
                    }
                }
                AK_OK
            }
            Err(e) => err_code(e),
        }
    }))
    .unwrap_or(AK_ERR_PANIC)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr;

    #[test]
    fn version_packed() {
        assert_eq!(ak_version(), VERSION_PACKED);
    }

    #[test]
    fn premium_compose_roundtrip() {
        let mut total = 0i64;
        let mut pure = 0i64;
        let mut loadings = 0i64;
        let rels = [1.18f64];
        let taxes = [0.075f64];
        let rc = ak_premium_compose(
            9_250_000.0,
            rels.as_ptr(),
            1,
            0.20,
            0.10,
            0.05,
            taxes.as_ptr(),
            1,
            0,
            i64::MAX,
            &mut total,
            &mut pure,
            &mut loadings,
        );
        assert_eq!(rc, AK_OK);
        assert_eq!(pure, 1_091_500_000);
        assert_eq!(total, 1_805_173_077);
        assert!(loadings > 0);
    }

    #[test]
    fn null_out_params_rejected() {
        let rc = ak_premium_compose(
            100.0,
            ptr::null(),
            0,
            0.1,
            0.1,
            0.1,
            ptr::null(),
            0,
            0,
            i64::MAX,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
        );
        assert_eq!(rc, AK_ERR_INPUT);
    }

    #[test]
    fn chainladder_length_mismatch_rejected() {
        let tri = [1.0f64; 16];
        let mut factors = [0.0f64; 3];
        let mut ults = [0.0f64; 4];
        // factors_len should be devs-1 = 3; pass 2 → AK_ERR_INPUT.
        let rc = ak_chainladder(
            tri.as_ptr(),
            4,
            4,
            factors.as_mut_ptr(),
            2,
            ults.as_mut_ptr(),
            4,
        );
        assert_eq!(rc, AK_ERR_INPUT);
    }
}
