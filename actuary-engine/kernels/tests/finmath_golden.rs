//! F2 finmath acceptance goldens (design Appendix H style: every number has
//! a cited source or an in-line hand derivation).
//!
//! ## Golden sources
//!
//! * Hand-computed FM textbook derivations (Broverman conventions), derived
//!   in the test comments where used.
//! * ActuaryUtilities.jl (MIT) — IRR goldens from tag **v2.0.0**
//!   (tag commit 296e8cc92cf8c848ddaec2347d262cc9cf993a24), test/runtests.jl lines 100–144: Excel help-text
//!   example, numpy-financial examples, multi-root policy, issue #28, and
//!   the unsolvable fail-closed case. pv/duration/convexity goldens from tag
//!   **v3.12.0** (tag commit 1d7868f133e48f77ba2c9c20d36ddd8198407c10), test/runtests.jl "financial calcs"
//!   and duration sections: Excel-NPV 117.04, backward-recursion
//!   `present_values`, forward-rate discounting, Wikipedia Macaulay/
//!   modified/DV01 example, 7.5% semiannual bond (Excel MDURATION check),
//!   and the Primer zero-bond convexity example.
//! * elizur (GPL-3.0, **reference-only** — numeric facts, no code or data
//!   vendored), tests/unit/life/annuity/test_annuity.py @ commit
//!   631a8f0b92aaed383aaa9c7a0d7bd1f72304ec14: BA II Plus-verified annuity
//!   values quoted at atol 1e-3 by the upstream tests.
//!
//! Rounded elizur values are asserted against the upstream tolerance
//! (1.5e-3); exact values are additionally asserted against closed-form
//! derivations to 1e-12.

use actuary_kernels::finmath::*;

// ---------------------------------------------------------------------------
// ActuaryUtilities.jl v2.0.0 IRR goldens (Excel help text + numpy examples)
// ---------------------------------------------------------------------------

/// Excel help-text IRR example: cash flows [-70000, 12000, 15000, 18000,
/// 21000, 26000] and progressive prefixes. Quoted values are Excel's own
/// results, pinned in ActuaryUtilities.jl v2.0.0 test/runtests.jl L100–107
/// at atol 0.001; we verify to 1e-9.
#[test]
fn irr_excel_help_text_golden() {
    let v = [-70000.0, 12000.0, 15000.0, 18000.0, 21000.0, 26000.0];
    let expected = [
        -0.828_571_428_571_4,
        -0.443_506_941_334_6,
        -0.182_137_464_145_5,
        -0.021_244_848_273_4,
        0.086_630_948_036_5,
    ];
    for (k, &exp) in expected.iter().enumerate() {
        let r = irr(&v[..k + 2]).unwrap();
        assert!(
            (r - exp).abs() < 1e-9,
            "prefix {}: got {r}, expected {exp}",
            k + 2
        );
    }
}

/// numpy-financial IRR examples, pinned in ActuaryUtilities.jl v2.0.0
/// test/runtests.jl L126–135 ("numpy examples" testset) at atol 1e-4.
#[test]
fn irr_numpy_examples_golden() {
    let cases: &[(&[f64], f64)] = &[
        (
            &[-150_000.0, 15_000.0, 25_000.0, 35_000.0, 45_000.0, 60_000.0],
            0.0524,
        ),
        (&[-100.0, 0.0, 0.0, 74.0], -0.0955),
        (&[-100.0, 39.0, 59.0, 55.0, 20.0], 0.280_95),
        (&[-100.0, 100.0, 0.0, -7.0], -0.0833),
        (&[-100.0, 100.0, 0.0, 7.0], 0.062_06),
    ];
    for &(cfs, exp) in cases {
        let r = irr(cfs).unwrap();
        assert!((r - exp).abs() < 1e-3, "got {r}, expected ≈{exp}");
    }
    // Multiple roots (0.709559 and 0.0886); the solver must pick the root
    // closest to zero, per the upstream test comment (L134–135).
    let r = irr(&[-5.0, 10.5, 1.0, -8.0, 1.0]).unwrap();
    assert!((r - 0.088_598_338_527_755).abs() < 1e-6, "got {r}");
    assert!(r.abs() < 0.709_559f64.abs());
}

