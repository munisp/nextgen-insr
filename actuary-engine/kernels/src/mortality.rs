//! Life kernels: survival probabilities from a qx grid, annuity present
//! values, and profit-testing projections.
//!
//! ## Mortality and improvement convention
//!
//! The caller supplies a qx grid (`qx[a]` = probability a life aged `a` dies
//! within one year). A **flat improvement scalar** `imp` is applied per
//! projection year: the mortality rate used in year `t` (0-based) at attained
//! age `start_age + t` is
//!
//! ```text
//! q(t) = qx[start_age + t] × (1 − imp)^t
//! ```
//!
//! so a positive improvement reduces mortality over time (longevity risk for
//! annuities is modelled by negative improvement). `S(0) = 1` and
//! `S(t) = S(t−1)·(1 − q(t−1))`.
//!
//! ## Discount convention
//!
//! `discount[k]` is the annual effective rate for projection year `k`
//! (caller-supplied CBN curve); the discount factor to time `t` is
//! `v(t) = Π_{k=0..t-1} 1/(1 + discount[k])`.

use crate::{require_finite, AkError};

/// Annuity present-value result.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnnuityPv {
    /// PV of the annuity including the guaranteed portion (annuity-immediate,
    /// end-of-year payments).
    pub pv: f64,
    /// PV of payments made during the guarantee period only (paid regardless
    /// of survival).
    pub pv_guaranteed: f64,
}

/// Survival probability to time `t` under the improved qx grid.
/// Returns `S(0)..S(n_years)` (`n_years + 1` values).
fn survival_curve(
    qx: &[f64],
    start_age: usize,
    improvement: f64,
    n_years: usize,
) -> Result<Vec<f64>, AkError> {
    if qx.is_empty() {
        return Err(AkError::Input("qx grid must not be empty"));
    }
    if n_years == 0 {
        return Err(AkError::Input("n_years must be > 0"));
    }
    if start_age + (n_years - 1) >= qx.len() {
        return Err(AkError::Input(
            "qx grid does not cover start_age + n_years - 1",
        ));
    }
    let imp = require_finite(improvement, "improvement must be finite")?;
    if !(-1.0..1.0).contains(&imp) {
        return Err(AkError::Input("improvement must be in (-1, 1)"));
    }
    let mut s = Vec::with_capacity(n_years + 1);
    s.push(1.0);
    for t in 0..n_years {
        let q0 = qx[start_age + t];
        if !(q0.is_finite() && (0.0..=1.0).contains(&q0)) {
            return Err(AkError::Input("qx entries must be in [0, 1]"));
        }
        let q = q0 * (1.0 - imp).powi(t as i32);
        let q = q.clamp(0.0, 1.0);
        let next = s[t] * (1.0 - q);
        s.push(next);
    }
    Ok(s)
}

/// Cumulative discount factors `v(t)` for `t = 0..n_years` (`v(0) = 1`).
fn discount_curve(discount: &[f64], n_years: usize) -> Result<Vec<f64>, AkError> {
    if discount.len() < n_years {
        return Err(AkError::Input("discount curve shorter than n_years"));
    }
    let mut v = Vec::with_capacity(n_years + 1);
    v.push(1.0);
    for k in 0..n_years {
        let r = discount[k];
        if !(r.is_finite() && r > -1.0) {
            return Err(AkError::Input("discount rates must be > -1 (finite)"));
        }
        let next = v[k] / (1.0 + r);
        if !next.is_finite() {
            return Err(AkError::Numeric("discount factor overflow"));
        }
        v.push(next);
    }
    Ok(v)
}

