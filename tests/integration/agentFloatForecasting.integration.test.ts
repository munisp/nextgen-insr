/**
 * agentFloatForecasting.integration.test.ts — B17 (zero-undelivered-scope)
 * integration coverage for the real trailing-average float forecast behind
 * agentFloatForecasting.getForecast / triggerReplenishment, computed from
 * the transactions table (Cash In / Cash Out per agent over the trailing
 * window) against the REAL PG (PGlite) schema — no mocks.
 *
 * All forecast assertions are scoped (agentId input) to this file's own
 * agents, so rows seeded by other integration files can never pollute the
 * known answers.
 *
 * Seeded truth (agent AGT-W1C-F1, premiumReserve 20000):
 *   7 distinct trailing days (today … today-6), each with one successful
 *   Cash Out 10000 + one successful Cash In 4000.
 *   Plus decoys that must NOT affect the answer: one FAILED Cash Out
 *   999999, one PENDING Cash In 999999, one successful Transfer 999999.
 * → windowDays = 7 (horizon 7), cashOut 70000, cashIn 28000
 * → avgDailyNetOutflow = 42000/7 = 6000, predictedNeed = 6000*7 = 42000
 * → shortfall = 42000 − 20000 = 22000, risk 'critical' (shortfall ≥ float)
 * → avgDailyVolume = 98000/7 = 14000, activeDays = 7
 *
 * Agent AGT-W1C-F2 has only 3 distinct days of history → getForecast fails
 * loud PRECONDITION_FAILED / INSUFFICIENT_DATA with the actual day count.
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";

import { agents, transactions } from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "agentFloatForecasting";
const AGENT_F1 = "AGT-W1C-F1";
const AGENT_F2 = "AGT-W1C-F2";

let f1Pk: number;

async function seedAgent(
  agentId: string,
  name: string,
  premiumReserve: string
): Promise<number> {
  const db = (await getDb())!;
  // Reused-database safety: never delete (other tables reference agents.id);
  // update the balance to seeded truth when the row already exists.
  const [existing] = await db
    .select()
    .from(agents)
    .where(eq(agents.agentId, agentId))
    .limit(1);
  if (existing) {
    await db
      .update(agents)
      .set({ premiumReserve })
      .where(eq(agents.id, existing.id));
    return existing.id;
  }
  const [a] = await db
    .insert(agents)
    .values({
      agentId,
      name,
      phone: "08011112222",
      pinHash: "f".repeat(64),
      isActive: true,
      premiumReserve,
    })
    .returning();
  return a!.id;
}

async function seedFlows() {
  const db = (await getDb())!;
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const values = [];
  for (let k = 0; k < 7; k++) {
    const at = new Date(now - k * dayMs);
    values.push(
      {
        ref: `W1CF1-${k}-OUT`,
        agentId: f1Pk,
        type: "Cash Out" as const,
        amount: "10000.00",
        status: "success" as const,
        createdAt: at,
        updatedAt: at,
      },
      {
        ref: `W1CF1-${k}-IN`,
        agentId: f1Pk,
        type: "Cash In" as const,
        amount: "4000.00",
        status: "success" as const,
        createdAt: at,
        updatedAt: at,
      }
    );
  }
  // Decoys: wrong status / wrong type — must be excluded from the answer.
  values.push(
    {
      ref: "W1CF1-DECOY-FAILED",
      agentId: f1Pk,
      type: "Cash Out" as const,
      amount: "999999.00",
      status: "failed" as const,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
    {
      ref: "W1CF1-DECOY-PENDING",
      agentId: f1Pk,
      type: "Cash In" as const,
      amount: "999999.00",
      status: "pending" as const,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
    {
      ref: "W1CF1-DECOY-TRANSFER",
      agentId: f1Pk,
      type: "Transfer" as const,
      amount: "999999.00",
      status: "success" as const,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  );
  await db.delete(transactions).where(eq(transactions.agentId, f1Pk));
  await db.insert(transactions).values(values);

  // Thin history for F2: 3 distinct days only.
  const f2Pk = await seedAgent(AGENT_F2, "W1C Forecast Thin", "5000.00");
  await db.delete(transactions).where(eq(transactions.agentId, f2Pk));
  await db.insert(transactions).values(
    [0, 1, 2].map(k => ({
      ref: `W1CF2-${k}-OUT`,
      agentId: f2Pk,
      type: "Cash Out" as const,
      amount: "3000.00",
      status: "success" as const,
      createdAt: new Date(now - k * dayMs),
      updatedAt: new Date(now - k * dayMs),
    }))
  );
}

describe("agentFloatForecasting router (B17)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    f1Pk = await seedAgent(AGENT_F1, "W1C Forecast Agent", "20000.00");
    await seedFlows();
  });

  afterAll(() => {
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("rejects anonymous callers (UNAUTHORIZED)", async () => {
    const caller = callerFor(null);
    await expectTrpcError(
      caller.agentFloatForecasting.getForecast({ days: 7 }),
      "UNAUTHORIZED"
    );
  });

  it("getForecast returns the exact trailing-average known answer", async () => {
    const caller = callerFor(regularUser);
    const res = await caller.agentFloatForecasting.getForecast({
      days: 7,
      agentId: AGENT_F1,
    });
    expect(res.method).toBe("trailing_average");
    expect(res.windowDays).toBe(7);
    expect(res.horizonDays).toBe(7);
    expect(res.minHistoryDays).toBe(7);
    expect(res.historyDayCount).toBe(7);
    // 14 successful Cash In/Cash Out rows (decoys excluded)
    expect(res.dataPoints).toBe(14);
    expect(res.forecasts.length).toBe(1);
    const f = res.forecasts[0]!;
    expect(f.id).toBe(AGENT_F1);
    expect(f.currentFloat).toBe(20000);
    expect(f.avgDailyNetOutflow).toBe(6000);
    expect(f.predictedNeed).toBe(42000);
    expect(f.shortfall).toBe(22000);
    expect(f.risk).toBe("critical");
    expect(f.avgDailyVolume).toBe(14000);
    expect(f.activeDays).toBe(7);
  });

  it("widens a 1-day horizon to the 7-day minimum window and reports it", async () => {
    const caller = callerFor(regularUser);
    const res = await caller.agentFloatForecasting.getForecast({
      days: 1,
      agentId: AGENT_F1,
    });
    expect(res.windowDays).toBe(7);
    expect(res.horizonDays).toBe(1);
    // projected one day forward: 6000 * 1 < float → no shortfall, low risk
    expect(res.forecasts[0]!.predictedNeed).toBe(6000);
    expect(res.forecasts[0]!.shortfall).toBe(0);
    expect(res.forecasts[0]!.risk).toBe("low");
  });

  it("fails loud INSUFFICIENT_DATA with the actual day count under 7 days of history", async () => {
    const caller = callerFor(regularUser);
    const err = await expectTrpcError(
      caller.agentFloatForecasting.getForecast({ days: 7, agentId: AGENT_F2 }),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("INSUFFICIENT_DATA");
    expect(err.message).toContain("3 day(s)");
    expect(err.message).toContain("minimum 7");
  });

  it("fails loud NOT_FOUND for an unknown agent scope", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.agentFloatForecasting.getForecast({
        days: 7,
        agentId: "AGT-W1C-DOES-NOT-EXIST",
      }),
      "NOT_FOUND"
    );
  });

  it("rejects non-admin replenishment (FORBIDDEN)", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.agentFloatForecasting.triggerReplenishment({
        agentId: AGENT_F1,
        amount: 5000,
      }),
      "FORBIDDEN"
    );
  });

  it("triggerReplenishment executes a real float credit (PG + ledger + tx row)", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.agentFloatForecasting.triggerReplenishment({
      agentId: AGENT_F1,
      amount: 5000,
    });
    expect(res.mode).toBe("single");
    expect(res.replenished.length).toBe(1);
    const r = res.replenished[0]!;
    expect(r.agentId).toBe(AGENT_F1);
    expect(r.amountNGN).toBe(5000);
    expect(r.newBalanceNGN).toBe(25000);
    const db = (await getDb())!;
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.agentId, AGENT_F1))
      .limit(1);
    expect(Number(agent!.premiumReserve)).toBe(25000);
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ref, r.ref))
      .limit(1);
    expect(tx?.type).toBe("Float Transfer Received");
    expect(Number(tx?.amount)).toBe(5000);
    expect(tx?.status).toBe("success");
    // restore seeded truth for deterministic re-runs
    await db
      .update(agents)
      .set({ premiumReserve: "20000.00" })
      .where(eq(agents.agentId, AGENT_F1));
  });

  it("triggerReplenishment fails loud NOT_FOUND for an unknown agent", async () => {
    const caller = callerFor(adminUser);
    await expectTrpcError(
      caller.agentFloatForecasting.triggerReplenishment({
        agentId: "AGT-W1C-DOES-NOT-EXIST",
        amount: 1000,
      }),
      "NOT_FOUND"
    );
  });
});
