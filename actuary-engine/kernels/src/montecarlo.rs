//! Monte Carlo aggregate-loss economic-capital simulation.
//!
//! Per line: a frequency distribution (Poisson or negative binomial) and a
//! severity distribution (Gamma, Lognormal, or Tweedie), combined into a
//! compound aggregate loss. Lines are dependent through a **Gaussian copula**
//! applied to the frequency marginals (correlation matrix from the assumption
//! set); severities are independent given the counts.
//!
//! Everything runs on an in-crate xoshiro256** RNG seeded through SplitMix64,
//! so results are bit-for-bit deterministic under a given seed — the
//! determinism Leg C relies on for cross-language equality checks.
//!
//! ## Distribution codes (frozen FFI contract)
//!
//! | Code | Distribution | `p1` | `p2` | `p3` |
//! |------|--------------|------|------|------|
//! | 0 (frequency) | Poisson | `λ` | — | — |
//! | 1 (frequency) | Negative binomial | mean `m` | size `r` (`var = m + m²/r`) | — |
//! | 2 (severity) | Gamma | mean | cv (coefficient of variation) | — |
//! | 3 (severity) | Lognormal | `μ` (log-space) | `σ` (log-space) | — |
//! | 4 (severity) | Tweedie | mean | dispersion `φ` | power `p` |
//!
//! Tweedie powers supported: `p = 0` (Normal, variance `φ`), `1 < p < 2`
//! (compound Poisson–Gamma), `p = 2` (Gamma, `shape = 1/φ`), `p = 3`
//! (inverse Gaussian). Any other `p` is rejected with `AK_ERR_DOMAIN`.

use crate::AkError;

/// Frequency distribution codes (frozen contract).
pub const DIST_POISSON: i32 = 0;
/// Negative binomial frequency code (frozen contract).
pub const DIST_NEGBIN: i32 = 1;
/// Gamma severity code (frozen contract).
pub const DIST_GAMMA: i32 = 2;
/// Lognormal severity code (frozen contract).
pub const DIST_LOGNORMAL: i32 = 3;
/// Tweedie severity code (frozen contract).
pub const DIST_TWEEDIE: i32 = 4;

/// Specification of one simulated line (safe-Rust mirror of `AkLineSimSpec`).
#[derive(Debug, Clone, Copy)]
pub struct LineSimSpec {
    /// `DIST_POISSON` or `DIST_NEGBIN`.
    pub freq_dist: i32,
    /// Poisson: λ. NegBin: mean.
    pub freq_p1: f64,
    /// NegBin: size r (var = mean + mean²/r). Unused for Poisson.
    pub freq_p2: f64,
    /// `DIST_GAMMA`, `DIST_LOGNORMAL` or `DIST_TWEEDIE`.
    pub sev_dist: i32,
    /// Gamma/Tweedie: mean. Lognormal: μ (log-space).
    pub sev_p1: f64,
    /// Gamma: cv. Lognormal: σ. Tweedie: dispersion φ.
    pub sev_p2: f64,
    /// Tweedie: power p. Unused otherwise.
    pub sev_p3: f64,
}

/// Simulation outputs.
#[derive(Debug, Clone)]
pub struct SimResult {
    /// Number of paths actually simulated.
    pub n_paths: u64,
    /// Mean aggregate loss.
    pub mean: f64,
    /// Value-at-Risk at 99.5% (interpolated quantile of the sorted paths).
    pub var_995: f64,
    /// Tail Value-at-Risk at 99% (mean of the worst 1% of aggregate losses,
    /// with fractional weighting of the boundary path).
    pub tvar_99: f64,
    /// Per-line TVaR contribution: each line's mean loss over the paths in
    /// the worst 1% of the *aggregate* distribution (scenario-allocation).
    /// Empty when not requested.
    pub per_line_tvar: Vec<f64>,
}

// ---------------------------------------------------------------------------
// RNG: SplitMix64 seeding + xoshiro256** core. Deterministic across platforms.
// ---------------------------------------------------------------------------