/// Hard IRR cases from ActuaryUtilities.jl v2.0.0 test/runtests.jl L109–122:
/// the overflow-prone 100-year signature and issue #28's bond-like schedule.
#[test]
fn irr_hard_cases_golden() {
    // L109–112: "much more challenging to solve b/c of the overflow below
    // zero" — 100 cash flows alternating -10 (every 10th) and 1.5.
    let cfs: Vec<f64> = (0..100)
        .map(|t| if t % 10 == 0 { -10.0 } else { 1.5 })
        .collect();
    let r = irr(&cfs).unwrap();
    assert!((r - 0.064_631_639_639_258_66).abs() < 1e-9, "got {r}");

    // L114–116 (issue #28): 51-point declining coupon-like signature with a
    // large negative first flow; root quoted to 13 digits.
    let issue28 = [
        -8.728_037_307_132_952e7,
        3.043_754_023_830_998e7,
        2.963_004_184_784_189e7,
        2.880_303_074_875_509_7e7,
        2.795_691_211_181_196_6e7,
        2.709_218_205_124_452_7e7,
        2.620_906_954_380_653_8e7,
        2.530_796_432_984_000_4e7,
        2.438_961_041_057_478e7,
        2.345_508_465_301_169_5e7,
        2.250_592_552_001_826_5e7,
        2.154_395_414_765_592e7,
        2.057_107_611_306_500_4e7,
        1.958_930_608_135_183e7,
        1.860_062_746_489_502_5e7,
        1.760_698_092_326_240_2e7,
        1.661_046_149_512_893e7,
        1.561_312_825_963_898e7,
        1.461_760_481_586_352e7,
        1.362_680_120_741_020_9e7,
        1.264_473_396_949_940_2e7,
        1.167_539_368_729_985_5e7,
        1.072_272_015_165_838_6e7,
        9.790_756_734_337_71e6,
        8.883_278_741_880_089e6,
        8.004_445_298_876_338e6,
        7.158_801_085_946_172_5e6,
        6.351_121_678_665_243e6,
        5.585_860_320_479_795e6,
        4.867_389_515_994_362_5e6,
        4.199_080_594_953_47e6,
        3.583_538_247_530_099e6,
        3.022_766_488_834_396e6,
        2.518_107_232_419_017_7e6,
        2.070_105_388_107_664_9e6,
        1.678_292_122_466_420_8e6,
        1.341_060_548_929_136_2e6,
        1.055_664_309_752_747_4e6,
        818_348.535_731_511_2,
        624_147.937_321_492_5,
        467_849.788_997_191,
        344_241.752_520_618,
        248_285.656_306_497_75,
        175_235.547_542_632_1,
        120_677.871_744_989_42,
        80_759.098_046_782_89,
        52_186.834_009_367_39,
        32_211.057_718_402_008,
        18_589.519_073_851_64,
        9_540.782_278_174_447,
        3_688.401_534_175_529_4,
    ];
    let r = irr(&issue28).unwrap();
    // Upstream quotes 0.3176680627111823; both roots solve NPV = 0 with
    // |cf| ~ 1e7 scale, so 1e-5 absolute agreement is the honest check.
    assert!((r - 0.317_668_062_711_182_3).abs() < 1e-5, "got {r}");
    let npv: f64 = issue28
        .iter()
        .enumerate()
        .map(|(t, &c)| c / (1.0 + r).powi(t as i32))
        .sum();
    assert!(npv.abs() < 1e-1, "npv={npv}");

    // L122–123: unsolvable all-negative-after-first signature fails closed.
    assert!(matches!(
        irr(&[-1.0e8, 0.0, 0.0, 0.0]),
        Err(actuary_kernels::AkError::Numeric(_))
    ));
}

/// L119: `irr([100,100]) ≈ -1` in Julia. Honest note: the mathematical
/// root is r = -2, outside the (-1, ∞) domain; Julia clamps to the
/// boundary. Our solver fails closed instead of returning a clamp —
/// documented divergence.
#[test]
fn irr_root_outside_domain_fails_closed() {
    assert!(matches!(
        irr(&[100.0, 100.0]),
        Err(actuary_kernels::AkError::Numeric(_))
    ));
}

