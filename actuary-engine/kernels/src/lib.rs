//! # actuary_kernels
//!
//! Actuarial compute kernels for the InsureTech platform (`actuary-engine/kernels`).
//!
//! Four pure-numeric cores, each fail-closed on invalid or non-finite input:
//!
//! | Module        | Capability |
//! |---------------|------------|
//! | [`premium`]   | GLM-style premium composition: relativities product, expense/commission/profit loadings, statutory taxes, kobo-integer rounding and min/max clamps. |
//! | [`triangle`]  | Chain-ladder (volume-weighted and simple-average factor paths), Bornhuetter–Ferguson, Mack parameter/process standard errors. |
//! | [`montecarlo`]| Aggregate-loss economic-capital simulation: frequency–severity per line, Gaussian copula, VaR 99.5 / TVaR 99 and per-line TVaR. Deterministic under seed. |
//! | [`mortality`] | qx-grid survival, annuity present values with flat improvement scalar and caller-supplied discount curve, profit-testing projection (margin + IRR). |
//!
//! The C ABI surface lives in [`ffi`] and mirrors `include/actuary_kernels.h`
//! exactly (frozen cross-leg contract, design doc Appendix C). Every
//! `extern "C"` function wraps its body in [`std::panic::catch_unwind`], so no
//! panic can cross the boundary; failures are reported through the `AK_ERR_*`
//! status codes and out-params are left untouched on error.
//!
//! ## Money conventions
//!
//! All monetary *inputs* are `f64` major units (NGN naira). All monetary
//! *outputs* that cross the FFI boundary are integer minor units (kobo,
//! 1/100 naira), rounded half-away-from-zero — the Go boundary converts once
//! and the platform never accumulates float drift (`tbClient` precedent).
//! Rates (ratios, discounts, improvements, taxes) are `f64` fractions.
//!
//! ## No-mock policy
//!
//! This crate contains no mocks, fakes, or stubs. Every function performs the
//! real computation; every error path is returned, never swallowed.

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod ffi;
pub mod montecarlo;
pub mod mortality;
pub mod premium;
pub mod triangle;

#[cfg(feature = "python")]
pub mod py;

/// Crate version packed as `major << 16 | minor << 8 | patch`.
///
/// Mirrors `ak_version()` in the C ABI.
pub const VERSION_PACKED: u32 = 65536; // 1.0.0

/// Status codes returned by every fallible FFI entry point.
/// Values are part of the frozen FFI contract (design Appendix C) and must
/// never be renumbered.
pub mod status {
    /// Success.
    pub const AK_OK: i32 = 0;
    /// Invalid argument (null pointer, bad length, non-finite or out-of-range
    /// value detected during validation *before* any compute).
    pub const AK_ERR_INPUT: i32 = -1;
    /// Out-of-model-domain input (e.g. unknown distribution code, Tweedie
    /// power outside the supported family).
    pub const AK_ERR_DOMAIN: i32 = -2;
    /// Numeric failure: non-convergence, overflow, degenerate input that makes
    /// the estimator undefined (e.g. zero column sum in a development factor).
    pub const AK_ERR_NUMERIC: i32 = -3;
    /// A panic was caught at the FFI boundary. Must be unreachable in tests.
    pub const AK_ERR_PANIC: i32 = -99;
}

/// Error type used by the safe-Rust cores. [`ffi`] maps these onto the
/// `AK_ERR_*` status codes at the boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AkError {
    /// Invalid argument — maps to `AK_ERR_INPUT`.
    Input(&'static str),
    /// Out of model domain — maps to `AK_ERR_DOMAIN`.
    Domain(&'static str),
    /// Numeric failure — maps to `AK_ERR_NUMERIC`.
    Numeric(&'static str),
}

impl AkError {
    pub(crate) fn code(self) -> i32 {
        match self {
            AkError::Input(_) => status::AK_ERR_INPUT,
            AkError::Domain(_) => status::AK_ERR_DOMAIN,
            AkError::Numeric(_) => status::AK_ERR_NUMERIC,
        }
    }
}

impl core::fmt::Display for AkError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            AkError::Input(m) => write!(f, "invalid input: {m}"),
            AkError::Domain(m) => write!(f, "out of model domain: {m}"),
            AkError::Numeric(m) => write!(f, "numeric failure: {m}"),
        }
    }
}

impl std::error::Error for AkError {}

pub(crate) fn require_finite(x: f64, what: &'static str) -> Result<f64, AkError> {
    if x.is_finite() {
        Ok(x)
    } else {
        Err(AkError::Input(what))
    }
}

/// Returns the packed crate version; used by the `readyz` smoke call.
#[inline]
pub const fn version_packed() -> u32 {
    VERSION_PACKED
}
