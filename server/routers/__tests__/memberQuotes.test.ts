/**
 * memberQuotes.test.ts — R3 batch 5 (2026-10-01, R3-b5)
 *
 * Real-behavior PGlite tests for server/routers/memberQuotes.ts (harness
 * copied from memberIdentity.test.ts — real embedded PostgreSQL, ephemeral
 * probeFreePort, faithful minimal table projections):
 *   - anonymous caller → UNAUTHORIZED on every proc
 *   - session user with NO customer profile → NOT_FOUND on every proc
 *     (the cart keys customers.id; fail-closed, non-enumerating)
 *   - addToQuoteCart pins customerId = resolved customers.id (4242) — the
 *     input schema carries NO customerId, so nothing can be smuggled;
 *     premium math verified against real numeric columns
 *   - myQuoteCart/quoteSummary are caller-scoped with real COUNT/SUM;
 *     the seeded foreign pending quote NEVER appears
 *   - removeQuoteItem on a FOREIGN quoteId → NOT_FOUND, foreign row stays
 *     pending (the source removeItem would have cancelled it — IDOR closed)
 *   - clearQuoteCart cancels only the caller's pending rows (real row count)
 *
 * Identity spaces: caller user id 1 → customer 4242; foreign user id 2 →
 * customer 5555. No-profile caller user id 777 (no customers row).
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

process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberQuotes"))["memberQuotesRouter"]["createCaller"]
>;
let caller: Caller; // session user id 1 → customer 4242
let noProfileCaller: Caller; // session user id 777 → no customers row
let anonCaller: Caller;

const CALLER_CUSTOMER = 4242;
const FOREIGN_CUSTOMER = 5555;
const PRODUCT_ID = 11;

let foreignQuoteId = 0;

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
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);

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

  // Minimal faithful insurance_products projection (the router selects
  // id/name/coverageType/minPremium/maxCoverageAmount only).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      name varchar(256) NOT NULL,
      "coverageType" coverage_type NOT NULL,
      "minPremium" numeric(18,2),
      "maxCoverageAmount" numeric(18,2),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full policy_quotes column set (schema.additions.ts:470) — addToQuoteCart
  // inserts with .returning() (full row).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_quotes (
      id serial PRIMARY KEY,
      "customerId" integer,
      "agentId" integer,
      "productId" integer,
      "productName" text,
      "productType" varchar(64),
      "sumInsured" numeric(18,2),
      "premiumAmount" numeric(18,2),
      "stampDuty" numeric(18,2),
      "totalPayable" numeric(18,2),
      "durationMonths" integer,
      "coverageType" varchar(64),
      status varchar(32) NOT NULL DEFAULT 'pending',
      "validUntil" timestamp,
      metadata jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, status, "keycloakSub")
    VALUES
      (${CALLER_CUSTOMER}, 'Member', 'A', '09000000001', 'active', '1'),
      (${FOREIGN_CUSTOMER}, 'Foreign', 'F', '09000000002', 'active', '2')
    ON CONFLICT DO NOTHING`);

  // minPremium 20000 / maxCoverage 1000000 → derived baseRate 0.02.
  await db.execute(sql`
    INSERT INTO insurance_products (id, name, "coverageType", "minPremium", "maxCoverageAmount")
    VALUES (${PRODUCT_ID}, 'Family Life Plan', 'life', 20000, 1000000)`);

  // Seeded FOREIGN pending quote (IDOR probe target) + a cancelled caller row
  // (must not surface in the pending cart).
  const fr = await db.execute(sql`
    INSERT INTO policy_quotes
      ("customerId", "productId", "productName", "sumInsured", "premiumAmount",
       "stampDuty", "totalPayable", "durationMonths", status)
    VALUES
      (${FOREIGN_CUSTOMER}, ${PRODUCT_ID}, 'Family Life Plan', 900000, 18000, 90, 18090, 12, 'pending'),
      (${CALLER_CUSTOMER}, ${PRODUCT_ID}, 'Family Life Plan', 100000, 2000, 10, 2010, 12, 'cancelled')
    RETURNING id`);
  foreignQuoteId = Number((fr as any).rows?.[0]?.id ?? (fr as any)[0]?.id);
}

async function quoteStatus(quoteId: number): Promise<string> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT status FROM policy_quotes WHERE id = ${quoteId}`
  );
  const row = (r as any).rows?.[0] ?? (r as any)[0];
  return String(row.status);
}

async function pendingCount(customerId: number): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM policy_quotes
        WHERE "customerId" = ${customerId} AND status = 'pending'`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberQuotesRouter } = await import("../memberQuotes");
  caller = memberQuotesRouter.createCaller(makeAuthenticatedCtx());
  noProfileCaller = memberQuotesRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberQuotesRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberQuotes router (2026-10-01, R3-b5)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
    await expect(anonCaller.myQuoteCart()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.addToQuoteCart({ productId: PRODUCT_ID, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.removeQuoteItem({ quoteId: foreignQuoteId })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.clearQuoteCart()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.quoteSummary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("fails closed with NOT_FOUND when the session user has no customer profile", async () => {
    await expect(noProfileCaller.myQuoteCart()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      noProfileCaller.addToQuoteCart({ productId: PRODUCT_ID, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(noProfileCaller.clearQuoteCart()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(noProfileCaller.quoteSummary()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("addToQuoteCart pins the caller-derived customerId and computes the real premium", async () => {
    const result = await caller.addToQuoteCart({
      productId: PRODUCT_ID,
      sumInsured: 500000,
      durationMonths: 12,
    });
    // baseRate = 20000/1000000 = 0.02 → premium 10000, stamp 50, total 10050.
    expect(result.premiumAmount).toBe(10000);
    expect(result.stampDuty).toBe(50);
    expect(result.totalPayable).toBe(10050);
    expect(result.quote.customerId).toBe(CALLER_CUSTOMER);
    expect(result.quote.status).toBe("pending");
    expect(result.quote.productName).toBe("Family Life Plan");
    expect(result.currency).toBe("NGN");
    expect(await pendingCount(CALLER_CUSTOMER)).toBe(1);
  });

  it("addToQuoteCart with an unknown product → NOT_FOUND, no row written", async () => {
    await expect(
      caller.addToQuoteCart({ productId: 999999, sumInsured: 1000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await pendingCount(CALLER_CUSTOMER)).toBe(1);
  });

  it("myQuoteCart returns only the caller's pending items with real totals", async () => {
    const result = await caller.myQuoteCart();
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.totalPremium).toBe(10000);
    expect(result!.items[0].productName).toBe("Family Life Plan");
    // The seeded foreign pending quote (18000) and the caller's own CANCELLED
    // row (2000) never enter the totals.
    expect(JSON.stringify(result)).not.toContain("18000");
    expect(JSON.stringify(result)).not.toContain("2010");
  });

  it("quoteSummary reports real COUNT/SUM over the caller's pending rows only", async () => {
    const result = await caller.quoteSummary();
    expect(result).toEqual({ count: 1, totalPremium: 10000, currency: "NGN" });
  });

  it("removeQuoteItem on a FOREIGN quoteId → NOT_FOUND, foreign row stays pending (IDOR closed)", async () => {
    await expect(
      caller.removeQuoteItem({ quoteId: foreignQuoteId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await quoteStatus(foreignQuoteId)).toBe("pending");
  });

  it("removeQuoteItem on the caller's own quote cancels the real row", async () => {
    const cart = await caller.myQuoteCart();
    const ownId = cart!.items[0].id;
    const result = await caller.removeQuoteItem({ quoteId: ownId });
    expect(result).toEqual({ removed: true, quoteId: ownId });
    expect(await quoteStatus(ownId)).toBe("cancelled");
    // Re-removing a now-cancelled row is NOT_FOUND (pending-scoped update).
    await expect(
      caller.removeQuoteItem({ quoteId: ownId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clearQuoteCart cancels only the caller's pending rows and returns the real count", async () => {
    await caller.addToQuoteCart({ productId: PRODUCT_ID, sumInsured: 100000 });
    await caller.addToQuoteCart({ productId: PRODUCT_ID, sumInsured: 200000 });
    expect(await pendingCount(CALLER_CUSTOMER)).toBe(2);
    const foreignBefore = await pendingCount(FOREIGN_CUSTOMER);

    const result = await caller.clearQuoteCart();
    expect(result).toEqual({ cleared: true, cancelled: 2 });
    expect(await pendingCount(CALLER_CUSTOMER)).toBe(0);
    // Foreign pending quote untouched.
    expect(await pendingCount(FOREIGN_CUSTOMER)).toBe(foreignBefore);

    const summary = await caller.quoteSummary();
    expect(summary).toEqual({ count: 0, totalPremium: 0, currency: "NGN" });
  });
});
