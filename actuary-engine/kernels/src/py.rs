//! PyO3 wrapper: `actuary_kernels_py` — numpy-friendly callables exposing the
//! same kernels as the C ABI, so the Python analytics leg (Leg C) and the Go
//! pricing service (Leg B) share one numeric implementation. Built only with
//! `--features python`; cgo-only builds skip it entirely.
//!
//! Errors map onto Python exceptions carrying the `AK_ERR_*` code: invalid
//! arguments → `ValueError`, domain failures → `ValueError`, numeric
//! failures → `ArithmeticError`. No result is ever fabricated: on failure the
//! kernel returns an error and the wrapper raises.

use numpy::{PyArray1, PyReadonlyArray1, PyReadonlyArray2};
use pyo3::exceptions::{PyArithmeticError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::montecarlo::{self, LineSimSpec};
use crate::mortality::{self, ProfitTestInput};
use crate::premium;
use crate::status;
use crate::triangle::{self, FactorMethod};
use crate::{AkError, VERSION_PACKED};

fn to_pyerr(e: AkError) -> PyErr {
    let msg = format!("{e} (code {})", e.code());
    match e {
        AkError::Numeric(_) => PyArithmeticError::new_err(msg),
        _ => PyValueError::new_err(msg),
    }
}

/// Converts a NaN-masked 2-D numpy triangle into the row-major
/// upper-triangular layout the core expects. NaN cells are only allowed in
/// the unobserved (below-diagonal) region and are replaced by 0.0.
fn tri_from_numpy(tri: &PyReadonlyArray2<'_, f64>) -> PyResult<(Vec<f64>, usize, usize)> {
    let arr = tri.as_array();
    let (origins, devs) = (arr.nrows(), arr.ncols());
    if origins < 2 || devs < 2 {
        return Err(PyValueError::new_err(format!(
            "triangle must be at least 2x2, got {origins}x{devs} (code {})",
            status::AK_ERR_INPUT
        )));
    }
    let mut data = Vec::with_capacity(origins * devs);
    for i in 0..origins {
        for j in 0..devs {
            let v = arr[[i, j]];
            if v.is_nan() {
                if i + j >= origins {
                    data.push(0.0);
                } else {
                    return Err(PyValueError::new_err(format!(
                        "NaN at observed cell ({i},{j}) (code {})",
                        status::AK_ERR_INPUT
                    )));
                }
            } else {
                data.push(v);
            }
        }
    }
    Ok((data, origins, devs))
}

fn pyarr1<'py>(py: Python<'py>, v: Vec<f64>) -> Bound<'py, PyArray1<f64>> {
    PyArray1::from_vec(py, v)
}

type PyArr1Pair<'py> = (Bound<'py, PyArray1<f64>>, Bound<'py, PyArray1<f64>>);

/// Compose a full premium quote. Returns (total_kobo, pure_kobo,
/// loadings_kobo).
#[pyfunction]
#[pyo3(name = "premium_compose")]
#[allow(clippy::too_many_arguments)]
fn premium_compose_py(
    base_pure_premium: f64,
    rels: PyReadonlyArray1<'_, f64>,
    expense_ratio: f64,
    commission_rate: f64,
    profit_margin: f64,
    tax_rates: PyReadonlyArray1<'_, f64>,
    min_premium_kobo: i64,
    max_premium_kobo: i64,
) -> PyResult<(i64, i64, i64)> {
    let rels = rels.as_slice()?;
    let taxes = tax_rates.as_slice()?;
    let q = premium::compose(
        base_pure_premium,
        rels,
        expense_ratio,
        commission_rate,
        profit_margin,
        taxes,
        min_premium_kobo,
        max_premium_kobo,
    )
    .map_err(to_pyerr)?;
    Ok((q.total_kobo, q.pure_kobo, q.loadings_kobo))
}

