/**
 * mlScoring.integration.test.ts — real-DB integration tests for the ML
 * scoring service honesty contract.
 *
 * No real ML/fraud model is attached, so:
 *   - score / batchScore / explainScore MUST reject with NOT_IMPLEMENTED
 *     ("not configured") instead of returning fabricated scores
 *   - analytics MUST report honest zeros
 *   - list / getSummary MUST reflect real audit_log rows
 *   - anonymous callers are rejected
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { count } from "drizzle-orm";
import { getDb } from "../../server/db";
import { auditLog } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "mlScoring";

async function auditLogCount(): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db.select({ c: count() }).from(auditLog);
  return Number(row?.c ?? 0);
}

describe("mlScoring router (integration, real DB)", () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("scoreTransaction rejects NOT_IMPLEMENTED 'not configured'", async () => {
    const caller = callerFor(adminUser);
    const err = await expectTrpcError(
      caller.mlScoring.scoreTransaction({ transactionId: 1, amount: 5000 }),
      "NOT_IMPLEMENTED"
    );
    expect(err.message).toContain("not configured");
  });

  it("batchScore rejects NOT_IMPLEMENTED 'not configured'", async () => {
    const caller = callerFor(adminUser);
    const err = await expectTrpcError(
      caller.mlScoring.batchScore({ transactionIds: [1, 2, 3] }),
      "NOT_IMPLEMENTED"
    );
    expect(err.message).toContain("not configured");
  });

  it("explainScore rejects NOT_IMPLEMENTED 'not configured'", async () => {
    const caller = callerFor(adminUser);
    const err = await expectTrpcError(
      caller.mlScoring.explainScore({ transactionId: 1 }),
      "NOT_IMPLEMENTED"
    );
    expect(err.message).toContain("not configured");
  });

  it("analytics reports honest zeros", async () => {
    const caller = callerFor(adminUser);
    const analytics = await caller.mlScoring.analytics();
    expect(analytics.totalScored).toBe(0);
    expect(analytics.avgScore).toBe(0);
    expect(analytics.highRiskCount).toBe(0);
    expect(analytics.modelAccuracy).toBe(0);
  });

  it("list and getSummary reflect seeded audit_log rows", async () => {
    const before = await auditLogCount();

    const db = (await getDb())!;
    for (let i = 0; i < 3; i++) {
      await db.insert(auditLog).values({
        action: "ml_scoring_seed",
        resource: "ml_scoring",
        resourceId: `seed-${i}`,
        status: "success",
        metadata: { fixture: true, i },
      });
    }
    expect(await auditLogCount()).toBe(before + 3);

    const caller = callerFor(adminUser);
    const summary = await caller.mlScoring.getSummary();
    expect(Number(summary.totalRecords)).toBe(before + 3);

    const list = await caller.mlScoring.list({ limit: 10, offset: 0 });
    expect(Number(list.total)).toBe(before + 3);
    // Rows are returned newest-first; our three seeds are the most recent.
    const seeded = list.data.filter(r => r.action === "ml_scoring_seed");
    expect(seeded.length).toBe(3);
  });

  it("anonymous callers are rejected from both reads and writes", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.mlScoring.list({ limit: 5, offset: 0 }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(
      caller.mlScoring.scoreTransaction({ transactionId: 1 }),
      "UNAUTHORIZED"
    );
  });
});
