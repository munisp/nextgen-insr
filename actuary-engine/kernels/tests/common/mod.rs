//! Shared helpers for golden integration tests.

/// Loads a CSV triangle: first column is an origin label, the remaining
/// columns are cumulative development values; unobserved cells are empty.
/// Returns (row-major data with 0.0 in unobserved cells, origins, devs).
pub fn load_triangle_csv(path: &str) -> (Vec<f64>, usize, usize) {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let mut rows = Vec::new();
    let mut devs = 0usize;
    for (r, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if r == 0 {
            assert!(line.starts_with("origin"), "bad header: {line}");
            devs = line.split(',').count() - 1;
            continue;
        }
        let cells: Vec<&str> = line.split(',').collect();
        assert_eq!(cells.len(), devs + 1, "ragged row: {line}");
        let row: Vec<f64> = cells[1..]
            .iter()
            .map(|c| {
                if c.trim().is_empty() {
                    f64::NAN
                } else {
                    c.trim().parse::<f64>().expect("numeric cell")
                }
            })
            .collect();
        rows.push(row);
    }
    let origins = rows.len();
    assert!(origins >= 2 && devs >= 2, "need >= 2 origins and devs");
    // NaN-masked → kernel layout (0.0 in unobserved cells); assert the NaN
    // mask is exactly the upper-triangle complement.
    let mut data = Vec::with_capacity(origins * devs);
    for (i, row) in rows.iter().enumerate() {
        for (j, &v) in row.iter().enumerate() {
            if v.is_nan() {
                assert!(i + j >= origins, "unexpected hole at ({i},{j})");
                data.push(0.0);
            } else {
                assert!(i + j < origins, "value below diagonal at ({i},{j})");
                data.push(v);
            }
        }
    }
    (data, origins, devs)
}

/// Relative difference helper used by the golden tests.
#[allow(dead_code)] // shared helper: not every test binary uses it
pub fn rel_diff(a: f64, b: f64) -> f64 {
    let denom = b.abs().max(1e-12);
    (a - b).abs() / denom
}
