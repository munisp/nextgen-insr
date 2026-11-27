# Golden datasets — actuary_kernels

Published and cross-validated reference data for the acceptance tests
(design doc Appendix H, Leg A). All files are plain CSV; unobserved triangle
cells are empty.

## Files

| File | Contents | Provenance |
|------|----------|------------|
| `gen_ins.csv` | 10×10 cumulative incurred triangle ("GenIns", the Taylor & Ashe (1983) data used by Mack (1991/1993), Table 1 of Mack 1993 ASTIN 23:213–225). | R `ChainLadder` package `GenIns` dataset documentation (pkgdown reference page), corroborated by `chainladder-python` `load_sample('genins')`. |
| `raa.csv` | 10×10 cumulative paid triangle (Reinsurance Association of America historical loss development). | R `ChainLadder` package `RAA` dataset; values printed in the r-bloggers walkthrough of `MackChainLadder(RAA)`. |
| `annuity_5yr.csv` | Hand-computed 5-year annuity-certain-plus-contingent reference: qx = [0.10]×5, start age 0, no improvement, flat 5% discount, payment 10,000, guarantee 2 years. Columns: survival S(t), discount v(t), certain payment, PV terms. | Closed-form arithmetic (see `tests/annuity_golden.rs`): pv = 34915.874999173626, pv_guaranteed = 18594.104308390022. |

## Expected results pinned by the tests

Chain-ladder on `gen_ins.csv` (volume-weighted), published by R
`ChainLadder::MackChainLadder(GenIns)` (rounded to integers in the package
output): ultimates
3901463, 5433719, 5378826, 5297906, 4858200, 5111171, 5660771, 6784799,
5642266, 4969825 (total 53,038,946); total IBNR 18,680,856; total Mack S.E.
2,447,618. Full-precision cross-validation values produced with
`chainladder-python` 0.10.1 are embedded in `tests/golden_chainladder.rs`
and `tests/golden_mack.rs` (the Python package's Mack total SE is
2,441,364.13 — a documented convention difference, R issue #234, within
±0.26% of the R-published value; the acceptance tolerance is ±0.5%).

Chain-ladder on `raa.csv` (R vignette `MackChainLadder(RAA)`): total
ultimate 213,122.23, total IBNR 52,135.23, total Mack S.E. 26,909.01;
per-origin IBNR/SE embedded in `tests/golden_mack.rs`. Our implementation
reproduces the R convention on RAA exactly (total 26,909.011156 and every
per-origin SE within the printed 1-d.p. precision).

Monte Carlo analytic reference (`tests/mc_analytic.rs`): single line,
frequency Poisson(50), severity Normal(1000, 500²) (kernel code Tweedie
p=0). The aggregate is an exact Poisson–Normal mixture; VaR_99.5 and
TVaR_99 were computed by mixture quadrature with scipy 1.16.2:
VaR_995 = 71641.37217383638, TVaR_99 = 72474.33118882046.
Monte Carlo standard errors at 10⁶ paths: SE(VaR) ≈ 38.56,
SE(TVaR) ≤ 79.06 (loose bound); the test asserts agreement within 5×SE.

The simple-average factor path and the `chainladder-python`
cross-validation constants were produced by the script recorded in
`golden-refs.txt` (chainladder-python 0.10.1,
`Development(average='simple')`, `MackChainladder`).
