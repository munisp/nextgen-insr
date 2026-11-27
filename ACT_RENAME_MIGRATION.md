# ACT RENAME MIGRATION — NGApp → InsureTech

**Date:** 2026-11-28
**Scope:** Platform brand rename `NGApp` → `InsureTech` across `munisp/nextgen-insr` @ `4b99b8f570c3c68e3901d311504f368e4b490ef5` (main).
**Driver:** `rename-audit/ngapp-occurrences.md`, `rename-blast-radius.md`, `consolidation-map.md` (rename executed on BOTH root and `insureportal/` trees identically; consolidation is a SEPARATE wave and was NOT performed here).

## Token mapping applied (mechanical, word-boundary safe)

| Form | Replacement | Notes |
|---|---|---|
| `NGApp` (title) | `InsureTech` | brand, title case |
| `ngapp` (lower) | `insuretech` | lowercase token |
| `NGAPP` (upper) | `INSURETECH` | e.g. USSD marketing `*384*NGAPP#` → `*384*INSURETECH#` |
| `ngapp_*` identifiers | `insuretech_*` | e.g. `ngapp_staging`, `ngapp_policies_issued_total` |
| `NGApp[A-Z]…` camel | `InsureTech…` | `NGAppInsurance`→`InsureTechInsurance`, `NGAppCheckout`→`InsureTechCheckout` |
| Go module `github.com/munisp/NGApp/…` | `github.com/munisp/insuretech/…` | module paths lowercased per Go convention |
| Go module `github.com/munisp/ngapp/…` | `github.com/munisp/insuretech/…` | 9 lowercase modules under `services/go/` (see note below) |
| npm scope `@ngapp` / URL-encoded `%40ngapp` | `@insuretech` / `%40insuretech` | SBOM purl consistency |
| Clone URL `github.com/munisp/NGApp.git` | `github.com/munisp/nextgen-insr.git` | see "Repository name" below |

False-positive identifiers were NOT touched (word-boundary matching): `pendingApproval`, `underwritingApplications`, `subscribingApp`, `setSubscribingApp`, `isLoadingApplications`, `Approve/approvePendingApplications`, `getPendingApprovals`, `UnderwritingApplication`, `underwritingApps`.

---

## CLASS D — External contracts renamed in-repo (RUNTIME MIGRATION REQUIRED)

> Editing these strings in the repo does **not** change the live external systems.
> Each entry below lists the old → new value and the operational step required to
> make the runtime match. Until the runtime step is done, the live system still
> answers to the OLD name.

### D1. Apache Kafka topics — `ngapp.*` → `insuretech.*`
- **Renamed in:** `infra/kafka/create-topics-insuretech.sh` (was `create-topics-ngapp.sh`); topic prefix driven by `KAFKA_TOPIC_PREFIX=insuretech` (`.env.example`, both `deploy/staging/.env.staging` + `insureportal/.../.env.staging`).
- **Contract:** ~70 topics, prefix `ngapp.` → `insuretech.` — e.g. `ngapp.transactions.*`, `ngapp.claims.{submitted,approved,adjudicated,denied,paid}`, `ngapp.payments.completed`, `ngapp.fraud.{alerts,decisions,events}`, `ngapp.notifications.{email,push,sms,ussd}`, `ngapp.kyc.{verified,failed}`, `ngapp.kyb.verified`, `ngapp.audit.{log,changes}`, `ngapp.compliance.{cbn,naicom,ndpr}.reports`, `ngapp.dlq.{claims,notifications,payments,settlements,transactions}`, `ngapp.agent.*`, `ngapp.gamification.*`, `ngapp.mdm.*`, `ngapp.microinsurance.*`, `ngapp.dr.*`.
- **Client/group ids:** `KAFKA_CLIENT_ID=ngapp-producer`→`insuretech-producer`; `KAFKA_GROUP_ID`/`KAFKA_CONSUMER_GROUP=ngapp-consumers`→`insuretech-consumers`.
- **Migration step:** Create the full `insuretech.*` topic set. Run a **dual-publish / dual-consume transition window**: producers emit to both `ngapp.*` and `insuretech.*` while consumers subscribe to both, then cut producers over, drain `ngapp.*`, and delete the old topics. Do **not** flag-day rename — in-flight events in `ngapp.*` would be stranded otherwise. Update consumer allowlists/DLQ mappings in the same window.

