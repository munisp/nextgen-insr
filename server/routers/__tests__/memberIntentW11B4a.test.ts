/**
 * memberIntentW11B4a.test.ts — W11-B4a (2026-10-24)
 *
 * Real-behavior tests for server/routers/memberIntent.ts (the Phase 4a
 * omnibox parse surface). REAL PGlite PostgreSQL; the payee_directory
 * schema under test is applied by executing the REAL migration
 * drizzle/0090_payee_directory.sql. NOTHING is mocked — the parse path is
 * deterministic and the only DB touch is the caller-scoped payee lookup.
 *
 * Covers:
 *   - parseIntent happy path: ready airtime/bill/momo proposals pass
 *     through with payee:null when the caller has no matching payee.
 *   - Enrichment: a parsed intent whose identifiers match one of the
 *     CALLER'S OWN payee_directory rows returns {payeeId, label}
 *     (one-tap confirm); the row is seeded via the REAL recordPayee
 *     (HMAC natural key + AES-256-GCM envelope).
 *   - Cross-member isolation: member B's payee NEVER enriches member A's
 *     parse, even with identical identifiers (mutant probe: dropping the
 *     customerId predicate → red).
 *   - clarification / unsupported results get NO enrichment.
 *   - Anonymous caller → UNAUTHORIZED.
 *   - Rate limit: the 61st parse in the hour for one member →
 *     TOO_MANY_REQUESTS (distinct test user id, isolated bucket).
 *   - resolvePayeeHint: alias hit / miss, anon UNAUTHORIZED.
 *   - Boundary honesty: the router exposes NO execute proc.
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

/** Member A: users.id 1 ↔ customers.id 4242. Member B: users.id 2 ↔ 9999. */
const A_USER = 1;
const A_CUSTOMER = 4242;
const B_USER = 2;
const B_CUSTOMER = 9999;
/** Isolated user for the rate-limit bucket test (no member profile). */
const RL_USER = 7;

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL DEFAULT 'M',
      "lastName" varchar(64) NOT NULL DEFAULT 'T',
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE,
      "kycLevel" integer NOT NULL DEFAULT 0
    )`);
  // The REAL W11-B1a migration — verified to apply cleanly on PGlite.
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0090_payee_directory.sql"),
    "utf8"
  );
  await db.execute(sql.raw(migrationSql));
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", email, phone, "keycloakSub", "kycLevel") VALUES
      (${A_CUSTOMER}, 'Ada', 'Okafor', 'ada@example.io', '09000000001', '1', 3),
      (${B_CUSTOMER}, 'Bala', 'Yusuf', 'bala@example.io', '09000000002', '2', 3)
    ON CONFLICT DO NOTHING`);
  // Seed payees via the REAL recorder (blind index + encryption envelope).
  const { recordPayee } = await import("../../lib/memberPayees");
  await recordPayee(db, {
    customerId: A_CUSTOMER,
    rail: "airtime",
    identifiers: { network: "MTN", phone: "08031234567" },
    amountKobo: 100_000,
  });
  await recordPayee(db, {
    customerId: A_CUSTOMER,
    rail: "bill",
    identifiers: { billerCode: "IKEDC", meterNumber: "0451234567" },
    amountKobo: 1_000_000,
  });
  await recordPayee(db, {
    customerId: A_CUSTOMER,
    rail: "momo",
    identifiers: { provider: "MTN MoMo", walletNumber: "09000000001" },
    amountKobo: 2_000_000,
  });
  // Member B owns an IDENTICAL airtime payee — the isolation probe.
  await recordPayee(db, {
    customerId: B_CUSTOMER,
    rail: "airtime",
    identifiers: { network: "MTN", phone: "08031234567" },
    amountKobo: 100_000,
  });
  // Give A's airtime payee a human label via the REAL router proc.
  const { memberPayeesRouter } = await import("../memberPayees");
  const payeesCaller = memberPayeesRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: A_USER, role: "user" } as any })
  );
  const { payees } = await payeesCaller.list({});
  const airtimePayee = payees.find(p => p.rail === "airtime");
  await payeesCaller.rename({ id: airtimePayee!.id, label: "Mum's line" });
}

let callerA: ReturnType<
  (typeof import("../memberIntent"))["memberIntentRouter"]["createCaller"]
>;
let callerB: typeof callerA;
let callerRl: typeof callerA;
let anon: typeof callerA;

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberIntentRouter } = await import("../memberIntent");
  callerA = memberIntentRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: A_USER, role: "user" } as any })
  );
  callerB = memberIntentRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: B_USER, role: "user" } as any })
  );
  callerRl = memberIntentRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: RL_USER, role: "user" } as any })
  );
  anon = memberIntentRouter.createCaller(makeUnauthenticatedCtx());
}, 90_000);