// ---------------------------------------------------------------------------
// ActuaryUtilities.jl v3.12.0 pv / duration / convexity goldens
// ---------------------------------------------------------------------------

/// v3.12.0 L63: `pv(0.05, [-15000,1500,2500,3500,4500,6000]) ≈ 117.04`
/// "117.04 comes from Excel verification with NPV function". Excel NPV
/// discounts starting at period 1 — our `pv_uniform` convention exactly.
#[test]
fn pv_excel_npv_golden() {
    let v = pv_uniform(
        0.05,
        &[-15_000.0, 1_500.0, 2_500.0, 3_500.0, 4_500.0, 6_000.0],
    )
    .unwrap();
    assert!((v - 117.04).abs() < 1e-2, "got {v}");
}

/// v3.12.0 L77: `present_values(0.01, [1,2,3]) ≈ [5.862461552497766,
/// 4.921086168022744, 2.9702970297029707]` — backward recursion
/// pv[j] = (cf[j] + pv[j+1])/(1+i).
#[test]
fn present_values_backward_golden() {
    let out = present_values_backward(0.01, &[1.0, 2.0, 3.0]).unwrap();
    let expected = [
        5.862_461_552_497_766,
        4.921_086_168_022_744,
        2.970_297_029_702_970_7,
    ];
    for (got, exp) in out.iter().zip(expected.iter()) {
        assert!((got - exp).abs() < 1e-12, "got {got}, expected {exp}");
    }
}

/// v3.12.0 L93–98: vector-of-forward-rates discounting goldens.
#[test]
fn pv_forward_rates_golden() {
    // pv([0.0,0.05],[100,100]) ≈ 100/1.0 + 100/1.05
    let a = pv_forward_rates(&[0.0, 0.05], &[100.0, 100.0]).unwrap();
    assert!((a - (100.0 + 100.0 / 1.05)).abs() < 1e-10);
    // pv([0.05,0.0],[100,100]) ≈ 100/1.05 + 100/1.05
    let b = pv_forward_rates(&[0.05, 0.0], &[100.0, 100.0]).unwrap();
    assert!((b - (100.0 / 1.05 + 100.0 / 1.05)).abs() < 1e-10);
    // pv([0.05,0.1],[100,100]) ≈ 100/1.05 + 100/1.05/1.1
    let c = pv_forward_rates(&[0.05, 0.1], &[100.0, 100.0]).unwrap();
    assert!((c - (100.0 / 1.05 + 100.0 / 1.05 / 1.1)).abs() < 1e-10);
    // L78–79 (times [0,1] convention): cf 10 at t=0 + 20 at t=1 discounted
    // by the first forward rate → [28.18181818181818, 18.18181818181818].
    let d = pv_forward_rates(&[0.1], &[20.0]).unwrap();
    assert!((d - 18.181_818_181_818_18).abs() < 1e-12);
    assert!((10.0 + d - 28.181_818_181_818_18).abs() < 1e-12);
}

/// v3.12.0 L171–188: Wikipedia duration example. cfs [10,10,10,110] at
/// times [0.5,1,1.5,2], y = 4%: Macaulay ≈ 1.777570320376649, modified =
/// Macaulay/1.04, DV01 = modified × price / 10000 (per-bp convention).
#[test]
fn duration_wikipedia_golden() {
    let cfs = [10.0, 10.0, 10.0, 110.0];
    let times = [0.5, 1.0, 1.5, 2.0];
    let price = pv_at_times(0.04, &cfs, &times).unwrap();
    let (mac, modd, _conv) = duration_convexity(0.04, &cfs, &times).unwrap();
    assert!((mac - 1.777_570_320_376_649).abs() < 1e-12, "mac={mac}");
    assert!((modd - 1.777_570_320_376_649 / 1.04).abs() < 1e-12);
    let dv01 = modd * price / 10_000.0;
    assert!((dv01 - 1.777_570_320_376_649 / 1.04 * price / 10_000.0).abs() < 1e-12);
    assert!((price - 130.551_035_147_428_4).abs() < 1e-9);
}