### D2. Prometheus metric namespace — `ngapp_*` → `insuretech_*`
- **Renamed in:** `shared/observability/metrics.go` AND duplicate `insureportal/shared/observability/metrics.go` (`Namespace: "ngapp"` → `"insuretech"`). Dashboard/alert copies updated in BOTH trees: `monitoring/grafana-dashboards.json`, `monitoring/grafana/dashboards/insurance-platform-overview.json`, `monitoring/grafana/dashboards/middleware-infrastructure.json`, `monitoring/alertmanager.yml`, `monitoring/prometheus/prometheus.yml`, `monitoring/prometheus-values.yaml`, and the `insureportal/infrastructure/monitoring/*` duplicates.
- **Metrics affected:** `ngapp_policies_issued_total`, `ngapp_claims_{submitted,approved,escalated,rejected}_total`, `ngapp_db_pool_{idle,active,available}` → `insuretech_*` equivalents.
- **Migration step:** Metric names change → **historical series continuity is broken**. Ship new names + updated dashboards/alerts atomically; consider a dual-emit window (export both `ngapp_*` and `insuretech_*`) if continuity of SLOs is required. Re-point Grafana datasources/dashboards and Alertmanager routing to `insuretech_*` in lockstep (both trees already renamed identically). Re-baseline any recording rules / SLO burn-rate alerts that referenced `ngapp_*`.

### D3. Temporal namespaces — `ngapp`, `ngapp-*` → `insuretech`, `insuretech-*`
- **Renamed in:** `infra/temporal/setup-namespaces.sh`; default `TEMPORAL_NAMESPACE=insuretech`, `TEMPORAL_TASK_QUEUE=insuretech-tasks` (`.env.example`).
- **Namespaces:** `ngapp` + `ngapp-agent`, `ngapp-agent-commission`, `ngapp-audit`, `ngapp-claims`, `ngapp-compliance-cbn`, `ngapp-compliance-naicom`, `ngapp-compliance-ndpr`, `ngapp-fraud`, `ngapp-kyc`, `ngapp-notifications`, `ngapp-payments`, `ngapp-policies`, `ngapp-reporting`, `ngapp-settlement`, `ngapp-settlement-daily` → `insuretech[-…]` equivalents.
- **Migration step:** Temporal namespaces are namespace-bound; in-flight workflows do not migrate. **Drain** each old namespace (let running workflows finish / terminate-and-continue-as-new), create the `insuretech[-*]` namespaces, re-register workers against the new namespaces, then retire the old ones. Update worker deployment env (`TEMPORAL_NAMESPACE`, task queues) in the same change.

### D4. PostgreSQL role / schema / databases — `ngapp`, `ngapp_core`, `ngapp_staging`, `ngapp_test` → `insuretech*`
- **Renamed in:** `infra/postgres/init-insuretech.sql` (was `init-ngapp.sql`); `deploy/staging/docker-compose.staging.yml` + duplicate `insureportal/infrastructure/deploy/staging/docker-compose.staging.yml`; `.github/workflows/platform-ci.yml`; `.env.example` (`DB_USER/DB_NAME/DATABASE_NAME=insuretech`, `DATABASE_URL`/`POSTGRES_URL=…/insuretech`, `KC_DB_URL=…/insuretech_staging`, `KC_DB_USERNAME=insuretech`); seed/fixture scripts `customer-portal-full/{seed-enums.js,seed-gaps.sql,seed-empty-tables.sql,generate-seeds.js,fix-fk-seeds.js}`; `infrastructure/init-db/01-schema.sql`; `infrastructure/docker/docker-compose.v3.yaml`.
- **Objects:** role `ngapp`→`insuretech`; schema `ngapp_core`→`insuretech_core`; databases `ngapp`→`insuretech`, `ngapp_staging`→`insuretech_staging`, `ngapp_test`→`insuretech_test`.
- **Migration step:** Data-level change, not a file rename. Produce a **DB rename runbook**: `ALTER DATABASE … RENAME`, `ALTER ROLE … RENAME`, `ALTER SCHEMA … RENAME` (or dump/restore into `insuretech*` instances) on redeploy; roll connection strings (`DATABASE_URL`, `KC_DB_URL`) through a dual-config window; re-grant privileges. CI `platform-ci.yml` now provisions `insuretech_test` — ensure the CI service container creates the new name (it is created fresh each run, so no migration needed there).