afterAll(async () => {
  pgliteChild?.kill();
});

describe("parseIntent — ready proposals", () => {
  it("airtime intent matching the caller's own payee is enriched", async () => {
    const r = await callerA.parseIntent({
      text: "buy 1000 mtn airtime for 08031234567",
    });
    expect(r.result).toMatchObject({
      status: "ready",
      intent: { flow: "airtime_vend", network: "MTN", phone: "08031234567" },
    });
    expect(r.payee).not.toBeNull();
    expect(r.payee!.label).toBe("Mum's line");
    expect(typeof r.payee!.payeeId).toBe("string");
  });

  it("bill intent matching the caller's own payee is enriched", async () => {
    const r = await callerA.parseIntent({
      text: "pay ikeja electric 10000 meter 0451234567",
    });
    expect(r.result).toMatchObject({
      status: "ready",
      intent: { flow: "bill_pay", billerCode: "IKEDC" },
    });
    expect(r.payee).not.toBeNull();
  });

  it("momo intent matches on (provider, caller session phone)", async () => {
    const r = await callerA.parseIntent({
      text: "cash in 20000 to my mtn momo wallet",
    });
    expect(r.result).toMatchObject({
      status: "ready",
      intent: { flow: "momo_cash_in", provider: "MTN MoMo" },
    });
    expect(r.payee).not.toBeNull();
  });

  it("ready intent with NO matching payee → payee:null (no fabrication)", async () => {
    const r = await callerA.parseIntent({
      text: "buy 1000 glo airtime for 08051112223",
    });
    expect(r.result).toMatchObject({ status: "ready" });
    expect(r.payee).toBeNull();
  });

  it("navigate intent → payee:null, no payload", async () => {
    const r = await callerA.parseIntent({ text: "file a claim" });
    expect(r.result).toEqual({
      status: "ready",
      intent: { flow: "navigate", target: "claims_file" },
    });
    expect(r.payee).toBeNull();
  });
});

describe("parseIntent — isolation and honesty", () => {
  it("cross-member: B's identical payee enriches B, never leaks A's label", async () => {
    const r = await callerB.parseIntent({
      text: "buy 1000 mtn airtime for 08031234567",
    });
    expect(r.result).toMatchObject({ status: "ready" });
    expect(r.payee).not.toBeNull();
    // B's own row (label null), NEVER A's "Mum's line".
    expect(r.payee!.label).toBeNull();
  });

  it("mutant probe: A's payee id != B's payee id for the same identifiers", async () => {
    const ra = await callerA.parseIntent({
      text: "buy 1000 mtn airtime for 08031234567",
    });
    const rb = await callerB.parseIntent({
      text: "buy 1000 mtn airtime for 08031234567",
    });
    expect(ra.payee!.payeeId).not.toBe(rb.payee!.payeeId);
  });

  it("clarification result → verbatim pass-through, no enrichment", async () => {
    const r = await callerA.parseIntent({
      text: "buy airtime for 08031234567",
    });
    expect(r.result.status).toBe("clarification");
    expect(r.payee).toBeNull();
  });

  it("unsupported result → verbatim pass-through", async () => {
    const r = await callerA.parseIntent({
      text: "transfer 5000 to my bank account",
    });
    expect(r.result).toEqual({
      status: "unsupported",
      reason: "bank_transfer_not_supported",
    });
    expect(r.payee).toBeNull();
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(
      anon.parseIntent({ text: "buy 1k mtn airtime for 08031234567" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("61st parse in the hour → TOO_MANY_REQUESTS (rate limit)", async () => {
    for (let i = 0; i < 60; i++) {
      await callerRl.parseIntent({ text: "hello there" }); // cheap unsupported parse
    }
    await expect(
      callerRl.parseIntent({ text: "hello there" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  }, 60_000);

  it("boundary: the router exposes NO execute proc", async () => {
    const { memberIntentRouter } = await import("../memberIntent");
    const procs = Object.keys((memberIntentRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(["parseIntent", "resolvePayeeHint"]);
  });
});

describe("resolvePayeeHint", () => {
  it("alias hit → canonical code", async () => {
    expect(await callerA.resolvePayeeHint({ billerText: "ikeja electric" })).toEqual({
      billerCode: "IKEDC",
    });
  });

  it("alias miss → null (never a nearest guess)", async () => {
    expect(await callerA.resolvePayeeHint({ billerText: "zamfara electric" })).toEqual({
      billerCode: null,
    });
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(
      anon.resolvePayeeHint({ billerText: "dstv" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
