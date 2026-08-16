/**
 * airtimeVending.integration.test.ts — real-DB integration tests for airtime
 * vending honesty guarantees.
 *
 * No airtime provider API is wired into this service, so:
 *   - vend MUST fail loudly with PRECONDITION_FAILED when no provider is
 *     configured (never a fabricated success)
 *   - a failed vend MUST NOT write any transaction row, and definitely no
 *     status='success' row
 *   - getSummary MUST report honest numbers (F-02: exactly the
 *     provider-confirmed successful vends — never phantom volume)
 *   - anonymous callers write nothing
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and, count, sql, gte } from "drizzle-orm";
import { getDb } from "../../server/db";
import { transactions } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "airtimeVending";
const VEND_REFERENCE = "AIRT-IT-00001";
const ANON_REFERENCE = "AIRT-IT-ANON1";

const PROVIDER_ENV_VARS = [
  "AIRTIME_PROVIDER_URL",
  "AIRTIME_PROVIDER_API_KEY",
  "VTPASS_API_KEY",
  "RELOADLY_API_KEY",
] as const;

async function airtimeTxCount(): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ c: count() })
    .from(transactions)
    .where(eq(transactions.type, "Airtime"));
  return Number(row?.c ?? 0);
}

describe("airtimeVending router (integration, real DB)", () => {
  beforeAll(() => {
    resetAssertionCount();
    // Ensure NO airtime provider is configured, regardless of the outer env.
    for (const key of PROVIDER_ENV_VARS) delete process.env[key];
  });

  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("vend throws PRECONDITION_FAILED when no provider is configured", async () => {
    const caller = callerFor(adminUser);
    const before = await airtimeTxCount();

    await expectTrpcError(
      caller.airtimeVending.vend({
        agentId: 1,
        network: "MTN",
        phoneNumber: "08031234567",
        amountNGN: 100,
        reference: VEND_REFERENCE,
      }),
      "PRECONDITION_FAILED"
    );

    // The failed vend wrote nothing at all.
    expect(await airtimeTxCount()).toBe(before);
  });

  it("no rows exist for the failed vend reference", async () => {
    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ref, VEND_REFERENCE));
    expect(rows.length).toBe(0);
  });

  // Refined for F-02 (order-independent): the original global-zero assertion
  // held only because no provider could ever fulfil a vend. With provider
  // dispatch wired (F-02), a vend CAN reach success — but ONLY after
  // provider-confirmed fulfilment (metadata.providerStatus = 'completed',
  // set by the status-lookup resolution path). The honesty invariant is now
  // STRONGER: no successful Airtime transaction exists without provider
  // confirmation — no synchronous or fabricated success anywhere.
  it("no airtime transaction reaches success without provider-confirmed fulfilment", async () => {
    const db = (await getDb())!;
    const rows = await db
      .select({ c: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "Airtime"),
          eq(transactions.status, "success"),
          sql`(metadata->>'providerStatus') IS DISTINCT FROM 'completed'`
        )
      );
    expect(Number(rows[0]?.c ?? 0)).toBe(0);
  });

  it("getSummary counts exactly the provider-confirmed successful vends (no phantom volume)", async () => {
    const db = (await getDb())!;
    const since = new Date(Date.now() - 30 * 86400000);
    const [expected] = await db
      .select({
        total: count(),
        volume: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        commission: sql<string>`COALESCE(SUM(CAST(commission AS NUMERIC)), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "Airtime"),
          eq(transactions.status, "success"),
          sql`(metadata->>'providerStatus') = 'completed'`,
          gte(transactions.createdAt, since)
        )
      );
    const caller = callerFor(adminUser);
    const summary = await caller.airtimeVending.getSummary({ periodDays: 30 });
    expect(summary.total).toBe(Number(expected?.total ?? 0));
    expect(summary.volumeNGN).toBeCloseTo(Number(expected?.volume ?? 0), 2);
    expect(summary.commissionNGN).toBeCloseTo(Number(expected?.commission ?? 0), 2);
  });

  it("anonymous caller gets UNAUTHORIZED and writes nothing", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.airtimeVending.vend({
        agentId: 1,
        network: "Glo",
        phoneNumber: "09051234567",
        amountNGN: 200,
        reference: ANON_REFERENCE,
      }),
      "UNAUTHORIZED"
    );

    const db = (await getDb())!;
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ref, ANON_REFERENCE));
    expect(rows.length).toBe(0);
  });
});