### D5. Keycloak realm + client — `ngapp` / `ngapp-client` → `insuretech` / `insuretech-client`
- **Renamed in:** `.env.example` (`KEYCLOAK_REALM=insuretech`, `KEYCLOAK_CLIENT_ID=insuretech-client`); SDK defaults `keycloak_client_id: "ngapp-platform"`→`"insuretech-platform"` in `infrastructure/{python-sdk/infra_sdk/platform.py,go-sdk/kafka.go (kafka source header),rust-sdk/src/platform.rs,ts-sdk/src/platform.ts,ts-sdk/dist/platform.js}`; `shared/auth/keycloak.go` + `insureportal/shared/auth/keycloak.go`; helm `values.yaml` secret `insuretech-keycloak-credentials`.
- **Migration step:** Changing the realm changes the OIDC issuer URL — **all issued tokens/clients break**. Create the `insuretech` realm, recreate/migrate clients (`insuretech-client`), rotate client secrets, update all relying parties' issuer/audience config, then deprecate the `ngapp` realm. Plan a token-migration / re-login window.

### D6. Mojaloop DFSP ID — `ngapp-dfsp` → `insuretech-dfsp`
- **Renamed in:** `.env.example` (`MOJALOOP_DFSP_ID=insuretech-dfsp`); `mojaloop-integration/` connector and SDK clients (`infrastructure/{python-sdk/infra_sdk/mojaloop_client.py,go-sdk/mojaloop.go,rust-sdk/src/mojaloop.rs,ts-sdk/src/mojaloop.ts}`).
- **Migration step:** The DFSP ID is **registered with the Mojaloop switch**. Re-register `insuretech-dfsp` with the switch / coordinate with the scheme, update participant lookup and callback URLs, then decommission `ngapp-dfsp`. Requires partner/switch coordination — not a unilateral change.

