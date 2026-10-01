/**
 * memberOnboarding.test.ts — R3 batch 6 (2026-10-01, R3-b6)
 *
 * Real-behavior PGlite tests for server/routers/memberOnboarding.ts
 * (harness copied from memberIdentity.test.ts — real embedded PostgreSQL,
 * ephemeral probeFreePort, minimal table projections matching exactly the
 * columns the router touches: users.id/createdAt + the full
 * customer_onboarding_progress column set from drizzle/schema.ts:5947):
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - myProgress is rebound to ctx.user.id — there is NO input at all, so a
 *     foreign userId cannot be supplied (identity space: users.id, per the
 *     source customerOnboardingPipeline.getProgress)
 *   - stage comes from the durable store (G2 #10): seeded stage reported
 *     with the correct index/percent; missing row → honest "registration"
 *   - foreign progress rows never leak into the caller's payload
 *   - read-only: the proc never writes (row COUNT unchanged after calls)
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
  (typeof import("../memberOnboarding"))["memberOnboardingRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → users.id 1 (kyc_review)
let noProgressCaller: Caller; // session user id 777 → no users row
let anonCaller: Caller;

// Foreign marker that must NEVER leak into the caller's payload.
const FOREIGN_STAGE = "live";

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

  // users — faithful minimal projection of drizzle/schema.ts:284 (the
  // router selects id + createdAt only; all NOT NULL columns present).
  await db.execute(sql`CREATE TYPE role AS ENUM ('user', 'admin', 'supervisor')`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      "keycloakSub" varchar(128) NOT NULL UNIQUE,
      name text,
      email varchar(320),
      "loginMethod" varchar(64),
      role role NOT NULL DEFAULT 'user',
      "mfaEnabled" boolean NOT NULL DEFAULT false,
      "mfaEnforcedAt" timestamp,
      "tenantId" integer,
      "stripeCustomerId" varchar(255),
      "stripeSubscriptionId" varchar(255),
      "stripePlanId" varchar(128),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "lastSignedIn" timestamp NOT NULL DEFAULT now()
    )`);

  // customer_onboarding_progress — full drizzle/schema.ts:5947 column set.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_onboarding_progress (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id),
      current_stage varchar(32) NOT NULL DEFAULT 'registration',
      notes text,
      advanced_by varchar(64),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_onboarding_progress_user_idx
    ON customer_onboarding_progress (user_id)`);

  await db.execute(sql`
    INSERT INTO users (id, "keycloakSub", name, "createdAt")
    VALUES
      (1, 'sub-member-a', 'Member A', '2026-09-01'),
      (2, 'sub-member-b', 'Member B', '2026-09-02')
    ON CONFLICT DO NOTHING`);

  // Caller (users.id 1) is mid-pipeline; foreign user 2 is LIVE — the
  // caller must never see the foreign stage.
  await db.execute(sql`
    INSERT INTO customer_onboarding_progress (user_id, current_stage, notes, advanced_by)
    VALUES
      (1, 'kyc_review', 'caller notes', 'agent-1'),
      (2, ${FOREIGN_STAGE}, 'foreign notes', 'agent-1')`);
}

async function progressRowCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM customer_onboarding_progress`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberOnboardingRouter } = await import("../memberOnboarding");
  memberCaller = memberOnboardingRouter.createCaller(makeAuthenticatedCtx());
  noProgressCaller = memberOnboardingRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberOnboardingRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberOnboarding router (2026-10-01, R3-b6)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myProgress()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("myProgress reads the caller's durable stage with correct index/percent", async () => {
    const before = await progressRowCount();
    const result = await memberCaller.myProgress();
    expect(result.currentStage).toBe("kyc_review");
    expect(result.stageIndex).toBe(2);
    expect(result.totalStages).toBe(7);
    expect(result.completionPercent).toBe(Math.round((3 / 7) * 100));
    expect(result.startedAt).toContain("2026-09-01");
    expect(result.stages.map(s => s.name)).toEqual([
      "registration",
      "kyc_submission",
      "kyc_review",
      "account_setup",
      "training",
      "activation",
      "live",
    ]);
    // Read-only: zero rows changed by the call.
    expect(await progressRowCount()).toBe(before);
  });

  it("myProgress honestly reports 'registration' when no users/progress row exists", async () => {
    const result = await noProgressCaller.myProgress();
    expect(result.currentStage).toBe("registration");
    expect(result.stageIndex).toBe(0);
    expect(result.completionPercent).toBe(Math.round((1 / 7) * 100));
  });

  it("never leaks the foreign user's progress or notes", async () => {
    const result = await memberCaller.myProgress();
    const payload = JSON.stringify(result);
    expect(result.currentStage).not.toBe(FOREIGN_STAGE);
    expect(payload).not.toContain("foreign notes");
  });
});
