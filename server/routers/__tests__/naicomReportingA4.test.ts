/**
 * naicomReportingA4.test.ts — A4 (2026-10-02)
 *
 * Honest-contract PGlite tests for server/routers/naicomReporting.ts after the
 * fabricated NAICOM figures were removed (A4). The old code reported
 * premiumsEarned = 95% of gross, ceded = 15%, recoveries = 15%, and a
 * fabricated solvency floor of max(premiums×20%, ₦15M) — all invented
 * multipliers fed to the regulator. These tests pin the replacement behaviour
 * against a real embedded PostgreSQL (harness pattern copied from
 * memberQuotes.test.ts — raw DDL projections, probeFreePort):
 *
 *   (a) UPR / earned premium is pro-rata temporis over real policy rows:
 *       a mid-term policy contributes exactly the overlapping fraction
 *       (e.g. 30 of 60 term days inside the period → exactly half earned).
 *   (b) With ZERO reinsurance treaty rows, reinsurancePremiumsCeded and
 *       reinsuranceRecoveries are exactly 0 — an honest zero, never 15%.
 *   (c) With a real active quota-share treaty (20% on motor), cession =
 *       earned premium × 0.20 for matching-class policies, and recoveries =
 *       paid motor claims × 0.20.
 *   (d) Solvency: no admitted-assets/liabilities tables exist →
 *       actualSolvencyMargin / solvencyRatio are null with an explicit
 *       INSUFFICIENT_DATA marker; minimumSolvencyMargin stays the genuine
 *       NAICOM statutory ₦15,000,000 constant.
 *   (e) Fail-closed: earnedInPeriod throws on a policy with missing or
 *       inverted dates rather than guessing a regulatory figure.
 *
 * Reporting period used throughout: 2026-06 (June 2026, 30 days, UTC).
 * Precision note (2026-10-02, A4): the period closes at 23:59:59.999, so the
 * overlap is 1ms short of a full 30 days; assertions are at kobo precision
 * (toBeCloseTo(..., 2)) rather than exact floats.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

let PG_PORT = 0;
let PG_URL = "";
let pgliteChild: ChildProcess | null = null;

const PERIOD = "2026-06";
// Period bounds computed by the router: 2026-06-01T00:00:00Z →
// 2026-06-30T23:59:59.999Z (30 full days).
const P_START = new Date(Date.UTC(2026, 5, 1));

async function probeFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
}

async function getDbOrThrow() {
  const { getDb } = await import("../../db");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  return db;
}

async function createTables() {
  const { sql } = await import("drizzle-orm");
  const db = await getDbOrThrow();

  // Minimal faithful projections of the columns naicomReporting.ts reads.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "agentId" integer NOT NULL,
      type varchar(32) NOT NULL,
      amount numeric(15,2) NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "coverageType" varchar(32) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      status varchar(32) NOT NULL DEFAULT 'active'
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS claims (
      id serial PRIMARY KEY,
      "policyId" integer NOT NULL,
      "paidAmount" numeric(18,2),
      status varchar(32) NOT NULL DEFAULT 'submitted',
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id serial PRIMARY KEY,
      "isActive" boolean NOT NULL DEFAULT true
    )`);
  // reinsurance_treaties projection (drizzle/schema.ts:5231). cessionPercentage
  // is a percent 0-100 per the schema comment.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS reinsurance_treaties (
      id serial PRIMARY KEY,
      "treatyNumber" varchar(64) NOT NULL UNIQUE,
      "reinsurerName" varchar(256) NOT NULL,
      type varchar(32) NOT NULL,
      "coverageType" varchar(32),
      "cessionPercentage" numeric(7,4),
      "startDate" timestamp NOT NULL,
      "endDate" timestamp,
      "isActive" boolean NOT NULL DEFAULT true
    )`);
}

async function resetRows() {
  const { sql } = await import("drizzle-orm");
  const db = await getDbOrThrow();
  await db.execute(sql`DELETE FROM reinsurance_treaties`);
  await db.execute(sql`DELETE FROM claims`);
  await db.execute(sql`DELETE FROM policies`);
  await db.execute(sql`DELETE FROM transactions`);
  await db.execute(sql`DELETE FROM agents`);
}

async function build(period = PERIOD) {
  const { buildMonthlyActivityReport } = await import("../naicomReporting");
  return buildMonthlyActivityReport(await getDbOrThrow(), period);
}

beforeAll(async () => {
  await startPglite();
  await createTables();
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("naicomReporting A4 (2026-10-02) — no fabricated regulatory figures", () => {
  it("(a) UPR/earned premium is pro-rata temporis over real policy rows", async () => {
    await resetRows();
    const { sql } = await import("drizzle-orm");
    const db = await getDbOrThrow();

    // Mid-term policy: 2026-05-17 → 2026-07-16 = 60-day term; June overlap is
    // 30 days → exactly HALF earned. Premium 60000 → earned 30000.
    // UPR (2026-10-02, A4-r2): only the 15 term days AFTER the period end
    // (2026-07-01 → 2026-07-16) are unearned at period end → UPR = 60000 ×
    // 15/60 ≈ 15000. The 15 days elapsed before June are neither earned this
    // period nor unearned at period end.
    await db.execute(sql`
      INSERT INTO policies (id, "coverageType", "annualPremium", "startDate", "endDate", status)
      VALUES (1, 'motor', 60000, '2026-05-17T00:00:00Z', '2026-07-16T00:00:00Z', 'active')`);
    // Fully-in-period policy: 2026-06-01 → 2026-07-01 (30-day term) → the
    // whole 30000 premium earns inside June.
    await db.execute(sql`
      INSERT INTO policies (id, "coverageType", "annualPremium", "startDate", "endDate", status)
      VALUES (2, 'life', 30000, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', 'active')`);
    // Out-of-period policy (ended before June) must contribute NOTHING.
    await db.execute(sql`
      INSERT INTO policies (id, "coverageType", "annualPremium", "startDate", "endDate", status)
      VALUES (3, 'motor', 999999, '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'expired')`);

    const r = await build();
    // Exact half for the mid-term policy + full for the in-period policy.
    expect(r.sectionA.premiumsEarned).toBeCloseTo(30000 + 30000, 2);
    expect(r.sectionA.unearnedPremiumReserve).toBeCloseTo(15000 + 0, 2);
    // No treaties → honest zero cession; net == gross earned.
    expect(r.sectionA.reinsurancePremiumsCeded).toBe(0);
    expect(r.sectionA.netPremiumsEarned).toBeCloseTo(60000, 2);
  });

  it("(b) zero treaty rows → ceded/recoveries are exactly 0, not 15%", async () => {
    await resetRows();
    const { sql } = await import("drizzle-orm");
    const db = await getDbOrThrow();

    await db.execute(sql`
      INSERT INTO policies (id, "coverageType", "annualPremium", "startDate", "endDate", status)
      VALUES (1, 'motor', 60000, '2026-05-17T00:00:00Z', '2026-07-16T00:00:00Z', 'active')`);
    await db.execute(sql`
      INSERT INTO claims (id, "policyId", "paidAmount", status, "createdAt")
      VALUES (1, 1, 50000, 'paid', '2026-06-10T12:00:00Z')`);
    await db.execute(sql`
      INSERT INTO transactions (ref, "agentId", type, amount, "createdAt")
      VALUES ('TX-A4-1', 1, 'Insurance', 60000, '2026-06-05T12:00:00Z')`);

    const r = await build();
    expect(r.sectionA.grossPremiumWritten).toBe(60000);
    // HONEST ZERO — the old code would have reported 9000 (15%) here.
    expect(r.sectionA.reinsurancePremiumsCeded).toBe(0);
    expect(r.sectionB.grossClaimsPaid).toBe(50000);
    expect(r.sectionB.reinsuranceRecoveries).toBe(0);
    expect(r.sectionB.netClaimsPaid).toBe(50000);
  });

  it("(c) active quota-share treaty → cession = earned premium × rate for matching class", async () => {
    await resetRows();
    const { sql } = await import("drizzle-orm");
    const db = await getDbOrThrow();

    await db.execute(sql`
      INSERT INTO policies (id, "coverageType", "annualPremium", "startDate", "endDate", status)
      VALUES
        (1, 'motor', 60000, '2026-05-17T00:00:00Z', '2026-07-16T00:00:00Z', 'active'),
        (2, 'life',  30000, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', 'active')`);
    // 20% quota-share treaty on MOTOR only, active during June.
    await db.execute(sql`
      INSERT INTO reinsurance_treaties
        ("treatyNumber", "reinsurerName", type, "coverageType", "cessionPercentage", "startDate", "endDate", "isActive")
      VALUES ('QS-MOTOR-2026', 'Test Reinsurer Ltd', 'quota_share', 'motor', 20.0,
              '2026-01-01T00:00:00Z', NULL, true)`);
    // Expired treaty (ended before the period) must NOT apply.
    await db.execute(sql`
      INSERT INTO reinsurance_treaties
        ("treatyNumber", "reinsurerName", type, "coverageType", "cessionPercentage", "startDate", "endDate", "isActive")
      VALUES ('QS-MOTOR-2025', 'Test Reinsurer Ltd', 'quota_share', 'motor', 50.0,
              '2025-01-01T00:00:00Z', '2025-12-31T00:00:00Z', true)`);
    await db.execute(sql`
      INSERT INTO claims (id, "policyId", "paidAmount", status, "createdAt")
      VALUES
        (1, 1, 50000, 'paid', '2026-06-10T12:00:00Z'),
        (2, 2, 10000, 'paid', '2026-06-12T12:00:00Z')`);

    const r = await build();
    // Motor earned 30000 × 20% = 6000; life is not covered by the treaty.
    expect(r.sectionA.reinsurancePremiumsCeded).toBeCloseTo(6000, 2);
    expect(r.sectionA.netPremiumsEarned).toBeCloseTo(60000 - 6000, 2);
    // Recoveries: motor paid 50000 × 20% = 10000; life claim not covered.
    expect(r.sectionB.reinsuranceRecoveries).toBeCloseTo(10000, 2);
    expect(r.sectionB.netClaimsPaid).toBeCloseTo(60000 - 10000, 2);
  });

  it("(d) solvency is null + INSUFFICIENT_DATA (no assets/liabilities tables), statutory ₦15M minimum kept", async () => {
    await resetRows();
    const r = await build();
    expect(r.sectionD.minimumSolvencyMargin).toBe(15_000_000);
    expect(r.sectionD.actualSolvencyMargin).toBeNull();
    expect(r.sectionD.solvencyRatio).toBeNull();
    expect(r.sectionD.dataStatus).toBe("INSUFFICIENT_DATA");
    // The fabricated floor max(premiums×20%, ₦15M) must be gone entirely.
    expect(JSON.stringify(r.sectionD)).not.toContain("15000000,\"solvencyRatio");
  });

  it("(e) fail-closed: earnedInPeriod throws on missing/inverted dates instead of guessing", async () => {
    const { earnedInPeriod } = await import("../naicomReporting");
    const pEnd = new Date(Date.UTC(2026, 6, 1));
    expect(() =>
      earnedInPeriod(
        { id: 99, annualPremium: "1000", startDate: null, endDate: pEnd },
        P_START,
        pEnd,
      )
    ).toThrow(/fail-closed/);
    expect(() =>
      earnedInPeriod(
        {
          id: 98,
          annualPremium: "1000",
          startDate: pEnd,
          endDate: P_START, // inverted term
        },
        P_START,
        pEnd,
      )
    ).toThrow(/fail-closed/);
  });
});