/// Chain-ladder on a NaN-masked cumulative triangle. `method` is
/// "volume_weighted" or "simple_average". Returns (factors, ultimates).
#[pyfunction]
#[pyo3(name = "chainladder")]
fn chainladder_py<'py>(
    py: Python<'py>,
    tri: PyReadonlyArray2<'py, f64>,
    method: &str,
) -> PyResult<PyArr1Pair<'py>> {
    let m = match method {
        "volume_weighted" => FactorMethod::VolumeWeighted,
        "simple_average" => FactorMethod::SimpleAverage,
        other => {
            return Err(PyValueError::new_err(format!(
                "unknown factor method '{other}' (code {})",
                status::AK_ERR_INPUT
            )))
        }
    };
    let (data, origins, devs) = tri_from_numpy(&tri)?;
    let r = triangle::chainladder(&data, origins, devs, m).map_err(to_pyerr)?;
    Ok((pyarr1(py, r.factors), pyarr1(py, r.ultimates)))
}

/// Bornhuetter–Ferguson ultimates. Returns per-origin ultimates.
#[pyfunction]
#[pyo3(name = "bornhuetter_ferguson")]
fn bornhuetter_ferguson_py<'py>(
    py: Python<'py>,
    tri: PyReadonlyArray2<'py, f64>,
    apriori_ultimates: PyReadonlyArray1<'py, f64>,
    payout_patterns: PyReadonlyArray1<'py, f64>,
) -> PyResult<Bound<'py, PyArray1<f64>>> {
    let (data, origins, devs) = tri_from_numpy(&tri)?;
    let apriori = apriori_ultimates.as_slice()?;
    let pattern = payout_patterns.as_slice()?;
    let u =
        triangle::bornhuetter_ferguson(&data, origins, devs, apriori, pattern).map_err(to_pyerr)?;
    Ok(pyarr1(py, u))
}

/// Mack standard errors. Returns (se_total, se_per_origin).
#[pyfunction]
#[pyo3(name = "mack_se")]
fn mack_se_py<'py>(
    py: Python<'py>,
    tri: PyReadonlyArray2<'py, f64>,
) -> PyResult<(f64, Bound<'py, PyArray1<f64>>)> {
    let (data, origins, devs) = tri_from_numpy(&tri)?;
    let (total, per_origin) = triangle::mack_se(&data, origins, devs).map_err(to_pyerr)?;
    Ok((total, pyarr1(py, per_origin)))
}

/// Aggregate-loss Monte Carlo. `lines` is a sequence of
/// `(freq_dist, freq_p1, freq_p2, sev_dist, sev_p1, sev_p2, sev_p3)` tuples;
/// `corr` is an optional row-major correlation matrix (None → independence).
/// Returns a dict with `mean`, `var_995`, `tvar_99`, `per_line_tvar`.
#[pyfunction]
#[pyo3(name = "montecarlo_aggregate", signature = (lines, corr, n_paths, seed))]
fn montecarlo_aggregate_py<'py>(
    py: Python<'py>,
    lines: Vec<(i32, f64, f64, i32, f64, f64, f64)>,
    corr: Option<PyReadonlyArray2<'py, f64>>,
    n_paths: u64,
    seed: u64,
) -> PyResult<Bound<'py, PyDict>> {
    let specs: Vec<LineSimSpec> = lines
        .iter()
        .map(|&(fd, fp1, fp2, sd, sp1, sp2, sp3)| LineSimSpec {
            freq_dist: fd,
            freq_p1: fp1,
            freq_p2: fp2,
            sev_dist: sd,
            sev_p1: sp1,
            sev_p2: sp2,
            sev_p3: sp3,
        })
        .collect();
    let corr_vec: Option<Vec<f64>> = match &corr {
        None => None,
        Some(c) => {
            let arr = c.as_array();
            let (rows, cols) = (arr.nrows(), arr.ncols());
            if rows != cols {
                return Err(PyValueError::new_err(format!(
                    "correlation matrix must be square (code {})",
                    status::AK_ERR_INPUT
                )));
            }
            let mut v = Vec::with_capacity(rows * cols);
            for i in 0..rows {
                for j in 0..cols {
                    v.push(arr[[i, j]]);
                }
            }
            Some(v)
        }
    };
    let r =
        montecarlo::simulate(&specs, corr_vec.as_deref(), n_paths, seed, true).map_err(to_pyerr)?;
    let dict = PyDict::new(py);
    dict.set_item("mean", r.mean)?;
    dict.set_item("var_995", r.var_995)?;
    dict.set_item("tvar_99", r.tvar_99)?;
    dict.set_item("per_line_tvar", PyArray1::from_vec(py, r.per_line_tvar))?;
    dict.set_item("n_paths", r.n_paths)?;
    Ok(dict)
}

