/*
 * actuary_kernels.h — C ABI for the actuary compute kernels
 * (actuary-engine/kernels). Frozen cross-leg contract, design doc
 * Appendix C. Checked in by hand; CI regenerates-equivalent bindings and
 * diffs against this file.
 *
 * Boundary rules (non-negotiable):
 *  - No panic crosses the boundary: every function wraps its body in
 *    std::panic::catch_unwind and maps failures onto the AK_ERR_* codes.
 *  - All inputs are validated BEFORE any compute; invalid arguments return
 *    AK_ERR_INPUT and leave every out-param untouched.
 *  - The kernels never return a guess: model-domain failures return
 *    AK_ERR_DOMAIN, non-convergence/overflow returns AK_ERR_NUMERIC.
 *
 * Ownership: the library is stateless and allocates nothing that outlives a
 * call. Input arrays are borrowed for the duration of the call (caller keeps
 * ownership); outputs are written into caller-provided buffers. There is
 * nothing to free; no ak_free exists by design.
 *
 * Money: inputs are f64 major units (naira); monetary out-params are int64
 * minor units (kobo, 1/100 naira) rounded half-away-from-zero. Rates are f64
 * fractions.
 *
 * Pointer safety: null pointers and length mismatches are detected and
 * rejected. As with any C ABI, a non-null pointer that does not actually
 * reference `len` valid elements is undetectable from the callee side;
 * callers must pass truthful (ptr, len) pairs (enforced in the cgo wrapper).
 */

#ifndef ACTUARY_KERNELS_H
#define ACTUARY_KERNELS_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define AK_OK 0
#define AK_ERR_INPUT -1        /* invalid argument (validated before compute) */
#define AK_ERR_DOMAIN -2       /* out-of-model-domain (e.g. missing relativity key) */
#define AK_ERR_NUMERIC -3      /* non-convergence / overflow */
#define AK_ERR_PANIC -99       /* caught panic — must be unreachable in tests */

/*
 * Distribution codes used by AkLineSimSpec:
 *
 *   frequency: 0 = Poisson(freq_p1=lambda)
 *              1 = NegBin(freq_p1=mean, freq_p2=size r; var = mean + mean^2/r)
 *   severity:  2 = Gamma(sev_p1=mean, sev_p2=cv)
 *              3 = Lognormal(sev_p1=mu, sev_p2=sigma; log-space)
 *              4 = Tweedie(sev_p1=mean, sev_p2=dispersion phi, sev_p3=power p)
 *                  supported powers: p=0 (Normal), 1<p<2 (compound
 *                  Poisson-Gamma), p=2 (Gamma), p=3 (inverse Gaussian);
 *                  any other p returns AK_ERR_DOMAIN
 */
typedef struct AkLineSimSpec {
    int32_t freq_dist;   /* 0=Poisson, 1=NegBin */
    double  freq_p1;     /* Poisson: lambda; NegBin: mean */
    double  freq_p2;     /* NegBin: size r (unused for Poisson) */
    int32_t sev_dist;    /* 2=Gamma, 3=Lognormal, 4=Tweedie */
    double  sev_p1;      /* Gamma/Tweedie: mean; Lognormal: mu (log space) */
    double  sev_p2;      /* Gamma: cv; Lognormal: sigma; Tweedie: phi */
    double  sev_p3;      /* Tweedie: power p (unused otherwise) */
} AkLineSimSpec;

/*
 * Profit-testing input. All arrays have length n_years unless stated
 * otherwise. See src/mortality.rs for the projection convention.
 */
typedef struct AkProfitTestInput {
    size_t         n_years;       /* projection horizon (years) */
    const double*  premiums;      /* annual premium per in-force policy */
    const double*  expenses;      /* annual expense per in-force policy */
    double         sum_assured;   /* level death benefit */
    const double*  qx;            /* mortality grid, length n_ages */
    size_t         n_ages;        /* length of qx grid */
    size_t         start_age;     /* issue age (index into qx grid) */
    const double*  reserve_end;   /* end-of-year reserve per surviving policy */
    const double*  earned_rates;  /* annual earned (investment) rate */
    const double*  discount;      /* risk discount curve (annual rates) */
    double         improvement;   /* flat mortality improvement scalar/year */
} AkProfitTestInput;