/// v3.12.0 L212–216 ("Bond examples"): 7.5% bond with semiannual coupons,
/// price at the effective annual yield (1+0.075/2)² − 1 must be ~100 (par,
/// because coupon BEY equals yield BEY), Macaulay duration ≈ 4.26
/// (Excel MDURATION verification).
#[test]
fn bond_semiannual_excel_golden() {
    let cfs: Vec<f64> = (1..=10)
        .map(|t| if t == 10 { 103.75 } else { 3.75 })
        .collect();
    let times: Vec<f64> = (1..=10).map(|t| 0.5 * t as f64).collect();
    let i_eff = (1.0 + 0.075 / 2.0f64).powi(2) - 1.0;
    let price = pv_at_times(i_eff, &cfs, &times).unwrap();
    assert!((price - 100.0).abs() < 1e-2, "price={price}");
    let (mac, _m, _c) = duration_convexity(i_eff, &cfs, &times).unwrap();
    assert!((mac - 4.26).abs() < 1e-2, "mac={mac}");
    // Our bond kernel in BEY conventions must agree: price at BEY 7.5% is
    // exactly par, and bond_yield recovers 0.075 from price 100.
    let p2 = bond_price(100.0, 0.075, 0.075, 10, 2).unwrap();
    assert!((p2 - 100.0).abs() < 1e-10);
    let y = bond_yield(100.0, 0.075, 100.0, 10, 2).unwrap();
    assert!((y - 0.075).abs() < 1e-9);
}

/// v3.12.0 L219–228 ("Primer example",
/// https://math.illinoisstate.edu/krzysio/Primer.pdf): zero-coupon 1e6 at
/// t=5, y=4% → PV ≈ 821927.11 and convexity ≈ 27.7366864 = t(t+1)/(1+y)².
#[test]
fn convexity_primer_golden() {
    let cfs = [1.0e6];
    let times = [5.0];
    let price = pv_at_times(0.04, &cfs, &times).unwrap();
    assert!((price - 821_927.11).abs() < 1e-2, "price={price}");
    let (_mac, _modd, conv) = duration_convexity(0.04, &cfs, &times).unwrap();
    assert!((conv - 27.736_686_4).abs() < 1e-6, "conv={conv}");
    assert!((conv - 30.0 / 1.04f64.powi(2)).abs() < 1e-9);
}

// ---------------------------------------------------------------------------
// elizur (GPL-3.0, reference-only) BA II Plus annuity goldens
// ---------------------------------------------------------------------------

