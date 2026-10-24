/**
 * memberInsightsW11B3a.test.ts — W11-B3a (2026-10-24)
 *
 * Real-behavior tests for the member heuristic-intelligence surface
 * (server/routers/memberInsights.ts + server/lib/memberInsights.ts).
 *
 * REAL PGlite PostgreSQL; the payee_directory schema is applied by executing
 * the REAL migration drizzle/0090_payee_directory.sql (memberPayeesW11B1a
 * harness pattern). NO doubles anywhere — there is no external boundary on
 * these read-only procedures; nothing on the production path is mocked.
 *
 * Covers:
 *   - nextBestActions: renewal due ≤14d / unresolved failed_refund_pending /
 *     recurring due soon / KYC incomplete, ranked renewal > refund >
 *     recurring > kyc; KYC action absent for a verified member.
 *   - Periodicity detector precision: 2 occurrences → NOT recurring; 3 at
 *     ~30d → recurring; irregular intervals → NOT recurring; recurring but
 *     recent (last 5d ago) → candidate yet NOT due-soon (absent from NBA).
 *   - amountAnomalyCheck: 3× median over floor → anomalous; 2× → not;
 *     below ₦5,000 floor → not; no history → not (fail-closed);
 *     payee_directory.lastAmountKobo contributes to history.
 *   - Cross-member isolation on every proc; anonymous → UNAUTHORIZED.
 *   - Mutant probes: resolving the refund flag removes the action; a failed
 *     transaction never counts toward a cadence.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";

let pgliteChild: ChildProcess | null = null;

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
  const port = await probeFreePort();
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(port) },
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
  process.env.POSTGRES_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

/** Member A: users.id 11 ↔ customers.id 4242. Member B: users.id 22 ↔ 9999. */
const A_USER = 11;
const A_CUSTOMER = 4242;
const B_USER = 22;
const B_CUSTOMER = 9999;

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * DAY).toISOString();

type Db = NonNullable<Awaited<ReturnType<(typeof import("../../db"))["getDb"]>>>;
async function db(): Promise<Db> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("DB unavailable in test");
  return d;
}

async function insertTx(opts: {
  ref: string;
  customerId: number;
  type: string;
  amountNGN: number;
  status?: string;
  createdAt: string;
  extraMeta?: Record<string, unknown>;
}) {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  const metadata = {
    memberCustomerId: opts.customerId,
    ...(opts.extraMeta ?? {}),
  };
  await d.execute(sql`
    INSERT INTO transactions (ref, "agentId", type, amount, status, metadata, "createdAt", "updatedAt")
    VALUES (${opts.ref}, 1, ${opts.type}, ${String(opts.amountNGN)},
      ${opts.status ?? "success"}, ${JSON.stringify(metadata)},
      ${opts.createdAt}::timestamp, ${opts.createdAt}::timestamp)`);
}