/// Present value of a life annuity-immediate with a guarantee period.
///
/// Pays `payment` at the end of each year `t = 1..=n_years` while the
/// annuitant (aged `start_age` at issue) is alive; payments during the first
/// `guarantee_years` are certain. `guarantee_years` must be ≤ `n_years`.
///
/// * `out_pv` = Σ payment·v(t)·(t ≤ g ? 1 : S(t))
/// * `out_pv_guaranteed` = Σ_{t≤g} payment·v(t)
pub fn annuity_pv(
    qx: &[f64],
    start_age: usize,
    improvement: f64,
    discount: &[f64],
    n_years: usize,
    payment: f64,
    guarantee_years: u32,
) -> Result<AnnuityPv, AkError> {
    let payment = require_finite(payment, "payment must be finite")?;
    if payment < 0.0 {
        return Err(AkError::Input("payment must be >= 0"));
    }
    if guarantee_years as usize > n_years {
        return Err(AkError::Input("guarantee_years must be <= n_years"));
    }
    let s = survival_curve(qx, start_age, improvement, n_years)?;
    let v = discount_curve(discount, n_years)?;
    let g = guarantee_years as usize;
    let mut pv = 0.0;
    let mut pvg = 0.0;
    for t in 1..=n_years {
        let pay = payment * v[t];
        if t <= g {
            pvg += pay;
            pv += pay;
        } else {
            pv += pay * s[t];
        }
    }
    if !pv.is_finite() {
        return Err(AkError::Numeric("annuity PV overflow"));
    }
    Ok(AnnuityPv {
        pv,
        pv_guaranteed: pvg,
    })
}

/// Profit-testing input (safe-Rust mirror of `AkProfitTestInput`).
///
/// All arrays have length `n_years` unless stated otherwise.
#[derive(Debug, Clone)]
pub struct ProfitTestInput {
    /// Annual premium per in-force policy at the start of year t.
    pub premiums: Vec<f64>,
    /// Annual expense per in-force policy at the start of year t
    /// (include acquisition expense in year 1 to create initial strain).
    pub expenses: Vec<f64>,
    /// Level death benefit payable at end of year on death during year t.
    pub sum_assured: f64,
    /// qx mortality grid and issue age.
    pub qx: Vec<f64>,
    /// Issue age.
    pub start_age: usize,
    /// End-of-year reserve held per *surviving* policy at end of year t.
    pub reserve_end: Vec<f64>,
    /// Annual earned (investment) rate per year t, applied to the opening
    /// reserve plus net premium cash flow.
    pub earned_rates: Vec<f64>,
    /// Risk discount curve (annual effective rates) used for the PV/margin.
    pub discount: Vec<f64>,
    /// Flat mortality improvement scalar per projection year.
    pub improvement: f64,
}

/// Profit-testing outputs.
#[derive(Debug, Clone, PartialEq)]
pub struct ProfitTestResult {
    /// Profit margin: PV(expected profits, risk discount curve) /
    /// PV(expected premiums, risk discount curve).
    pub margin: f64,
    /// Internal rate of return on the expected profit signature.
    pub irr: f64,
    /// Expected profit per year (before discounting).
    pub profit_signature: Vec<f64>,
}

/// Year-by-year profit-testing projection.
///
/// Standard profit test per policy in force at issue (`I₀ = 1`), with
/// expected in-force `S(t)` from the mortality grid:
///
/// ```text
/// Profit_t = S(t−1)·(prem_t − exp_t + i_t·(res_{t−1} + prem_t − exp_t))
///          − S(t−1)·q_t·SA
///          − S(t)·res_t + S(t−1)·res_{t−1}
/// ```
///
/// (investment income earned on opening reserve plus net premium; death
/// benefit and end-of-year reserve set up for survivors).
///
/// The **margin** is PV(profits)/PV(premiums) on the risk discount curve.
/// The **IRR** solves `Σ profit_t·(1+r)^{-(t)} = 0` over `t = 1..=n`
/// (bisection on `r ∈ (−0.9999, 10]`); fails with `AK_ERR_NUMERIC` when the
/// signature has no root (e.g. all-positive profits with no initial strain).
pub fn profit_test(input: &ProfitTestInput) -> Result<ProfitTestResult, AkError> {
    let n = input.premiums.len();
    if n == 0 {
        return Err(AkError::Input("premiums must not be empty"));
    }
    if input.expenses.len() != n
        || input.reserve_end.len() != n
        || input.earned_rates.len() != n
        || input.discount.len() != n
    {
        return Err(AkError::Input(
            "expenses/reserve_end/earned_rates/discount must match premiums length",
        ));
    }
    let sa = require_finite(input.sum_assured, "sum_assured must be finite")?;
    if sa < 0.0 {
        return Err(AkError::Input("sum_assured must be >= 0"));
    }
    for (name, arr) in [
        ("premiums must be finite", &input.premiums),
        ("expenses must be finite", &input.expenses),
        ("reserve_end must be finite", &input.reserve_end),
    ] {
        if arr.iter().any(|x| !x.is_finite()) {
            return Err(AkError::Input(name));
        }
    }
    for &e in &input.earned_rates {
        if !(e.is_finite() && e > -1.0) {
            return Err(AkError::Input("earned rates must be > -1"));
        }
    }
    let s = survival_curve(&input.qx, input.start_age, input.improvement, n)?;
    let v = discount_curve(&input.discount, n)?;

    // Expected profit signature, t = 1..=n (0-based index t−1).
    let mut signature = Vec::with_capacity(n);
    let mut pv_profit = 0.0;
    let mut pv_premium = 0.0;
    let mut res_prev = 0.0f64;
    for t in 1..=n {
        let idx = t - 1;
        let s_prev = s[idx];
        let s_now = s[t];
        // Mortality rate actually used this year (same construction as
        // survival_curve).
        let q0 = input.qx[input.start_age + idx];
        let q = (q0 * (1.0 - input.improvement).powi(idx as i32)).clamp(0.0, 1.0);
        let prem = input.premiums[idx];
        let expn = input.expenses[idx];
        let i_t = input.earned_rates[idx];
        let res_t = input.reserve_end[idx];

        let invest_base = res_prev + prem - expn;
        let profit = s_prev * (prem - expn + i_t * invest_base) - s_prev * q * sa - s_now * res_t
            + s_prev * res_prev;
        if !profit.is_finite() {
            return Err(AkError::Numeric("profit signature overflow"));
        }
        signature.push(profit);
        pv_profit += profit * v[t];
        pv_premium += s_prev * prem * v[t];
        res_prev = res_t;
    }

    if !pv_profit.is_finite() || !pv_premium.is_finite() {
        return Err(AkError::Numeric("profit-test PV overflow"));
    }
    if pv_premium.abs() < f64::EPSILON {
        return Err(AkError::Numeric("PV of premiums is zero; margin undefined"));
    }
    let margin = pv_profit / pv_premium;
    let irr = irr_of_signature(&signature)?;
    Ok(ProfitTestResult {
        margin,
        irr,
        profit_signature: signature,
    })
}

