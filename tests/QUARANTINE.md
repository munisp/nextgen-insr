# Test Quarantine Registry

Central, auditable registry of tests excluded from CI gating. Entries require
assurance-lead approval, one file per entry. A test leaves quarantine only when
its re-enable condition is met.

| Date | File | Reason | Evidence | Re-enable condition | Owner action |
|------|------|--------|----------|---------------------|--------------|
| 2026-08-16 | `server/sprint73-resilience.test.ts` | Asserts existence of 8 "sprint-73 connectivity-resilience" microservices (services/go/connectivity-resilience, connection-multiplexer; services/rust/bandwidth-optimizer, offline-ledger, adaptive-compression; services/python/network-quality-predictor, sms-transaction-bridge, connectivity-analytics) that were never merged. Test arrived during the broken-CI window (ci.yml 0-jobs startup failure) so it was never gated. All assertions left intact; writing the services from scratch to satisfy the test would be fabrication-grade mockware. | GitHub path-commit API returns zero commits for all 8 directories (checked 2026-08-16); last green CI (2026-07-14, c605a064) contains neither the services nor this test file. | All 8 directories exist on main with the asserted deliverables AND are wired into CI; then remove the `vitest.config.ts` exclude entry and this row. | F-11 (external cap): owner to deliver the sprint-73 resilience services. |