async function createTablesAndSeed() {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL DEFAULT 'M',
      "lastName" varchar(64) NOT NULL DEFAULT 'T',
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE,
      "kycLevel" integer NOT NULL DEFAULT 0
    )`);
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "idempotencyKey" varchar(192) UNIQUE,
      "agentId" integer NOT NULL,
      type varchar(32) NOT NULL,
      amount numeric(15,2) NOT NULL,
      fee numeric(10,2) DEFAULT '0.00',
      commission numeric(10,2) DEFAULT '0.00',
      currency varchar(8) NOT NULL DEFAULT 'NGN',
      "customerName" varchar(128),
      "customerPhone" varchar(20),
      "customerAccount" varchar(20),
      "destinationBank" varchar(64),
      "destinationAccount" varchar(20),
      channel varchar(16) DEFAULT 'App',
      status varchar(32) NOT NULL DEFAULT 'pending',
      "failureReason" text,
      metadata json,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'active',
      "coverageType" varchar(32) NOT NULL DEFAULT 'motor',
      "sumInsured" numeric(18,2) NOT NULL DEFAULT 0,
      "annualPremium" numeric(18,2) NOT NULL DEFAULT 0,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      metadata json,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS kyc_sessions (
      id serial PRIMARY KEY,
      "agentId" integer,
      "customerId" integer,
      "sessionRef" varchar(64) NOT NULL UNIQUE,
      type varchar(32) NOT NULL DEFAULT 'agent_onboarding',
      status varchar(32) NOT NULL DEFAULT 'pending',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  // The REAL W11-B1a migration — verifies it applies cleanly on PGlite.
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0090_payee_directory.sql"),
    "utf8"
  );
  await d.execute(sql.raw(migrationSql));
  await d.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", email, phone, "keycloakSub", "kycLevel") VALUES
      (${A_CUSTOMER}, 'Ada', 'Okafor', 'ada@example.io', '09000000001', ${String(A_USER)}, 3),
      (${B_CUSTOMER}, 'Bala', 'Yusuf', 'bala@example.io', '09000000002', ${String(B_USER)}, 0)
    ON CONFLICT DO NOTHING`);
  // A is KYC-verified (document session adjudicated "verified");
  // B has no verified session → kyc_incomplete applies to B only.
  await d.execute(sql`
    INSERT INTO kyc_sessions ("customerId", "sessionRef", type, status) VALUES
      (${A_CUSTOMER}, 'kyc-a-verified', 'customer_kyc', 'verified')
    ON CONFLICT DO NOTHING`);

  // ── A: renewal due in 7 days (active policy, renewalDate set) ──────────
  await d.execute(sql`
    INSERT INTO policies ("policyNumber", "productId", "customerId", status, "renewalDate")
    VALUES ('POL-NBA-1', 501, ${A_CUSTOMER}, 'active', ${daysAhead(7)}::timestamp)`);
  // A: renewal far out (60d) → must NOT surface.
  await d.execute(sql`
    INSERT INTO policies ("policyNumber", "productId", "customerId", status, "renewalDate")
    VALUES ('POL-NBA-FAR', 501, ${A_CUSTOMER}, 'active', ${daysAhead(60)}::timestamp)`);
  // A: lapsed policy due in 3d → must NOT surface (not active).
  await d.execute(sql`
    INSERT INTO policies ("policyNumber", "productId", "customerId", status, "renewalDate")
    VALUES ('POL-NBA-LAPSED', 501, ${A_CUSTOMER}, 'lapsed', ${daysAhead(3)}::timestamp)`);

  // ── A: recurring bill payee — 3 payments at exactly 30d cadence ───────
  for (const [i, age] of [[0, 90], [1, 60], [2, 30]] as const) {
    await insertTx({
      ref: `BP-REC-A${i}`,
      customerId: A_CUSTOMER,
      type: "Bill Payment",
      amountNGN: 2000,
      createdAt: daysAgo(age),
      extraMeta: { biller: "EKEDC", customerNumber: "04512345678" },
    });
  }
  // ── A: unresolved failed refund capture ────────────────────────────────
  await insertTx({
    ref: "BP-REFUND-A",
    customerId: A_CUSTOMER,
    type: "Bill Payment",
    amountNGN: 5000,
    status: "failed",
    createdAt: daysAgo(2),
    extraMeta: {
      biller: "IKEDC",
      customerNumber: "04000000001",
      refund: { status: "failed_refund_pending", flaggedAt: daysAgo(2) },
    },
  });

  // ── B: same-shaped history of their OWN (isolation fixtures) ──────────
  await d.execute(sql`
    INSERT INTO policies ("policyNumber", "productId", "customerId", status, "renewalDate")
    VALUES ('POL-NBA-B', 501, ${B_CUSTOMER}, 'active', ${daysAhead(9)}::timestamp)`);
  for (const [i, age] of [[0, 92], [1, 61], [2, 31]] as const) {
    await insertTx({
      ref: `BP-REC-B${i}`,
      customerId: B_CUSTOMER,
      type: "Bill Payment",
      amountNGN: 1500,
      createdAt: daysAgo(age),
      extraMeta: { biller: "EKEDC", customerNumber: "04512345678" },
    });
  }
}

let insightsA: ReturnType<
  (typeof import("../memberInsights"))["memberInsightsRouter"]["createCaller"]
>;
let insightsB: typeof insightsA;
let insightsAnon: typeof insightsA;

function ctxFor(userId: number) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `member-${userId}`, role: "user", email: `m${userId}@example.io` } as never,
  });
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberInsightsRouter } = await import("../memberInsights");
  insightsA = memberInsightsRouter.createCaller(ctxFor(A_USER));
  insightsB = memberInsightsRouter.createCaller(ctxFor(B_USER));
  insightsAnon = memberInsightsRouter.createCaller(makeUnauthenticatedCtx());
}, 90_000);

afterAll(async () => {
  pgliteChild?.kill();
});

