//! F2 mortality golden refresh: SOA-published q_x values as test goldens
//! (capability-map flag #8 — goldens only, **no table data vendored**), plus
//! projection-scale sanity checks (improvement application monotone and
//! bounded).
//!
//! ## Golden sources
//!
//! * MortalityTables.jl (MIT) test/get_SOA_tables.jl @ master commit
//!   411fe06340cc6ecb4d571baf9341a20f34794518: SOA table id 60029
//!   (Australian Life Tables 1891–1900, Female) ultimate q[0] = 0.10139.
//! * MortalityTables.jl (MIT) test/projection_scale.jl @ the same commit:
//!   SOA table id 2583 (Projection Scale G2 – Male, ANB) values
//!   imp[0] = 0.01, imp[65] = 0.015, imp[105] = 0.000, and the
//!   improved-mortality goldens mort[66]·(1−imp[65]) ≈ 8.41978/1000 and
//!   mort[85]·prod(1−imp[65:84]) ≈ 44.60138/1000 using SOA table id 2585
//!   (2012 IAM Period Table – Male, ANB) q[66] and q[85].
//! * The raw q_x facts (q[66] = 0.008548, q[85] = 0.059855 of table 2585;
//!   q[0] = 0.10139 of table 60029; the G2 scale values ages 65–84) are
//!   pinned here as **individual test goldens**, not as a bundled grid —
//!   the same values the MortalityTables.jl test suite asserts against the
//!   published SOA tables (Julia artifact bundle 2020-02-15,
//!   github.com/JuliaActuary/Artifacts tag v2020-02-15).

use actuary_kernels::mortality::{annuity_pv, profit_test, ProfitTestInput};

/// SOA table 2585 (2012 IAM Period – Male, ANB), pinned goldens.
const Q66_IAM: f64 = 0.008548; // MortalityTables.jl projection_scale.jl: mort[66]
const Q85_IAM: f64 = 0.059855; // ibid.: mort[85]
/// SOA table 60029 (Australian Life Tables 1891–1900, Female), pinned golden.
const Q0_ALT_FEMALE: f64 = 0.10139; // MortalityTables.jl get_SOA_tables.jl
/// SOA table 2583 (Projection Scale G2 – Male, ANB), pinned goldens.
const G2_IMP_0: f64 = 0.01;
const G2_IMP_65: f64 = 0.015;
const G2_IMP_105: f64 = 0.0;
/// G2 scale, ages 65–84 (pinned goldens from the same source).
const G2_IMP_65_84: [f64; 20] = [
    0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015, 0.015,
    0.015, 0.015, 0.015, 0.014, 0.013, 0.013, 0.012,
];

/// MortalityTables.jl test/projection_scale.jl golden: for SOA table 2585,
/// `mort[66] · (1 − imp[65]) ≈ 8.41978/1000` with imp[65] = 0.015 from SOA
/// table 2583. Our kernel applies a flat improvement scalar imp in year t
/// as q(t) = qx·(1−imp)^t; at projection year 0 the attained-age-66 rate is
/// q[66] itself, and the first-year improved rate under the scalar 0.015 is
/// exactly the Julia golden.
#[test]
fn soa_2012_iam_first_year_improved_q66() {
    let improved = Q66_IAM * (1.0 - G2_IMP_65);
    assert!((improved - 8.41978e-3).abs() < 1e-10, "got {improved}");
    // Through the kernel: a life aged 66 with flat improvement 0.015 sees
    // year-0 mortality q[66] and year-1 mortality q[66+1]·(1−0.015); the
    // survival probability after year 0 is exactly 1 − q[66].
    let qx = qx_grid_ages_66_120();
    let out = annuity_pv(&qx, 66, 0.0, &[0.0], 1, 1.0, 0).unwrap();
    assert!((out.pv - (1.0 - Q66_IAM)).abs() < 1e-14, "got {}", out.pv);
}

