# actuary-pricing (Leg B)

Go pricing microservice: rating through the real Rust `actuary_kernels`
cdylib via cgo, with the fail-closed de-risking controls of the design doc
(exposure limits, accumulation ceilings, declarative referral rules) on top.
Layout follows the `reinsurance-management` conventions (cmd/internal,
net/http ServeMux, writeJSON/writeError, graceful shutdown).

## Architecture

```
cmd/server/main.go        boot sequence (Appendix D): PG → snapshot load →
                          accumulation warm → cgo smoke test → serve :7080
internal/
  kernels/                THE single cgo boundary (Appendix C contract)
  rating/                 GLM artefact validation (Appendix F), immutable
                          snapshots, deterministic resolution
  exposure/               per-risk/per-policy/aggregate limit checks
  accumulation/           Redis geo + per-line aggregates; atomic
                          check-and-apply Lua script (no TOCTOU over-commit)
  referral/               declarative JSON predicate rules engine;
                          engine error → refer (never accept)
  reinsurance/            retained-risk impact via the MC kernel
                          (quota-share exact scaling; XoL LEV approximation)
  adequacy/               priced-LR vs live-LR evaluator (amber ±5 / red
                          ±10 pts, credibility-widened under ₦50m EP)
  handlers/ models/ service/ repository/ observability/ shadow/
testdata/
  seed/rating_fixtures.json   6-line seed (artefacts, limits, rules)
  golden_quotes.json          20 quotes across 6 lines (Appendix H)
  golden_expected.csv         Leg A reference outputs (refgen.c, direct cdylib)
  refgen.c                    regeneration driver for the reference outputs
openapi.yaml                Appendix D endpoint contract
```

## Money & rounding contract

Money crosses the FFI boundary as **integer kobo** (`i64`). The kernel owns
the single rounding policy (half-away-from-zero). Go never re-rounds kernel
outputs; the loadings/taxes decomposition assigns the residual so the
identity `pure + expense + commission + profit + Σtaxes == total` holds
exactly (design §9.1 float discipline).

## Fail-closed posture (de-risked by construction)

- Managed line without an approved version → **503** (never a guess).
- Exposure-limit breach → **decline** (`LIMIT_SUM_INSURED`,
  `LIMIT_MAX_PREMIUM`).
- Accumulation breach → **refer** (`ACCUM_GEO`/`ACCUM_LINE`); the aggregate
  is left unchanged on breach (asserted by the pinned acceptance test).
- Accumulation store down → **refer** (`ACCUM_UNAVAILABLE`).
- Referral rules engine error → **refer** (`REFERRAL_ENGINE_ERROR`).
- Out-of-model-domain variable → **refer** (`MODEL_OUT_OF_DOMAIN`).
- Kernel numeric error → **refer** (`KERNEL_ERROR`), never accept.

## Configuration

| env | default | purpose |
|---|---|---|
| `PORT` | `7080` | listen port (Appendix G) |
| `DATABASE_URL` | *(required)* | PG DSN (lib/pq, act_* schema) |
| `REDIS_ADDR` | `localhost:6379` | accumulation store |
| `PRICING_HMAC_SECRET` | *(unset = trusted gateway)* | service-to-service HMAC (Leg D scheme: `X-Actuary-Timestamp`, `X-Actuary-Signature` = hex HMAC-SHA256(`ts.body`)) |
| `TB_SIDECAR_URL` | *(unset = disabled)* | async TB reserve-shadow endpoint (2s timeout, off hot path) |

Role claims arrive gateway-injected via `X-Actuary-Roles` (APISix validates
the JWT): `activate` requires `actuary_admin`, referral `decide` requires
`underwriter` or `actuary`.

## Build & test (dev)

The cgo boundary links `libactuary_kernels.so` from `../kernels`:

```sh
(cd ../kernels && cargo build --release)          # produces target/release/libactuary_kernels.so
export LD_LIBRARY_PATH=$PWD/../kernels/target/release
go build ./...
go test ./...                                      # full suite
go test -race ./...
go vet ./... && gofmt -l .
```

Latency gates (Appendix H): `go test ./internal/service -run TestLatency`
asserts measured p99 < 1 ms (kernel) / < 5 ms (handler); benchmarks at
`go test -bench . ./internal/kernels ./internal/service`.

### Regenerating the golden reference outputs

```sh
AK_GOLDEN_DUMP=/tmp/resolved_inputs.csv go test ./internal/service -run TestGoldenQuotes
cc -O2 -o /tmp/refgen testdata/refgen.c \
   -I../kernels/include -L../kernels/target/release -lactuary_kernels
/tmp/refgen /tmp/resolved_inputs.csv testdata/golden_expected.csv
go test ./internal/service -run 'TestGolden'      # must pass unchanged
```

## Docker

Build context is the repo root (kernels + pricing):

```sh
docker build -f actuary-engine/pricing/Dockerfile -t actuary-pricing .
docker run -e DATABASE_URL=... -e REDIS_ADDR=... -p 7080:7080 actuary-pricing
```

Compose wiring (Appendix G): `actuary-postgres` on `insureportal`,
`actuary-redis` accumulation, port `7080`.
