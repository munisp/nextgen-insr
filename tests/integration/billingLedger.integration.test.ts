/**
 * billingLedger.integration.test.ts — F-12 (wave-3) coverage for the
 * rewired-from-mockware billing/audit/schema-tracking procedures.
 *
 * The previous implementations returned hardcoded fixtures (transactionCount
 * 150, grossFees 22500, "CLIENT-001"/28%, MIG-001..003) or agent-registry
 * rows for security concepts. These tests assert the REAL behavior against
 * the REAL PG (PGlite) schema: values must match seeded truth, not literals.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  platformBillingLedger,
  tenantBillingConfig,
} from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "billingLedger";
const REF_PREFIX = "F12W3-";

async function seedSplit(
  ref: string,
  opts: { grossFee: number; platform: number; client: number; createdAt?: Date }
) {
  const db = (await getDb())!;
  await db.insert(platformBillingLedger).values({
    transactionId: Math.floor(Math.random() * 1e9),
    transactionRef: ref,
    transactionType: "cash_out",
    agentId: 1,
    grossAmount: String(opts.grossFee * 10),
    grossFee: String(opts.grossFee),
    agentCommission: "0",
    switchFee: "0",
    aggregatorFee: "0",
    platformNetFee: String(opts.platform),
    billingModel: "revenue_share",
    clientRevenue: String(opts.client),
    platformRevenue: String(opts.platform),
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  });
}

describe("billingLedger (F-12 wave-3, real PG)", () => {
  beforeAll(() => resetAssertionCount());
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("recordSplit persists a real ledger row (no fabricated sync claims)", async () => {
    const caller = callerFor(adminUser);
    const ref = REF_PREFIX + "RS-1";
    const row = await caller.billingLedger.recordSplit({
      transactionId: 424242,
      transactionRef: ref,
      transactionType: "cash_out",
      grossAmount: 1000,
      grossFee: 100,
      clientShare: 70,
      platformShare: 30,
      agentCommission: 10,
      switchFee: 5,
      aggregatorFee: 1,
      billingModel: "revenue_share",
      agentId: 1,
    });
    expect(row.id).toBeGreaterThan(0);
    // Real DB row exists with the exact submitted economics.
    const db = (await getDb())!;
    const [persisted] = await db
      .select()
      .from(platformBillingLedger)
      .where(eq(platformBillingLedger.transactionRef, ref));
    expect(persisted).toBeDefined();
    expect(Number(persisted.grossFee)).toBe(100);
    expect(Number(persisted.platformRevenue)).toBe(30);
    expect(Number(persisted.clientRevenue)).toBe(70);
    expect(Number(persisted.platformNetFee)).toBe(30 - 5 - 1);
    // The old facade's fabricated fields are gone from the contract.
    expect((row as Record<string, unknown>).syncedToTigerBeetle).toBeUndefined();
    expect((row as Record<string, unknown>).syncedToOpenSearch).toBeUndefined();
  });

  it("recordSplit rejects duplicate transactionRef loudly (idempotency)", async () => {
    const caller = callerFor(adminUser);
    const ref = REF_PREFIX + "RS-1"; // same ref as previous test
    await expect(
      caller.billingLedger.recordSplit({
        transactionId: 424243,
        transactionRef: ref,
        transactionType: "cash_out",
        grossAmount: 1000,
        grossFee: 100,
        clientShare: 70,
        platformShare: 30,
        agentCommission: 10,
        switchFee: 5,
        billingModel: "revenue_share",
        agentId: 1,
      })
    ).rejects.toThrow();
  });

  it("query returns seeded rows with real pagination totals", async () => {
    const caller = callerFor(adminUser);
    const ref = REF_PREFIX + "Q-1";
    await seedSplit(ref, { grossFee: 40, platform: 12, client: 28 });
    const result = await caller.billingLedger.query({
      transactionType: "cash_out",
      page: 1,
      pageSize: 500,
    });
    const found = result.entries.find(
      (e) => e.transactionRef === ref
    );
    expect(found).toBeDefined();
    expect(Number(found!.grossFee)).toBe(40);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("aggregateRevenue sums match seeded truth (not fixture literals)", async () => {
    const caller = callerFor(adminUser);
    const before = await caller.billingLedger.aggregateRevenue({
      period: "daily",
    });
    await seedSplit(REF_PREFIX + "AGG-1", { grossFee: 50, platform: 15, client: 35 });
    await seedSplit(REF_PREFIX + "AGG-2", { grossFee: 30, platform: 9, client: 21 });
    const after = await caller.billingLedger.aggregateRevenue({
      period: "daily",
    });
    expect(after.totals.totalGrossFees - before.totals.totalGrossFees).toBe(80);
    expect(after.totals.totalPlatformRevenue - before.totals.totalPlatformRevenue).toBe(24);
    expect(after.totals.totalClientRevenue - before.totals.totalClientRevenue).toBe(56);
    expect(after.totals.totalTransactions - before.totals.totalTransactions).toBe(2);
    // The old fixtures must never resurface.
    expect(after.totals.totalTransactions).not.toBe(150);
  });

  it("aggregateRevenue with tenantId is tenant-scoped (F-12 wave-5, B15)", async () => {
    // Tenant scoping is now DELIVERED (platform_billing_ledger.tenant_id,
    // migration 0055) — the old NOT_IMPLEMENTED assertion is replaced by a
    // known-answer scoping assertion: an admin asking for a specific tenant
    // sees only that tenant's rows.
    const caller = callerFor(adminUser);
    const tenantId = 987100;
    const before = await caller.billingLedger.aggregateRevenue({
      period: "daily",
      tenantId,
    });
    const db = (await getDb())!;
    await db.insert(platformBillingLedger).values({
      transactionId: Math.floor(Math.random() * 1e9),
      transactionRef: REF_PREFIX + "TEN-AGG-1",
      transactionType: "cash_out",
      agentId: 1,
      grossAmount: "1000",
      grossFee: "100",
      agentCommission: "0",
      switchFee: "0",
      aggregatorFee: "0",
      platformNetFee: "30",
      billingModel: "revenue_share",
      clientRevenue: "70",
      platformRevenue: "30",
      tenantId,
    });
    const after = await caller.billingLedger.aggregateRevenue({
      period: "daily",
      tenantId,
    });
    expect(after.totals.totalGrossFees - before.totals.totalGrossFees).toBe(100);
    expect(after.totals.totalTransactions - before.totals.totalTransactions).toBe(1);
    // A different tenant does not see the row.
    const other = await caller.billingLedger.aggregateRevenue({
      period: "daily",
      tenantId: 987101,
    });
    expect(other.totals.totalTransactions).toBe(0);
  });

  it("getLiveSplitMetrics reflects today's seeded rows", async () => {
    const caller = callerFor(adminUser);
    const before = await caller.billingLedger.getLiveSplitMetrics({});
    const ref = REF_PREFIX + "LIVE-1";
    await seedSplit(ref, { grossFee: 200, platform: 60, client: 140 });
    const after = await caller.billingLedger.getLiveSplitMetrics({});
    expect(after.today.transactionCount - before.today.transactionCount).toBe(1);
    expect(after.today.grossFees - before.today.grossFees).toBe(200);
    expect(after.today.platformShare - before.today.platformShare).toBe(60);
    expect(after.thisMonth.transactionCount - before.thisMonth.transactionCount).toBe(1);
  });

  it("getClientBillingConfig returns the real tenant config or null", async () => {
    const db = (await getDb())!;
    const tenantId = 987001;
    await db
      .insert(tenantBillingConfig)
      .values({
        tenantId,
        billingModel: "subscription",
        subscriptionConfig: { monthlyFee: 5000 },
        provisionedBy: 1,
      })
      .onConflictDoNothing({ target: tenantBillingConfig.tenantId });
    const caller = callerFor(adminUser);
    const found = await caller.billingLedger.getClientBillingConfig({ tenantId });
    expect(found).not.toBeNull();
    expect(found!.billingModel).toBe("subscription");
    // Missing tenant -> honest null, not a fabricated "CLIENT-001" contract.
    const missing = await caller.billingLedger.getClientBillingConfig({
      tenantId: 987002,
    });
    expect(missing).toBeNull();
    // client-keyed lookup is not delivered -> loud.
    await expect(
      caller.billingLedger.getClientBillingConfig({ clientId: "CLIENT-001" })
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("securityAudit.getAuditChain verifies the REAL audit_log hash chain", async () => {
    const caller = callerFor(adminUser);
    const result = await caller.securityAudit.getAuditChain({ maxRows: 1000 });
    expect(typeof result.chainValid).toBe("boolean");
    expect(result.totalRows).toBeGreaterThanOrEqual(0);
    expect(result.checkedRows + result.unchainedRows).toBeLessThanOrEqual(
      result.totalRows
    );
    if (!result.chainValid) {
      // Loud, structured failure detail — never a silent pass.
      expect(result.failure).not.toBeNull();
    }
  });

  it("securityAudit stub-payload procedures now fail loud", async () => {
    const caller = callerFor(adminUser);
    // B6 (zero-undelivered-scope, W2d): getDDoSStatus is now DELIVERED —
    // real in-repo request-rate telemetry (ddosTelemetryMiddleware +
    // ddos_rate_windows, migration 0060). Order-independent contract: it
    // either returns the real status (windows recorded by
    // ddosTelemetry.integration.test.ts first) or fails loud
    // PRECONDITION_FAILED on an empty store. Never NOT_IMPLEMENTED again.
    const ddos = await caller.securityAudit.getDDoSStatus({}).then(
      r => ({ resolved: true as const, status: r.status }),
      (e: { code?: string }) => ({ resolved: false as const, code: e.code })
    );
    if (ddos.resolved) {
      expect(["no_anomalies", "threshold_breaches_observed"]).toContain(
        ddos.status
      );
    } else {
      expect(ddos.code).toBe("PRECONDITION_FAILED");
    }
    // B5 (zero-undelivered-scope): getBackupStatus is now DELIVERED against
    // the real backup_jobs catalog — it must never again answer
    // NOT_IMPLEMENTED. Order-independent contract: it either returns a real
    // latest job row (when backupCatalog.integration.test.ts seeded the
    // shared database first) or fails loud PRECONDITION_FAILED with the
    // honest 'no backups recorded' message on an empty catalog.
    const backupStatus = await caller.securityAudit
      .getBackupStatus({})
      .then(
        r => ({ resolved: true as const, latest: r.latest }),
        (e: { code?: string }) => ({ resolved: false as const, code: e.code })
      );
    if (backupStatus.resolved) {
      expect(["running", "success", "failed"]).toContain(
        backupStatus.latest.status
      );
    } else {
      expect(backupStatus.code).toBe("PRECONDITION_FAILED");
    }
    // B4 (zero-undelivered-scope, W2d): getFileIntegrity is now DELIVERED —
    // real sha256 baseline + filesystem diff (server/lib/fileIntegrity.ts,
    // migration 0060). Order-independent contract: a real diff result or
    // PRECONDITION_FAILED (NO_BASELINE / allowlist unconfigured).
    const fim = await caller.securityAudit.getFileIntegrity({}).then(
      r => ({ resolved: true as const, status: r.status }),
      (e: { code?: string }) => ({ resolved: false as const, code: e.code })
    );
    if (fim.resolved) {
      expect(["clean", "violations_detected"]).toContain(fim.status);
    } else {
      expect(fim.code).toBe("PRECONDITION_FAILED");
    }
    // B1 (zero-undelivered-scope, W2a): getPolicies is now DELIVERED — it
    // reads the real pbac_policies store (seeded by parsing the actual
    // infra/permify/schema.perm via syncPbacPolicies). On this suite-shared
    // database the store is EMPTY unless the pbacScanner suite synced it, so
    // the honest contract is order-independent: real policy rows OR the
    // fail-loud empty-store error naming the sync remedy (never the old
    // NOT_IMPLEMENTED stub).
    const policies = await caller.securityAudit.getPolicies({}).then(
      r => ({ resolved: true as const, rows: r }),
      (e: { code?: string; message?: string }) => ({
        resolved: false as const,
        code: e.code,
        message: e.message ?? "",
      })
    );
    if (policies.resolved) {
      expect(Array.isArray(policies.rows)).toBe(true);
    } else {
      expect(policies.code).toBe("PRECONDITION_FAILED");
      expect(policies.message).toMatch(/pbac_policies store is empty/);
      expect(policies.message).toMatch(/syncPbacPolicies/);
    }
    // B3 (zero-undelivered-scope): getMitigations is now DELIVERED — it reads
    // the real security_mitigations tracker table and returns rows instead of
    // failing loud. The remaining procedures above stay NOT_IMPLEMENTED.
    const mitigations = await caller.securityAudit.getMitigations({});
    expect(Array.isArray(mitigations)).toBe(true);
    // B2 (zero-undelivered-scope, W2a): runSecurityScan is now DELIVERED —
    // real scanner probing at call time. CI has no trivy/semgrep binary, so
    // the honest outcome here is the fail-loud probe report; a host WITH a
    // scanner returns a real run summary instead. Never the old echoed
    // {success:true} and never NOT_IMPLEMENTED.
    const scan = await caller.securityAudit.runSecurityScan({}).then(
      r => ({ resolved: true as const, summary: r }),
      (e: { code?: string; message?: string }) => ({
        resolved: false as const,
        code: e.code,
        message: e.message ?? "",
      })
    );
    if (scan.resolved) {
      expect(scan.summary.status).toBe("completed");
      expect(scan.summary.totalFindings).toBeGreaterThanOrEqual(0);
    } else {
      expect(scan.code).toBe("PRECONDITION_FAILED");
      expect(scan.message).toMatch(/no security scanner is available/);
    }
  });

  it("dbSchemaPush.getHistory/getSummary report real journal state", async () => {
    const caller = callerFor(adminUser);
    const history = await caller.dbSchemaPush.getHistory({ limit: 5 });
    expect(history.migrations.length).toBeLessThanOrEqual(5);
    // Tags are real drizzle journal tags, never the MIG-001..003 fixtures.
    for (const m of history.migrations) {
      expect(m.version).not.toMatch(/^2026\.05\.2[678]\.001$/);
      expect(m.status).toBe("applied");
    }
    const summary = await caller.dbSchemaPush.getSummary();
    expect(summary.totalMigrations).toBeGreaterThanOrEqual(0);
    expect(summary.totalMigrations).not.toBe(47);
    if (history.migrations.length > 0) {
      expect(summary.currentVersion).toBe(history.migrations[0].version);
    } else {
      expect(summary.currentVersion).toBeNull();
    }
  });
});
