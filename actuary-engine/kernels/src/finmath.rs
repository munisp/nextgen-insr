//! Financial-mathematics kernel: time value of money, annuities-certain,
//! bonds, amortization schedules, and a robust IRR solver.
//!
//! Pure numeric core with the crate's fail-closed conventions: every input
//! is validated before compute, every fallible path returns [`AkError`], and
//! no result is ever fabricated (a solver that does not converge returns
//! [`AkError::Numeric`], never a guess).
//!
//! ## Conventions
//!
//! * Rates are `f64` effective fractions per period (e.g. 0.05 = 5%). `nper`
//!   may be fractional for PV/FV/PMT/RATE but must be > 0; annuity-certain
//!   factors require an integral number of payments (checked).
//! * [`PaymentTiming`] selects arrears (annuity-immediate / ordinary
//!   annuity) or advance (annuity-due) payment placement.
//! * Sign convention follows the standard five-variable TVM identity used
//!   by Excel and numpy-financial:
//!   `pv·(1+i)^n + pmt·(1+i·when)·((1+i)^n − 1)/i + fv = 0`.
//! * Bonds use coupon-period cash flows; yields are returned as
//!   bond-equivalent yield (periodic yield × frequency), the market
//!   convention. Duration is reported in years (Macaulay and modified) and
//!   convexity in years².
//!
//! ## Golden sources
//!
//! In-module tests pin hand-computed FM-textbook values (derivations in the
//! test comments) and reference-only cross-checks against:
//!
//! * ActuaryUtilities.jl (MIT) test goldens — IRR Excel/numpy examples
//!   (tag v2.0.0, test/runtests.jl) and pv/duration/convexity examples
//!   (tag v3.12.0, test/runtests.jl).
//! * elizur (GPL-3.0, reference-only) BA II Plus-verified annuity values
//!   (tests/unit/life/annuity/test_annuity.py @ 631a8f0b).
//!
//! Full citations live in tests/finmath_golden.rs.

use crate::{require_finite, AkError};

/// Payment placement: arrears (annuity-immediate) or advance (annuity-due).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentTiming {
    /// Payments at the end of each period (ordinary annuity / immediate).
    Arrears,
    /// Payments at the start of each period (annuity-due).
    Advance,
}

impl PaymentTiming {
    /// Map the FFI flag (`0` = arrears, `1` = advance).
    pub fn from_code(code: u32) -> Result<Self, AkError> {
        match code {
            0 => Ok(PaymentTiming::Arrears),
            1 => Ok(PaymentTiming::Advance),
            _ => Err(AkError::Input("timing must be 0 (arrears) or 1 (advance)")),
        }
    }
}

/// Varying-payment annuity kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaryingKind {
    /// Arithmetic increasing: P, P+Q, P+2Q, …
    Arithmetic,
    /// Arithmetic decreasing: P, P−Q, P−2Q, …
    ArithmeticDecreasing,
    /// Geometric: P, P(1+g), P(1+g)², … (step = growth rate g).
    Geometric,
}

impl VaryingKind {
    /// Map the FFI code (`0` arithmetic increasing, `1` arithmetic
    /// decreasing, `2` geometric).
    pub fn from_code(code: u32) -> Result<Self, AkError> {
        match code {
            0 => Ok(VaryingKind::Arithmetic),
            1 => Ok(VaryingKind::ArithmeticDecreasing),
            2 => Ok(VaryingKind::Geometric),
            _ => Err(AkError::Input("varying kind must be 0, 1 or 2")),
        }
    }
}

fn require_rate(rate: f64, what: &'static str) -> Result<f64, AkError> {
    let r = require_finite(rate, what)?;
    if r <= -1.0 {
        return Err(AkError::Input("rate must be > -1"));
    }
    Ok(r)
}

fn require_nper(nper: f64) -> Result<f64, AkError> {
    let n = require_finite(nper, "nper must be finite")?;
    if !(n > 0.0 && n <= 1.0e6) {
        return Err(AkError::Input("nper must be in (0, 1e6]"));
    }
    Ok(n)
}

fn require_integral_nper(nper: f64) -> Result<u32, AkError> {
    let n = require_nper(nper)?;
    if (n - n.round()).abs() > 1e-9 || n.round() < 1.0 || n.round() > u32::MAX as f64 {
        return Err(AkError::Input(
            "annuity-certain requires an integral number of payments",
        ));
    }
    Ok(n.round() as u32)
}

/// The annuity accumulation helper `a(n, i) = ((1+i)^n − 1)/i`, with the
/// `i → 0` limit `n`. Defined for fractional `n` as well.
fn annuity_accumulator(rate: f64, nper: f64) -> f64 {
    if rate.abs() < 1e-12 {
        return nper;
    }
    ((1.0 + rate).powf(nper) - 1.0) / rate
}

/// Timing multiplier: payments in advance earn one extra period of interest.
fn timing_factor(rate: f64, timing: PaymentTiming) -> f64 {
    match timing {
        PaymentTiming::Arrears => 1.0,
        PaymentTiming::Advance => 1.0 + rate,
    }
}

// ---------------------------------------------------------------------------
// Five-variable TVM
// ---------------------------------------------------------------------------

/// Present value solving the TVM identity
/// `pv·(1+i)^n + pmt·(1+i·when)·a(n,i) + fv = 0`.
pub fn pv(rate: f64, nper: f64, pmt: f64, fv: f64, timing: PaymentTiming) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_nper(nper)?;
    let pmt = require_finite(pmt, "pmt must be finite")?;
    let fv = require_finite(fv, "fv must be finite")?;
    let acc = (1.0 + i).powf(n);
    let a = annuity_accumulator(i, n);
    let pv = -(fv + pmt * timing_factor(i, timing) * a) / acc;
    if !pv.is_finite() {
        return Err(AkError::Numeric("pv overflow"));
    }
    Ok(pv)
}