/// IRR of a cash-flow signature `Σ cf_t·(1+r)^{-t} = 0`, t = 1..=n.
/// Bisection over r ∈ (−0.9999, 10]; fails closed when no sign change exists.
fn irr_of_signature(cf: &[f64]) -> Result<f64, AkError> {
    let npv = |r: f64| -> f64 {
        let mut acc = 0.0;
        let mut disc = 1.0 / (1.0 + r);
        for &c in cf {
            acc += c * disc;
            disc /= 1.0 + r;
        }
        acc
    };
    let lo = -0.999_9f64;
    let hi = 10.0f64;
    let f_lo = npv(lo);
    let f_hi = npv(hi);
    if !(f_lo.is_finite() && f_hi.is_finite()) {
        return Err(AkError::Numeric("IRR NPV evaluation overflow"));
    }
    if f_lo == 0.0 {
        return Ok(lo);
    }
    if f_hi == 0.0 {
        return Ok(hi);
    }
    if f_lo.signum() == f_hi.signum() {
        return Err(AkError::Numeric(
            "IRR not found: profit signature has no root in (-0.9999, 10]",
        ));
    }
    let mut a = lo;
    let mut b = hi;
    let mut fa = f_lo;
    for _ in 0..200 {
        let m = 0.5 * (a + b);
        let fm = npv(m);
        if !fm.is_finite() {
            return Err(AkError::Numeric("IRR bisection overflow"));
        }
        if fm == 0.0 || (b - a).abs() < 1e-12 {
            return Ok(m);
        }
        if fm.signum() == fa.signum() {
            a = m;
            fa = fm;
        } else {
            b = m;
        }
    }
    Err(AkError::Numeric("IRR bisection did not converge"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-checkable 5-year annuity: qx = [0.10, 0.10, 0.10, 0.10, 0.10]
    /// (start_age 0), no improvement, flat 5% discount, payment 1, no
    /// guarantee.
    ///
    /// S: 1, 0.9, 0.81, 0.729, 0.6561, 0.59049
    /// v(t) = 1/1.05^t
    /// pv = Σ_{t=1..5} v(t)·S(t)
    ///    = 0.9/1.05 + 0.81/1.1025 + 0.729/1.157625 + 0.6561/1.21550625
    ///      + 0.59049/1.2762815625
    #[test]
    fn annuity_hand_computed() {
        let qx = [0.10; 5];
        let disc = [0.05; 5];
        let r = annuity_pv(&qx, 0, 0.0, &disc, 5, 1.0, 0).unwrap();
        let expected: f64 = (1..=5).map(|t| 0.9f64.powi(t) / 1.05f64.powi(t)).sum();
        assert!((r.pv - expected).abs() < 1e-12);
        assert_eq!(r.pv_guaranteed, 0.0);
    }

    #[test]
    fn annuity_guarantee_pays_certain() {
        let qx = [0.10; 5];
        let disc = [0.05; 5];
        let r = annuity_pv(&qx, 0, 0.0, &disc, 5, 1.0, 2).unwrap();
        let certain: f64 = (1..=2).map(|t| 1.0 / 1.05f64.powi(t)).sum();
        let contingent: f64 = (3..=5).map(|t| 0.9f64.powi(t) / 1.05f64.powi(t)).sum();
        assert!((r.pv_guaranteed - certain).abs() < 1e-12);
        assert!((r.pv - certain - contingent).abs() < 1e-12);
    }

    #[test]
    fn improvement_reduces_mortality() {
        // improvement 0.02: q(t) = 0.1×0.98^t → higher survival → higher PV.
        let qx = [0.10; 5];
        let disc = [0.05; 5];
        let base = annuity_pv(&qx, 0, 0.0, &disc, 5, 1.0, 0).unwrap();
        let improved = annuity_pv(&qx, 0, 0.02, &disc, 5, 1.0, 0).unwrap();
        assert!(improved.pv > base.pv);
    }

    #[test]
    fn annuity_rejects_bad_input() {
        let qx = [0.10; 5];
        let disc = [0.05; 5];
        assert!(annuity_pv(&qx, 0, 0.0, &disc, 5, 1.0, 6).is_err()); // guarantee > n_years
        assert!(annuity_pv(&qx, 4, 0.0, &disc, 5, 1.0, 0).is_err()); // grid too short
        assert!(annuity_pv(&qx, 0, 2.0, &disc, 5, 1.0, 0).is_err()); // improvement out of range
    }

    #[test]
    fn profit_test_margin_and_irr() {
        // 3-year term product crafted so the signature has an initial strain
        // then profits, giving a finite IRR.
        let input = ProfitTestInput {
            premiums: vec![100.0, 100.0, 100.0],
            expenses: vec![80.0, 10.0, 10.0], // acquisition strain year 1
            sum_assured: 1000.0,
            qx: vec![0.01, 0.01, 0.01],
            start_age: 0,
            reserve_end: vec![50.0, 30.0, 0.0],
            earned_rates: vec![0.05, 0.05, 0.05],
            discount: vec![0.10, 0.10, 0.10],
            improvement: 0.0,
        };
        let r = profit_test(&input).unwrap();
        // IRR exists and is in a sane band for a priced product.
        assert!(r.irr > -1.0 && r.irr <= 10.0);
        // Margin = PV(profit)/PV(premium); recompute independently.
        let v: Vec<f64> = (1..=3).map(|t| 1.0 / 1.10f64.powi(t)).collect();
        let pv_profit: f64 = r
            .profit_signature
            .iter()
            .enumerate()
            .map(|(i, p)| p * v[i])
            .sum();
        let pv_prem: f64 = (1..=3)
            .map(|t| {
                let s = 0.99f64.powi(t - 1);
                s * 100.0 / 1.10f64.powi(t)
            })
            .sum();
        assert!((r.margin - pv_profit / pv_prem).abs() < 1e-12);
        // IRR satisfies NPV = 0 to bisection tolerance.
        let npv: f64 = r
            .profit_signature
            .iter()
            .enumerate()
            .map(|(i, p)| p / (1.0 + r.irr).powi(i as i32 + 1))
            .sum();
        assert!(npv.abs() < 1e-6, "npv={npv}");
    }

    #[test]
    fn irr_fails_closed_when_no_root() {
        // All-positive signature → no IRR; must error, never guess.
        let input = ProfitTestInput {
            premiums: vec![100.0, 100.0],
            expenses: vec![1.0, 1.0],
            sum_assured: 0.0,
            qx: vec![0.0, 0.0],
            start_age: 0,
            reserve_end: vec![0.0, 0.0],
            earned_rates: vec![0.05, 0.05],
            discount: vec![0.10, 0.10],
            improvement: 0.0,
        };
        assert!(profit_test(&input).is_err());
    }
}
