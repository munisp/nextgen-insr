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

## Deployment (2026-11-28, W34-E)

CI: `.github/workflows/actuary-engine-ci.yml` (cargo → go → python → docker
build gates; the go job links the cdylib artifact uploaded by the cargo job —
one rust toolchain, single `.so` source of truth).

### docker-compose

The `actuary-pricing` service is wired into both root stacks:

- `docker-compose.yml` (dev): builds from the repo root, `PORT=7080`,
  `DATABASE_URL` → `postgres:5432/insureportal`, `REDIS_ADDR=redis:6379`,
  `depends_on` postgres+redis `service_healthy`, published `7080:7080`.
- `docker-compose.final.yml` (final core): same wiring against the
  `posinsureportal` DB, `PRICING_HMAC_SECRET` **required** (`:?` guard),
  `expose 7080` only (behind the gateway).

No compose `healthcheck` is declared: the distroless runtime image carries no
shell/wget/curl to execute one. Probes are HTTP-only: `GET /healthz`
(liveness) and `GET /readyz` (readiness).

### Helm (`helm/insuretech-platform`)

`templates/pricing-service.yaml` renders Deployment + Service + ServiceAccount
from the `actuaryPricing:` values block (`enabled`, `replicaCount`, `port`,
`image.repository/tag` — defaulting to the shared
`insuretech.serviceImage` convention, `resources`, `tigerbeetleSidecarUrl`).
The template is deliberately NOT part of the generic `.Values.services`
loop: this service's env contract (`PORT`/`DATABASE_URL`/`REDIS_ADDR`) and
probe paths (`/healthz`, `/readyz`) differ from the generic template's
`SERVICE_PORT` + `/health` convention. Pod `securityContext` runs as
uid/gid 65532, matching the image's `USER`.

### Required env vars

| env | required | source in deploy |
|---|---|---|
| `DATABASE_URL` | **yes** (boot fails without it) | helm: `<release>-secrets` `DB_USER`/`DB_PASSWORD` + postgresql host; compose: inline DSN |
| `PORT` | no (default `7080`) | values/compose pin `7080` |
| `REDIS_ADDR` | no (default `localhost:6379`) | helm: `<release>-redis-master:6379`; compose: `redis:6379` |
| `PRICING_HMAC_SECRET` | no (unset = trusted gateway) | helm: optional `PRICING_HMAC_SECRET` key in `<release>-secrets` (values `commonSecrets.pricing.hmacSecret`; empty default = key not emitted — NEVER commit a real secret); compose.final: required env |
| `TB_SIDECAR_URL` | no (unset = shadow writes disabled) | values `actuaryPricing.tigerbeetleSidecarUrl` / compose env |

### Known wiring caveat — Redis auth

`cmd/server/main.go` constructs the go-redis client with `Addr` **only** —
no password. Both compose stacks and the bitnami redis subchart run redis
with `requirepass`/`auth`. Until the service grows a `REDIS_PASSWORD` env
(follow-up, outside W34-E wiring scope), the accumulation store is
unreachable against an authenticated redis and every quote fails closed with
`ACCUM_UNAVAILABLE` → **refer** (never accept) — safe, but rating throughput
that depends on accumulation checks will not accept quotes. Point
`REDIS_ADDR` at a passwordless redis (or sidecar proxy) for full function.

### Database migration

`insureportal/drizzle/0049_actuary_engine.sql` (12 `act_*` tables) runs in
the production deploy path via `scripts/db-migrate-safe.sh` step 4c
(invoked by `make -f Makefile.production db-migrate`): the
`schema_migrations_ext` ledger applies insureportal hand-written files
> 0048 exactly once; 0043-0048 are baseline-recorded as pre-existing (same
model as the root series in step 4b). The file is idempotent
(DO-block enums + `IF NOT EXISTS`), so re-application is safe.