/// Future value solving the same TVM identity.
pub fn fv(rate: f64, nper: f64, pmt: f64, pv: f64, timing: PaymentTiming) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_nper(nper)?;
    let pmt = require_finite(pmt, "pmt must be finite")?;
    let pv = require_finite(pv, "pv must be finite")?;
    let acc = (1.0 + i).powf(n);
    let a = annuity_accumulator(i, n);
    let fv = -(pv * acc + pmt * timing_factor(i, timing) * a);
    if !fv.is_finite() {
        return Err(AkError::Numeric("fv overflow"));
    }
    Ok(fv)
}

/// Level payment solving the TVM identity.
pub fn pmt(rate: f64, nper: f64, pv: f64, fv: f64, timing: PaymentTiming) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_nper(nper)?;
    let pv = require_finite(pv, "pv must be finite")?;
    let fv = require_finite(fv, "fv must be finite")?;
    let denom = timing_factor(i, timing) * annuity_accumulator(i, n);
    if denom.abs() < f64::EPSILON {
        return Err(AkError::Numeric("pmt undefined: zero denominator"));
    }
    let acc = (1.0 + i).powf(n);
    let pmt = -(fv + pv * acc) / denom;
    if !pmt.is_finite() {
        return Err(AkError::Numeric("pmt overflow"));
    }
    Ok(pmt)
}

/// Number of periods solving the TVM identity. With
/// `B = pmt·(1+i·when)/i` and `A = pv + B`, `(1+i)^n = (B − fv)/A`.
/// Fails closed when the log argument is non-positive (no solution).
pub fn nper(rate: f64, pmt: f64, pv: f64, fv: f64, timing: PaymentTiming) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let pmt = require_finite(pmt, "pmt must be finite")?;
    let pv = require_finite(pv, "pv must be finite")?;
    let fv = require_finite(fv, "fv must be finite")?;
    if i.abs() < 1e-12 {
        // Linear limit: fv = -(pv + pmt·when·n).
        if pmt.abs() < f64::EPSILON {
            return Err(AkError::Numeric(
                "nper undefined at zero rate and zero payment",
            ));
        }
        let n = -(fv + pv) / (pmt * timing_factor(0.0, timing));
        if !(n > 0.0 && n.is_finite()) {
            return Err(AkError::Numeric("no positive nper solution"));
        }
        return Ok(n);
    }
    let b = pmt * timing_factor(i, timing) / i;
    let a = pv + b;
    let ratio = (b - fv) / a;
    if !(ratio > 0.0 && ratio.is_finite()) {
        return Err(AkError::Numeric(
            "nper has no solution (log of non-positive)",
        ));
    }
    let n = ratio.ln() / (1.0 + i).ln();
    if !(n > 0.0 && n.is_finite()) {
        return Err(AkError::Numeric("no positive nper solution"));
    }
    Ok(n)
}

/// TVM identity residual used by the rate solver.
fn tvm_residual(rate: f64, nper: f64, pmt: f64, pv: f64, fv: f64, timing: PaymentTiming) -> f64 {
    let acc = (1.0 + rate).powf(nper);
    let a = annuity_accumulator(rate, nper);
    pv * acc + pmt * timing_factor(rate, timing) * a + fv
}

/// Effective rate solving the TVM identity. Newton–Raphson with a bracketed
/// bisection fallback; fails closed with [`AkError::Numeric`] when no root
/// exists in `(-1, ∞)` or the iteration does not converge.
pub fn tvm_rate(
    nper: f64,
    pmt: f64,
    pv: f64,
    fv: f64,
    timing: PaymentTiming,
) -> Result<f64, AkError> {
    let n = require_nper(nper)?;
    let pmt = require_finite(pmt, "pmt must be finite")?;
    let pv = require_finite(pv, "pv must be finite")?;
    let fv = require_finite(fv, "fv must be finite")?;
    let f = |r: f64| tvm_residual(r, n, pmt, pv, fv, timing);
    // Scale for the convergence test.
    let scale = pv.abs().max(fv.abs()).max(pmt.abs()).max(1.0);
    let tol = 1e-12 * scale;
    // Newton from r = 0.1 with a damped step.
    let mut r = 0.1f64;
    for _ in 0..100 {
        let fr = f(r);
        if fr.abs() < tol {
            return Ok(r);
        }
        let h = 1e-6 * (1.0 + r.abs());
        let frh = f(r + h);
        let frm = f(r - h);
        if !(frh.is_finite() && frm.is_finite()) {
            break;
        }
        let df = (frh - frm) / (2.0 * h);
        if !df.is_finite() || df.abs() < 1e-14 * scale {
            break;
        }
        let step = fr / df;
        let step = step.clamp(-0.5 * (1.0 + r), 10.0); // damped, keeps r > -1
        let r_new = r - step;
        if !r_new.is_finite() || r_new <= -1.0 {
            break;
        }
        r = r_new;
    }
    // Fallback: grid-scan brackets on (-1, 10] and bisect; choose the root
    // closest to zero (mirrors the ActuaryUtilities.jl multi-root policy).
    let grid: &[f64] = &[
        -0.99, -0.95, -0.9, -0.8, -0.7, -0.5, -0.25, -0.1, 0.0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25,
        0.3, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.5, 10.0,
    ];
    let mut best: Option<(f64, f64)> = None; // (|root|, root)
    for w in grid.windows(2) {
        let (a, b) = (w[0], w[1]);
        let fa = f(a);
        let fb = f(b);
        if !(fa.is_finite() && fb.is_finite()) {
            continue;
        }
        if fa == 0.0 {
            return Ok(a);
        }
        if fa.signum() == fb.signum() {
            continue;
        }
        let root = bisect(&f, a, b, fa, tol)?;
        let cand = (root.abs(), root);
        if best.map_or(true, |(b0, _)| cand.0 < b0) {
            best = Some(cand);
        }
    }
    match best {
        Some((_, root)) => Ok(root),
        None => Err(AkError::Numeric(
            "TVM rate not found: residual has no root in (-1, 10]",
        )),
    }
}