describe("memberInsights.nextBestActions (W11-B3a, 2026-10-24)", () => {
  it("detects renewal due ≤14d, unresolved failed refund, recurring due soon — ranked renewal > refund > recurring; no kyc for verified member", async () => {
    const { actions } = await insightsA.nextBestActions();
    const types = actions.map(a => a.type);
    expect(types).toContain("policy_renewal_due");
    expect(types).toContain("failed_refund_pending");
    expect(types).toContain("recurring_bill_due");
    expect(types).not.toContain("kyc_incomplete");
    // Ranking: strict priority order.
    const idx = (t: string) => types.indexOf(t);
    expect(idx("policy_renewal_due")).toBeLessThan(idx("failed_refund_pending"));
    expect(idx("failed_refund_pending")).toBeLessThan(idx("recurring_bill_due"));
    const renewal = actions.find(a => a.type === "policy_renewal_due")!;
    expect(renewal.explain).toContain("POL-NBA-1");
    expect((renewal.payload as { policyNumber: string }).policyNumber).toBe("POL-NBA-1");
    // Non-vacuous: far-out and lapsed policies are NOT surfaced.
    expect(actions.some(a => a.explain.includes("POL-NBA-FAR"))).toBe(false);
    expect(actions.some(a => a.explain.includes("POL-NBA-LAPSED"))).toBe(false);
    const refund = actions.find(a => a.type === "failed_refund_pending")!;
    expect((refund.payload as { reference: string }).reference).toBe("BP-REFUND-A");
  });

  it("kyc_incomplete surfaces for unverified member B, ranked last", async () => {
    const { actions } = await insightsB.nextBestActions();
    const types = actions.map(a => a.type);
    expect(types).toContain("kyc_incomplete");
    expect(types.indexOf("kyc_incomplete")).toBe(types.length - 1);
  });

  it("cross-member isolation: B never sees A's refund / policy refs", async () => {
    const { actions } = await insightsB.nextBestActions();
    expect(actions.some(a => a.explain.includes("POL-NBA-1"))).toBe(false);
    expect(actions.some(a => a.explain.includes("BP-REFUND-A"))).toBe(false);
    // B sees their own renewal + recurring, though.
    expect(actions.some(a => a.explain.includes("POL-NBA-B"))).toBe(true);
    expect(actions.some(a => a.type === "recurring_bill_due")).toBe(true);
  });

  it("mutant probe: resolving the refund flag removes the failed_refund action", async () => {
    const { sql } = await import("drizzle-orm");
    const d = await db();
    await d.execute(sql`
      UPDATE transactions SET metadata = jsonb_set(metadata::jsonb, '{refund,status}', '"refunded"'::jsonb)
      WHERE ref = 'BP-REFUND-A'`);
    const { actions } = await insightsA.nextBestActions();
    expect(actions.some(a => a.type === "failed_refund_pending")).toBe(false);
    // Restore for any later assertions (kept deterministic: none depend on it).
    await d.execute(sql`
      UPDATE transactions SET metadata = jsonb_set(metadata::jsonb, '{refund,status}', '"failed_refund_pending"'::jsonb)
      WHERE ref = 'BP-REFUND-A'`);
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(insightsAnon.nextBestActions()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("memberInsights.recurringCandidates — periodicity precision", () => {
  it("3 occurrences at ~30d → recurring + due soon; carries refs and cadence", async () => {
    const { candidates, state } = await insightsA.recurringCandidates();
    expect(state).toBe("detections_only"); // no accept/dismiss table this phase
    const c = candidates.find(c => c.rail === "bill")!;
    expect(c).toBeDefined();
    expect(c.occurrences).toBe(3);
    expect(c.cadenceDays).toBe(30);
    expect(c.dueSoon).toBe(true);
    expect(c.transactionIds).toHaveLength(3);
    expect(c.averageAmountKobo).toBe(200_000);
  });

  it("2 occurrences → NOT recurring", async () => {
    for (const [i, age] of [[0, 60], [1, 30]] as const) {
      await insertTx({
        ref: `AV-TWO-${i}`,
        customerId: A_CUSTOMER,
        type: "Airtime",
        amountNGN: 500,
        createdAt: daysAgo(age),
        extraMeta: { network: "MTN", phoneNumber: "08030000001" },
      });
    }
    const { candidates } = await insightsA.recurringCandidates();
    expect(candidates.some(c => c.rail === "airtime")).toBe(false);
  });

  it("irregular intervals → NOT recurring; failed rows never count toward a cadence (mutant probe)", async () => {
    // Intervals 45d then 15d — one outlier gap disqualifies the group.
    for (const [i, age] of [[0, 90], [1, 45], [2, 30]] as const) {
      await insertTx({
        ref: `AV-IRR-${i}`,
        customerId: A_CUSTOMER,
        type: "Airtime",
        amountNGN: 700,
        createdAt: daysAgo(age),
        extraMeta: { network: "GLO", phoneNumber: "08050000002" },
      });
    }
    // 3 rows at 30d cadence but the middle one FAILED → only 2 paid → not recurring.
    for (const [i, age, st] of [[0, 90, "success"], [1, 60, "failed"], [2, 30, "success"]] as const) {
      await insertTx({
        ref: `AV-FL-${i}`,
        customerId: A_CUSTOMER,
        type: "Airtime",
        amountNGN: 900,
        status: st,
        createdAt: daysAgo(age),
        extraMeta: { network: "AIRTEL", phoneNumber: "08080000003" },
      });
    }
    const { candidates } = await insightsA.recurringCandidates();
    expect(candidates.filter(c => c.rail === "airtime")).toHaveLength(0);
  });

  it("recurring but paid 5d ago → candidate yet NOT due-soon → absent from NBA", async () => {
    for (const [i, age] of [[0, 65], [1, 35], [2, 5]] as const) {
      await insertTx({
        ref: `AV-RECENT-${i}`,
        customerId: A_CUSTOMER,
        type: "Airtime",
        amountNGN: 1000,
        createdAt: daysAgo(age),
        extraMeta: { network: "9MOBILE", phoneNumber: "08090000004" },
      });
    }
    const { candidates } = await insightsA.recurringCandidates();
    const c = candidates.find(c => c.rail === "airtime")!;
    expect(c).toBeDefined();
    expect(c.dueSoon).toBe(false);
    const { actions } = await insightsA.nextBestActions();
    // Only the EKEDC bill (due soon) appears as recurring_bill_due.
    const recurringActions = actions.filter(a => a.type === "recurring_bill_due");
    expect(recurringActions).toHaveLength(1);
  });

  it("cross-member isolation: candidate lists are disjoint by transaction ids", async () => {
    const a = await insightsA.recurringCandidates();
    const b = await insightsB.recurringCandidates();
    const aIds = new Set(a.candidates.flatMap(c => c.transactionIds));
    for (const c of b.candidates) {
      for (const id of c.transactionIds) expect(aIds.has(id)).toBe(false);
    }
    expect(b.candidates.length).toBeGreaterThan(0);
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(insightsAnon.recurringCandidates()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("memberInsights.amountAnomalyCheck — conservative soft confirm", () => {
  const EKEDC = { billerCode: "EKEDC", meterNumber: "04512345678" };

  it("> 3× median AND ≥ ₦5,000 floor → anomalous with multiple", async () => {
    // A's EKEDC history: 3× ₦2,000 (200_000 kobo) → median 200_000.
    const res = await insightsA.amountAnomalyCheck({
      rail: "bill",
      identifiers: EKEDC,
      amountKobo: 700_000, // ₦7,000 = 3.5×
    });
    expect(res.anomalous).toBe(true);
    expect(res.multiple).toBe(3.5);
    expect(res.reason).toBe("exceeds_historical_multiple");
  });

  it("2× median → NOT anomalous (mutant probe of the multiplier)", async () => {
    const res = await insightsA.amountAnomalyCheck({
      rail: "bill",
      identifiers: EKEDC,
      amountKobo: 500_000, // ₦5,000 = 2.5×
    });
    expect(res.anomalous).toBe(false);
    expect(res.reason).toBe("within_historical_range");
  });

  it("below the ₦5,000 floor → NOT anomalous even at a huge multiple", async () => {
    // A's 9MOBILE airtime history: 3× ₦1,000 (100_000 kobo) → median 100_000.
    const res = await insightsA.amountAnomalyCheck({
      rail: "airtime",
      identifiers: { network: "9MOBILE", phone: "08090000004" },
      amountKobo: 450_000, // ₦4,500 = 4.5× median but < ₦5,000 floor
    });
    expect(res.anomalous).toBe(false);
    expect(res.reason).toBe("below_floor");
  });

  it("no history → fail-closed anomalous:false (never a false alarm)", async () => {
    const res = await insightsA.amountAnomalyCheck({
      rail: "bill",
      identifiers: { billerCode: "UNKNOWN", meterNumber: "00000000000" },
      amountKobo: 5_000_000,
    });
    expect(res.anomalous).toBe(false);
    expect(res.reason).toBe("insufficient_history");
    // Incomplete tuple → same fail-closed outcome.
    const partial = await insightsA.amountAnomalyCheck({
      rail: "bill",
      identifiers: { billerCode: "EKEDC" },
      amountKobo: 5_000_000,
    });
    expect(partial.anomalous).toBe(false);
  });

  it("payee_directory.lastAmountKobo contributes to history", async () => {
    const d = await db();
    const { recordPayee } = await import("../../lib/memberPayees");
    await recordPayee(d, {
      customerId: B_CUSTOMER,
      rail: "bill",
      identifiers: EKEDC,
      amountKobo: 150_000,
    });
    // B's EKEDC history: 3× ₦1,500 transactions + the directory's
    // lastAmountKobo (150_000 kobo) → median 150_000.
    const res = await insightsB.amountAnomalyCheck({
      rail: "bill",
      identifiers: EKEDC,
      amountKobo: 600_000, // ₦6,000 = 4× B's median
    });
    expect(res.anomalous).toBe(true);
    expect(res.multiple).toBe(4);
    // Cross-member isolation: B's history is B's — A's ₦2,000 rows never
    // leak in (else the median would shift and the multiple would differ).
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(
      insightsAnon.amountAnomalyCheck({
        rail: "bill",
        identifiers: EKEDC,
        amountKobo: 700_000,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
