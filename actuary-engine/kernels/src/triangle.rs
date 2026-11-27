//! Loss-triangle reserving kernels: chain-ladder, Bornhuetter–Ferguson, Mack.
//!
//! Triangles are **cumulative**, upper-triangular, stored row-major with
//! `origins` rows (origin/accident periods) and `devs` columns (development
//! periods). Cell `(i, j)` is observed iff `i + j <= origins - 1` and must be
//! finite and non-negative there; unobserved cells are ignored (any value).
//!
//! Conventions follow Mack (1991/1993) as implemented by the R `ChainLadder`
//! package so the golden tests can pin published reference values:
//! volume-weighted factors (R `alpha=1`) and straight-average factors
//! (R `alpha=0`).

use crate::AkError;

/// Age-to-age factor estimator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactorMethod {
    /// Volume-weighted: `f_j = Σ C_ij+1 / Σ C_ij` (Mack / R `alpha=1`).
    VolumeWeighted,
    /// Simple average of individual link ratios (R `alpha=0`).
    SimpleAverage,
}

/// Chain-ladder result.
#[derive(Debug, Clone)]
pub struct ChainLadderResult {
    /// `devs - 1` age-to-age factors.
    pub factors: Vec<f64>,
    /// Ultimate per origin.
    pub ultimates: Vec<f64>,
}

/// Validated view over a row-major upper triangle.
struct TriView<'a> {
    data: &'a [f64],
    origins: usize,
    devs: usize,
}

impl<'a> TriView<'a> {
    fn validate(data: &'a [f64], origins: usize, devs: usize) -> Result<Self, AkError> {
        if origins < 2 {
            return Err(AkError::Input("need at least 2 origin periods"));
        }
        if devs < 2 {
            return Err(AkError::Input("need at least 2 development periods"));
        }
        if devs > origins {
            return Err(AkError::Input("devs must be <= origins"));
        }
        if data.len() != origins * devs {
            return Err(AkError::Input("triangle length must be origins * devs"));
        }
        for i in 0..origins {
            for j in 0..devs.min(origins - i) {
                let v = data[i * devs + j];
                if !v.is_finite() {
                    return Err(AkError::Input("observed triangle cells must be finite"));
                }
                if v < 0.0 {
                    return Err(AkError::Input(
                        "observed triangle cells must be non-negative",
                    ));
                }
            }
        }
        Ok(TriView {
            data,
            origins,
            devs,
        })
    }

    /// Latest observed development column for origin `i`.
    #[inline]
    fn latest_col(&self, i: usize) -> usize {
        (self.origins - 1 - i).min(self.devs - 1)
    }

    #[inline]
    fn at(&self, i: usize, j: usize) -> f64 {
        self.data[i * self.devs + j]
    }

    /// Rows observed in column `j`: origins `0 ..= origins-1-j`.
    #[inline]
    fn rows_in_col(&self, j: usize) -> usize {
        self.origins - j
    }
}

/// Age-to-age development factors for columns `0 .. devs-2`.
pub fn development_factors(
    tri: &[f64],
    origins: usize,
    devs: usize,
    method: FactorMethod,
) -> Result<Vec<f64>, AkError> {
    let t = TriView::validate(tri, origins, devs)?;
    let mut factors = Vec::with_capacity(devs - 1);
    for j in 0..devs - 1 {
        let rows = t.rows_in_col(j + 1); // rows with both C_ij and C_ij+1
        debug_assert!(rows >= 1);
        match method {
            FactorMethod::VolumeWeighted => {
                let mut num = 0.0;
                let mut den = 0.0;
                for i in 0..rows {
                    num += t.at(i, j + 1);
                    den += t.at(i, j);
                }
                if den <= 0.0 {
                    return Err(AkError::Numeric(
                        "volume-weighted factor undefined: zero column sum",
                    ));
                }
                let f = num / den;
                if !f.is_finite() || f <= 0.0 {
                    return Err(AkError::Numeric("non-finite development factor"));
                }
                factors.push(f);
            }
            FactorMethod::SimpleAverage => {
                let mut sum = 0.0;
                let mut n = 0usize;
                for i in 0..rows {
                    let c = t.at(i, j);
                    if c > 0.0 {
                        sum += t.at(i, j + 1) / c;
                        n += 1;
                    }
                }
                if n == 0 {
                    return Err(AkError::Numeric(
                        "simple-average factor undefined: no positive cell",
                    ));
                }
                let f = sum / n as f64;
                if !f.is_finite() || f <= 0.0 {
                    return Err(AkError::Numeric("non-finite development factor"));
                }
                factors.push(f);
            }
        }
    }
    Ok(factors)
}