/// Bisection on a sign-changing bracket; 200 iterations, fail-closed.
fn bisect(f: &dyn Fn(f64) -> f64, a0: f64, b0: f64, fa0: f64, tol: f64) -> Result<f64, AkError> {
    let mut a = a0;
    let mut b = b0;
    let mut fa = fa0;
    for _ in 0..200 {
        let m = 0.5 * (a + b);
        let fm = f(m);
        if !fm.is_finite() {
            return Err(AkError::Numeric("bisection residual overflow"));
        }
        if fm.abs() < tol || (b - a).abs() < 1e-14 {
            return Ok(m);
        }
        if fm.signum() == fa.signum() {
            a = m;
            fa = fm;
        } else {
            b = m;
        }
    }
    Err(AkError::Numeric("bisection did not converge"))
}

// ---------------------------------------------------------------------------
// Annuities-certain
// ---------------------------------------------------------------------------

/// Present value of a level annuity-certain, optionally deferred by `defer`
/// whole periods: `defer` multiplies the immediate PV by `v^defer`.
///
/// * arrears: `payment · a(n,i)` with `a(n,i) = (1 − v^n)/i`
/// * advance: `payment · ä(n,i)` with `ä(n,i) = a(n,i)·(1+i)`
pub fn annuity_pv(
    rate: f64,
    nper: f64,
    payment: f64,
    timing: PaymentTiming,
    defer: f64,
) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_integral_nper(nper)?;
    let payment = require_finite(payment, "payment must be finite")?;
    let defer = require_finite(defer, "defer must be finite")?;
    if !(defer >= 0.0 && (defer - defer.round()).abs() <= 1e-9) {
        return Err(AkError::Input("defer must be a non-negative integer"));
    }
    let v = 1.0 / (1.0 + i);
    let a = if i.abs() < 1e-12 {
        n as f64
    } else {
        (1.0 - v.powi(n as i32)) / i
    };
    let pv = payment * a * timing_factor(i, timing) * v.powi(defer.round() as i32);
    if !pv.is_finite() {
        return Err(AkError::Numeric("annuity PV overflow"));
    }
    Ok(pv)
}

/// Accumulated (future) value of a level annuity-certain at the last payment
/// date: arrears `payment · s(n,i)` with `s(n,i) = ((1+i)^n − 1)/i`;
/// advance multiplies by `(1+i)`.
pub fn annuity_fv(
    rate: f64,
    nper: f64,
    payment: f64,
    timing: PaymentTiming,
) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_integral_nper(nper)?;
    let payment = require_finite(payment, "payment must be finite")?;
    let s = annuity_accumulator(i, n as f64);
    let fv = payment * s * timing_factor(i, timing);
    if !fv.is_finite() {
        return Err(AkError::Numeric("annuity FV overflow"));
    }
    Ok(fv)
}

/// Present value of a perpetuity: arrears `payment/i`, advance
/// `payment·(1+i)/i`. `rate` must be strictly positive.
pub fn perpetuity_pv(rate: f64, payment: f64, timing: PaymentTiming) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    if i <= 0.0 {
        return Err(AkError::Input(
            "perpetuity requires a strictly positive rate",
        ));
    }
    let payment = require_finite(payment, "payment must be finite")?;
    let pv = payment * timing_factor(i, timing) / i;
    if !pv.is_finite() {
        return Err(AkError::Numeric("perpetuity PV overflow"));
    }
    Ok(pv)
}

/// Present value of a varying annuity-certain.
///
/// * [`VaryingKind::Arithmetic`]: payments P, P+Q, P+2Q, …, P+(n−1)Q.
///   Computed directly as Σ (P + (t−1)Q)·v^t for exactness (the sum is the
///   textbook formula `(Ia)_n` when P = Q = 1).
/// * [`VaryingKind::ArithmeticDecreasing`]: payments P, P−Q, …, P−(n−1)Q.
/// * [`VaryingKind::Geometric`]: payments P, P(1+g), …, P(1+g)^{n−1}.
///
/// Advance timing multiplies the arrears value by `(1+i)`.
pub fn varying_annuity_pv(
    rate: f64,
    nper: f64,
    first_payment: f64,
    step: f64,
    kind: VaryingKind,
    timing: PaymentTiming,
) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_integral_nper(nper)?;
    let first = require_finite(first_payment, "first payment must be finite")?;
    let step = require_finite(step, "step must be finite")?;
    let v = 1.0 / (1.0 + i);
    let mut pv = 0.0f64;
    let mut vt = v;
    for t in 1..=(n as usize) {
        let pay = match kind {
            VaryingKind::Arithmetic => first + (t as f64 - 1.0) * step,
            VaryingKind::ArithmeticDecreasing => first - (t as f64 - 1.0) * step,
            VaryingKind::Geometric => first * (1.0 + step).powi(t as i32 - 1),
        };
        pv += pay * vt;
        vt *= v;
    }
    let pv = pv * timing_factor(i, timing);
    if !pv.is_finite() {
        return Err(AkError::Numeric("varying annuity PV overflow"));
    }
    Ok(pv)
}