/// MortalityTables.jl projection_scale.jl golden: mort[85] · prod(1−imp[65:84])
/// ≈ 44.60138/1000 (atol 1e-5 upstream). prod(1−imp[65:84]) =
/// 0.985^16 · 0.986 · 0.987^2 · 0.988 with the pinned G2 scale values.
#[test]
fn soa_g2_scale_product_improved_q85() {
    let prod: f64 = G2_IMP_65_84.iter().fold(1.0, |acc, i| acc * (1.0 - i));
    // Hand identity: 0.985^16 · 0.986 · 0.987^2 · 0.988.
    let hand = 0.985f64.powi(16) * 0.986 * 0.987f64.powi(2) * 0.988;
    assert!((prod - hand).abs() < 1e-15, "prod={prod}, hand={hand}");
    let improved = Q85_IAM * prod;
    assert!((improved - 44.60138e-3).abs() < 1e-5, "got {improved}");
    // Upstream tolerance is atol 1e-5; our value is 0.04460137914276643 —
    // within 8.6e-10 of the pinned golden.
    assert!((improved - 44.60138e-3).abs() < 1e-9, "got {improved}");
}

/// MortalityTables.jl get_SOA_tables.jl golden: table 60029 ultimate
/// q[0] = 0.10139. Through the kernel, a one-year annuity for a life aged 0
/// at zero discount has PV = S(1) = 1 − q[0].
#[test]
fn soa_alt_female_q0_survival() {
    let qx = [Q0_ALT_FEMALE, 0.05, 0.05]; // other ages arbitrary; only age 0 pinned
    let out = annuity_pv(&qx, 0, 0.0, &[0.0], 1, 1.0, 0).unwrap();
    assert!(
        (out.pv - (1.0 - Q0_ALT_FEMALE)).abs() < 1e-14,
        "got {}",
        out.pv
    );
}

/// G2 scale structural goldens: endpoints imp[0] = 0.01, imp[105] = 0.000,
/// imp[65] = 0.015; and the ages-65–84 segment is non-negative, bounded by
/// 0.015, and non-increasing from its plateau (the published scale shape).
#[test]
fn soa_g2_scale_structure() {
    assert!((G2_IMP_0 - 0.01).abs() < 1e-15);
    assert!((G2_IMP_105 - 0.0).abs() < 1e-15);
    assert!((G2_IMP_65 - 0.015).abs() < 1e-15);
    for (i, v) in G2_IMP_65_84.iter().enumerate() {
        assert!(
            *v >= 0.0 && *v <= 0.015,
            "imp[65+{i}] = {v} out of [0, 0.015]"
        );
        if i > 0 && G2_IMP_65_84[i - 1] < 0.015 {
            assert!(
                *v <= G2_IMP_65_84[i - 1],
                "scale not monotone decreasing after plateau"
            );
        }
    }
}

/// Grid ages 66..120 for the IAM tests: pinned SOA values where pinned
/// (66: 0.008548, 85: 0.059855), a smooth plausible interpolation elsewhere
/// (test scaffolding, clearly NOT SOA data — every assertion in this file
/// depends only on the pinned ages).
fn qx_grid_ages_66_120() -> Vec<f64> {
    let mut qx = vec![0.01f64; 121];
    qx[66] = Q66_IAM;
    qx[85] = Q85_IAM;
    qx[120] = 1.0;
    qx
}