/// Chain-ladder ultimates given pre-computed factors (`devs - 1` of them).
pub fn chainladder_ultimates(
    tri: &[f64],
    origins: usize,
    devs: usize,
    factors: &[f64],
) -> Result<Vec<f64>, AkError> {
    let t = TriView::validate(tri, origins, devs)?;
    if factors.len() != devs - 1 {
        return Err(AkError::Input("factors length must be devs - 1"));
    }
    for &f in factors {
        if !f.is_finite() || f <= 0.0 {
            return Err(AkError::Input("factors must be finite and > 0"));
        }
    }
    let mut ultimates = Vec::with_capacity(origins);
    for i in 0..origins {
        let l = t.latest_col(i);
        let mut u = t.at(i, l);
        for &f in &factors[l..devs - 1] {
            u *= f;
        }
        if !u.is_finite() {
            return Err(AkError::Numeric("ultimate overflow"));
        }
        ultimates.push(u);
    }
    Ok(ultimates)
}

/// Full chain-ladder: factors + ultimates in one pass.
pub fn chainladder(
    tri: &[f64],
    origins: usize,
    devs: usize,
    method: FactorMethod,
) -> Result<ChainLadderResult, AkError> {
    let factors = development_factors(tri, origins, devs, method)?;
    let ultimates = chainladder_ultimates(tri, origins, devs, &factors)?;
    Ok(ChainLadderResult { factors, ultimates })
}

/// Bornhuetter–Ferguson ultimates.
///
/// For origin `i` with latest observed column `L_i`:
///
/// ```text
/// ultimate_i = C[i, L_i] + apriori_i × (1 − cumulative_pattern[L_i])
/// ```
///
/// * `apriori_ultimates`: a priori ultimate per origin (e.g. earned premium ×
///   priced loss ratio from the rating engine). Finite, ≥ 0.
/// * `payout_patterns`: incremental fraction of ultimate emerging in each
///   development period; length `devs`, each ≥ 0, must sum to 1 (±1e-6).
pub fn bornhuetter_ferguson(
    tri: &[f64],
    origins: usize,
    devs: usize,
    apriori_ultimates: &[f64],
    payout_patterns: &[f64],
) -> Result<Vec<f64>, AkError> {
    let t = TriView::validate(tri, origins, devs)?;
    if apriori_ultimates.len() != origins {
        return Err(AkError::Input("apriori length must equal origins"));
    }
    if payout_patterns.len() != devs {
        return Err(AkError::Input("payout pattern length must equal devs"));
    }
    let mut cum = Vec::with_capacity(devs);
    let mut acc = 0.0;
    for &p in payout_patterns {
        if !p.is_finite() || p < 0.0 {
            return Err(AkError::Input("payout pattern must be finite and >= 0"));
        }
        acc += p;
        cum.push(acc);
    }
    if (acc - 1.0).abs() > 1e-6 {
        return Err(AkError::Input("payout pattern must sum to 1 (±1e-6)"));
    }
    let mut out = Vec::with_capacity(origins);
    for (i, &a) in apriori_ultimates.iter().enumerate() {
        if !a.is_finite() || a < 0.0 {
            return Err(AkError::Input("a priori ultimates must be finite and >= 0"));
        }
        let l = t.latest_col(i);
        let u = t.at(i, l) + a * (1.0 - cum[l]);
        if !u.is_finite() {
            return Err(AkError::Numeric("BF ultimate overflow"));
        }
        out.push(u);
    }
    Ok(out)
}