/// elizur test_annuity.py @631a8f0b: BA II Plus-verified values, quoted at
/// atol 1e-3 by upstream. We assert the upstream tolerance and additionally
/// verify our closed forms to 1e-12 against the exact derivation.
#[test]
fn elizur_annuity_goldens() {
    // annuity_pv (immediate, a-angle-n): (10,7%)→7.024, (20,6%)→11.47,
    // (30,5%)→15.372
    for &(n, i, quoted) in &[
        (10.0, 0.07, 7.024),
        (20.0, 0.06, 11.47),
        (30.0, 0.05, 15.372),
    ] {
        let got = annuity_pv(i, n, 1.0, PaymentTiming::Arrears, 0.0).unwrap();
        assert!(
            (got - quoted).abs() < 1.5e-3,
            "a({n},{i})={got}, quoted {quoted}"
        );
        let exact = (1.0 - (1.0 + i).powf(-n)) / i;
        assert!((got - exact).abs() < 1e-12);
    }
    // annuity_due_pv (ä): (10,7%)→7.515, (20,6%)→12.158, (30,5%)→16.141
    for &(n, i, quoted) in &[
        (10.0, 0.07, 7.515),
        (20.0, 0.06, 12.158),
        (30.0, 0.05, 16.141),
    ] {
        let got = annuity_pv(i, n, 1.0, PaymentTiming::Advance, 0.0).unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "ä({n},{i})={got}");
    }
    // perpetuity_pv: 1/i → 14.286 / 16.667 / 20
    for &(i, quoted) in &[(0.07, 14.286), (0.06, 16.667), (0.05, 20.0)] {
        let got = perpetuity_pv(i, 1.0, PaymentTiming::Arrears).unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "1/{i}={got}");
        assert!((got - 1.0 / i).abs() < 1e-12);
    }
    // perpetuity_due_pv: (1+i)/i → 15.286 / 17.667 / 21
    for &(i, quoted) in &[(0.07, 15.286), (0.06, 17.667), (0.05, 21.0)] {
        let got = perpetuity_pv(i, 1.0, PaymentTiming::Advance).unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "(1+{i})/{i}={got}");
    }
    // annuity_fv (s-angle-n): (10,7%)→13.816, (20,6%)→36.786, (30,5%)→66.439
    for &(n, i, quoted) in &[
        (10.0, 0.07, 13.816),
        (20.0, 0.06, 36.786),
        (30.0, 0.05, 66.439),
    ] {
        let got = annuity_fv(i, n, 1.0, PaymentTiming::Arrears).unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "s({n},{i})={got}");
        let exact = ((1.0 + i).powf(n) - 1.0) / i;
        assert!((got - exact).abs() < 1e-12);
    }
    // increasing_annuity_pv (Ia): (10,7%)→34.739, (20,6%)→98.700,
    // (30,5%)→183.995
    for &(n, i, quoted) in &[
        (10.0, 0.07, 34.739),
        (20.0, 0.06, 98.700),
        (30.0, 0.05, 183.995),
    ] {
        let got = varying_annuity_pv(
            i,
            n,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "Ia({n},{i})={got}");
    }
    // increasing_annuity_due_pv (Iä): (10,7%)→37.171, (20,6%)→104.622,
    // (30,5%)→193.195
    for &(n, i, quoted) in &[
        (10.0, 0.07, 37.171),
        (20.0, 0.06, 104.622),
        (30.0, 0.05, 193.195),
    ] {
        let got = varying_annuity_pv(
            i,
            n,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Advance,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "Iä({n},{i})={got}");
    }
    // increasing_annuity_fv: (10,7%)→68.337, (20,6%)→316.545,
    // (30,5%)→795.216
    for &(n, i, quoted) in &[
        (10.0, 0.07, 68.337),
        (20.0, 0.06, 316.545),
        (30.0, 0.05, 795.216),
    ] {
        let got = varying_annuity_fv(
            i,
            n,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "(Ia)fv({n},{i})={got}");
    }
    // increasing_annuity_due_fv: (10,7%)→73.121, (20,6%)→335.538,
    // (30,5%)→834.977
    for &(n, i, quoted) in &[
        (10.0, 0.07, 73.121),
        (20.0, 0.06, 335.538),
        (30.0, 0.05, 834.977),
    ] {
        let got = varying_annuity_fv(
            i,
            n,
            1.0,
            1.0,
            VaryingKind::Arithmetic,
            PaymentTiming::Advance,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "(Iä)fv({n},{i})={got}");
    }
    // decreasing_annuity_pv (Da): (10,7%)→42.520, (20,6%)→142.168,
    // (30,5%)→292.551 — payments n, n−1, …, 1.
    for &(n, i, quoted) in &[
        (10.0, 0.07, 42.520),
        (20.0, 0.06, 142.168),
        (30.0, 0.05, 292.551),
    ] {
        let got = varying_annuity_pv(
            i,
            n,
            n,
            1.0,
            VaryingKind::ArithmeticDecreasing,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "Da({n},{i})={got}");
    }
    // decreasing_annuity_due_pv (Dä): (10,7%)→45.497, (20,6%)→150.698,
    // (30,5%)→307.179
    for &(n, i, quoted) in &[
        (10.0, 0.07, 45.497),
        (20.0, 0.06, 150.698),
        (30.0, 0.05, 307.179),
    ] {
        let got = varying_annuity_pv(
            i,
            n,
            n,
            1.0,
            VaryingKind::ArithmeticDecreasing,
            PaymentTiming::Advance,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "Dä({n},{i})={got}");
    }
    // decreasing_annuity_fv: (10,7%)→83.644, (20,6%)→455.952,
    // (30,5%)→1264.388
    for &(n, i, quoted) in &[
        (10.0, 0.07, 83.644),
        (20.0, 0.06, 455.952),
        (30.0, 0.05, 1264.388),
    ] {
        let got = varying_annuity_fv(
            i,
            n,
            n,
            1.0,
            VaryingKind::ArithmeticDecreasing,
            PaymentTiming::Arrears,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "(Da)fv({n},{i})={got}");
    }
    // decreasing_annuity_due_fv: (10,7%)→89.499, (20,6%)→483.309,
    // (30,5%)→1327.608
    for &(n, i, quoted) in &[
        (10.0, 0.07, 89.499),
        (20.0, 0.06, 483.309),
        (30.0, 0.05, 1327.608),
    ] {
        let got = varying_annuity_fv(
            i,
            n,
            n,
            1.0,
            VaryingKind::ArithmeticDecreasing,
            PaymentTiming::Advance,
        )
        .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "(Dä)fv({n},{i})={got}");
    }
    // geo_increasing_annuity_pv: (10,7%,3%)→7.921, (20,6%,4%)→15.83987234,
    // (30,5%,8%)→44.27572926
    for &(n, i, g, quoted) in &[
        (10.0, 0.07, 0.03, 7.921),
        (20.0, 0.06, 0.04, 15.839_872_34),
        (30.0, 0.05, 0.08, 44.275_729_26),
    ] {
        let got = varying_annuity_pv(i, n, 1.0, g, VaryingKind::Geometric, PaymentTiming::Arrears)
            .unwrap();
        assert!((got - quoted).abs() < 1.5e-3, "geo({n},{i},{g})={got}");
    }
}

