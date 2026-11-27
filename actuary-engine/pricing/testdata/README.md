# testdata — fixtures, golden set, reference driver

- `seed/rating_fixtures.json` — six-line seed: GLM artefacts (Appendix F
  schema) as the `base` rating table, loading/tax tables, exposure limits,
  referral rules, accumulation warm seeds, and an approved capital summary
  for the read-model tests.
- `golden_quotes.json` — the pinned golden quote set: 20 quotes across the
  6 representative lines, all designed to ACCEPT (the set validates the
  numeric path; refer/decline paths are covered by dedicated unit tests).
- `golden_expected.csv` — Leg A reference outputs (`id,total,pure,
  loadings` in kobo) produced by `refgen.c` calling
  `libactuary_kernels.so` directly — never through Go.
- `refgen.c` — the reference driver. Regenerate:

  ```sh
  AK_GOLDEN_DUMP=/tmp/resolved_inputs.csv go test ./internal/service -run TestGoldenQuotes
  cc -O2 -o /tmp/refgen refgen.c -I../../kernels/include -L../../kernels/target/release -lactuary_kernels
  LD_LIBRARY_PATH=../../kernels/target/release /tmp/refgen /tmp/resolved_inputs.csv golden_expected.csv
  go test ./internal/service -run 'TestGolden'   # must pass unchanged
  ```