/// Accumulated value of a varying annuity-certain at the last payment date:
/// computed directly as Σ pay_t·(1+i)^{n−t} for exactness.
pub fn varying_annuity_fv(
    rate: f64,
    nper: f64,
    first_payment: f64,
    step: f64,
    kind: VaryingKind,
    timing: PaymentTiming,
) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_integral_nper(nper)?;
    let first = require_finite(first_payment, "first payment must be finite")?;
    let step = require_finite(step, "step must be finite")?;
    // Advance timing shifts every payment one period earlier: accumulate
    // Σ pay_t·(1+i)^{n−t+1} instead of Σ pay_t·(1+i)^{n−t}.
    let shift = match timing {
        PaymentTiming::Arrears => 0.0,
        PaymentTiming::Advance => 1.0,
    };
    let mut fv = 0.0f64;
    for t in 1..=(n as usize) {
        let pay = match kind {
            VaryingKind::Arithmetic => first + (t as f64 - 1.0) * step,
            VaryingKind::ArithmeticDecreasing => first - (t as f64 - 1.0) * step,
            VaryingKind::Geometric => first * (1.0 + step).powi(t as i32 - 1),
        };
        fv += pay * (1.0 + i).powf(n as f64 - t as f64 + shift);
    }
    if !fv.is_finite() {
        return Err(AkError::Numeric("varying annuity FV overflow"));
    }
    Ok(fv)
}

// ---------------------------------------------------------------------------
// Generic present-value utilities (reference cross-checks)
// ---------------------------------------------------------------------------

/// PV of cash flows at uniform times `1..=n` under a flat rate.
pub fn pv_uniform(rate: f64, cfs: &[f64]) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    let mut acc = 0.0;
    let mut disc = 1.0 / (1.0 + i);
    for &c in cfs {
        if !c.is_finite() {
            return Err(AkError::Input("cash flows must be finite"));
        }
        acc += c * disc;
        disc /= 1.0 + i;
    }
    if !acc.is_finite() {
        return Err(AkError::Numeric("PV overflow"));
    }
    Ok(acc)
}

/// PV of cash flows at explicit time points under a flat rate.
pub fn pv_at_times(rate: f64, cfs: &[f64], times: &[f64]) -> Result<f64, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    if cfs.len() != times.len() {
        return Err(AkError::Input(
            "cash flows and times must have equal length",
        ));
    }
    if cfs.is_empty() {
        return Err(AkError::Input("cash flows must not be empty"));
    }
    let mut acc = 0.0;
    for (&c, &t) in cfs.iter().zip(times.iter()) {
        if !c.is_finite() || !t.is_finite() || t < 0.0 {
            return Err(AkError::Input(
                "cash flows must be finite and times non-negative",
            ));
        }
        acc += c / (1.0 + i).powf(t);
    }
    if !acc.is_finite() {
        return Err(AkError::Numeric("PV overflow"));
    }
    Ok(acc)
}

/// PV of cash flows at uniform times `1..=n` under a vector of forward
/// (per-period) rates: discount factor to time t compounds `rates[0..t]`.
pub fn pv_forward_rates(rates: &[f64], cfs: &[f64]) -> Result<f64, AkError> {
    if rates.len() != cfs.len() {
        return Err(AkError::Input(
            "rates and cash flows must have equal length",
        ));
    }
    if cfs.is_empty() {
        return Err(AkError::Input("cash flows must not be empty"));
    }
    let mut acc = 0.0;
    let mut disc = 1.0;
    for (&r, &c) in rates.iter().zip(cfs.iter()) {
        if !(r.is_finite() && r > -1.0) {
            return Err(AkError::Input("rates must be > -1 (finite)"));
        }
        if !c.is_finite() {
            return Err(AkError::Input("cash flows must be finite"));
        }
        disc /= 1.0 + r;
        acc += c * disc;
    }
    if !acc.is_finite() {
        return Err(AkError::Numeric("PV overflow"));
    }
    Ok(acc)
}

