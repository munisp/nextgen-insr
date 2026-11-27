//! Premium mathematics kernels.
//!
//! Pure premium from frequency × severity × exposure, multiplicative
//! relativity composition, expense/commission/profit loading decomposition,
//! statutory taxes, and kobo-integer boundaries.
//!
//! ## Composition convention (documented contract)
//!
//! Loadings are expressed as fractions of the **gross** premium (the standard
//! "rate-making" convention), so
//!
//! ```text
//! pure            = base_pure_premium × Π rels
//! gross_before_tax = pure / (1 − expense_ratio − commission_rate − profit_margin)
//! total           = gross_before_tax × (1 + Σ tax_rates)
//! ```
//!
//! Taxes and levies are additive rates applied to the gross premium
//! (mirrors `PremiumFormulaEngine`'s `taxDetails` shape).
//!
//! All outputs are integer **kobo** (1/100 naira), rounded half-away-from-zero.
//! The total is clamped to `[min_premium_kobo, max_premium_kobo]`; pass
//! `(0, i64::MAX)` for "no clamp".

use crate::{require_finite, AkError};

/// Decomposed premium quote, all integer minor units (kobo).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PremiumQuote {
    /// Total premium payable, after loadings and taxes, clamped.
    pub total_kobo: i64,
    /// Pure (risk) premium: exposure × base rate × relativity product.
    pub pure_kobo: i64,
    /// Loadings portion (expense + commission + profit), pre-tax.
    /// `pure_kobo + loadings_kobo` is the gross premium before tax.
    pub loadings_kobo: i64,
    /// Tax portion actually included in the (possibly clamped) total.
    /// `total_kobo = pure_kobo + loadings_kobo + tax_kobo` whenever the
    /// total was not clamped.
    pub tax_kobo: i64,
}

/// Pure premium from exposure, expected frequency and expected severity.
///
/// All inputs must be finite and non-negative; severity is in major units
/// (naira). Returns the pure premium in major units.
pub fn pure_premium(exposure: f64, frequency: f64, severity: f64) -> Result<f64, AkError> {
    let exposure = require_finite(exposure, "exposure must be finite")?;
    let frequency = require_finite(frequency, "frequency must be finite")?;
    let severity = require_finite(severity, "severity must be finite")?;
    if exposure < 0.0 || frequency < 0.0 || severity < 0.0 {
        return Err(AkError::Input(
            "exposure, frequency and severity must be non-negative",
        ));
    }
    let pure = exposure * frequency * severity;
    if !pure.is_finite() {
        return Err(AkError::Numeric("pure premium overflow"));
    }
    Ok(pure)
}

/// Maximum gross-before-tax premium (naira) representable in kobo as `i64`,
/// with head-room for the tax multiplier.
const MAX_NAIRA: f64 = (i64::MAX as f64) / 100.0 / 64.0;

