/**
 * billingLedgerTenantScoping.integration.test.ts — F-12 (wave-5, B15)
 * tenant-scoped billing ledger views against the REAL PG (PGlite) schema.
 *
 * Authorization semantics under test (all session-derived, never
 * client-supplied):
 *   - admin               -> sees all tenants; may filter by any tenantId
 *   - user with tenantId  -> forced to their own tenant; foreign tenantId
 *                            request is FORBIDDEN
 *   - user without tenant -> FORBIDDEN with the exact reason
 * recordSplit stamps platform_billing_ledger.tenant_id SERVER-SIDE from
 * agents.tenantId — the mutation input carries no tenant field at all.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  agents,
  platformBillingLedger,
  tenantBillingConfig,
} from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "billingLedgerTenantScoping";
const TENANT_A = 987200;
const TENANT_B = 987201;
const REF_PREFIX = "F12W5-TEN-";

const tenantUserA: TestUser = {
  id: 91010,
  email: "tenant-a@integration.local",
  name: "Tenant A User",
  role: "user",
  tenantId: TENANT_A,
};
const platformUser: TestUser = {
  id: 91011,
  email: "platform-user@integration.local",
  name: "Platform User",
  role: "user",
  tenantId: null,
};

async function seedAgent(code: string, tenantId: number | null) {
  const db = (await getDb())!;
  const [a] = await db
    .insert(agents)
    .values({
      agentId: code,
      name: `Tenant Scope ${code}`,
      phone: `081${String(Math.floor(10000000 + Math.random() * 89999999))}`,
      pinHash: "f".repeat(64),
      isActive: true,
      premiumReserve: "0",
      tenantId,
    })
    .returning();
  return a!.id;
}

async function seedLedgerRow(
  ref: string,
  tenantId: number | null,
  grossFee: number
) {
  const db = (await getDb())!;
  await db.insert(platformBillingLedger).values({
    transactionId: Math.floor(Math.random() * 1e9),
    transactionRef: ref,
    transactionType: "cash_out",
    agentId: 1,
    grossAmount: String(grossFee * 10),
    grossFee: String(grossFee),
    agentCommission: "0",
    switchFee: "0",
    aggregatorFee: "0",
    platformNetFee: String(grossFee * 0.3),
    billingModel: "revenue_share",
    clientRevenue: String(grossFee * 0.7),
    platformRevenue: String(grossFee * 0.3),
    tenantId,
  });
}

describe("billingLedger tenant scoping (F-12 wave-5, B15, real PG)", () => {
  beforeAll(() => resetAssertionCount());
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("recordSplit stamps tenant_id SERVER-SIDE from agents.tenantId", async () => {
    const agentPk = await seedAgent("AGT-TEN-A1", TENANT_A);
    const caller = callerFor(adminUser);
    const ref = REF_PREFIX + "RS-A1";
    const row = await caller.billingLedger.recordSplit({
      transactionId: Math.floor(Math.random() * 1e9),
      transactionRef: ref,
      transactionType: "cash_out",
      grossAmount: 1000,
      grossFee: 100,
      clientShare: 70,
      platformShare: 30,
      agentCommission: 10,
      switchFee: 5,
      aggregatorFee: 0,
      billingModel: "revenue_share",
      agentId: agentPk,
    });
    expect(row.tenantId).toBe(TENANT_A);
    const db = (await getDb())!;
    const [persisted] = await db
      .select()
      .from(platformBillingLedger)
      .where(eq(platformBillingLedger.transactionRef, ref));
    expect(persisted.tenantId).toBe(TENANT_A);
  });

  it("recordSplit with an unknown agent records tenant_id NULL (no fabrication)", async () => {
    const caller = callerFor(adminUser);
    const ref = REF_PREFIX + "RS-NULL";
    const row = await caller.billingLedger.recordSplit({
      transactionId: Math.floor(Math.random() * 1e9),
      transactionRef: ref,
      transactionType: "cash_out",
      grossAmount: 100,
      grossFee: 10,
      clientShare: 7,
      platformShare: 3,
      agentCommission: 1,
      switchFee: 0,
      aggregatorFee: 0,
      billingModel: "revenue_share",
      agentId: 999999999, // no such agent -> no tenant to attribute
    });
    expect(row.tenantId).toBeNull();
  });

  it("admin query sees all tenants; tenant-filtered query returns only that tenant", async () => {
    const caller = callerFor(adminUser);
    await seedLedgerRow(REF_PREFIX + "Q-A", TENANT_A, 40);
    await seedLedgerRow(REF_PREFIX + "Q-B", TENANT_B, 60);
    const all = await caller.billingLedger.query({ page: 1, pageSize: 500 });
    const refs = all.entries.map((e) => e.transactionRef);
    expect(refs).toContain(REF_PREFIX + "Q-A");
    expect(refs).toContain(REF_PREFIX + "Q-B");
    const onlyA = await caller.billingLedger.query({
      tenantId: TENANT_A,
      page: 1,
      pageSize: 500,
    });
    const refsA = onlyA.entries.map((e) => e.transactionRef);
    expect(refsA).toContain(REF_PREFIX + "Q-A");
    expect(refsA).not.toContain(REF_PREFIX + "Q-B");
  });

  it("tenant-scoped caller sees ONLY its own tenant rows (session-derived)", async () => {
    const caller = callerFor(tenantUserA);
    const result = await caller.billingLedger.query({
      page: 1,
      pageSize: 500,
    });
    const refs = result.entries.map((e) => e.transactionRef);
    expect(refs).toContain(REF_PREFIX + "Q-A");
    expect(refs).not.toContain(REF_PREFIX + "Q-B");
    // Every returned row genuinely belongs to TENANT_A.
    for (const e of result.entries) {
      expect(e.tenantId).toBe(TENANT_A);
    }
  });

  it("tenant-scoped caller requesting a FOREIGN tenantId is FORBIDDEN", async () => {
    const caller = callerFor(tenantUserA);
    await expect(
      caller.billingLedger.query({ tenantId: TENANT_B, page: 1, pageSize: 50 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.billingLedger.aggregateRevenue({
        period: "daily",
        tenantId: TENANT_B,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.billingLedger.getLiveSplitMetrics({ tenantId: TENANT_B })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.billingLedger.getClientBillingConfig({ tenantId: TENANT_B })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("non-admin WITHOUT a tenant membership is FORBIDDEN with the exact reason", async () => {
    const caller = callerFor(platformUser);
    const err = await expectTrpcError(
      caller.billingLedger.query({ page: 1, pageSize: 50 }),
      "FORBIDDEN"
    );
    expect(err.message).toContain("users.tenantId IS NULL");
  });

  it("aggregateRevenue + getLiveSplitMetrics are tenant-scoped for tenant callers", async () => {
    const db = (await getDb())!;
    await db
      .insert(tenantBillingConfig)
      .values({
        tenantId: TENANT_A,
        billingModel: "revenue_share",
        provisionedBy: 1,
      })
      .onConflictDoNothing({ target: tenantBillingConfig.tenantId });
    const caller = callerFor(tenantUserA);
    const before = await caller.billingLedger.aggregateRevenue({
      period: "daily",
    });
    await seedLedgerRow(REF_PREFIX + "AGG-A", TENANT_A, 50);
    await seedLedgerRow(REF_PREFIX + "AGG-B", TENANT_B, 70);
    const after = await caller.billingLedger.aggregateRevenue({
      period: "daily",
    });
    // Only the TENANT_A row (50) enters the tenant caller's aggregate.
    expect(after.totals.totalGrossFees - before.totals.totalGrossFees).toBe(50);
    expect(after.totals.totalTransactions - before.totals.totalTransactions).toBe(1);
    const liveBefore = await caller.billingLedger.getLiveSplitMetrics({});
    await seedLedgerRow(REF_PREFIX + "LIVE-A", TENANT_A, 200);
    const liveAfter = await caller.billingLedger.getLiveSplitMetrics({});
    expect(liveAfter.today.grossFees - liveBefore.today.grossFees).toBe(200);
  });

  it("getClientBillingConfig: tenant caller reads only its own config; admin any", async () => {
    const tenantCaller = callerFor(tenantUserA);
    const own = await tenantCaller.billingLedger.getClientBillingConfig({});
    expect(own).not.toBeNull();
    expect(own!.tenantId).toBe(TENANT_A);
    // Admin can read any tenant's config (honest null when absent).
    const admin = callerFor(adminUser);
    const adminView = await admin.billingLedger.getClientBillingConfig({
      tenantId: TENANT_A,
    });
    expect(adminView).not.toBeNull();
    const missing = await admin.billingLedger.getClientBillingConfig({
      tenantId: 987299,
    });
    expect(missing).toBeNull();
  });

  it("regularUser (no tenantId field set) is denied tenant-scoped billing", async () => {
    // regularUser has tenantId undefined — same denial path as NULL.
    const caller = callerFor(regularUser);
    await expect(
      caller.billingLedger.getLiveSplitMetrics({})
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