/// Backward-recursion present values: `pv[n] = cf[n−1]/(1+i)` and
/// `pv[j] = (cf[j−1] + pv[j+1])/(1+i)` for j = n−1 down to 1. Returns the
/// full vector (ActuaryUtilities.jl `present_values` convention).
pub fn present_values_backward(rate: f64, cfs: &[f64]) -> Result<Vec<f64>, AkError> {
    let i = require_rate(rate, "rate must be finite")?;
    if cfs.is_empty() {
        return Err(AkError::Input("cash flows must not be empty"));
    }
    let mut out = vec![0.0; cfs.len()];
    let mut acc = 0.0;
    for j in (0..cfs.len()).rev() {
        if !cfs[j].is_finite() {
            return Err(AkError::Input("cash flows must be finite"));
        }
        acc = (cfs[j] + acc) / (1.0 + i);
        out[j] = acc;
    }
    if !out.iter().all(|v| v.is_finite()) {
        return Err(AkError::Numeric("PV overflow"));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// IRR
// ---------------------------------------------------------------------------

/// Internal rate of return of a cash-flow signature at uniform times
/// `t = 0..n−1`: solves `Σ cf_t·(1+r)^{−t} = 0` over `r ∈ (−1, ∞)`.
///
/// Newton–Raphson with a damped step first; on non-convergence a grid-scan
/// finds all sign-changing brackets in `(-1, 10]`, bisects them, and picks
/// the root closest to zero (matching the ActuaryUtilities.jl multi-root
/// policy, tag v2.0.0 test/runtests.jl). Fails closed with
/// [`AkError::Numeric`] when no root exists — never returns a guess.
pub fn irr(cfs: &[f64]) -> Result<f64, AkError> {
    if cfs.len() < 2 {
        return Err(AkError::Input("IRR needs at least two cash flows"));
    }
    if cfs.iter().any(|c| !c.is_finite()) {
        return Err(AkError::Input("cash flows must be finite"));
    }
    let scale = cfs
        .iter()
        .fold(0.0f64, |m, c| m.max(c.abs()))
        .max(f64::EPSILON);
    let tol = 1e-10 * scale;
    let f = |r: f64| {
        let mut acc = 0.0;
        let mut disc = 1.0;
        for &c in cfs {
            acc += c * disc;
            disc /= 1.0 + r;
        }
        acc
    };
    // Newton with damping from r = 0.1.
    let mut r = 0.1f64;
    for _ in 0..100 {
        let fr = f(r);
        if fr.abs() < tol {
            return Ok(r);
        }
        let h = 1e-6 * (1.0 + r.abs());
        let frh = f(r + h);
        let frm = f(r - h);
        if !(frh.is_finite() && frm.is_finite()) {
            break;
        }
        let df = (frh - frm) / (2.0 * h);
        if !df.is_finite() || df.abs() < 1e-14 * scale {
            break;
        }
        let step = (fr / df).clamp(-0.5 * (1.0 + r), 10.0);
        let r_new = r - step;
        if !r_new.is_finite() || r_new <= -1.0 {
            break;
        }
        r = r_new;
    }
    // Grid-scan fallback (root closest to zero).
    let grid: &[f64] = &[
        -0.99, -0.95, -0.9, -0.8, -0.7, -0.5, -0.25, -0.1, 0.0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25,
        0.3, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.5, 10.0,
    ];
    let mut best: Option<(f64, f64)> = None;
    for w in grid.windows(2) {
        let (a, b) = (w[0], w[1]);
        let fa = f(a);
        let fb = f(b);
        if !(fa.is_finite() && fb.is_finite()) || fa.signum() == fb.signum() {
            continue;
        }
        if fa == 0.0 {
            return Ok(a);
        }
        let root = bisect(&f, a, b, fa, tol)?;
        let cand = (root.abs(), root);
        if best.map_or(true, |(b0, _)| cand.0 < b0) {
            best = Some(cand);
        }
    }
    match best {
        Some((_, root)) => Ok(root),
        None => Err(AkError::Numeric(
            "IRR not found: signature has no root in (-1, 10]",
        )),
    }
}

// ---------------------------------------------------------------------------
// Bonds
// ---------------------------------------------------------------------------

/// Coupon-period cash flows of a bullet bond: `face·coupon_rate/freq` per
/// period plus `face` redemption with the last coupon.
pub fn bond_cashflows(
    face: f64,
    coupon_rate: f64,
    nper_coupons: u32,
    freq: u32,
) -> Result<Vec<f64>, AkError> {
    let face = require_finite(face, "face must be finite")?;
    if face <= 0.0 {
        return Err(AkError::Input("face must be positive"));
    }
    let coupon_rate = require_finite(coupon_rate, "coupon rate must be finite")?;
    if coupon_rate < 0.0 {
        return Err(AkError::Input("coupon rate must be >= 0"));
    }
    if nper_coupons == 0 || nper_coupons > 1_000_000 {
        return Err(AkError::Input("nper_coupons must be in [1, 1e6]"));
    }
    if freq == 0 || freq > 365 {
        return Err(AkError::Input("coupon frequency must be in [1, 365]"));
    }
    let c = face * coupon_rate / freq as f64;
    let mut cfs = vec![c; nper_coupons as usize];
    let last = cfs.last_mut().expect("non-empty by validation");
    *last += face;
    Ok(cfs)
}

/// Price of a bullet bond as a percentage of face: coupons discounted at the
/// periodic yield `ytm/freq`, plus redemption at the final period.
/// `nper_coupons` is the number of coupon periods remaining.
pub fn bond_price(
    face: f64,
    coupon_rate: f64,
    ytm: f64,
    nper_coupons: u32,
    freq: u32,
) -> Result<f64, AkError> {
    let y = require_rate(ytm, "yield must be finite")?;
    let cfs = bond_cashflows(face, coupon_rate, nper_coupons, freq)?;
    let yp = y / freq as f64;
    if yp <= -1.0 {
        return Err(AkError::Input("periodic yield must be > -1"));
    }
    let price = pv_uniform(yp, &cfs)? * 100.0 / face;
    if !price.is_finite() {
        return Err(AkError::Numeric("bond price overflow"));
    }
    Ok(price)
}

/// Bond-equivalent yield (periodic yield × frequency) solved from the
/// clean price, via Newton with bisection fallback. Fails closed with
/// [`AkError::Numeric`] on non-convergence — never returns a guess.
pub fn bond_yield(
    face: f64,
    coupon_rate: f64,
    price_pct: f64,
    nper_coupons: u32,
    freq: u32,
) -> Result<f64, AkError> {
    let price_pct = require_finite(price_pct, "price must be finite")?;
    if price_pct <= 0.0 {
        return Err(AkError::Input("price must be positive"));
    }
    let cfs = bond_cashflows(face, coupon_rate, nper_coupons, freq)?;
    let scale = cfs
        .iter()
        .fold(0.0f64, |m, c| m.max(c.abs()))
        .max(f64::EPSILON);
    let tol = 1e-10 * scale;
    let target = price_pct * face / 100.0;
    let f = |yp: f64| -> f64 {
        let mut acc = 0.0;
        let mut disc = 1.0 / (1.0 + yp);
        for &c in &cfs {
            acc += c * disc;
            disc /= 1.0 + yp;
        }
        acc - target
    };
    // Newton on the periodic yield.
    let mut y = 0.05f64;
    let mut converged = false;
    for _ in 0..100 {
        let fy = f(y);
        if fy.abs() < tol {
            converged = true;
            break;
        }
        let h = 1e-6 * (1.0 + y.abs());
        let df = (f(y + h) - f(y - h)) / (2.0 * h);
        if !df.is_finite() || df.abs() < 1e-14 * scale {
            break;
        }
        let step = (fy / df).clamp(-0.5 * (1.0 + y), 10.0);
        let y_new = y - step;
        if !y_new.is_finite() || y_new <= -1.0 {
            break;
        }
        y = y_new;
    }
    if !converged {
        // Grid-scan + bisection fallback, root closest to zero.
        let grid: &[f64] = &[
            -0.99, -0.95, -0.9, -0.8, -0.7, -0.5, -0.25, -0.1, 0.0, 0.02, 0.05, 0.1, 0.15, 0.2,
            0.25, 0.3, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.5, 10.0,
        ];
        let mut best: Option<(f64, f64)> = None;
        for w in grid.windows(2) {
            let (a, b) = (w[0], w[1]);
            let fa = f(a);
            let fb = f(b);
            if !(fa.is_finite() && fb.is_finite()) || fa.signum() == fb.signum() {
                continue;
            }
            if fa == 0.0 {
                return Ok(a * freq as f64);
            }
            let root = bisect(&f, a, b, fa, tol)?;
            let cand = (root.abs(), root);
            if best.map_or(true, |(b0, _)| cand.0 < b0) {
                best = Some(cand);
            }
        }
        match best {
            Some((_, root)) => return Ok(root * freq as f64),
            None => {
                return Err(AkError::Numeric(
                    "bond yield not found: price residual has no root in (-1, 10]",
                ));
            }
        }
    }
    Ok(y * freq as f64)
}

/// Macaulay duration (in periods), modified duration (in periods), and
/// convexity (periods²) of cash flows at explicit time points under a
/// periodic effective yield `y`.
///
/// * Macaulay: `D = Σ t·PV(cf_t)/P`
/// * Modified: `D/(1+y)`
/// * Convexity: `P″(y)/P = Σ t·(t+1)·cf_t·(1+y)^{−(t+2)}/P`
///
/// The zero-bond check `convexity = t(t+1)/(1+y)²` is the Primer-example
/// golden pinned in tests/finmath_golden.rs.
pub fn duration_convexity(y: f64, cfs: &[f64], times: &[f64]) -> Result<(f64, f64, f64), AkError> {
    let y = require_rate(y, "yield must be finite")?;
    if cfs.len() != times.len() {
        return Err(AkError::Input(
            "cash flows and times must have equal length",
        ));
    }
    if cfs.is_empty() {
        return Err(AkError::Input("cash flows must not be empty"));
    }
    let price = pv_at_times(y, cfs, times)?;
    if price.abs() < f64::EPSILON {
        return Err(AkError::Numeric("duration undefined: zero price"));
    }
    let mut mac = 0.0;
    let mut conv = 0.0;
    for (&c, &t) in cfs.iter().zip(times.iter()) {
        if !t.is_finite() || t < 0.0 {
            return Err(AkError::Input("times must be non-negative"));
        }
        let pv = c / (1.0 + y).powf(t);
        mac += t * pv;
        conv += t * (t + 1.0) * c / (1.0 + y).powf(t + 2.0);
    }
    let mac = mac / price;
    let conv = conv / price;
    if !(mac.is_finite() && conv.is_finite()) {
        return Err(AkError::Numeric("duration/convexity overflow"));
    }
    Ok((mac, mac / (1.0 + y), conv))
}

/// Duration (years) and convexity (years²) of a bullet bond under its
/// bond-equivalent yield. Macaulay and modified duration are reported in
/// years (`period duration / freq`); convexity is `P″(y_bey)/P` in years²
/// (chain rule via y_bey = freq·y_periodic — see tests for the identity).
pub fn bond_duration_convexity(
    face: f64,
    coupon_rate: f64,
    ytm: f64,
    nper_coupons: u32,
    freq: u32,
) -> Result<(f64, f64, f64), AkError> {
    let y = require_rate(ytm, "yield must be finite")?;
    let cfs = bond_cashflows(face, coupon_rate, nper_coupons, freq)?;
    let yp = y / freq as f64;
    if yp <= -1.0 {
        return Err(AkError::Input("periodic yield must be > -1"));
    }
    let times: Vec<f64> = (1..=nper_coupons).map(|t| t as f64).collect();
    let (mac_periods, _mod_periods, conv_periods) = duration_convexity(yp, &cfs, &times)?;
    let mac_years = mac_periods / freq as f64;
    let mod_years = mac_years / (1.0 + yp);
    // Convexity w.r.t. the bond-equivalent yield y_bey = freq·y_periodic:
    // P″(y_bey)/P = (1/freq)² · P″(y_periodic)/P.
    let conv_years = conv_periods / (freq as f64 * freq as f64);
    Ok((mac_years, mod_years, conv_years))
}

// ---------------------------------------------------------------------------
// Amortization
// ---------------------------------------------------------------------------

/// One row of an amortization schedule (period 1-based).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AmortRow {
    /// Period index (1-based).
    pub period: u32,
    /// Level payment.
    pub payment: f64,
    /// Interest portion of the payment.
    pub interest: f64,
    /// Principal-reduction portion of the payment.
    pub principal: f64,
    /// Outstanding balance after the payment.
    pub balance: f64,
}

/// Level-payment amortization schedule of a loan: payment solves
/// `principal = payment · a(n,i)`; each row splits the payment into
/// interest (opening balance × rate) and principal reduction.
pub fn amort_schedule(principal: f64, rate: f64, nper: f64) -> Result<Vec<AmortRow>, AkError> {
    let principal = require_finite(principal, "principal must be finite")?;
    if principal <= 0.0 {
        return Err(AkError::Input("principal must be positive"));
    }
    let i = require_rate(rate, "rate must be finite")?;
    let n = require_integral_nper(nper)?;
    let pay = pmt(i, n as f64, -principal, 0.0, PaymentTiming::Arrears)?;
    let mut rows = Vec::with_capacity(n as usize);
    let mut bal = principal;
    for t in 1..=n {
        let interest = bal * i;
        let prin = pay - interest;
        let new_bal = bal - prin;
        if !new_bal.is_finite() {
            return Err(AkError::Numeric("amortization overflow"));
        }
        // Final-period rounding: the last balance is exactly zero by
        // construction of the payment; absorb sub-ulp residue.
        let new_bal = if t == n && new_bal.abs() < 1e-9 * principal {
            0.0
        } else {
            new_bal
        };
        rows.push(AmortRow {
            period: t,
            payment: pay,
            interest,
            principal: prin,
            balance: new_bal,
        });
        bal = new_bal;
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FM textbook derivations (hand-computed; Broverman, Mathematics of
    /// Investment and Credit conventions):
    /// a(10, 5%) = (1 − 1.05⁻¹⁰)/0.05, ä(10, 5%) = a·1.05.
    #[test]
    fn annuity_hand_computed() {
        let a10 = annuity_pv(0.05, 10.0, 1.0, PaymentTiming::Arrears, 0.0).unwrap();
        let expected = (1.0 - 1.05f64.powi(-10)) / 0.05;
        assert!((a10 - expected).abs() < 1e-14);
        let ad10 = annuity_pv(0.05, 10.0, 1.0, PaymentTiming::Advance, 0.0).unwrap();
        assert!((ad10 - expected * 1.05).abs() < 1e-13);
        // Deferred 5 periods: v^5 · a(10,5%).
        let def = annuity_pv(0.05, 10.0, 1.0, PaymentTiming::Arrears, 5.0).unwrap();
        assert!((def - expected / 1.05f64.powi(5)).abs() < 1e-13);
        // s(10, 5%) = ((1.05)^10 − 1)/0.05; FV = PV·(1.05)^10 identity.
        let fv = annuity_fv(0.05, 10.0, 1.0, PaymentTiming::Arrears).unwrap();
        assert!((fv - (1.05f64.powi(10) - 1.0) / 0.05).abs() < 1e-13);
        assert!((fv - a10 * 1.05f64.powi(10)).abs() < 1e-11);
    }

    /// Increasing annuity textbook identity (Ia)_n = (ä(n) − n·v^n)/i and
    /// decreasing (Da)_n = (n − a(n))/i, verified against direct summation.
    #[test]
    fn varying_annuity_textbook_identities() {
        let i = 0.07f64;
        let n = 10u32;
        let v = 1.0 / (1.0 + i);
        let a_n = (1.0 - v.powi(n as i32)) / i;
        let ad_n = a_n * (1.0 + i);
        let ia = varying_annuity_pv(
            i,
            10.0,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((ia - (ad_n - n as f64 * v.powi(n as i32)) / i).abs() < 1e-12);
        let da = varying_annuity_pv(
            i,
            10.0,
            10.0,
            1.0,
            VaryingKind::ArithmeticDecreasing,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((da - (n as f64 - a_n) / i).abs() < 1e-12);
        // (Iä) = (Ia)·(1+i); (Dä) = (Da)·(1+i).
        let iad = varying_annuity_pv(
            i,
            10.0,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Advance,
        )
        .unwrap();
        assert!((iad - ia * (1.0 + i)).abs() < 1e-12);
        let dad = varying_annuity_pv(
            i,
            10.0,
            10.0,
            1.0,
            VaryingKind::ArithmeticDecreasing,
            PaymentTiming::Advance,
        )
        .unwrap();
        assert!((dad - da * (1.0 + i)).abs() < 1e-12);
        // FV = PV·(1+i)^n.
        let ia_fv = varying_annuity_fv(
            i,
            10.0,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((ia_fv - ia * (1.0 + i).powi(n as i32)).abs() < 1e-10);
    }

    /// Geometric annuity: closed form P/(1+i) · (1 − r^n)/(1 − r) with
    /// r = (1+g)/(1+i), and the g == i degenerate case n·P/(1+i).
    #[test]
    fn geometric_annuity_closed_form() {
        let i = 0.07f64;
        let g = 0.03f64;
        let pv = varying_annuity_pv(
            i,
            10.0,
            1.0,
            g,
            VaryingKind::Geometric,
            PaymentTiming::Arrears,
        )
        .unwrap();
        let r = (1.0 + g) / (1.0 + i);
        let expected = (1.0 / (1.0 + i)) * (1.0 - r.powi(10)) / (1.0 - r);
        assert!((pv - expected).abs() < 1e-12);
        let pv_eq = varying_annuity_pv(
            i,
            10.0,
            1.0,
            i,
            VaryingKind::Geometric,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((pv_eq - 10.0 / (1.0 + i)).abs() < 1e-12);
    }

    /// TVM round-trip: solve each variable from the other four and recover
    /// the original inputs (Excel sign conventions).
    #[test]
    fn tvm_round_trip() {
        let i = 0.05f64;
        let n = 12.0f64;
        let pv0 = -1000.0;
        let fv0 = 500.0;
        let pmt0 = pmt(i, n, pv0, fv0, PaymentTiming::Arrears).unwrap();
        let pv1 = pv(i, n, pmt0, fv0, PaymentTiming::Arrears).unwrap();
        let fv1 = fv(i, n, pmt0, pv0, PaymentTiming::Arrears).unwrap();
        let n1 = nper(i, pmt0, pv0, fv0, PaymentTiming::Arrears).unwrap();
        let i1 = tvm_rate(n, pmt0, pv0, fv0, PaymentTiming::Arrears).unwrap();
        assert!((pv1 - pv0).abs() < 1e-8);
        assert!((fv1 - fv0).abs() < 1e-8);
        assert!((n1 - n).abs() < 1e-8);
        assert!((i1 - i).abs() < 1e-10);
        // Advance timing round-trip too.
        let pmt_d = pmt(i, n, pv0, fv0, PaymentTiming::Advance).unwrap();
        let i_d = tvm_rate(n, pmt_d, pv0, fv0, PaymentTiming::Advance).unwrap();
        assert!((i_d - i).abs() < 1e-10);
        // No-solution nper fails closed (fv and pv same sign, pmt 0).
        assert!(matches!(
            nper(0.05, 0.0, 100.0, 100.0, PaymentTiming::Arrears),
            Err(AkError::Numeric(_))
        ));
    }

    /// Amortization schedule: payment from a(n,i), interest = balance·i,
    /// last balance zero. Hand example: 12,000 at 8% over 5 years →
    /// payment = 12000/a(5,8%) = 3005.48…; interest row 1 = 960.
    #[test]
    fn amortization_hand_computed() {
        let rows = amort_schedule(12_000.0, 0.08, 5.0).unwrap();
        assert_eq!(rows.len(), 5);
        let a5 = (1.0 - 1.08f64.powi(-5)) / 0.08;
        let pay = 12_000.0 / a5;
        assert!((rows[0].payment - pay).abs() < 1e-10);
        assert!((rows[0].interest - 960.0).abs() < 1e-10);
        assert!((rows[0].principal - (pay - 960.0)).abs() < 1e-10);
        assert!(rows[4].balance.abs() < 1e-7);
        // Sum of principal portions repays the loan exactly.
        let total_prin: f64 = rows.iter().map(|r| r.principal).sum();
        assert!((total_prin - 12_000.0).abs() < 1e-7);
    }

    /// IRR: textbook two-cash-flow case solves exactly; the unsolvable
    /// all-negative-signature case fails closed (never panics, never
    /// guesses).
    #[test]
    fn irr_basics() {
        // 1000 invested, 600 + 550 returned: NPV = -1000 + 600/(1+r) + 550/(1+r)^2 = 0
        // verify NPV at the returned root.
        let r = irr(&[-1000.0, 600.0, 550.0]).unwrap();
        let npv = -1000.0 + 600.0 / (1.0 + r) + 550.0 / (1.0 + r).powi(2);
        assert!(npv.abs() < 1e-8);
        // All-positive signature: no root — must error honestly.
        assert!(matches!(irr(&[1.0, 1.0, 1.0]), Err(AkError::Numeric(_))));
        // Degenerate input rejected before compute.
        assert!(matches!(irr(&[f64::NAN, 1.0]), Err(AkError::Input(_))));
        assert!(matches!(irr(&[1.0]), Err(AkError::Input(_))));
    }

    /// Bond round-trip: price at a known yield, then solve the yield back
    /// from the price (Newton + fallback).
    #[test]
    fn bond_round_trip() {
        // 5% annual-coupon 10-year bond at 6% yield:
        // price = 5·a(10,6%) + 100·v^10 (per 100 face).
        let price = bond_price(100.0, 0.05, 0.06, 10, 1).unwrap();
        let a10 = (1.0 - 1.06f64.powi(-10)) / 0.06;
        let expected = 5.0 * a10 + 100.0 / 1.06f64.powi(10);
        assert!((price - expected).abs() < 1e-10);
        let y = bond_yield(100.0, 0.05, price, 10, 1).unwrap();
        assert!((y - 0.06).abs() < 1e-9);
        // Par bond: price == 100 when coupon == yield (semiannual too).
        let par = bond_price(100.0, 0.075, 0.075, 10, 2).unwrap();
        assert!((par - 100.0).abs() < 1e-10);
        // Zero-coupon bond: price = face·v^n.
        let z = bond_price(100.0, 0.0, 0.05, 5, 1).unwrap();
        assert!((z - 100.0 / 1.05f64.powi(5)).abs() < 1e-10);
    }

    /// Duration/convexity conventions verified against direct identities:
    /// zero bond Macaulay duration = t; convexity = t(t+1)/(1+y)².
    #[test]
    fn duration_convexity_identities() {
        let cfs = [1.0e6];
        let times = [5.0];
        let (mac, modd, conv) = duration_convexity(0.04, &cfs, &times).unwrap();
        assert!((mac - 5.0).abs() < 1e-12);
        assert!((modd - 5.0 / 1.04).abs() < 1e-12);
        assert!((conv - 30.0 / 1.04f64.powi(2)).abs() < 1e-9);
        // Bond wrapper reports years: semiannual halves the period duration.
        let (mac_y, mod_y, conv_y) = bond_duration_convexity(100.0, 0.05, 0.06, 10, 2).unwrap();
        let cfs2 = bond_cashflows(100.0, 0.05, 10, 2).unwrap();
        let times2: Vec<f64> = (1..=10).map(|t| t as f64).collect();
        let (mac_p, _m, conv_p) = duration_convexity(0.03, &cfs2, &times2).unwrap();
        assert!((mac_y - mac_p / 2.0).abs() < 1e-12);
        assert!((mod_y - mac_p / 2.0 / 1.03).abs() < 1e-12);
        assert!((conv_y - conv_p / 4.0).abs() < 1e-12);
    }

    /// Rejection paths: every invalid shape returns an error before compute.
    #[test]
    fn validation_fail_closed() {
        assert!(matches!(
            pv(-1.5, 10.0, 0.0, 0.0, PaymentTiming::Arrears),
            Err(AkError::Input(_))
        ));
        assert!(matches!(
            pv(0.05, 0.0, 0.0, 0.0, PaymentTiming::Arrears),
            Err(AkError::Input(_))
        ));
        assert!(matches!(
            annuity_pv(0.05, 10.5, 1.0, PaymentTiming::Arrears, 0.0),
            Err(AkError::Input(_))
        ));
        assert!(matches!(
            perpetuity_pv(0.0, 1.0, PaymentTiming::Arrears),
            Err(AkError::Input(_))
        ));
        assert!(matches!(
            bond_price(0.0, 0.05, 0.06, 10, 1),
            Err(AkError::Input(_))
        ));
        assert!(matches!(
            bond_yield(100.0, 0.05, 0.0, 10, 1),
            Err(AkError::Input(_))
        ));
        assert!(PaymentTiming::from_code(2).is_err());
        assert!(VaryingKind::from_code(3).is_err());
        assert!(matches!(
            amort_schedule(-1.0, 0.05, 5.0),
            Err(AkError::Input(_))
        ));
    }
}
