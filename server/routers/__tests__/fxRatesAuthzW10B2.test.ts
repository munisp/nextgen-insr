/**
 * fxRatesAuthzW10B2.test.ts — W10-B2 (2026-10-03)
 *
 * Real-behavior tests for the BROKEN-AUTHZ FIX in server/routers/fxRates.ts:
 * updateRates/refresh were plain protectedProcedure — ANY authenticated
 * member could overwrite the global rate book that memberFxRates.convert
 * quotes from. They are now gated to admin/supervisor (fxElevatedProcedure).
 *
 * REAL PGlite PostgreSQL (memberPayments.test.ts harness pattern); refresh
 * is exercised against a REAL local HTTP wire server speaking the
 * Frankfurter response shape (FRANKFURTER_BASE_URL override) — the only
 * double is the external HTTP boundary.
 *
 * Covers: anonymous → UNAUTHORIZED; member (role "user") → FORBIDDEN on
 * BOTH mutations (and the stored book is NOT modified); admin updateRates →
 * success; supervisor refresh → success (rate book persisted under fx_rates);
 * member read path (convert) unaffected by the re-gate.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
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

async function createTables() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
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
    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status varchar(32) DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
}

let frankfurterServer: Server | null = null;

beforeAll(async () => {
  await startPglite();
  await createTables();
  const http = await import("node:http");
  frankfurterServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/latest")) {
      res.end(JSON.stringify({
        amount: 1,
        base: "EUR",
        date: "2026-10-03",
        rates: { USD: 1.09, NGN: 1700.5 },
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>(r => frankfurterServer!.listen(0, "127.0.0.1", r));
  const addr = frankfurterServer.address();
  process.env.FRANKFURTER_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 90_000);

afterAll(async () => {
  delete process.env.FRANKFURTER_BASE_URL;
  pgliteChild?.kill();
  await new Promise(r => frankfurterServer?.close(r));
});

async function storedBook() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  const rows = await d!.execute(
    sql`SELECT value FROM system_config WHERE key = 'fx_rates'`
  );
  const row = (rows as any).rows?.[0] ?? (rows as any)[0];
  return row ? JSON.parse(row.value) : null;
}

describe("fxRates.updateRates/refresh admin re-gate (W10-B2, 2026-10-03)", () => {
  it("anonymous → UNAUTHORIZED on both mutations", async () => {
    const { fxRatesRouter } = await import("../fxRates");
    const anon = fxRatesRouter.createCaller(makeUnauthenticatedCtx());
    await expect(anon.updateRates({ rates: { USD: 1.1 } })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anon.refresh()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("member (role user) → FORBIDDEN on both mutations, and the stored book is NOT modified", async () => {
    const { fxRatesRouter } = await import("../fxRates");
    const member = fxRatesRouter.createCaller(
      makeAuthenticatedCtx({
        user: { id: 7, username: "member-x", role: "user", email: "x@example.io" } as never,
      })
    );
    await expect(member.updateRates({ rates: { USD: 9.99 } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(member.refresh()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await storedBook()).toBeNull(); // never written by the member
  });

  it("admin updateRates succeeds and persists the book", async () => {
    const { fxRatesRouter } = await import("../fxRates");
    const admin = fxRatesRouter.createCaller(
      makeAuthenticatedCtx({
        user: { id: 99, username: "admin-1", role: "admin", email: "admin@example.io" } as never,
      })
    );
    const res = await admin.updateRates({ rates: { USD: 1.08, NGN: 1690 } });
    expect(res.success).toBe(true);
    expect(await storedBook()).toEqual({ USD: 1.08, NGN: 1690 });
  });

  it("supervisor refresh succeeds against the real provider wire shape", async () => {
    const { fxRatesRouter } = await import("../fxRates");
    const supervisor = fxRatesRouter.createCaller(
      makeAuthenticatedCtx({
        user: { id: 98, username: "sup-1", role: "supervisor", email: "sup@example.io" } as never,
      })
    );
    const res = await supervisor.refresh();
    expect(res.success).toBe(true);
    expect(res.ratesUpdated).toBe(3); // EUR base + USD + NGN
    const book = await storedBook();
    expect(book.EUR).toBe(1);
    expect(book.NGN).toBe(1700.5);
  });

  it("the member READ path (convert) is unaffected by the re-gate", async () => {
    const { fxRatesRouter } = await import("../fxRates");
    const member = fxRatesRouter.createCaller(
      makeAuthenticatedCtx({
        user: { id: 7, username: "member-x", role: "user", email: "x@example.io" } as never,
      })
    );
    const res = await member.convert({ from: "EUR", to: "NGN", amount: 10 });
    expect(res.convertedAmount).toBe(17005); // 10 × 1700.5
  });
});