/// Deterministic RNG (xoshiro256**). Not cryptographically secure; used for
/// reproducible actuarial simulation only.
#[derive(Debug, Clone)]
pub struct Rng {
    s: [u64; 4],
}

impl Rng {
    /// Seed through SplitMix64 (deterministic, platform-independent).
    pub fn new(seed: u64) -> Self {
        let mut z = seed;
        let mut s = [0u64; 4];
        for slot in &mut s {
            z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut x = z;
            x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            x ^= x >> 31;
            *slot = x;
        }
        Rng { s }
    }

    #[inline]
    fn next_u64(&mut self) -> u64 {
        let star = self.s[1].wrapping_mul(5);
        let result = star.rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform on [0, 1).
    #[inline]
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Standard normal via Box–Muller.
    #[inline]
    pub fn normal(&mut self) -> f64 {
        let u1 = 1.0 - self.uniform(); // (0, 1]
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }

    /// Gamma(shape k, scale θ) via Marsaglia–Tsang. Requires k > 0, θ > 0.
    pub fn gamma(&mut self, k: f64, theta: f64) -> Result<f64, AkError> {
        if !(k.is_finite() && theta.is_finite() && k > 0.0 && theta > 0.0) {
            return Err(AkError::Input("gamma parameters must be finite and > 0"));
        }
        if k < 1.0 {
            // Boost: G(k) = G(k+1) · U^(1/k).
            let g = self.gamma(k + 1.0, theta)?;
            let u = 1.0 - self.uniform(); // (0, 1]
            return Ok(g * u.powf(1.0 / k));
        }
        let d = k - 1.0 / 3.0;
        let c = 1.0 / (9.0 * d).sqrt();
        loop {
            let x = self.normal();
            let v = (1.0 + c * x).powi(3);
            if v <= 0.0 {
                continue;
            }
            let u = 1.0 - self.uniform(); // (0, 1]
                                          // Acceptance: ln u < x²/2 + d − d·v + d·ln v
            if u.ln() < 0.5 * x * x + d - d * v + d * v.ln() {
                return Ok(d * v * theta);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Standard normal CDF / inverse CDF for the Gaussian copula.
// ---------------------------------------------------------------------------

/// Standard normal CDF. Max abs error ~1.5e-7 (A&S 7.1.26), ample for
/// copula uniformity in simulation work.
pub(crate) fn norm_cdf(x: f64) -> f64 {
    // Φ(x) = ½(1 + erf(x/√2)); erf via Abramowitz–Stegun 7.1.26.
    let t = x / std::f64::consts::SQRT_2;
    let sign = if t < 0.0 { -1.0 } else { 1.0 };
    let a = t.abs();
    let p = 1.0 / (1.0 + 0.327_591_1 * a);
    // erf(x) = 1 − (a1·p + a2·p² + … + a5·p⁵)·e^−x² (A&S 7.1.26), Horner
    // starting from the highest-degree coefficient a5.
    let erf_abs = 1.0
        - ((((1.061_405_429 * p - 1.453_152_027) * p + 1.421_413_741) * p - 0.284_496_736) * p
            + 0.254_829_592)
            * p
            * (-a * a).exp();
    0.5 * (1.0 + sign * erf_abs)
}

/// Inverse standard normal CDF (Acklam's algorithm).
pub(crate) fn inv_norm_cdf(u: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239e0,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838e0,
        -2.549_732_539_343_734e0,
        4.374_664_141_464_968e0,
        2.938_163_982_698_783e0,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996e0,
        3.754_408_661_907_416e0,
    ];
    let u = u.clamp(1e-300, 1.0 - 1e-16);
    if u < 0.024_25 {
        let q = (-2.0 * u.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if u > 1.0 - 0.024_25 {
        let q = (-2.0f64 * (1.0 - u).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else {
        let q = u - 0.5;
        let r = q * q;
        ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q)
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    }
}

// ---------------------------------------------------------------------------
// Discrete-distribution quantiles (exact, via recurrence + local walk).
// ---------------------------------------------------------------------------

/// ln(k!) — exact sum for small k, Stirling with correction terms for large
/// k (relative error ~1e-11 for k ≥ 64).
fn log_factorial(k: u64) -> f64 {
    if k < 64 {
        let mut s = 0.0;
        for i in 1..=k {
            s += (i as f64).ln();
        }
        s
    } else {
        let kf = k as f64;
        kf * kf.ln() - kf + 0.5 * (2.0 * std::f64::consts::PI * kf).ln() + 1.0 / (12.0 * kf)
            - 1.0 / (360.0 * kf.powi(3))
    }
}

/// Poisson quantile: smallest k with CDF(k) ≥ u. Exact up to f64 rounding.
/// `z_hint` is a normal-deviate hint (the copula variate) used to anchor the
/// search near the quantile for large λ.
fn poisson_quantile(u: f64, lambda: f64, z_hint: f64) -> u64 {
    if lambda <= 0.0 {
        return 0;
    }
    if lambda < 30.0 {
        // Exact recurrence from p0 = e^-λ (no underflow for λ < 30).
        let mut p = (-lambda).exp();
        let mut cdf = p;
        let mut k = 0u64;
        while cdf < u {
            k += 1;
            p *= lambda / k as f64;
            cdf += p;
            if k > 10_000 {
                return k; // extreme-tail safety valve
            }
        }
        return k;
    }
    // Large λ: anchor near the quantile with the normal approximation, then
    // evaluate the PMF at the anchor (Stirling log-factorial) and walk.
    let anchor = (lambda + z_hint * lambda.sqrt() - 0.5).max(0.0).round() as u64;
    let logp = if anchor == 0 {
        -lambda
    } else {
        -(lambda) + anchor as f64 * lambda.ln() - log_factorial(anchor)
    };
    let p_anchor = logp.exp();
    // CDF at the anchor: expand downward until terms are negligible relative
    // to the anchor mass (relative error < ~1e-12).
    let mut cdf = p_anchor;
    let mut pk = p_anchor;
    let mut kd = anchor;
    while kd > 0 {
        pk *= kd as f64 / lambda;
        if pk < p_anchor * 1e-14 {
            break;
        }
        cdf += pk;
        kd -= 1;
    }
    if cdf >= u {
        // Walk down.
        let mut k = anchor;
        let mut pk = p_anchor;
        loop {
            if cdf - pk < u {
                return k;
            }
            cdf -= pk;
            pk *= k as f64 / lambda;
            if k == 0 {
                return 0;
            }
            k -= 1;
        }
    } else {
        // Walk up.
        let mut k = anchor;
        let mut pk = p_anchor;
        let mut cdf = cdf;
        loop {
            k += 1;
            pk *= lambda / k as f64;
            cdf += pk;
            if cdf >= u {
                return k;
            }
            if k > anchor + 100_000 {
                return k; // safety valve
            }
        }
    }
}

/// Negative-binomial quantile (var = m + m²/r). Exact recurrence from p0.
fn negbin_quantile(u: f64, mean: f64, r: f64) -> u64 {
    if mean <= 0.0 {
        return 0;
    }
    let prob = r / (r + mean);
    let mut p = (r * prob.ln()).exp();
    let mut cdf = p;
    let mut k = 0u64;
    let limit = (mean + 40.0 * (mean + mean * mean / r).sqrt() + 1e3) as u64;
    while cdf < u {
        k += 1;
        p *= (k as f64 - 1.0 + r) / k as f64 * (1.0 - prob);
        cdf += p;
        if k > limit.max(10_000_000) {
            return k; // extreme-tail safety valve
        }
    }
    k
}

// ---------------------------------------------------------------------------
// Severity samplers.
// ---------------------------------------------------------------------------

fn sample_severity(spec: &LineSimSpec, rng: &mut Rng) -> Result<f64, AkError> {
    match spec.sev_dist {
        DIST_GAMMA => {
            // mean / cv parameterization: shape = 1/cv², scale = mean·cv².
            let cv = spec.sev_p2;
            let shape = 1.0 / (cv * cv);
            let scale = spec.sev_p1 * cv * cv;
            rng.gamma(shape, scale)
        }
        DIST_LOGNORMAL => {
            let v = (spec.sev_p1 + spec.sev_p2 * rng.normal()).exp();
            if !v.is_finite() {
                return Err(AkError::Numeric("lognormal draw overflow"));
            }
            Ok(v)
        }
        DIST_TWEEDIE => sample_tweedie(spec.sev_p1, spec.sev_p2, spec.sev_p3, rng),
        _ => Err(AkError::Domain("unknown severity distribution code")),
    }
}

/// Tweedie draw with mean μ, dispersion φ, power p.
fn sample_tweedie(mu: f64, phi: f64, p: f64, rng: &mut Rng) -> Result<f64, AkError> {
    if p == 0.0 {
        // Normal(μ, φ).
        return Ok(mu + phi.sqrt() * rng.normal());
    }
    if p == 2.0 {
        // Gamma(shape 1/φ, scale φ·μ).
        return rng.gamma(1.0 / phi, phi * mu);
    }
    if p == 3.0 {
        // Inverse Gaussian with mean μ and Var = φ (shape λ = μ³/φ).
        return sample_inverse_gaussian(mu, mu.powi(3) / phi, rng);
    }
    if p > 1.0 && p < 2.0 {
        // Compound Poisson–Gamma representation.
        let lambda = mu.powf(2.0 - p) / (phi * (2.0 - p));
        let alpha = (2.0 - p) / (p - 1.0); // gamma shape
        let scale = phi * (p - 1.0) * mu.powf(p - 1.0);
        let n = poisson_draw(lambda, rng);
        let mut s = 0.0f64;
        for _ in 0..n {
            s += rng.gamma(alpha, scale)?;
            if !s.is_finite() {
                return Err(AkError::Numeric("tweedie draw overflow"));
            }
        }
        return Ok(s);
    }
    Err(AkError::Domain(
        "tweedie power outside supported family {0, (1,2), 2, 3}",
    ))
}

/// Inverse Gaussian(μ, λ) via the method of Michael, Schucany & Haas.
fn sample_inverse_gaussian(mu: f64, lambda: f64, rng: &mut Rng) -> Result<f64, AkError> {
    let v = rng.normal();
    let y = v * v;
    let x = mu + (mu * mu * y) / (2.0 * lambda)
        - (mu / (2.0 * lambda)) * (4.0 * mu * lambda * y + mu * mu * y * y).sqrt();
    let u = rng.uniform();
    let out = if u <= mu / (mu + x) { x } else { mu * mu / x };
    if !out.is_finite() || out <= 0.0 {
        return Err(AkError::Numeric("inverse-gaussian draw invalid"));
    }
    Ok(out)
}

/// Direct Poisson count draw (no copula), used inside compound severities.
fn poisson_draw(lambda: f64, rng: &mut Rng) -> u64 {
    if lambda <= 0.0 {
        return 0;
    }
    let u = 1.0 - rng.uniform(); // (0, 1]
    poisson_quantile(u, lambda, inv_norm_cdf(u))
}

// ---------------------------------------------------------------------------
// Validation and driver.
// ---------------------------------------------------------------------------

fn validate_spec(spec: &LineSimSpec) -> Result<(), AkError> {
    match spec.freq_dist {
        DIST_POISSON => {
            if !(spec.freq_p1.is_finite() && spec.freq_p1 >= 0.0) {
                return Err(AkError::Input("poisson lambda must be finite and >= 0"));
            }
        }
        DIST_NEGBIN => {
            if !(spec.freq_p1.is_finite()
                && spec.freq_p1 >= 0.0
                && spec.freq_p2.is_finite()
                && spec.freq_p2 > 0.0)
            {
                return Err(AkError::Input("negbin mean/r invalid"));
            }
        }
        _ => return Err(AkError::Domain("unknown frequency distribution code")),
    }
    match spec.sev_dist {
        DIST_GAMMA => {
            if !(spec.sev_p1.is_finite()
                && spec.sev_p1 >= 0.0
                && spec.sev_p2.is_finite()
                && spec.sev_p2 > 0.0)
            {
                return Err(AkError::Input("gamma mean/cv invalid"));
            }
        }
        DIST_LOGNORMAL => {
            if !(spec.sev_p1.is_finite() && spec.sev_p2.is_finite() && spec.sev_p2 > 0.0) {
                return Err(AkError::Input("lognormal mu/sigma invalid"));
            }
        }
        DIST_TWEEDIE => {
            if !(spec.sev_p1.is_finite()
                && spec.sev_p1 > 0.0
                && spec.sev_p2.is_finite()
                && spec.sev_p2 > 0.0
                && spec.sev_p3.is_finite())
            {
                return Err(AkError::Input("tweedie mu/phi/p invalid"));
            }
            let p = spec.sev_p3;
            if !(p == 0.0 || (1.0..2.0).contains(&p) || p == 2.0 || p == 3.0) {
                return Err(AkError::Domain(
                    "tweedie power outside supported family {0, (1,2), 2, 3}",
                ));
            }
        }
        _ => return Err(AkError::Domain("unknown severity distribution code")),
    }
    Ok(())
}

fn draw_count(spec: &LineSimSpec, u: f64, z: f64) -> u64 {
    match spec.freq_dist {
        DIST_NEGBIN => negbin_quantile(u, spec.freq_p1, spec.freq_p2),
        _ => poisson_quantile(u, spec.freq_p1, z), // validated earlier
    }
}

/// Run the aggregate-loss simulation.
///
/// * `lines`: per-line frequency/severity specs.
/// * `corr`: `n_lines × n_lines` row-major Gaussian-copula correlation
///   matrix; `None` or an empty slice means independence.
/// * `want_per_line`: also collect per-line TVaR contributions.
///
/// Fails closed on non-positive-definite correlation matrices (Cholesky),
/// non-finite parameters, or unknown distribution codes.
pub fn simulate(
    lines: &[LineSimSpec],
    corr: Option<&[f64]>,
    n_paths: u64,
    seed: u64,
    want_per_line: bool,
) -> Result<SimResult, AkError> {
    if lines.is_empty() {
        return Err(AkError::Input("need at least one line"));
    }
    if n_paths == 0 {
        return Err(AkError::Input("n_paths must be > 0"));
    }
    if n_paths > (i32::MAX as u64) {
        return Err(AkError::Input("n_paths too large"));
    }
    for s in lines {
        validate_spec(s)?;
    }
    let n = lines.len();

    // Cholesky factor of the correlation matrix (None/empty → identity).
    let chol: Vec<f64> = match corr {
        None => identity_chol(n),
        Some(c) => {
            if c.is_empty() {
                identity_chol(n)
            } else if c.len() != n * n {
                return Err(AkError::Input("correlation matrix dimension mismatch"));
            } else {
                cholesky(c, n)?
            }
        }
    };

    let mut rng = Rng::new(seed);
    let mut agg: Vec<f64> = Vec::with_capacity(n_paths as usize);
    let mut per_line: Vec<Vec<f64>> = if want_per_line {
        (0..n)
            .map(|_| Vec::with_capacity(n_paths as usize))
            .collect()
    } else {
        Vec::new()
    };
    let mut zbuf = vec![0.0f64; n];

    for _ in 0..n_paths {
        // Correlated frequency uniforms via the Gaussian copula: z = L·g.
        for g in zbuf.iter_mut() {
            *g = rng.normal();
        }
        let mut total = 0.0f64;
        for (i, spec) in lines.iter().enumerate() {
            let mut zi = 0.0;
            for (j, g) in zbuf.iter().enumerate().take(i + 1) {
                zi += chol[i * n + j] * g;
            }
            let u = norm_cdf(zi);
            let count = draw_count(spec, u, zi);
            let mut line_loss = 0.0f64;
            for _ in 0..count {
                line_loss += sample_severity(spec, &mut rng)?;
                if !line_loss.is_finite() {
                    return Err(AkError::Numeric("aggregate loss overflow"));
                }
            }
            total += line_loss;
            if want_per_line {
                per_line[i].push(line_loss);
            }
        }
        agg.push(total);
    }

    // Aggregate statistics. Sort a permutation once so the per-line losses
    // stay correctly paired with their aggregate value.
    let m = agg.len();
    let mut order: Vec<usize> = (0..m).collect();
    order.sort_by(|&a, &b| {
        agg[a]
            .partial_cmp(&agg[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let sorted: Vec<f64> = order.iter().map(|&i| agg[i]).collect();
    let mean = sorted.iter().sum::<f64>() / n_paths as f64;
    let var_995 = quantile_sorted(&sorted, 0.995);
    let tvar_99 = tail_mean(&sorted, 0.99);

    // Per-line TVaR: mean line loss over the worst-1% aggregate paths
    // (scenario-allocation), using the same permutation.
    let per_line_tvar = if want_per_line {
        let alpha = 0.99f64;
        let tail = (1.0 - alpha) * m as f64;
        let k = tail.floor() as usize;
        let frac = tail - k as f64;
        let denom = k as f64 + frac;
        let mut out = Vec::with_capacity(lines.len());
        if denom == 0.0 {
            out.resize(lines.len(), 0.0);
        } else {
            for line_losses in &per_line {
                let mut sum = 0.0;
                for idx in order.iter().skip(m - k) {
                    sum += line_losses[*idx];
                }
                if frac > 0.0 && k < m {
                    sum += frac * line_losses[order[m - k - 1]];
                }
                out.push(sum / denom);
            }
        }
        out
    } else {
        Vec::new()
    };

    if !mean.is_finite() || !var_995.is_finite() || !tvar_99.is_finite() {
        return Err(AkError::Numeric("simulation statistics overflow"));
    }
    Ok(SimResult {
        n_paths,
        mean,
        var_995,
        tvar_99,
        per_line_tvar,
    })
}

fn identity_chol(n: usize) -> Vec<f64> {
    let mut m = vec![0.0; n * n];
    for i in 0..n {
        m[i * n + i] = 1.0;
    }
    m
}

/// Cholesky factorization (lower triangular, row-major). Fails closed when
/// the matrix is not symmetric positive definite.
fn cholesky(corr: &[f64], n: usize) -> Result<Vec<f64>, AkError> {
    for i in 0..n {
        for j in 0..n {
            let v = corr[i * n + j];
            if !v.is_finite() {
                return Err(AkError::Input("correlation matrix must be finite"));
            }
            if i == j && (v - 1.0).abs() > 1e-9 {
                return Err(AkError::Input("correlation diagonal must be 1"));
            }
            if i != j {
                if (v - corr[j * n + i]).abs() > 1e-9 {
                    return Err(AkError::Input("correlation matrix must be symmetric"));
                }
                if v.abs() > 1.0 {
                    return Err(AkError::Input("correlation entries must be in [-1, 1]"));
                }
            }
        }
    }
    let mut l = vec![0.0f64; n * n];
    for i in 0..n {
        for j in 0..=i {
            let mut s = corr[i * n + j];
            for k in 0..j {
                s -= l[i * n + k] * l[j * n + k];
            }
            if i == j {
                if s <= 0.0 {
                    return Err(AkError::Input(
                        "correlation matrix is not positive definite",
                    ));
                }
                l[i * n + j] = s.sqrt();
            } else {
                l[i * n + j] = s / l[j * n + j];
            }
        }
    }
    Ok(l)
}

/// Interpolated quantile of a sorted slice (α ∈ (0,1)): position α·n with
/// linear interpolation between order statistics.
fn quantile_sorted(sorted: &[f64], alpha: f64) -> f64 {
    let n = sorted.len();
    debug_assert!(n > 0);
    let pos = alpha * n as f64;
    let k = pos.floor() as usize;
    let frac = pos - k as f64;
    if k == 0 {
        sorted[0]
    } else if k >= n {
        sorted[n - 1]
    } else {
        sorted[k - 1] * (1.0 - frac) + sorted[k] * frac
    }
}

/// Mean of the worst (1−α) fraction of a sorted slice, with fractional
/// weighting of the boundary path (consistent with `quantile_sorted`).
fn tail_mean(sorted: &[f64], alpha: f64) -> f64 {
    let n = sorted.len();
    let tail = (1.0 - alpha) * n as f64;
    let k = tail.floor() as usize; // full tail elements
    let frac = tail - k as f64;
    let mut sum = 0.0;
    for v in sorted.iter().skip(n - k) {
        sum += v;
    }
    if frac > 0.0 && k < n {
        sum += frac * sorted[n - k - 1];
    }
    let denom = k as f64 + frac;
    if denom == 0.0 {
        sorted[n - 1]
    } else {
        sum / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rng_deterministic() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.normal().to_bits(), b.normal().to_bits());
        }
    }

    #[test]
    fn inv_cdf_roundtrip() {
        // norm_cdf carries ~1.5e-7 abs error (A&S 7.1.26), which in the far
        // tail maps to a z-error of ~1.5e-7/φ(z); tolerance accounts for it.
        for &z in &[-3.5, -1.0, 0.0, 0.7, 2.576, 3.9] {
            let u = norm_cdf(z);
            let z2 = inv_norm_cdf(u);
            assert!((z - z2).abs() < 3e-4, "z={z} z2={z2}");
        }
    }

    #[test]
    fn poisson_quantile_small() {
        // CDF of Poisson(2): P(0)=e^-2≈0.1353, P(1)≈0.4060, P(2)≈0.6767.
        assert_eq!(poisson_quantile(0.05, 2.0, 0.0), 0);
        assert_eq!(poisson_quantile(0.20, 2.0, 0.0), 1);
        assert_eq!(poisson_quantile(0.50, 2.0, 0.0), 2);
        assert!(poisson_quantile(0.999_999, 2.0, 0.0) > 5);
    }

    #[test]
    fn poisson_quantile_large_lambda() {
        // Poisson(1000): median ≈ 999.5 + 1/3 ≈ 1000; 99.9% ≈ 1097 (z≈3.09).
        let q = poisson_quantile(0.5, 1000.0, inv_norm_cdf(0.5));
        assert!((995..=1005).contains(&q), "q={q}");
        let hi = poisson_quantile(0.999, 1000.0, inv_norm_cdf(0.999));
        assert!((1090..=1110).contains(&hi), "hi={hi}");
    }

    #[test]
    fn negbin_quantile_sane() {
        // mean 5, r 10 → var = 5 + 25/10 = 7.5. u=0.5 near the median.
        let q = negbin_quantile(0.5, 5.0, 10.0);
        assert!((3..=8).contains(&q));
    }

    #[test]
    fn cholesky_2x2() {
        let l = cholesky(&[1.0, 0.5, 0.5, 1.0], 2).unwrap();
        assert!((l[0] - 1.0).abs() < 1e-15);
        assert!((l[2] - 0.5).abs() < 1e-15);
        assert!((l[3] - 0.75f64.sqrt()).abs() < 1e-15);
    }

    #[test]
    fn cholesky_rejects_npd() {
        assert!(cholesky(&[1.0, 2.0, 2.0, 1.0], 2).is_err());
    }

    #[test]
    fn simulate_deterministic_seed() {
        let lines = [LineSimSpec {
            freq_dist: DIST_POISSON,
            freq_p1: 5.0,
            freq_p2: 0.0,
            sev_dist: DIST_GAMMA,
            sev_p1: 1000.0,
            sev_p2: 0.5,
            sev_p3: 0.0,
        }];
        let a = simulate(&lines, None, 20_000, 7, false).unwrap();
        let b = simulate(&lines, None, 20_000, 7, false).unwrap();
        assert_eq!(a.var_995.to_bits(), b.var_995.to_bits());
        assert_eq!(a.tvar_99.to_bits(), b.tvar_99.to_bits());
        // Compound Poisson-Gamma moments: mean = λ·μ = 5000.
        assert!((a.mean - 5000.0).abs() < 500.0);
    }
}
