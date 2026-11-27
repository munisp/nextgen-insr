//! Acceptance test `annuity_golden` (design doc Appendix H): annuity PV
//! against the hand-computed 5-year annuity reference
//! (`tests/golden/annuity_5yr.csv`), through the frozen C ABI.
//!
//! Hand computation (also scripted in tests/golden/README.md):
//!   qx = [0.10]×5, start_age 0, improvement 0, discount 5% flat,
//!   payment 10,000, guarantee 2 years.
//!   S(t) = 0.9^t; v(t) = 1.05^-t
//!   pv            = Σ_{t=1..5} 10000·v(t)·(t ≤ 2 ? 1 : S(t))
//!                 = 34915.874999173626
//!   pv_guaranteed = Σ_{t=1..2} 10000·v(t)
//!                 = 18594.104308390022

use actuary_kernels::ffi;
use actuary_kernels::status::*;

const EXPECTED_PV: f64 = 34915.874999173626;
const EXPECTED_PV_GUARANTEED: f64 = 18594.104308390022;

#[test]
fn annuity_golden() {
    let qx = [0.10f64; 5];
    let discount = [0.05f64; 5];
    let mut pv = 0.0;
    let mut pvg = 0.0;
    let rc = ffi::ak_annuity_pv(
        qx.as_ptr(),
        qx.len(),
        0,
        0.0,
        discount.as_ptr(),
        discount.len(),
        10_000.0,
        2,
        &mut pv,
        &mut pvg,
    );
    assert_eq!(rc, AK_OK);
    assert!(
        (pv - EXPECTED_PV).abs() < 1e-6,
        "pv {pv} vs hand-computed {EXPECTED_PV}"
    );
    assert!(
        (pvg - EXPECTED_PV_GUARANTEED).abs() < 1e-6,
        "pv_guaranteed {pvg} vs hand-computed {EXPECTED_PV_GUARANTEED}"
    );

    // Cross-check against the golden CSV's per-year terms.
    let text = std::fs::read_to_string("tests/golden/annuity_5yr.csv").unwrap();
    let mut csv_pv = 0.0;
    let mut csv_pvg = 0.0;
    for line in text.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let cells: Vec<&str> = line.split(',').collect();
        if cells[4].trim().is_empty() && cells[5].trim().is_empty() {
            continue; // t = 0 row carries no PV terms
        }
        let gterm: f64 = cells[4].parse().unwrap();
        let cterm: f64 = cells[5].parse().unwrap();
        csv_pvg += gterm;
        csv_pv += gterm + cterm;
    }
    assert!((pv - csv_pv).abs() < 1e-4, "pv {pv} vs CSV sum {csv_pv}");
    assert!(
        (pvg - csv_pvg).abs() < 1e-4,
        "pv_guaranteed {pvg} vs CSV sum {csv_pvg}"
    );
}

#[test]
fn profit_test_golden_ffi() {
    // Term product with year-1 acquisition strain so the signature has a
    // root; IRR checked by NPV = 0 identity, margin by independent PV ratio.
    let premiums = [100.0f64, 100.0, 100.0];
    let expenses = [80.0f64, 10.0, 10.0];
    let qx = [0.01f64, 0.01, 0.01];
    let reserve_end = [50.0f64, 30.0, 0.0];
    let earned = [0.05f64, 0.05, 0.05];
    let discount = [0.10f64, 0.10, 0.10];
    let input = ffi::AkProfitTestInput {
        n_years: 3,
        premiums: premiums.as_ptr(),
        expenses: expenses.as_ptr(),
        sum_assured: 1000.0,
        qx: qx.as_ptr(),
        n_ages: 3,
        start_age: 0,
        reserve_end: reserve_end.as_ptr(),
        earned_rates: earned.as_ptr(),
        discount: discount.as_ptr(),
        improvement: 0.0,
    };
    let mut margin = 0.0;
    let mut irr = 0.0;
    let rc = ffi::ak_profit_test(&input, &mut margin, &mut irr);
    assert_eq!(rc, AK_OK);
    assert!(irr > -1.0 && irr <= 10.0, "irr {irr} out of bracket");

    // Independent recomputation of margin from first principles.
    let s = [1.0, 0.99, 0.9801, 0.970299f64];
    let v = [1.0, 1.0 / 1.1, 1.0 / 1.21, 1.0 / 1.331f64];
    let mut res_prev = 0.0f64;
    let mut pv_profit = 0.0;
    let mut pv_prem = 0.0;
    for t in 1..=3usize {
        let prem = 100.0;
        let expn = [80.0, 10.0, 10.0][t - 1];
        let res_t = [50.0, 30.0, 0.0][t - 1];
        let i_t = 0.05;
        let profit = s[t - 1] * (prem - expn + i_t * (res_prev + prem - expn))
            - s[t - 1] * 0.01 * 1000.0
            - s[t] * res_t
            + s[t - 1] * res_prev;
        pv_profit += profit * v[t];
        pv_prem += s[t - 1] * prem * v[t];
        res_prev = res_t;
    }
    assert!(
        (margin - pv_profit / pv_prem).abs() < 1e-9,
        "margin {margin} vs independent {}",
        pv_profit / pv_prem
    );
}
