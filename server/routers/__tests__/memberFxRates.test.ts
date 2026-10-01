/**
 * memberFxRates.test.ts — R3 batch 3 (2026-10-01, R3-b3)
 *
 * Real-behavior PGlite tests for server/routers/memberFxRates.ts:
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure)
 *   - rates/currencies read the REAL stored book from system_config key
 *     `fx_rates` (drizzle/schema.ts:2187)
 *   - convert math verified against seeded rows (EUR-base "units per 1 EUR":
 *     USD→NGN = amount * rates[NGN] / rates[USD]); missing currency and
 *     poisoned books fail LOUD (PRECONDITION_FAILED) — never treated as 1
 *   - empty-rates disclosure: no stored row → rates = {} + null timestamp,
 *     currencies = [], convert → PRECONDITION_FAILED (never fixture rates)
 *   - no mutation surface: updateRates/refresh (broken authz in the base
 *     router) are absent by construction
 *   - historical input validation (days > 365 rejected at the boundary)
 *
 * PGlite harness copied from memberReferrals.test.ts (2026-10-01 R3-fix-ci2):
 * real embedded PostgreSQL over the wire protocol, EPHEMERAL probed port so
 * suites run concurrently without EADDRINUSE. The system_config table is the
 * real schema projection (columns exactly as drizzle/schema.ts systemConfig).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// Ephemeral port probe (memberReferrals.test.ts copy, 2026-10-01 R3-b3).
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

// Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
// as memberReferrals) so protectedProcedure passes the base gate.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberFxRates"))["memberFxRatesRouter"]["createCaller"]
>;
let memberCaller: Caller;
let anonCaller: Caller;

// Seeded EUR-base rate book ("units per 1 EUR").
const SEEDED_BOOK = { EUR: 1, USD: 1.08, NGN: 1600, GBP: 0.85 };

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

  // Real schema projection (drizzle/schema.ts:2187 systemConfig): table
  // system_config, camelCase quoted columns, unique key.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_config (
      id serial PRIMARY KEY,
      key varchar(128) NOT NULL UNIQUE,
      value text NOT NULL,
      description text,
      "updatedBy" varchar(64),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    INSERT INTO system_config (key, value, description, "updatedBy")
    VALUES ('fx_rates', ${JSON.stringify(SEEDED_BOOK)}, 'EUR-base FX rate book', 'test-seed')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberFxRatesRouter } = await import("../memberFxRates");
  memberCaller = memberFxRatesRouter.createCaller(makeAuthenticatedCtx());
  anonCaller = memberFxRatesRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

async function setBook(value: string | null): Promise<void> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  if (value === null) {
    await db.execute(sql`DELETE FROM system_config WHERE key = 'fx_rates'`);
  } else {
    await db.execute(sql`
      INSERT INTO system_config (key, value) VALUES ('fx_rates', ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }
}

describe("memberFxRates router (2026-10-01, R3-b3)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.rates()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.convert({ from: "USD", to: "NGN", amount: 100 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.currencies()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.historical()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("exposes no mutation surface (updateRates/refresh never delegated to)", async () => {
    // Assert on the router DEFINITION (createCaller is a proxy with no
    // enumerable keys): only the four read-only procs exist.
    const { memberFxRatesRouter } = await import("../memberFxRates");
    const procs = Object.keys(
      memberFxRatesRouter._def.procedures as Record<string, unknown>
    );
    expect(procs.sort()).toEqual(["convert", "currencies", "historical", "rates"]);
  });

  it("rates returns the real stored book with a timestamp", async () => {
    const result = await memberCaller.rates();
    expect(result.baseCurrency).toBe("EUR");
    expect(result.rates).toEqual(SEEDED_BOOK);
    expect(result.lastUpdated).toBeTruthy();
  });

  it("currencies derives the code+rate list from the stored book", async () => {
    const result = await memberCaller.currencies();
    expect(result.baseCurrency).toBe("EUR");
    expect(result.currencies).toHaveLength(4);
    expect(result.currencies).toContainEqual({ code: "NGN", rate: 1600 });
  });

  it("convert performs EUR-base math against the seeded book", async () => {
    // USD→NGN = amount * rates[NGN] / rates[USD] = 100 * 1600 / 1.08.
    const result = await memberCaller.convert({ from: "USD", to: "NGN", amount: 100 });
    expect(result.rate).toBeCloseTo(1600 / 1.08, 10);
    expect(result.convertedAmount).toBeCloseTo((100 * 1600) / 1.08, 2);
    expect(result.from).toBe("USD");
    expect(result.to).toBe("NGN");
    // EUR is the book base: EUR→GBP = amount * rates[GBP] / rates[EUR].
    const eur = await memberCaller.convert({ from: "EUR", to: "GBP", amount: 50 });
    expect(eur.convertedAmount).toBe(42.5);
  });

  it("convert fails loud on a currency absent from the book (never treated as 1)", async () => {
    await expect(
      memberCaller.convert({ from: "USD", to: "JPY", amount: 100 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("convert fails loud on a poisoned/malformed stored book", async () => {
    await setBook(JSON.stringify({ USD: "not-a-number", NGN: -5 }));
    try {
      await expect(
        memberCaller.convert({ from: "USD", to: "NGN", amount: 100 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await setBook(JSON.stringify(SEEDED_BOOK));
    }
  });

  it("historical rejects days > 365 at the input boundary", async () => {
    await expect(
      memberCaller.historical({ base: "NGN", target: "USD", days: 400 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("empty-rates disclosure: no stored book → empty rates, empty currencies, convert PRECONDITION_FAILED", async () => {
    await setBook(null);
    try {
      const rates = await memberCaller.rates();
      expect(rates.rates).toEqual({});
      expect(rates.lastUpdated).toBeNull();
      const currencies = await memberCaller.currencies();
      expect(currencies.currencies).toEqual([]);
      await expect(
        memberCaller.convert({ from: "USD", to: "NGN", amount: 100 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await setBook(JSON.stringify(SEEDED_BOOK));
    }
  });
});