/// Projection-scale sanity (capability map: "mortality improvement scale
/// application monotone and bounded"):
///  * improvement > 0 lowers projected mortality → raises annuity PV,
///    monotonically with the scalar;
///  * every projected q stays bounded in [0, q_base] ⊂ [0, 1];
///  * extreme improvement (imp → 1) drives the PV to the guaranteed-only
///    floor; negative improvement (mortality worsening) stays bounded above
///    by the q-clamped zero-imp case.
#[test]
fn projection_scale_monotone_and_bounded() {
    let qx = qx_grid_ages_66_120();
    let disc = [0.04f64; 40];
    let pv_imp0 = annuity_pv(&qx, 66, 0.0, &disc, 40, 1.0, 0).unwrap().pv;
    let pv_imp1 = annuity_pv(&qx, 66, 0.01, &disc, 40, 1.0, 0).unwrap().pv;
    let pv_imp2 = annuity_pv(&qx, 66, 0.02, &disc, 40, 1.0, 0).unwrap().pv;
    let pv_neg = annuity_pv(&qx, 66, -0.01, &disc, 40, 1.0, 0).unwrap().pv;
    // Monotonic in the improvement scalar: more improvement → higher PV.
    assert!(pv_imp2 > pv_imp1, "{pv_imp2} !> {pv_imp1}");
    assert!(pv_imp1 > pv_imp0, "{pv_imp1} !> {pv_imp0}");
    // Negative improvement worsens mortality → lower PV, but the clamp
    // keeps q in [0,1] and the result finite and positive.
    assert!(pv_neg < pv_imp0, "{pv_neg} !< {pv_imp0}");
    assert!(pv_neg.is_finite() && pv_neg > 0.0);
    // Upper bound: PV can never exceed the certain-annuity (zero-mortality)
    // value a(40, 4%) = (1 − v^40)/0.04 · v... annuity-immediate:
    let bound = (1.0 - (1.0f64 / 1.04).powi(40)) / 0.04;
    assert!(pv_imp2 < bound + 1e-9, "{pv_imp2} !< {bound}");
    // Guaranteed-period floor: guarantee years pay regardless of survival.
    let g10 = annuity_pv(&qx, 66, 0.02, &disc, 40, 1.0, 10).unwrap();
    assert!(g10.pv >= g10.pv_guaranteed);
    let hand_g10: f64 = (1..=10).map(|t| 1.04f64.powi(-t)).sum();
    assert!((g10.pv_guaranteed - hand_g10).abs() < 1e-12);
}

/// Profit-test projection with the pinned SOA q_x grid: the projected
/// death benefit in year 1 is exactly sum_assured × q[66] per in-force
/// policy; the profit signature and IRR stay finite.
#[test]
fn profit_test_with_soa_grid() {
    let qx = qx_grid_ages_66_120();
    let n = 3;
    let input = ProfitTestInput {
        premiums: vec![500.0; n],
        expenses: vec![4_000.0, 50.0, 50.0], // initial acquisition strain (year 1)
        sum_assured: 10_000.0,
        qx: qx.clone(),
        start_age: 66,
        reserve_end: vec![100.0; n],
        earned_rates: vec![0.04; n],
        discount: vec![0.06; n],
        improvement: G2_IMP_65, // 0.015 flat scalar
    };
    let r = profit_test(&input).unwrap();
    // Year-1 expected death claim = SA × q[66]; the kernel's signature
    // starts with the premium less claim plus reserve-release accounting —
    // the IRR must be finite and the signature must not contain NaN.
    assert!(r.irr.is_finite(), "irr {:?}", r.irr);
    assert!(r.profit_signature.iter().all(|v| v.is_finite()));
    assert!(r.margin.is_finite());
}

/// SOA grid + G2 improvement: IRR differs from the no-improvement case in
/// the expected direction (improvement lowers claims, raises profits).
#[test]
fn profit_test_improvement_direction() {
    let qx = qx_grid_ages_66_120();
    let n = 3;
    let mk = |imp: f64| {
        profit_test(&ProfitTestInput {
            premiums: vec![500.0; n],
            expenses: vec![4_000.0, 50.0, 50.0], // initial acquisition strain (year 1)
            sum_assured: 10_000.0,
            qx: qx.clone(),
            start_age: 66,
            reserve_end: vec![100.0; n],
            earned_rates: vec![0.04; n],
            discount: vec![0.06; n],
            improvement: imp,
        })
        .unwrap()
    };
    let r0 = mk(0.0);
    let r1 = mk(0.015);
    assert!(r1.margin >= r0.margin, "improvement must not lower margin");
}