// ---------------------------------------------------------------------------
// Hand-computed FM textbook goldens (derivations in comments)
// ---------------------------------------------------------------------------

/// Deferred annuity: `m|a(n) = v^m · a(n)`. Hand example at 6%, defer 3,
/// n=7: v = 1/1.06, a(7,6%) = 5.582381…, deferred = v³·a(7,6%).
#[test]
fn deferred_annuity_hand_computed() {
    let i = 0.06f64;
    let a7 = annuity_pv(i, 7.0, 1.0, PaymentTiming::Arrears, 0.0).unwrap();
    let def = annuity_pv(i, 7.0, 1.0, PaymentTiming::Arrears, 3.0).unwrap();
    assert!((def - a7 / (1.0 + i).powi(3)).abs() < 1e-12);
}

/// Amortization golden (hand): 120,000 mortgage at 6% for 10 years.
/// payment = 120000/a(10,6%); interest(1) = 7200; principal(1) = pay − 7200;
/// balance path closes to exactly 0.
#[test]
fn amortization_golden_hand() {
    let rows = amort_schedule(120_000.0, 0.06, 10.0).unwrap();
    let a10 = (1.0 - 1.06f64.powi(-10)) / 0.06;
    let pay = 120_000.0 / a10;
    assert!((rows[0].payment - pay).abs() < 1e-8);
    assert!((rows[0].interest - 7_200.0).abs() < 1e-8);
    // Balance after row 1: 120000 − (pay − 7200).
    assert!((rows[0].balance - (120_000.0 - (pay - 7_200.0))).abs() < 1e-6);
    assert!(rows[9].balance.abs() < 1e-6);
}

/// TVM solver goldens (Excel RATE/NPER semantics verified against the
/// closed forms): 1,000 loan at 6% over 10 years →
/// pmt = 1000/a(10,6%) = 135.868…; solve rate back.
#[test]
fn tvm_solvers_golden() {
    let i = 0.06f64;
    let pay = pmt(i, 10.0, -1_000.0, 0.0, PaymentTiming::Arrears).unwrap();
    let a10 = (1.0 - 1.06f64.powi(-10)) / 0.06;
    assert!((pay - 1_000.0 / a10).abs() < 1e-9);
    let i2 = tvm_rate(10.0, pay, -1_000.0, 0.0, PaymentTiming::Arrears).unwrap();
    assert!((i2 - i).abs() < 1e-10);
    let n2 = nper(i, pay, -1_000.0, 0.0, PaymentTiming::Arrears).unwrap();
    assert!((n2 - 10.0).abs() < 1e-9);
    let fv0 = fv(i, 10.0, pay, -1_000.0, PaymentTiming::Arrears).unwrap();
    assert!(fv0.abs() < 1e-7);
    let pv0 = pv(i, 10.0, pay, 0.0, PaymentTiming::Arrears).unwrap();
    assert!((pv0 + 1_000.0).abs() < 1e-7);
}