/* Premium mathematics: GLM score -> loadings -> clamped total.
 *   rels: flattened relativity multipliers already resolved by the Go loader
 *   (kernel never does table lookup — keeps FFI stateless and test-pure).
 * rels may be NULL when n==0; tax_rates may be NULL when n_tax==0. */
int32_t ak_premium_compose(
    double base_pure_premium,      /* exposure × base rate */
    const double* rels, size_t n,  /* multiplicative relativities */
    double expense_ratio, double commission_rate, double profit_margin,
    const double* tax_rates, size_t n_tax,
    int64_t min_premium_kobo, int64_t max_premium_kobo,
    int64_t* out_total_kobo, int64_t* out_pure_kobo, int64_t* out_loadings_kobo);

/* Chain-ladder projection on an upper-triangular triangle (row-major,
 * origin × development), returns volume-weighted dev factors and ultimates.
 * Requires factors_len == devs-1 and ult_len == origins. */
int32_t ak_chainladder(
    const double* tri, size_t origins, size_t devs,
    double* out_factors, size_t factors_len,      /* devs-1 factors */
    double* out_ultimates, size_t ult_len);

/* Bornhuetter–Ferguson: ultimates = a_priori blended with CL emergence.
 * apriori_ultimates: origins entries. payout_patterns: devs entries,
 * incremental emergence fractions summing to 1 (±1e-6). */
int32_t ak_bornhuetter_ferguson(
    const double* tri, size_t origins, size_t devs,
    const double* apriori_ultimates, const double* payout_patterns,
    double* out_ultimates);

/* Mack parameter-uncertainty standard errors per origin (devs >= 3, square
 * triangle). out_se_per_origin: origins entries. */
int32_t ak_mack_se(
    const double* tri, size_t origins, size_t devs,
    double* out_se_total, double* out_se_per_origin);

/* Monte Carlo aggregate-loss simulation: per-line (freq dist, sev dist,
 * params) + Gaussian-copula correlation matrix; deterministic under seed.
 *   dist codes: 0=Poisson,1=NegBin,2=Gamma,3=Lognormal,4=Tweedie(passed p)
 * corr may be NULL when corr_dim==0 (independence); otherwise
 * corr_dim==n_lines and corr has corr_dim^2 entries (row-major).
 * out_per_line_tvar is optional (NULL → not computed); when non-NULL it must
 * hold n_lines entries (mean line loss over worst-1% aggregate paths). */
int32_t ak_montecarlo_aggregate(
    const AkLineSimSpec* lines, size_t n_lines,
    const double* corr, size_t corr_dim,
    uint64_t n_paths, uint64_t seed,
    double* out_var_995, double* out_tvar_99, double* out_mean,
    double* out_per_line_tvar /* optional, nullable */);

/* Life: survival/annuity present values from a qx grid with flat improvement
 * scalar and CBN-curve discounting (discount per year supplied by caller).
 * qx: n_ages entries; discount: n_years entries. Payment at end of year t in
 * 1..n_years while alive; first guarantee_years payments are certain. */
int32_t ak_annuity_pv(
    const double* qx, size_t n_ages, size_t start_age,
    double improvement, const double* discount, size_t n_years,
    double payment, uint32_t guarantee_years,
    double* out_pv, double* out_pv_guaranteed);

/* Profit testing: year-by-year cash-flow projection -> margin + IRR.
 * IRR is solved by bisection; returns AK_ERR_NUMERIC when the profit
 * signature has no root in (-0.9999, 10]. */
int32_t ak_profit_test(
    const AkProfitTestInput* input,   /* premiums, qx, expenses, reserves, disc */
    double* out_margin, double* out_irr);

uint32_t ak_version(void);            /* semver packed (major<<16|minor<<8|patch) */

#ifdef __cplusplus
}
#endif

#endif /* ACTUARY_KERNELS_H */
