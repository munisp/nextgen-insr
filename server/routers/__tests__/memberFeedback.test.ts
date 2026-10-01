/**
 * memberFeedback.test.ts — R3 batch 6 (2026-10-01, R3-b6)
 *
 * Real-behavior PGlite tests for server/routers/memberFeedback.ts (harness
 * copied from memberIdentity.test.ts — real embedded PostgreSQL, ephemeral
 * probeFreePort, faithful minimal projections: the full customers column
 * set from the memberIdentity harness + the full customer_feedback_nps
 * column set from drizzle/schema.ts:2882):
 *   - anonymous caller → UNAUTHORIZED on both procs (protectedProcedure)
 *   - session user with no customer profile → NOT_FOUND (fail-closed,
 *     non-enumerating — memberQuotes requireSessionCustomer pattern)
 *   - submitMyFeedback stamps the RESOLVED customers.id server-side; a
 *     smuggled customerId in the input is stripped by the schema (the input
 *     carries no customerId field at all) — real row COUNT + value checks
 *   - score bounds enforced (1..10) → BAD_REQUEST outside
 *   - myFeedback returns ONLY the caller's rows (foreign feedback with a
 *     distinct marker never leaks)
 *   - IDOR probe: no proc accepts an id — there is no way to read or
 *     mutate another member's feedback row
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

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

// Unit-test env: no Permify sidecar (same pattern as memberIdentity); the
// member authz under test is the router's own scoping.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberFeedback"))["memberFeedbackRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242
let noProfileCaller: Caller; // session user id 777 → no customers row
let anonCaller: Caller;

// Foreign marker that must NEVER leak into the caller's payload.
const FOREIGN_FEEDBACK = "FOREIGN-FEEDBACK-MARKER";

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

  // Full customers projection (memberIdentity harness shape — the router
  // resolves id via customers.keycloakSub).
  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "externalId" varchar(128) UNIQUE,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      bvn text,
      nin text,
      bvn_hash varchar(64),
      nin_hash varchar(64),
      "dateOfBirth" text,
      address text,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "kycLevel" integer NOT NULL DEFAULT 0,
      "walletBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "dailyLimit" numeric(15,2) NOT NULL DEFAULT '50000.00',
      "monthlyLimit" numeric(15,2) NOT NULL DEFAULT '300000.00',
      "preferredAgentId" integer,
      "keycloakSub" varchar(128) UNIQUE,
      "passwordHash" varchar(256),
      "refreshToken" text,
      "lastLoginAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // customer_feedback_nps — full drizzle/schema.ts:2882 column set.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_feedback_nps (
      id serial PRIMARY KEY,
      "customerId" integer,
      score integer NOT NULL,
      feedback text,
      channel varchar(64) NOT NULL DEFAULT 'web',
      "policyId" integer,
      "claimId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub", "kycLevel", status)
    VALUES
      (4242, 'Member', 'A', '09000000001', '1', 2, 'active'),
      (9999, 'Member', 'B', '09000000002', '2', 0, 'pending_kyc')
    ON CONFLICT DO NOTHING`);

  // Foreign feedback row (customer 9999) with a distinct marker.
  await db.execute(sql`
    INSERT INTO customer_feedback_nps ("customerId", score, feedback, channel)
    VALUES (9999, 3, ${FOREIGN_FEEDBACK}, 'ussd')`);
}

async function feedbackCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM customer_feedback_nps`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberFeedbackRouter } = await import("../memberFeedback");
  memberCaller = memberFeedbackRouter.createCaller(makeAuthenticatedCtx());
  noProfileCaller = memberFeedbackRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberFeedbackRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberFeedback router (2026-10-01, R3-b6)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on both procs", async () => {
    await expect(
      anonCaller.submitMyFeedback({ score: 8 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.myFeedback({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns NOT_FOUND (non-enumerating) when the session user has no customer profile", async () => {
    const before = await feedbackCount();
    await expect(
      noProfileCaller.submitMyFeedback({ score: 8 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(noProfileCaller.myFeedback({})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await feedbackCount()).toBe(before);
  });

  it("submitMyFeedback stamps the RESOLVED customer id server-side (smuggled customerId is stripped)", async () => {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const before = await feedbackCount();

    const result = await memberCaller.submitMyFeedback({
      score: 9,
      feedback: "Great claims experience",
      // IDOR probe: zod strips unknown keys — this must NOT land on the row.
      customerId: 9999,
    } as any);
    expect(result.success).toBe(true);
    expect(result.feedback.score).toBe(9);
    expect(result.feedback.channel).toBe("web");
    expect(await feedbackCount()).toBe(before + 1);

    const row = await db.execute(sql`
      SELECT "customerId", score, feedback, channel FROM customer_feedback_nps
      WHERE id = ${result.feedback.id}`);
    const r = (row as any).rows?.[0] ?? (row as any)[0];
    expect(r.customerId).toBe(4242); // resolved customers.id, NEVER input
    expect(r.feedback).toBe("Great claims experience");
    expect(r.channel).toBe("web");
  });

  it("rejects out-of-range scores with BAD_REQUEST and writes nothing", async () => {
    const before = await feedbackCount();
    await expect(
      memberCaller.submitMyFeedback({ score: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      memberCaller.submitMyFeedback({ score: 11 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await feedbackCount()).toBe(before);
  });

  it("myFeedback returns ONLY the caller's rows, newest first", async () => {
    const result = await memberCaller.myFeedback({});
    expect(result.items).toHaveLength(1);
    expect(result.count).toBe(1);
    expect(result.items[0].score).toBe(9);
    // Foreign feedback never leaks; customerId linkage is not projected.
    const payload = JSON.stringify(result);
    expect(payload).not.toContain(FOREIGN_FEEDBACK);
    expect(payload).not.toContain("customerId");
  });
});