/// Annuity present values. Returns (pv, pv_guaranteed).
#[pyfunction]
#[pyo3(name = "annuity_pv")]
#[allow(clippy::too_many_arguments)]
fn annuity_pv_py(
    qx: PyReadonlyArray1<'_, f64>,
    start_age: usize,
    improvement: f64,
    discount: PyReadonlyArray1<'_, f64>,
    payment: f64,
    guarantee_years: u32,
) -> PyResult<(f64, f64)> {
    let qx = qx.as_slice()?;
    let disc = discount.as_slice()?;
    let n_years = disc.len();
    let r = mortality::annuity_pv(
        qx,
        start_age,
        improvement,
        disc,
        n_years,
        payment,
        guarantee_years,
    )
    .map_err(to_pyerr)?;
    Ok((r.pv, r.pv_guaranteed))
}

/// Profit test. Returns a dict with `margin`, `irr`, `profit_signature`.
#[pyfunction]
#[pyo3(name = "profit_test")]
#[allow(clippy::too_many_arguments)]
fn profit_test_py<'py>(
    py: Python<'py>,
    premiums: PyReadonlyArray1<'py, f64>,
    expenses: PyReadonlyArray1<'py, f64>,
    sum_assured: f64,
    qx: PyReadonlyArray1<'py, f64>,
    start_age: usize,
    reserve_end: PyReadonlyArray1<'py, f64>,
    earned_rates: PyReadonlyArray1<'py, f64>,
    discount: PyReadonlyArray1<'py, f64>,
    improvement: f64,
) -> PyResult<Bound<'py, PyDict>> {
    let input = ProfitTestInput {
        premiums: premiums.as_slice()?.to_vec(),
        expenses: expenses.as_slice()?.to_vec(),
        sum_assured,
        qx: qx.as_slice()?.to_vec(),
        start_age,
        reserve_end: reserve_end.as_slice()?.to_vec(),
        earned_rates: earned_rates.as_slice()?.to_vec(),
        discount: discount.as_slice()?.to_vec(),
        improvement,
    };
    let r = mortality::profit_test(&input).map_err(to_pyerr)?;
    let dict = PyDict::new(py);
    dict.set_item("margin", r.margin)?;
    dict.set_item("irr", r.irr)?;
    dict.set_item(
        "profit_signature",
        PyArray1::from_vec(py, r.profit_signature),
    )?;
    Ok(dict)
}

/// Packed semver (major<<16|minor<<8|patch).
#[pyfunction]
#[pyo3(name = "version")]
fn version_py() -> u32 {
    VERSION_PACKED
}

/// Python extension module. Import name: `actuary_kernels_py`.
#[pymodule]
fn actuary_kernels_py(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(premium_compose_py, m)?)?;
    m.add_function(wrap_pyfunction!(chainladder_py, m)?)?;
    m.add_function(wrap_pyfunction!(bornhuetter_ferguson_py, m)?)?;
    m.add_function(wrap_pyfunction!(mack_se_py, m)?)?;
    m.add_function(wrap_pyfunction!(montecarlo_aggregate_py, m)?)?;
    m.add_function(wrap_pyfunction!(annuity_pv_py, m)?)?;
    m.add_function(wrap_pyfunction!(profit_test_py, m)?)?;
    m.add_function(wrap_pyfunction!(version_py, m)?)?;
    Ok(())
}