/// Compose a full premium quote.
///
/// * `base_pure_premium`: exposure × base rate, major units (naira), ≥ 0.
/// * `rels`: resolved multiplicative relativities, each finite and > 0.
///   The kernel never does table lookup (frozen FFI contract).
/// * `expense_ratio`, `commission_rate`, `profit_margin`: fractions of gross,
///   each ≥ 0, sum strictly < 1.
/// * `tax_rates`: additive statutory taxes/levies on gross, each > −1.
/// * `min_premium_kobo`, `max_premium_kobo`: clamp on the total; requires
///   `0 ≤ min ≤ max`.
#[allow(clippy::too_many_arguments)] // mirrors the frozen FFI signature
pub fn compose(
    base_pure_premium: f64,
    rels: &[f64],
    expense_ratio: f64,
    commission_rate: f64,
    profit_margin: f64,
    tax_rates: &[f64],
    min_premium_kobo: i64,
    max_premium_kobo: i64,
) -> Result<PremiumQuote, AkError> {
    // ---- validation (before any compute; fail-closed) ----
    let base = require_finite(base_pure_premium, "base_pure_premium must be finite")?;
    if base < 0.0 {
        return Err(AkError::Input("base_pure_premium must be non-negative"));
    }
    let expense = require_finite(expense_ratio, "expense_ratio must be finite")?;
    let commission = require_finite(commission_rate, "commission_rate must be finite")?;
    let profit = require_finite(profit_margin, "profit_margin must be finite")?;
    if expense < 0.0 || commission < 0.0 || profit < 0.0 {
        return Err(AkError::Input("loading fractions must be non-negative"));
    }
    let loading_sum = expense + commission + profit;
    if loading_sum >= 1.0 {
        return Err(AkError::Input(
            "expense_ratio + commission_rate + profit_margin must be < 1",
        ));
    }
    let mut tax_sum = 0.0f64;
    for &t in tax_rates {
        let t = require_finite(t, "tax rates must be finite")?;
        if t <= -1.0 {
            return Err(AkError::Input("tax rate must be > -1 (100%)"));
        }
        tax_sum += t;
    }
    if !(0.0..=MAX_NAIRA).contains(&base) {
        return Err(AkError::Numeric(
            "base_pure_premium out of representable range",
        ));
    }
    if min_premium_kobo < 0 {
        return Err(AkError::Input("min_premium_kobo must be >= 0"));
    }
    if max_premium_kobo < min_premium_kobo {
        return Err(AkError::Input(
            "max_premium_kobo must be >= min_premium_kobo",
        ));
    }

    // ---- compute ----
    let mut rel_product = 1.0f64;
    for &r in rels {
        let r = require_finite(r, "relativities must be finite")?;
        if r <= 0.0 {
            return Err(AkError::Input("relativities must be > 0"));
        }
        rel_product *= r;
        if !rel_product.is_finite() {
            return Err(AkError::Numeric("relativity product overflow"));
        }
    }
    let pure = base * rel_product;
    if !pure.is_finite() || pure > MAX_NAIRA {
        return Err(AkError::Numeric("pure premium overflow"));
    }
    let gross = pure / (1.0 - loading_sum);
    if !gross.is_finite() || gross > MAX_NAIRA {
        return Err(AkError::Numeric("gross premium overflow"));
    }
    let total = gross * (1.0 + tax_sum);
    if !total.is_finite() || total > (i64::MAX as f64) / 100.0 {
        return Err(AkError::Numeric("total premium overflow"));
    }

    // ---- kobo conversion: round half away from zero (f64::round) ----
    let pure_kobo = (pure * 100.0).round() as i64;
    let loadings_kobo = ((gross - pure) * 100.0).round() as i64;
    let unclamped_total_kobo = (total * 100.0).round() as i64;
    let total_kobo = unclamped_total_kobo.clamp(min_premium_kobo, max_premium_kobo);
    let tax_kobo = total_kobo - pure_kobo - loadings_kobo;

    Ok(PremiumQuote {
        total_kobo,
        pure_kobo,
        loadings_kobo,
        tax_kobo,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_premium_basic() {
        // 100 vehicle-years × 5% frequency × ₦1,850,000 severity = ₦9,250,000
        let p = pure_premium(100.0, 0.05, 1_850_000.0).unwrap();
        assert!((p - 9_250_000.0).abs() < 1e-6);
    }

    #[test]
    fn compose_decomposition_holds() {
        // pure 9,250,000 × 1.18 territory rel; loadings 20%+10%+5%; VAT 7.5%.
        let q = compose(
            9_250_000.0,
            &[1.18],
            0.20,
            0.10,
            0.05,
            &[0.075],
            0,
            i64::MAX,
        )
        .unwrap();
        // pure = 10,915,000.00 → 1,091,500,000 kobo
        assert_eq!(q.pure_kobo, 1_091_500_000);
        // gross = pure / 0.65 = 16,792,307.6923... → loadings = 5,877,307.6923..
        assert_eq!(q.loadings_kobo, 587_730_769);
        // total = gross × 1.075 = 18,051,730.7692 → 1,805,173,077 kobo
        assert_eq!(q.total_kobo, 1_805_173_077);
        assert_eq!(q.pure_kobo + q.loadings_kobo + q.tax_kobo, q.total_kobo);
    }

    #[test]
    fn compose_clamps_min_and_max() {
        let q = compose(10.0, &[], 0.0, 0.0, 0.0, &[], 50_000, i64::MAX).unwrap();
        assert_eq!(q.total_kobo, 50_000); // raised to minimum
        let q = compose(1e9, &[], 0.0, 0.0, 0.0, &[], 0, 1_000).unwrap();
        assert_eq!(q.total_kobo, 1_000); // clamped to maximum
    }

    #[test]
    fn compose_rejects_bad_inputs() {
        assert!(compose(-1.0, &[], 0.1, 0.1, 0.1, &[], 0, i64::MAX).is_err());
        assert!(compose(f64::NAN, &[], 0.1, 0.1, 0.1, &[], 0, i64::MAX).is_err());
        assert!(compose(1.0, &[0.0], 0.1, 0.1, 0.1, &[], 0, i64::MAX).is_err());
        assert!(compose(1.0, &[], 0.5, 0.4, 0.2, &[], 0, i64::MAX).is_err()); // loadings >= 1
        assert!(compose(1.0, &[], 0.1, 0.1, 0.1, &[], 10, 5).is_err()); // max < min
        assert!(compose(1.0, &[], 0.1, 0.1, 0.1, &[-1.0], 0, i64::MAX).is_err());
    }

    #[test]
    fn half_away_from_zero_rounding() {
        // 0.005 naira = 0.5 kobo → rounds up to 1 kobo.
        let q = compose(0.005, &[], 0.0, 0.0, 0.0, &[], 0, i64::MAX).unwrap();
        assert_eq!(q.total_kobo, 1);
    }
}
