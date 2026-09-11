-- F-12 (wave-5, B15): tenant attribution for the platform billing ledger.
-- Additive only: a nullable tenant_id column plus its index. Existing rows
-- keep tenant_id = NULL (pre-scoping platform-wide history); new rows are
-- stamped server-side from the agent's tenant (agents.tenantId) at
-- recordSplit time — never from client input. Backs the tenant-scoped
-- billingLedger.query / aggregateRevenue / getLiveSplitMetrics variants.
ALTER TABLE "platform_billing_ledger" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
CREATE INDEX IF NOT EXISTS "pbl_tenant_id_idx" ON "platform_billing_ledger" ("tenant_id");
