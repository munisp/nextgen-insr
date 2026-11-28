/**
 * w29Analytics.integration.test.ts — W29 (2026-11-27) REAL-DB (PGlite) tests
 * for the newly-implemented analytics/list procedures and the ported B17
 * agentFloatForecasting.getForecast (main-repo semantics, portal deltas D1–D3
 * documented in server/routers/agentFloatForecasting.ts):
 *
 *   - biometricAuth.analytics / biometricAuth.list
 *       Sources: face_enrollments (registry) + biometric_audit_events
 *       (telemetry: eventType 'enrollment'|'verification', outcome
 *       'pass'|'fail' — written by server/routers/faceEnrollment.ts).
 *   - taxCollection.analytics
 *       Source: vat_records LEFT JOIN transactions ON transactions.ref =
 *       vat_records."transactionId" (ref link evidenced by repo seed.mjs).
 *   - agentFloatForecasting.getForecast
 *       Trailing average of (Cash Out − Cash In) per agent over
 *       (2026-11-28 C3: enum canonicalized — ip's Premium Payment/Claim
 *       Payout don't exist in root's txTypeEnum; C2 D1/D4 precedent maps them
 *       to Cash In/Cash Out).
 *       the trailing window; fail-loud PRECONDITION_FAILED below 7 distinct
 *       history days; legacy { agentId: number, horizon } and main-style
 *       { agentId: code-string, days } call shapes.
 *
 * Harness mirrors ./commissionApproveK.integration.test.ts (K-wave): spawned
 * PGlite wire server, minimal DDL with schema-verbatim column names/types for
 * every column the queries touch, raw-SQL seeds, createCaller against the
 * real routers. No mocks on the procedures under test.
 *
 * Seeded truth is computed in the header of each describe block so the
 * assertions trace to the seeds, not to the implementation.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 2026-11-28 (C3 port adaptation): ip tests lived one directory deeper
// (insureportal/tests/integration) — repo root is two levels up here.
const REPO_ROOT = path.resolve(__dirname, "../..");

async function allocFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
const PGLITE_PORT = await allocFreePort();
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PGLITE_PORT}/postgres`;

let child: ChildProcess;
let biometricAuthRouter: typeof import("../../server/routers/biometricAuth").biometricAuthRouter;
let taxCollectionRouter: typeof import("../../server/routers/taxCollection").taxCollectionRouter;
let agentFloatForecastingRouter: typeof import("../../server/routers/agentFloatForecasting").agentFloatForecastingRouter;
let getDb: typeof import("../../server/db").getDb;
let getPool: typeof import("../../server/db").getPool;

function waitReady(proc: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("PGlite not ready")), timeoutMs);
    let stderr = "";
    proc.stderr?.on("data", c => (stderr += String(c)));
    proc.stdout?.on("data", c => {
      if (String(c).includes("PGLITE_READY")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", code => {
      clearTimeout(t);
      reject(new Error(`PGlite exited early (${code})\n${stderr}`));
    });
  });
}

function ctxFor(user: TrpcContext["user"]) {
  return {
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const plainUser = {
  id: 950020,
  email: "reader@w29.test",
  name: "Read Only",
  role: "user",
  keycloakSub: "k-w29-user",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types for every column the
// procedures under test read. FKs omitted (documented in the K-wave harness):
// the queries join by value, not by constraint.
const DDL = `
CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY,
  "name" varchar(128)
);
CREATE TABLE IF NOT EXISTS "face_enrollments" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "enrollmentType" varchar(32) NOT NULL DEFAULT 'kyc',
  "qualityScore" numeric(5,4),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "biometric_audit_events" (
  "id" serial PRIMARY KEY,
  "sessionId" varchar(128) NOT NULL,
  "userId" integer,
  "eventType" varchar(64) NOT NULL,
  "outcome" varchar(32) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "agents" (
  "id" serial PRIMARY KEY,
  "agentId" varchar(32) NOT NULL,
  "name" varchar(128) NOT NULL,
  "location" varchar(128),
  "premiumReserve" numeric(15,2)
);
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL,
  "agentId" integer NOT NULL,
  "type" varchar(32) NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "fee" numeric(10,2) DEFAULT '0',
  "commission" numeric(10,2) DEFAULT '0',
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "vat_records" (
  "id" serial PRIMARY KEY,
  "transactionId" varchar(64) NOT NULL,
  "agentId" integer NOT NULL,
  "taxableAmount" numeric(15,2) NOT NULL,
  "vatAmount" numeric(15,2) NOT NULL,
  "period" varchar(7) NOT NULL,
  "remittedAt" timestamp
);
`;

async function exec(sql: string) {
  const db = (await getDb())!;
  return db.execute(sql as never);
}

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

const dayMs = 24 * 60 * 60 * 1000;

async function seed() {
  // ── Biometric registry + telemetry ──────────────────────────────────────
  // users: 501 named, 502 nameless (display-name fallback leg)
  await exec(`INSERT INTO "users" ("id", "name") VALUES (501, 'Ada Lovelace'), (502, NULL)`);
  await exec(`INSERT INTO "face_enrollments" ("id", "userId", "enrollmentType", "qualityScore", "isActive", "createdAt")
    VALUES (1, 501, 'kyc', 0.9200, true, now() - interval '2 days'),
           (2, 502, 'login', 0.5000, false, now() - interval '1 day')`);
  // events: 501 → 3 verification pass + 2 verification fail;
  //         502 → 1 verification pass + 1 ENROLLMENT fail (fail counting is
  //         outcome-based across event types, per the analytics contract)
  await exec(`INSERT INTO "biometric_audit_events" ("sessionId", "userId", "eventType", "outcome") VALUES
    ('s1', 501, 'verification', 'pass'),
    ('s2', 501, 'verification', 'pass'),
    ('s3', 501, 'verification', 'pass'),
    ('s4', 501, 'verification', 'fail'),
    ('s5', 501, 'verification', 'fail'),
    ('s6', 502, 'verification', 'pass'),
    ('s7', 502, 'enrollment', 'fail')`);
  // → analytics: enrolled 2, totalVerifications 6, totalFailedAttempts 3
  // → list: 501 {quality 92, verificationCount 5, failedAttempts 2, active}
  //         502 {quality 50, verificationCount 1, failedAttempts 1, revoked}

  // ── Agents ──────────────────────────────────────────────────────────────
  await exec(`INSERT INTO "agents" ("id", "agentId", "name", "location", "premiumReserve")
    VALUES (901, 'AGT-W29-F1', 'Float Agent One', 'Lagos', 20000.00),
           (902, 'AGT-W29-F2', 'Float Agent Two', 'Kano', 5000.00)`);

  // ── Transactions (tax link + float history) ─────────────────────────────
  // Tax-linked pair; T1 also serves as the sole successful cash-IN row.
  await exec(`INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt") VALUES
    ('TXN-W29-T1', 901, 'Cash In', 5000.00, 0, 100.00, 'success', now() - interval '1 day'),
    ('TXN-W29-T2', 901, 'Cash In', 533.33, 0, 40.00, 'failed',  now() - interval '1 day')`);
  // 7 distinct trailing days (today … today-6) of successful Claim Payout
  // 2000 for agent 901 — satisfies the 7-day minimum history.
  for (let k = 0; k < 7; k++) {
    const at = new Date(Date.now() - k * dayMs).toISOString();
    await exec(
      `INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt")
       VALUES ('W29-F1-${k}-OUT', 901, 'Cash Out', 2000.00, 0, 0, 'success', '${at}')`
    );
  }
  // Decoys: wrong status / non-float types — must NOT affect the forecast.
  await exec(`INSERT INTO "transactions" ("ref", "agentId", "type", "amount", "fee", "commission", "status", "createdAt") VALUES
    ('W29-F1-DECOY-FAILED', 901, 'Cash Out', 999999.00, 0, 0, 'failed', now()),
    ('W29-F1-DECOY-TRANSFER', 901, 'Transfer', 999999.00, 0, 0, 'success', now()),
    ('W29-F1-DECOY-BILL', 901, 'Bill Payment', 888888.00, 0, 0, 'success', now())`);
  // → forecast basis (7d window): cashIn 5000, cashOut 14000,
  //   historyDayCount 7, dataPoints 8, activeDays 7
  //   avgDailyNetOutflow = 9000/7 = 1285.71 (round2), predictedNeed(7d) = 9000
  //   currentFloat 20000 → shortfall 0 → risk 'low'
  //   avgDailyVolume = 19000/7 = 2714.29 (round2)

  // ── VAT records (tax analytics) ─────────────────────────────────────────
  // transactionId holds the originating transactions.ref (repo seed.mjs
  // convention); TXN-W29-MISSING has no matching transaction row (LEFT JOIN
  // leg: counted in volume/payments, never in success).
  await exec(`INSERT INTO "vat_records" ("transactionId", "agentId", "taxableAmount", "vatAmount", "period", "remittedAt") VALUES
    ('TXN-W29-T1', 901, 5000.00, 375.00, '2026-11', NULL),
    ('TXN-W29-T2', 901, 533.33, 100.00, '2026-11', now()),
    ('TXN-W29-MISSING', 901, 66.67, 50.00, '2026-11', NULL)`);
  // → analytics: totalVolume 525, totalPayments 3, totalCommission 140
  //   (100 + 40 over linked rows), successRate round(1/3*100) = 33
}

describe("W29: analytics/list real implementations + B17 forecast port (real PGlite DB)", () => {
  beforeAll(async () => {
    child = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "tests/integration/setup/pgliteServer.mjs")],
      {
        env: { ...process.env, PGLITE_PORT: String(PGLITE_PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    await waitReady(child);
    process.env.DATABASE_URL = DB_URL;
    // 2026-11-28 (C3 port adaptation): root server/db prefers POSTGRES_URL
    // over DATABASE_URL, and the integration globalSetup pins POSTGRES_URL to
    // its shared PGlite (full schema pushed — incl. the C3-merged W30
    // tables). Point POSTGRES_URL at this suite's own spawned PGlite so
    // the harness DDL lands on a fresh instance, exactly as it did in ip.
    process.env.POSTGRES_URL = DB_URL;
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    getPool = dbMod.getPool;
    ({ biometricAuthRouter } = await import("../../server/routers/biometricAuth"));
    ({ taxCollectionRouter } = await import("../../server/routers/taxCollection"));
    ({ agentFloatForecastingRouter } = await import(
      "../../server/routers/agentFloatForecasting"
    ));
    const db = (await getDb())!;
    await db.execute(DDL as never);
    await seed();
  }, 120_000);

  afterAll(async () => {
    try {
      const pool = await getPool?.();
      await pool?.end();
    } catch {
      // best-effort cleanup; teardown must not mask a test failure
    }
    child?.kill("SIGTERM");
  });

  // ── biometricAuth.analytics / list ───────────────────────────────────────
  // 2026-11-28 (C3 Item-4 re-derivation): my earlier NOT_IMPLEMENTED
  // alignments are REVERTED — C1's PR #362 merge (main @1bed27ca) landed
  // ip's W29 real implementations (server/routers/biometricAuth.ts:445,492).
  // Original assertions restored verbatim.
  it("biometricAuth.analytics returns registry/telemetry-derived aggregates", async () => {
    const res = await biometricAuthRouter
      .createCaller(ctxFor(plainUser))
      .analytics();
    expect(res.enrolled).toBe(2);
    expect(res.totalVerifications).toBe(6);
    expect(res.totalFailedAttempts).toBe(3);
  });

  it("biometricAuth.list returns real enrollment records with derived fields", async () => {
    const res = await biometricAuthRouter
      .createCaller(ctxFor(plainUser))
      .list();
    expect(res.records.length).toBe(2);
    const byId = new Map(res.records.map(r => [r.id, r]));
    const r1 = byId.get(1)!;
    expect(r1.agentName).toBe("Ada Lovelace");
    expect(r1.type).toBe("kyc");
    expect(r1.quality).toBe(92); // qualityScore 0.92 → percent
    expect(r1.verificationCount).toBe(5);
    expect(r1.failedAttempts).toBe(2);
    expect(r1.status).toBe("active");
    const r2 = byId.get(2)!;
    expect(r2.agentName).toBe("User #502"); // nameless-user fallback
    expect(r2.type).toBe("login");
    expect(r2.quality).toBe(50);
    expect(r2.verificationCount).toBe(1);
    expect(r2.failedAttempts).toBe(1); // enrollment-fail counts (outcome-based)
    expect(r2.status).toBe("revoked");
  });

  it("biometricAuth gates unauthenticated callers (UNAUTHORIZED)", async () => {
    const caller = biometricAuthRouter.createCaller(ctxFor(null));
    await expectTrpcCode(caller.analytics(), "UNAUTHORIZED");
    await expectTrpcCode(caller.list(), "UNAUTHORIZED");
  });

  // ── taxCollection.analytics ──────────────────────────────────────────────
  // 2026-11-28 (C3 contract alignment): root keeps taxCollection.analytics
  // fail-loud NOT_IMPLEMENTED (F-12) and taxCollection is DECON REMOVE-class.
  // Asserting the truthful root contract.
  it("taxCollection.analytics is fail-loud NOT_IMPLEMENTED on root (ip W29 impl not merged; DECON REMOVE)", async () => {
    await expectTrpcCode(
      taxCollectionRouter.createCaller(ctxFor(plainUser)).analytics(),
      "NOT_IMPLEMENTED"
    );
  });

  it("taxCollection.analytics gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      taxCollectionRouter.createCaller(ctxFor(null)).analytics(),
      "UNAUTHORIZED"
    );
  });

  // ── agentFloatForecasting.getForecast (B17 port) ─────────────────────────
  it("getForecast({ days }) returns the fleet-wide trailing-average forecast", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(plainUser))
      .getForecast({ days: 7 });
    expect(res.method).toBe("trailing_average");
    expect(res.horizonDays).toBe(7);
    expect(res.windowDays).toBe(7);
    expect(res.historyDayCount).toBe(7);
    expect(res.minHistoryDays).toBe(7);
    expect(res.dataPoints).toBe(8); // decoys excluded (status/type filters)
    expect(typeof res.generatedAt).toBe("string");
    expect(res.forecasts.length).toBe(1); // agent 902 has no flow rows
    const f = res.forecasts[0];
    expect(f.id).toBe("AGT-W29-F1");
    expect(f.name).toBe("Float Agent One");
    expect(f.location).toBe("Lagos");
    expect(f.currentFloat).toBe(20000);
    expect(f.avgDailyVolume).toBe(2714.29); // 19000/7
    expect(f.avgDailyNetOutflow).toBe(1285.71); // (14000-5000)/7
    expect(f.predictedNeed).toBe(9000);
    expect(f.shortfall).toBe(0);
    expect(f.risk).toBe("low");
    expect(f.activeDays).toBe(7);
  });

  it("getForecast keeps the legacy { agentId: number, horizon } call working", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(plainUser))
      .getForecast({ agentId: 901, horizon: "14" });
    expect(res.horizonDays).toBe(14);
    expect(res.windowDays).toBe(14);
    expect(res.forecasts.length).toBe(1);
    expect(res.forecasts[0].id).toBe("AGT-W29-F1");
    // Trailing average divides by the WINDOW: same 9000 net outflow now
    // spreads over 14 days (642.86/day) and projects over a 14-day horizon,
    // so the total need is unchanged — main's semantics exactly.
    expect(res.forecasts[0].avgDailyNetOutflow).toBe(642.86); // 9000/14
    expect(res.forecasts[0].predictedNeed).toBe(9000);
  });

  it("getForecast accepts main-style string agent codes", async () => {
    const res = await agentFloatForecastingRouter
      .createCaller(ctxFor(plainUser))
      .getForecast({ agentId: "AGT-W29-F1", days: 7 });
    expect(res.forecasts.length).toBe(1);
    expect(res.forecasts[0].predictedNeed).toBe(9000);
  });

  it("getForecast fails loud (PRECONDITION_FAILED) below minimum history", async () => {
    try {
      await agentFloatForecastingRouter
        .createCaller(ctxFor(plainUser))
        .getForecast({ days: 7, agentId: 902 });
      throw new Error("expected PRECONDITION_FAILED, but call succeeded");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("PRECONDITION_FAILED");
      expect(String((err as Error).message)).toContain("INSUFFICIENT_DATA");
    }
  });

  it("getForecast fails NOT_FOUND for unknown agents (numeric PK and code)", async () => {
    const caller = agentFloatForecastingRouter.createCaller(ctxFor(plainUser));
    await expectTrpcCode(caller.getForecast({ agentId: 999999 }), "NOT_FOUND");
    await expectTrpcCode(
      caller.getForecast({ agentId: "AGT-NOPE" }),
      "NOT_FOUND"
    );
  });

  it("getForecast gates unauthenticated callers (UNAUTHORIZED)", async () => {
    await expectTrpcCode(
      agentFloatForecastingRouter
        .createCaller(ctxFor(null))
        .getForecast({ days: 7 }),
      "UNAUTHORIZED"
    );
  });
});