### D7. SMS sender IDs + USSD shortcode — `NGApp` → `InsureTech`, `*384*NGAPP#` → `*384*INSURETECH#`
- **Renamed in:** `.env.example` (`TERMII_SENDER_ID=InsureTech`, `AT_SENDER_ID=InsureTech`); USSD marketing in `pwa-showcase/index.html` (`*384*INSURETECH#`); knowledge-base note in `ai-chatbot/src/knowledge/base.ts` (this comment documents pre-W8 **fabricated** contact details — `+234-800-NGAPP`, `*384*NGAPP#`, `portal.ngapp.ng` — kept as a fabrication warning, values updated to the new brand).
- **Migration step:** Alphanumeric sender IDs (`InsureTech`, 10 chars — within the 11-char limit) must be **re-registered with telcos/aggregators** (Termii, Africa's Talking); lead time applies and customers see the old sender until approved. The USSD shortcode `*384*INSURETECH#` implies a registered shortcode — confirm/re-register with the telco; marketing copy changed in-repo only.

### D8. Observability plumbing (OTEL / Alertmanager / Slack / logs)
- **OTEL** — `monitoring/otel-collector.yaml` + duplicate `insureportal/infrastructure/monitoring/otel-collector.yaml`: namespace `ngapp`→`insuretech`; scrape jobs `ngapp-services`→`insuretech-services`, `ngapp-infrastructure`→`insuretech-infrastructure`, `ngapp-exporters`→`insuretech-exporters`; pod log glob `/var/log/pods/ngapp_*/*`→`…/insuretech_*/*`; OpenSearch indexes `insuretech-logs`/`insuretech-traces`.
- **Alertmanager** — `monitoring/alertmanager.yml`: SMTP domain `ngapp.example.com`→`insuretech.example.com` (`alerts@insuretech.example.com`); Slack channels `#ngapp-critical`→`#insuretech-critical`, `#ngapp-warnings`→`#insuretech-warnings`, `#ngapp-fraud-alerts`→`#insuretech-fraud-alerts`, `#ngapp-network`→`#insuretech-network`.
- **Migration step:** Update Prometheus scrape configs / OTEL pipeline in lockstep with the pod/service renames or scrapes will miss targets. **Slack channels must be created/renamed in Slack** and webhook integrations re-pointed — editing the YAML does not create the channels. Domain `insuretech.example.com` must exist in DNS/SMTP before alerts route.

### D9. Helm chart + release identity — `ngapp-platform` → `insuretech-platform`
- **Renamed in:** `helm/ngapp-platform` → **`helm/insuretech-platform`** (dir) AND duplicate `insureportal/infrastructure/helm/ngapp-platform` → `insureportal/infrastructure/helm/insuretech-platform` (both trees, identical). `Chart.yaml name: insuretech-platform`; helpers `define "ngapp.*"`→`"insuretech.*"`; label `app.kubernetes.io/platform: ngapp`→`insuretech`, `app.kubernetes.io/part-of: ngapp-platform`→`insuretech-platform`; domain `ngapp.example.com`→`insuretech.example.com` (`portal.`/`api.` hosts + TLS secret names); secrets `ngapp-db-credentials`→`insuretech-db-credentials`, `ngapp-redis-credentials`→`insuretech-redis-credentials`, `insuretech-keycloak-credentials`; image repo `insuretech/customer-portal`. Path references updated in `README.md`, `insureportal/README.md`, `docs/DEPLOYMENT.md`, `docs/CONTRIBUTING.md`, `insureportal/docs/CONTRIBUTING.md`, `.env.example`.
- **Other charts:** `helm/{microinsurance-engine,agent-commission-management,enhanced-kyc-kyb,underwriting-engine,notification-service,fraud-detection-engine,multi-tenant-platform,reconciliation-engine,claims-adjudication-engine,audit-trail-system}/values.yaml` (label/env references) renamed consistently.
- **Migration step:** Chart + release-name change = **redeploy/reinstall** (existing `helm release ngapp-platform` history is not carried over). k8s label VALUE changes are selector-relevant — changing label values on live objects can orphan them; roll via fresh deploy rather than in-place label edits. Recreate the renamed secrets (`insuretech-db-credentials`, etc.) before the new release deploys.

### D10. MinIO bucket / Vault path / lakehouse schema — `ngapp-uploads`, `secret/data/ngapp`, `ngapp_analytics`
- **Renamed in:** `.env.example` (`MINIO_BUCKET=insuretech-uploads`, `VAULT_SECRET_PATH=secret/data/insuretech`, `LAKEHOUSE_SCHEMA=insuretech_analytics`); `ai-ml-platform/lakehouse_store/_catalog.json`, `ai-ml-platform/lakehouse_store/_lineage/lineage_state.json`.
- **Migration step:** Data/secrets must be **copied/migrated**, not just renamed: create `insuretech-uploads` bucket + move objects (and update any bucket policy/CORS); write secrets to `secret/data/insuretech` in Vault (copy from `secret/data/ngapp`) and update consumers' `VAULT_SECRET_PATH` before retiring the old path; `CREATE SCHEMA insuretech_analytics` + move lakehouse tables.

### D11. Docker network / service naming — `ngapp-net` → `insuretech-net`
- **Renamed in:** `deploy/staging/docker-compose.staging.yml`, `insureportal/infrastructure/deploy/staging/docker-compose.staging.yml`, `infrastructure/docker/docker-compose.v3.yaml`, `docker-compose.services.yaml`, `docker-compose.infrastructure.yml`, `docker-compose.yaml`, `customer-portal-full/infrastructure/docker-compose.yaml`, `customer-portal-full/docker-compose.production.yml`, `customer-portal-full/k8s/configmap.yaml`, `customer-portal-full/{server.cjs,infrastructure/kafka/event-consumer.js,services/auth-service/index.js,services/naicom-service/index.js,services/payment-service/index.js}`; `infra/redis/redis-staging.conf`; `docker-compose.production.yml`.
- **Migration step:** Network identity change forces **stack recreate** (compose `up` will create `insuretech-net` and restart attached services). Container/service name changes likewise require redeploy. (Note: `docker-compose.production.yml` container names were already `insureportal-*` and are unrelated to the NGApp brand — left as-is.)

### D12. GitHub workflow display name + CI env — "NGApp Platform CI/CD" → "InsureTech Platform CI/CD"
- **Renamed in:** `.github/workflows/platform-ci.yml` (display name; `POSTGRES_USER=insuretech`, `POSTGRES_DB=insuretech_test`, `DATABASE_URL=…/insuretech_test`).
- **Migration step:** Verified via GitHub API on 2026-11-28 that **branch protection on `main` is OFF (HTTP 404)** — no required-check pinning exists, so renaming the workflow display name breaks nothing today. If branch protection / required checks are (re)configured later, pin the NEW check-run names in the same change. Repository secrets contain no NGApp branding (no secret renames needed).

### D13. Published SDK surface — `NGAppInsurance`, `NGAppCheckout`, `@ngapp/*`, `*.ngapp.ng`
- **Renamed in:** `embedded-insurance-sdk/src/{index.ts,client.ts,widgets/quote.ts,widgets/checkout.ts}` — export/class `NGAppInsurance`→`InsureTechInsurance`, global `window.NGAppCheckout`→`window.InsureTechCheckout`; DOM ids `ngapp-quote-widget`→`insuretech-quote-widget`, `ngapp-checkout`→`insuretech-checkout`; npm scope `@ngapp/embedded-insurance-sdk`→`@insuretech/embedded-insurance-sdk` (`embedded-insurance-sdk/package.json`); API base domains `api.ngapp.ng`→`api.insuretech.ng`, `sandbox.ngapp.ng`→`sandbox.insuretech.ng`; `@ngapp/infra-sdk`→`@insuretech/infra-sdk` in `sbom.json` (incl. URL-encoded `%40ngapp`→`%40insuretech` purl); `portal.ngapp.ng`→`portal.insuretech.ng` (ai-chatbot knowledge note).
- **Migration step:** **BREAKING change for SDK consumers.** Publish as a **major version bump** (`@insuretech/embedded-insurance-sdk` v2.0.0) and/or ship a deprecated alias `NGAppInsurance`/`NGAppCheckout` that re-exports the new names for one major cycle. The `@ngapp` → `@insuretech` npm scope rename requires publishing under the new scope and deprecating the old. DNS for `api.insuretech.ng`/`sandbox.insuretech.ng`/`portal.insuretech.ng` must exist before the new base URLs work.

### D14. Go module path — `github.com/munisp/NGApp/…` **and** `github.com/munisp/ngapp/…` → `github.com/munisp/insuretech/…`
- **Renamed in:** **25 `go.mod`** module declarations (16 title-case `NGApp` — the audit's documented set — **plus 9 additional lowercase `ngapp` modules** under `services/go/` that the audit counted as word-boundary class-C: `api-marketplace, dapr-sidecar, fraud-detection, p2p-pools, parametric-evaluator, parametric-insurance, pbac-engine, telematics-engine, ussd-gateway`) and **24 importing `.go` files**; plus the recorded fixture `tests/fixtures/go_quorum_fence_test_results.txt` (module-path strings updated for consistency; fixture is not referenced by any test).
- **Migration step:** The Go module identity changes; downstream consumers importing `github.com/munisp/NGApp/…` or `github.com/munisp/ngapp/…` must update their imports + `go get`. Re-run `go build ./...` / `go vet ./...` / `go mod tidy` per module. **(No Go toolchain in this sandbox — build/vet flagged for CI, see "Validation" below.)** The 40 committed binaries embedding these paths must be rebuilt (Class X, below).

---

## CLASS X — Compiled Go binaries (NOT modified)

**40 committed binaries** embed `ngapp`/`NGApp` strings (370 occurrences total). They were **left untouched** — sed-ing binaries corrupts them. They are **build artifacts** regenerated by the services build; they will carry **stale branding until rebuilt** from the renamed source. Rebuild each service (e.g. `cd <svc> && go build ./...`) and re-commit/re-ship the artifacts. Highest-density: `kyc-kyb-system/kyc-orchestrator-service/server` (319 occurrences).

Binaries (40): `kyc-kyb-system/kyc-orchestrator-service/server`, `fluvio-integration/fluvio-integration`, `mojaloop-integration/mojaloop-integration`, `openappsec-apisix-integration/openappsec-apisix-integration`, `multi-language-service/multi_language_service`, `policy-workflow-go/policy_workflow_go`, `broker-api-service/broker_api_service`, `takaful-module/takaful_module`, `erpnext-integration-service/erpnext_integration_service`, `reinsurance-service/reinsurance-service`, `policy-lifecycle-service/policy-lifecycle-service`, `underwriting-engine/underwriting-engine`, `notification-service/notification_service`, `api-marketplace/api_marketplace`, `premium-finance-service/premium_finance_service`, `disaster-recovery-module/disaster_recovery_module`, `communication-service/communication-service`, `scripts/scripts`, `document-management-system/document_management_system`, `multi-currency-support/multi_currency_support`, `lakehouse-integration/lakehouse_integration`, `insurance-mobile-app/insurance_mobile_app`, `enterprise-mdm/enterprise_mdm`, `insurance-radar/insurance_radar`, `agentic-underwriting/agentic_underwriting`, `openimis-insurance-ops-integrated/openimis_insurance_ops_integrated`, `premium-collection-service/premium-collection-service`, `devops-platform/devops_platform`, `multi-tenant-platform/multi_tenant_platform`, `fraud-detection-go/fraud_detection_go`, `customer-feedback-loop/customer_feedback_loop`, `reconciliation-engine/reconciliation_engine`, `pan-african-ekyc/pan_african_ekyc`, `multi-currency-service/multi_currency_service`, `claims-adjudication-engine/claims-engine`, `claims-adjudication-engine/claims-adjudication-engine`, `nigerian-bank-integrations/nigerian_bank_integrations`, `etherisc-gif-enhanced/etherisc_gif_enhanced`, `usage-based-insurance/usage_based_insurance`, `etherisc-gif-integration/etherisc_gif_integration`.

---

## Repository name & clone URL

- The **GitHub repository is currently `munisp/nextgen-insr`**. The stale README clone URL `github.com/munisp/NGApp.git` was corrected to `github.com/munisp/nextgen-insr.git` (the actual repo), and the quickstart `cd` was corrected to `cd nextgen-insr` to match the clone target (both `README.md` and `insureportal/README.md`).
- **Repository rename to `insuretech` is deferred to program end.** At that point: rename the GitHub repo, update remaining clone URLs from `nextgen-insr` → `insuretech`, and update Go module paths if a new host path is adopted. This rename did **NOT** touch git remotes.
- In-repo brand/structural labels intentionally keep the `InsureTech` brand (e.g. README title `# InsureTech — Nigerian Insurance Platform`, the `InsureTech/` tree-diagram root) — these are conceptual labels, not the on-disk directory name.

## Intentional-history exclusions (deliberately NOT renamed)

- `customer-portal-full/.manus-logs/browserConsole.log` (431 occ) and `customer-portal-full/.manus-logs/sessionReplay.log` (9 occ): historical dev-machine stack-trace artifacts (recorded paths like `/home/ubuntu/repos/NGApp/…`). Renaming them would rewrite recorded history for no benefit (blast-radius item 13). These are the **only** word-boundary `ngapp` occurrences remaining in text files and are excluded from the "zero remaining" proof.
- `CHANGELOG.md`: contains **zero** NGApp occurrences — nothing to preserve or rename (decision recorded here per task instructions).
- `.vite` compiled caches and `scripts/insureportal-tsc-baseline.json`: contain no NGApp tokens; explicitly untouched per task rules.
- The 23 false-positive files (e.g. `server/routers/transactions.ts`, `insureportal/server/routers/transactions.ts`, `drizzle/schema.additions.ts`) match only on substrings inside unrelated identifiers (`pendingApproval`, `underwritingApplications`, etc.) and were correctly left untouched by word-boundary matching.

## Backward-compat / transition summary

Dual-run windows are required where noted: Kafka topics (dual publish/consume), Prometheus metrics (dual-emit optional), Postgres (connection-string rollout), Keycloak (new realm + deprecate old), Temporal (drain + re-register), MinIO/Vault/lakehouse (copy then retire), Mojaloop DFSP + SMS sender IDs + USSD shortcode (external re-registration with lead time), Slack channels (create/rename in Slack), Helm release (redeploy), Go module path + SDK exports (major-version bump / deprecated alias).

---

## Validation (what was run / what is deferred)

- **Rename execution + verification (this sandbox):** word-boundary `\bngapp\b` (ci) remaining = 440 occurrences, **all** in the two excluded `.manus-logs` artifacts; `ngapp_*` prefix remaining = 0; `NGApp[A-Z]` camel remaining = 0; `github.com/munisp/{ngapp,NGApp}` remaining = 0; filenames containing `ngapp` = 0. Substring sweep confirms remaining `ngapp` only in the 40 binaries and the verified false-positive identifiers above.
- **Go build/vet:** **NOT run — no Go toolchain available in this sandbox.** Deferred to CI: run `go build ./...`, `go vet ./...`, `go mod tidy` for the 25 renamed modules and rebuild the 40 binaries.
- **insureportal gates** (`npm ci`, `check-insureportal-parse.mjs`, `check-insureportal-tsc-baseline.mjs`, `vitest`, `vite build`): see `w33r-report.md` for the exact outcomes recorded when run on the renamed tree.
