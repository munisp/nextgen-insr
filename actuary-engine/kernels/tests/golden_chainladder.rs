//! Acceptance test `golden_chainladder_mack1991` (design doc Appendix H):
//! reproduces the published chain-ladder ultimates on the Mack 1991/1993
//! (Taylor & Ashe "GenIns") incurred triangle for both factor paths
//! (volume-weighted and simple-average) to 1e-6 relative tolerance.
//!
//! Golden provenance (see tests/golden/README.md):
//! * Published: R `ChainLadder::MackChainLadder(GenIns)` printed ultimates
//!   (rounded to integers in package output).
//! * Full-precision cross-validation: chainladder-python 0.10.1
//!   (`cl.Chainladder`, `cl.Development(average='simple')`), constants
//!   embedded below.

mod common;

use actuary_kernels::ffi;
use actuary_kernels::status::*;
use actuary_kernels::triangle::{self, FactorMethod};
use common::{load_triangle_csv, rel_diff};

/// Published R ultimates (integer-rounded), volume-weighted path.
const PUBLISHED_ULTIMATES_R: [i64; 10] = [
    3901463, 5433719, 5378826, 5297906, 4858200, 5111171, 5660771, 6784799, 5642266, 4969825,
];

/// chainladder-python 0.10.1 full-precision volume-weighted results.
const PY_VW_ULTIMATES: [f64; 10] = [
    3901463.0,
    5433718.8145487895,
    5378826.290064239,
    5297905.820825462,
    4858199.639049739,
    5111171.457661663,
    5660770.620135548,
    6784799.0119525,
    5642266.263261643,
    4969824.694424728,
];
const PY_VW_FACTORS: [f64; 9] = [
    3.4906065479,
    1.7473326421,
    1.457412836,
    1.1738517094,
    1.1038235322,
    1.0862693644,
    1.0538743555,
    1.0765551784,
    1.0177247252,
];

/// chainladder-python 0.10.1 `Development(average='simple')` results.
const PY_SA_FACTORS: [f64; 9] = [
    3.5661428518,
    1.7455566642,
    1.4519607611,
    1.1809837988,
    1.1112468716,
    1.0848177212,
    1.0527394996,
    1.0747527034,
    1.0177247252,
];
const PY_SA_ULTIMATES: [f64; 10] = [
    3901463.0,
    5433718.8145487895,
    5369820.527902629,
    5283340.089666161,
    4838368.371001493,
    5124540.453248157,
    5710060.847986358,
    6818274.089922175,
    5664341.214979828,
    5097235.941125257,
];

const TOL: f64 = 1e-6;

#[test]
fn golden_chainladder_mack1991() {
    let (tri, origins, devs) = load_triangle_csv("tests/golden/gen_ins.csv");
    assert_eq!((origins, devs), (10, 10));

    // ---- volume-weighted path through the frozen C ABI ----
    let mut factors = vec![0.0f64; devs - 1];
    let mut ultimates = vec![0.0f64; origins];
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

    // Published R values: exact match after rounding to integers.
    for (i, (&u, &pub_r)) in ultimates
        .iter()
        .zip(PUBLISHED_ULTIMATES_R.iter())
        .enumerate()
    {
        assert_eq!(
            u.round() as i64,
            pub_r,
            "origin {} ultimate {u} rounds to {}, published {pub_r}",
            i + 1,
            u.round()
        );
    }
    // Cross-validation: full-precision match to 1e-6 relative.
    for (i, (&u, &py)) in ultimates.iter().zip(PY_VW_ULTIMATES.iter()).enumerate() {
        assert!(
            rel_diff(u, py) <= TOL,
            "origin {} VW ultimate {u} vs cross-validated {py} (rel {})",
            i + 1,
            rel_diff(u, py)
        );
    }
    for (j, (&f, &py)) in factors.iter().zip(PY_VW_FACTORS.iter()).enumerate() {
        assert!(
            rel_diff(f, py) <= TOL,
            "factor {j}: {f} vs cross-validated {py} (rel {})",
            rel_diff(f, py)
        );
    }

    // Total ultimate = 53,038,946 (published).
    let total: f64 = ultimates.iter().sum();
    assert!(
        rel_diff(total, 53_038_946.0) <= TOL,
        "total ultimate {total}"
    );

    // ---- simple-average path ----
    let sa = triangle::chainladder(&tri, origins, devs, FactorMethod::SimpleAverage)
        .expect("simple-average chainladder");
    for (j, (&f, &py)) in sa.factors.iter().zip(PY_SA_FACTORS.iter()).enumerate() {
        assert!(
            rel_diff(f, py) <= TOL,
            "SA factor {j}: {f} vs cross-validated {py} (rel {})",
            rel_diff(f, py)
        );
    }
    for (i, (&u, &py)) in sa.ultimates.iter().zip(PY_SA_ULTIMATES.iter()).enumerate() {
        assert!(
            rel_diff(u, py) <= TOL,
            "origin {} SA ultimate {u} vs cross-validated {py} (rel {})",
            i + 1,
            rel_diff(u, py)
        );
    }
}
