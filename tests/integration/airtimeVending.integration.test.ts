/**
 * airtimeVending.integration.test.ts — real-DB integration tests for airtime
 * vending honesty guarantees.
 *
 * No airtime provider API is wired into this service, so:
 *   - vend MUST fail loudly with PRECONDITION_FAILED when no provider is
 *     configured (never a fabricated success)
 *   - a failed vend MUST NOT write any transaction row, and definitely no
 *     status='success' row
 *   - getSummary MUST report honest zeros
 *   - anonymous callers write nothing
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, and, count } from "drizzle-orm";
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

  it("no airtime transaction was ever recorded as synchronous success", async () => {
    const db = (await getDb())!;
    const [row] = await db
      .select({ c: count() })
      .from(transactions)
      .where(
        and(eq(transactions.type, "Airtime"), eq(transactions.status, "success"))
      );
    expect(Number(row?.c ?? 0)).toBe(0);
  });

  it("getSummary reports honest zeros", async () => {
    const caller = callerFor(adminUser);
    const summary = await caller.airtimeVending.getSummary({ periodDays: 30 });
    expect(summary.total).toBe(0);
    expect(summary.volumeNGN).toBe(0);
    expect(summary.commissionNGN).toBe(0);
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