/// Mack (1993) distribution-free standard errors of the chain-ladder reserve.
///
/// Requires a square `n × n` triangle with `n >= 3` (the last factor has a
/// single observation; its variance is extrapolated per Mack's formula
/// `σ²_last = min(σ²_{n-2}²/σ²_{n-3}, σ²_{n-2}, σ²_{n-3})`). For `n = 3`
/// only one sigma is directly estimable, so there is no pair to take the
/// min over and the rule degenerates to `σ²_last = σ²_1` (see the dated
/// comment at the extrapolation site below).
///
/// Returns `(se_total, se_per_origin)` — the standard error (square root of
/// the mean squared error of prediction) of the total outstanding reserve and
/// of each origin's reserve, using volume-weighted factors.
pub fn mack_se(tri: &[f64], origins: usize, devs: usize) -> Result<(f64, Vec<f64>), AkError> {
    if origins != devs {
        return Err(AkError::Input("Mack SE requires a square triangle"));
    }
    if devs < 3 {
        return Err(AkError::Input("Mack SE requires devs >= 3"));
    }
    let t = TriView::validate(tri, origins, devs)?;
    let n = devs;

    // Volume-weighted factors, n-1 of them.
    let factors = development_factors(tri, origins, devs, FactorMethod::VolumeWeighted)?;

    // sigma^2_j for j = 0 .. n-3 (directly estimable), then extrapolate the
    // last one (j = n-2).
    let mut sigma2: Vec<f64> = Vec::with_capacity(n - 1);
    for (j, &fj) in factors.iter().enumerate().take(n - 2) {
        let rows = t.rows_in_col(j + 1); // n - j - 1 rows
        if rows < 2 {
            return Err(AkError::Numeric("insufficient rows to estimate sigma"));
        }
        let mut s = 0.0;
        for i in 0..rows {
            let c = t.at(i, j);
            if c > 0.0 {
                let fij = t.at(i, j + 1) / c;
                s += c * (fij - fj).powi(2);
            }
        }
        let v = s / (rows as f64 - 1.0);
        if !v.is_finite() {
            return Err(AkError::Numeric("sigma estimate overflow"));
        }
        sigma2.push(v);
    }
    // Mack's extrapolation for the final sigma.
    let prev = sigma2[n - 3]; // sigma²_{n-2}, last directly estimable
    if n == 3 {
        // 2026-11-28 (W34-A fix cycle): for n = 3 only ONE sigma is directly
        // estimable (sigma2 has length n-2 = 1), so Mack's min-rule has no
        // pair to take the min over and `sigma2[n-4]` would underflow — the
        // index-out-of-bounds panic on a contract-valid 3×3 triangle reported
        // by the independent verifier (verify-w34a.md §4). Under R
        // ChainLadder's vector semantics the min-rule expression degenerates
        // to sigma²_last = sigma²_1, the single estimable sigma:
        // min(σ²_{n-2}²/σ²_{n-3}, σ²_{n-3}, σ²_{n-2}) with σ²_{n-3} absent is
        // min(c(numeric(0), σ²_1)) = σ²_1. (R ChainLadder 0.2.21 itself
        // errors "argument is of length zero" on 3×3 triangles before
        // reaching that expression, so this is the documented degeneration of
        // R's formula rather than a value R returns; it is validated against
        // R's own machinery via est.sigma = sigma_1 in golden_mack.rs.)
        sigma2.push(prev);
    } else {
        let prevprev = sigma2[n - 4]; // sigma²_{n-3}
        if prevprev <= 0.0 {
            // Cannot extrapolate ratio; fall back to the min of the two, which
            // is still Mack-consistent when sigma² is identically zero.
            sigma2.push(prev.min(prevprev));
        } else {
            let extrap = (prev * prev / prevprev).min(prev.min(prevprev));
            sigma2.push(if extrap.is_finite() {
                extrap
            } else {
                return Err(AkError::Numeric("sigma extrapolation overflow"));
            });
        }
    }

    // Column sums S_j over the rows used to *estimate* factor f_j (rows with
    // observed data in both columns j and j+1), as in Mack (1993) and R
    // ChainLadder — used in the parameter-error terms.
    let mut col_sum = vec![0.0f64; n];
    for (j, slot) in col_sum.iter_mut().enumerate().take(n - 1) {
        let mut s = 0.0;
        for i in 0..t.rows_in_col(j + 1) {
            s += t.at(i, j);
        }
        if s <= 0.0 {
            return Err(AkError::Numeric("zero column sum in triangle"));
        }
        *slot = s;
    }

    // Chain-ladder estimates Ĉ_{i,j} for every cell on/after the diagonal,
    // needed by the process-variance recursion.
    let mut chat = vec![0.0f64; n * n];
    for i in 0..n {
        let l = t.latest_col(i);
        chat[i * n + l] = t.at(i, l);
        for j in l + 1..n {
            chat[i * n + j] = chat[i * n + j - 1] * factors[j - 1];
        }
        if !chat[i * n + n - 1].is_finite() {
            return Err(AkError::Numeric("ultimate estimate overflow"));
        }
    }

    // Per-origin MSE of the reserve estimator (Mack 1993, theorem 3):
    //   mse(R̂_i) = Ĉ²_{i,n} Σ_{j=d_i}^{n-2} (σ²_j/f²_j) (1/Ĉ_{i,j} + 1/S_j)
    let mut se = vec![0.0f64; n];
    for (i, se_i) in se.iter_mut().enumerate() {
        let d_i = t.latest_col(i);
        let ult2 = chat[i * n + n - 1].powi(2);
        let mut mse = 0.0;
        for j in d_i..n - 1 {
            let cij = chat[i * n + j];
            if cij <= 0.0 {
                return Err(AkError::Numeric(
                    "Mack SE undefined: zero incremental position",
                ));
            }
            mse += (sigma2[j] / factors[j].powi(2)) * (1.0 / cij + 1.0 / col_sum[j]);
        }
        let mse = ult2 * mse;
        if !mse.is_finite() || mse < 0.0 {
            return Err(AkError::Numeric("per-origin MSE overflow"));
        }
        *se_i = mse.sqrt();
    }

    // Total MSE adds covariance between origin pairs (Mack 1993, corollary):
    //   2 Σ_{i<k} Û_i Û_k Σ_{j=d_i}^{n-2} σ²_j / (f²_j S_j)
    // where i < k, so origin i is the *more developed* of the pair and the
    // inner sum runs over origin i's remaining development range.
    let mut total_var: f64 = se.iter().map(|v| v.powi(2)).sum();
    for i in 0..n {
        let d_i = t.latest_col(i);
        let mut cov = 0.0;
        for j in d_i..n - 1 {
            cov += sigma2[j] / (factors[j].powi(2) * col_sum[j]);
        }
        let ui = chat[i * n + n - 1];
        for uk in chat.iter().skip((i + 1) * n + n - 1).step_by(n) {
            total_var += 2.0 * ui * uk * cov;
        }
    }
    if !total_var.is_finite() || total_var < 0.0 {
        return Err(AkError::Numeric("total MSE overflow"));
    }
    Ok((total_var.sqrt(), se))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Small 4×4 cumulative triangle with easy ratios.
    const TRI4: [f64; 16] = [
        100.0, 150.0, 180.0, 190.0, //
        120.0, 180.0, 216.0, 0.0, //
        110.0, 165.0, 0.0, 0.0, //
        130.0, 0.0, 0.0, 0.0,
    ];

    #[test]
    fn volume_weighted_factors() {
        let f = development_factors(&TRI4, 4, 4, FactorMethod::VolumeWeighted).unwrap();
        // f0 = (150+180+165)/(100+120+110) = 495/330 = 1.5
        assert!((f[0] - 1.5).abs() < 1e-15);
        // f1 = (180+216)/(150+180) = 396/330 = 1.2
        assert!((f[1] - 1.2).abs() < 1e-15);
        // f2 = 190/180 = 1.0555...
        assert!((f[2] - 190.0 / 180.0).abs() < 1e-15);
    }

    #[test]
    fn simple_average_factors() {
        let f = development_factors(&TRI4, 4, 4, FactorMethod::SimpleAverage).unwrap();
        // mean(150/100, 180/120, 165/110) = mean(1.5, 1.5, 1.5) = 1.5
        assert!((f[0] - 1.5).abs() < 1e-15);
        // mean(180/150, 216/180) = mean(1.2, 1.2) = 1.2
        assert!((f[1] - 1.2).abs() < 1e-15);
    }

    #[test]
    fn ultimates() {
        let r = chainladder(&TRI4, 4, 4, FactorMethod::VolumeWeighted).unwrap();
        assert!((r.ultimates[0] - 190.0).abs() < 1e-12);
        assert!((r.ultimates[1] - 216.0 * 190.0 / 180.0).abs() < 1e-9);
        assert!((r.ultimates[2] - 165.0 * 1.2 * 190.0 / 180.0).abs() < 1e-9);
        assert!((r.ultimates[3] - 130.0 * 1.5 * 1.2 * 190.0 / 180.0).abs() < 1e-9);
    }

    #[test]
    fn bf_blends_apriori() {
        // pattern: 50% in dev0, 30% dev1, 15% dev2, 5% dev3 (cumulative
        // 0.5, 0.8, 0.95, 1.0)
        let pattern = [0.5, 0.3, 0.15, 0.05];
        let apriori = [200.0, 220.0, 240.0, 260.0];
        let u = bornhuetter_ferguson(&TRI4, 4, 4, &apriori, &pattern).unwrap();
        // origin 0 fully developed: 190 + 200*(1-1.0) = 190
        assert!((u[0] - 190.0).abs() < 1e-12);
        // origin 1 latest col 2, cum 0.95: 216 + 220*0.05 = 227
        assert!((u[1] - 227.0).abs() < 1e-12);
        // origin 2 latest col 1, cum 0.8: 165 + 240*0.2 = 213
        assert!((u[2] - 213.0).abs() < 1e-12);
        // origin 3 latest col 0, cum 0.5: 130 + 260*0.5 = 260
        assert!((u[3] - 260.0).abs() < 1e-12);
    }

    #[test]
    fn bf_rejects_bad_pattern() {
        let apriori = [200.0, 220.0, 240.0, 260.0];
        assert!(bornhuetter_ferguson(&TRI4, 4, 4, &apriori, &[0.5, 0.3, 0.15, 0.10]).is_err());
    }

    #[test]
    fn mack_requires_square() {
        assert!(mack_se(&TRI4, 4, 3).is_err());
    }
}
