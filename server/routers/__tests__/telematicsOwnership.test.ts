/**
 * telematicsOwnership.test.ts — 2026-10-03 (verify-w9b3)
 *
 * Real-behavior PGlite tests for the telematicsRouter policy-ownership IDOR
 * fix in server/routers/innovationRouters.ts (harness copied from
 * memberQuotes.test.ts — real embedded PostgreSQL, ephemeral probeFreePort,
 * faithful minimal table projections).
 *
 * Proven contract (assertTelematicsPolicyOwnership, 2026-10-03):
 *   - getDrivingScore / getHistory / getScore / recordEvent with a FOREIGN
 *     policyId → non-enumerating NOT_FOUND (no data, no existence leak, no
 *     row written); with the caller's OWN policyId → real data / real insert
 *     (ownership resolved via customers.keycloakSub = String(ctx.user.id) —
 *     the member dual-identity path, so customer ids deliberately differ
 *     from user ids).
 *   - admin role bypasses the gate and reads any policy.
 *   - anonymous caller → UNAUTHORIZED on every proc (protectedProcedure).
 *
 * Identity spaces: member user id 6301 → customer 7301 (owns POLICY_OWN
 * 6101); member user id 6302 → customer 7302 (owns POLICY_FOREIGN 6102).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";

let PG_PORT = 0;
let PG_URL = "";

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
let pgliteChild: ChildProcess | null = null;

type Caller = ReturnType<
  (typeof import("../innovationRouters"))["telematicsRouter"]["createCaller"]
>;
let ownerCaller: Caller; // user 6301 → customer 7301 owns POLICY_OWN
let foreignCaller: Caller; // user 6302 → customer 7302 owns POLICY_FOREIGN
let adminCaller: Caller;
let anonCaller: Caller;

const MEMBER_A_USER = 6301;
const MEMBER_A_CUSTOMER = 7301;
const MEMBER_B_USER = 6302;
const MEMBER_B_CUSTOMER = 7302;
const POLICY_OWN = 6101;
const POLICY_FOREIGN = 6102;

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

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Minimal policies projection — the ownership gate selects id/customerId
  // only (assertTelematicsPolicyOwnership, 2026-10-03).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "customerId" integer NOT NULL
    )`);

  // Full telematics_events projection (drizzle/schema.innovations.ts:13) —
  // recordEvent inserts with .returning() and getHistory select()s the
  // whole row.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS telematics_events (
      id bigserial PRIMARY KEY,
      policy_id integer NOT NULL,
      customer_id integer NOT NULL,
      device_id varchar(64) NOT NULL,
      event_type varchar(32) NOT NULL,
      latitude numeric(10,7),
      longitude numeric(10,7),
      speed_kmh numeric(6,2),
      acceleration numeric(6,3),
      distance_km numeric(10,3),
      duration_seconds integer,
      risk_score numeric(5,2),
      driving_score numeric(5,2),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

  // Full telematics_scores projection (drizzle/schema.innovations.ts:498) —
  // getScore select()s the whole row.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS telematics_scores (
      id serial PRIMARY KEY,
      policy_id integer NOT NULL UNIQUE,
      customer_id integer NOT NULL,
      score numeric(5,2) NOT NULL,
      rating_factor numeric(4,2) NOT NULL DEFAULT 1.00,
      trips_counted integer NOT NULL DEFAULT 0,
      window_days integer NOT NULL DEFAULT 30,
      computed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, status, "keycloakSub")
    VALUES
      (${MEMBER_A_CUSTOMER}, 'Member', 'A', '09000000001', 'active', ${String(MEMBER_A_USER)}),
      (${MEMBER_B_CUSTOMER}, 'Member', 'B', '09000000002', 'active', ${String(MEMBER_B_USER)})
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO policies (id, "customerId")
    VALUES (${POLICY_OWN}, ${MEMBER_A_CUSTOMER}), (${POLICY_FOREIGN}, ${MEMBER_B_CUSTOMER})`);

  // Seed telematics rows for BOTH policies — the foreign rows must never be
  // readable by member A (IDOR probe data).
  await db.execute(sql`
    INSERT INTO telematics_events
      (policy_id, customer_id, device_id, event_type, speed_kmh, driving_score, recorded_at)
    VALUES
      (${POLICY_OWN}, ${MEMBER_A_CUSTOMER}, 'dev-a', 'trip_start', 60, 85, now()),
      (${POLICY_OWN}, ${MEMBER_A_CUSTOMER}, 'dev-a', 'hard_brake', 70, 65, now()),
      (${POLICY_FOREIGN}, ${MEMBER_B_CUSTOMER}, 'dev-b', 'speeding', 120, 40, now())`);

  await db.execute(sql`
    INSERT INTO telematics_scores (policy_id, customer_id, score, rating_factor, trips_counted)
    VALUES
      (${POLICY_OWN}, ${MEMBER_A_CUSTOMER}, 82.50, 0.90, 7),
      (${POLICY_FOREIGN}, ${MEMBER_B_CUSTOMER}, 41.00, 1.30, 3)`);
}

async function eventCount(policyId: number): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM telematics_events WHERE policy_id = ${policyId}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { telematicsRouter } = await import("../innovationRouters");
  ownerCaller = telematicsRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: MEMBER_A_USER, role: "user" } as any })
  );
  foreignCaller = telematicsRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: MEMBER_B_USER, role: "user" } as any })
  );
  adminCaller = telematicsRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 9999, role: "admin" } as any })
  );
  anonCaller = telematicsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("telematicsRouter policy ownership (2026-10-03, verify-w9b3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
    await expect(
      anonCaller.getDrivingScore({ policyId: POLICY_OWN, periodDays: 30 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.getHistory({ policyId: POLICY_OWN, limit: 10 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.getScore({ policyId: POLICY_OWN })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.recordEvent({ policyId: POLICY_OWN, deviceId: "d", eventType: "trip_start" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.myScore()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("owner reads their own driving score with real aggregation", async () => {
    const result = await ownerCaller.getDrivingScore({
      policyId: POLICY_OWN,
      periodDays: 30,
    });
    expect(result.events).toBe(2);
    expect(result.score).toBe(75); // (85 + 65) / 2
    expect(result.hardBrakes).toBe(1);
    expect(result.speedingEvents).toBe(0);
  });

  it("foreign policyId → NOT_FOUND for getDrivingScore (no existence leak)", async () => {
    await expect(
      ownerCaller.getDrivingScore({ policyId: POLICY_FOREIGN, periodDays: 30 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("owner reads their own history; foreign rows never leak", async () => {
    const rows = await ownerCaller.getHistory({ policyId: POLICY_OWN, limit: 50 });
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.policyId === POLICY_OWN)).toBe(true);
  });

  it("foreign policyId → NOT_FOUND for getHistory", async () => {
    await expect(
      ownerCaller.getHistory({ policyId: POLICY_FOREIGN, limit: 50 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("foreign member B is equally denied for member A's policy (symmetric IDOR)", async () => {
    await expect(
      foreignCaller.getHistory({ policyId: POLICY_OWN, limit: 50 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      foreignCaller.getDrivingScore({ policyId: POLICY_OWN, periodDays: 30 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unknown policyId → NOT_FOUND (indistinguishable from foreign)", async () => {
    await expect(
      ownerCaller.getHistory({ policyId: 999999, limit: 10 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin bypasses the ownership gate on getDrivingScore/getHistory", async () => {
    const score = await adminCaller.getDrivingScore({
      policyId: POLICY_FOREIGN,
      periodDays: 30,
    });
    expect(score.events).toBe(1);
    expect(score.speedingEvents).toBe(1);
    const rows = await adminCaller.getHistory({ policyId: POLICY_FOREIGN, limit: 50 });
    expect(rows).toHaveLength(1);
  });

  it("getScore returns the caller's own rolling score from PostgreSQL", async () => {
    const result = await ownerCaller.getScore({ policyId: POLICY_OWN });
    expect(result.policyId).toBe(POLICY_OWN);
    expect(result.score).toBe(82.5);
    expect(result.ratingFactor).toBe(0.9);
    expect(result.tripsCounted).toBe(7);
  });

  it("getScore on a foreign policy → NOT_FOUND (cached IDOR closed)", async () => {
    await expect(
      ownerCaller.getScore({ policyId: POLICY_FOREIGN })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recordEvent writes a real row for the caller's own policy", async () => {
    const before = await eventCount(POLICY_OWN);
    const result = await ownerCaller.recordEvent({
      policyId: POLICY_OWN,
      deviceId: "dev-a",
      eventType: "speeding",
      speedKmh: 110,
    });
    expect(result.success).toBe(true);
    expect(result.eventId).toBeGreaterThan(0);
    expect(await eventCount(POLICY_OWN)).toBe(before + 1);
  });

  it("recordEvent on a foreign policy → NOT_FOUND and ZERO rows written", async () => {
    const before = await eventCount(POLICY_FOREIGN);
    await expect(
      ownerCaller.recordEvent({
        policyId: POLICY_FOREIGN,
        deviceId: "evil",
        eventType: "hard_brake",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await eventCount(POLICY_FOREIGN)).toBe(before);
  });
});
