/**
 * memberAirtimeVendW10B2.test.ts — W10-B2 (2026-10-03)
 *
 * Real-behavior tests for memberAirtime.vend / confirmVend
 * (server/routers/memberAirtime.ts on server/lib/memberFunds.ts). REAL PGlite
 * PostgreSQL + REAL local HTTP wire servers for the Paystack and airtime
 * provider boundaries (PAYSTACK_BASE_URL / AIRTIME_PROVIDER_URL overrides) —
 * the ONLY doubles are the external HTTP boundaries; nothing on the
 * production path is mocked (memberPayments.test.ts harness pattern).
 *
 * Covers: anonymous → UNAUTHORIZED; missing member phone → fail-closed
 * PRECONDITION_FAILED; amount bounds ₦50–₦50,000 at the boundary; gateway
 * unconfigured → PRECONDITION_FAILED with no rows; caller-phone scoping
 * (transactions.customerPhone = CALLER phone, beneficiary phone recorded in
 * metadata, never re-scoping identity); happy path vend → awaiting_payment →
 * confirmVend → captured → submitted (never synchronous success);
 * idempotency replay adopted / different payload → CONFLICT; foreign
 * confirmVend → NOT_FOUND; unknown outcome held then resolved via provider
 * status lookup without re-dispatch.
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

const CALLER_PHONE = "09000000001";
const BENEFICIARY_PHONE = "08031234567";
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

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE,
      "kycLevel" integer NOT NULL DEFAULT 0
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "idempotencyKey" varchar(64) UNIQUE,
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
      "receiptPrinted" boolean DEFAULT false,
      "smsSent" boolean DEFAULT false,
      "fraudScore" numeric(5,2) DEFAULT '0.00',
      "velocityBreached" boolean DEFAULT false,
      "velocityReason" text,
      "approvalRequired" boolean DEFAULT false,
      "approvedBy" varchar(64),
      "approvedAt" timestamp,
      "deviceToken" varchar(64),
      "deletedAt" timestamp,
      "tenantId" integer,
      metadata json,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id serial PRIMARY KEY,
      key varchar(192) NOT NULL UNIQUE,
      journey varchar(32) NOT NULL,
      "payloadHash" varchar(64),
      status varchar(16) NOT NULL DEFAULT 'in_progress',
      result jsonb,
      error text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      "expiresAt" timestamp NOT NULL
    )`);
  await db.execute(sql`
    INSERT INTO customers (id, phone, "keycloakSub", "kycLevel") VALUES
      (4242, ${CALLER_PHONE}, '1', 3),
      (9999, '09000000002', '2', 3)
    ON CONFLICT DO NOTHING`);
}

let gatewayServer: Server | null = null;
let providerServer: Server | null = null;
let gatewayUrl = "";
let providerUrl = "";
const initiatedAmounts = new Map<string, number>();
const dispatchOverrides = new Map<string, "accept" | "malformed">();
const statusOverrides = new Map<string, "completed" | "failed" | "pending">();
const dispatchCounts = new Map<string, number>();

async function startWireServers() {
  const http = await import("node:http");
  gatewayServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/transaction/initialize") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        initiatedAmounts.set(String(body.reference), Number(body.amount));
        res.end(JSON.stringify({
          status: true,
          message: "Authorization URL created",
          data: {
            authorization_url: `http://gateway.test/checkout/${body.reference}`,
            access_code: "ac_wire_test",
            reference: body.reference,
          },
        }));
        return;
      }
      const m = req.url?.match(/^\/transaction\/verify\/(.+)$/);
      if (req.method === "GET" && m) {
        const ref = decodeURIComponent(m[1]);
        res.end(JSON.stringify({
          status: true,
          message: "Verification successful",
          data: {
            status: "success",
            amount: initiatedAmounts.get(ref) ?? 0,
            reference: ref,
            id: 777003,
            paid_at: "2026-10-03T00:00:00.000Z",
            channel: "card",
          },
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ status: false, message: "not found" }));
    });
  });
  providerServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const statusMatch = req.url?.match(/^\/status\/(.+)$/);
      if (req.method === "GET" && statusMatch) {
        const ref = decodeURIComponent(statusMatch[1]);
        res.end(JSON.stringify({ status: statusOverrides.get(ref) ?? "pending" }));
        return;
      }
      if (req.method === "POST" && req.url === "/vend") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const ref = String(body.reference);
        dispatchCounts.set(ref, (dispatchCounts.get(ref) ?? 0) + 1);
        if ((dispatchOverrides.get(ref) ?? "accept") === "accept") {
          res.end(JSON.stringify({ status: "accepted", provider_ref: `PRV-${ref}` }));
          return;
        }
        res.end(JSON.stringify({ unexpected: true })); // malformed → unknown
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ status: "failed", message: "not found" }));
    });
  });
  await new Promise<void>(r => gatewayServer!.listen(0, "127.0.0.1", r));
  await new Promise<void>(r => providerServer!.listen(0, "127.0.0.1", r));
  const g = gatewayServer.address();
  const p = providerServer.address();
  gatewayUrl = `http://127.0.0.1:${typeof g === "object" && g ? g.port : 0}`;
  providerUrl = `http://127.0.0.1:${typeof p === "object" && p ? p.port : 0}`;
}

function configureRails() {
  process.env.PAYSTACK_SECRET_KEY = "sk_wire_test";
  process.env.PAYSTACK_BASE_URL = gatewayUrl;
  process.env.AIRTIME_PROVIDER_URL = providerUrl;
}
function unconfigureRails() {
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_BASE_URL;
  delete process.env.AIRTIME_PROVIDER_URL;
}

type Caller = ReturnType<
  (typeof import("../memberAirtime"))["memberAirtimeRouter"]["createCaller"]
>;
let memberCaller: Caller;
let foreignCaller: Caller;
let noProfileCaller: Caller;
let anonCaller: Caller;

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  await startWireServers();
  const { memberAirtimeRouter } = await import("../memberAirtime");
  memberCaller = memberAirtimeRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 1, username: "member-a", role: "user", email: "a@example.io" } as never,
    })
  );
  foreignCaller = memberAirtimeRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 2, username: "member-b", role: "user", email: "b@example.io" } as never,
    })
  );
  noProfileCaller = memberAirtimeRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 3, username: "member-c", role: "user", email: "c@example.io" } as never,
    })
  );
  anonCaller = memberAirtimeRouter.createCaller(makeUnauthenticatedCtx());
}, 90_000);

afterAll(async () => {
  unconfigureRails();
  pgliteChild?.kill();
  await new Promise(r => gatewayServer?.close(r));
  await new Promise(r => providerServer?.close(r));
});

async function txRow(ref: string) {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  const rows = await d!.execute(
    sql`SELECT status, amount::text, "customerPhone", metadata FROM transactions WHERE ref = ${ref}`
  );
  return (rows as any).rows?.[0] ?? (rows as any)[0] ?? null;
}

describe("memberAirtime.vend/confirmVend (W10-B2, 2026-10-03)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(
      anonCaller.vend({ network: "MTN", amountNGN: 500, idempotencyKey: "anon-key-01" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.confirmVend({ reference: "AV4242-anon-key-01" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails closed for a caller with no registered phone", async () => {
    configureRails();
    await expect(
      noProfileCaller.vend({ network: "MTN", amountNGN: 500, idempotencyKey: "nophone-001" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("enforces the ₦50–₦50,000 bounds at the input boundary", async () => {
    configureRails();
    await expect(
      memberCaller.vend({ network: "MTN", amountNGN: 49, idempotencyKey: "bounds-0001" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      memberCaller.vend({ network: "MTN", amountNGN: 50_001, idempotencyKey: "bounds-0002" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      memberCaller.vend({
        network: "MTN",
        phoneNumber: "12345", // not a Nigerian phone
        amountNGN: 500,
        idempotencyKey: "bounds-0003",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fails closed when the gateway is unconfigured — no rows written", async () => {
    unconfigureRails();
    process.env.AIRTIME_PROVIDER_URL = providerUrl;
    await expect(
      memberCaller.vend({ network: "Glo", amountNGN: 1000, idempotencyKey: "nogw-key-01" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await txRow("AV4242-nogw-key-01")).toBeNull();
  });

  it("happy path: vend defaults beneficiary to the CALLER phone, row scoped to caller, confirm dispatches after verified capture", async () => {
    configureRails();
    const res = await memberCaller.vend({
      network: "MTN",
      amountNGN: 1000,
      idempotencyKey: "vend-key-001",
    });
    expect(res.reference).toBe("AV4242-vend-key-001");
    expect(res.status).toBe("awaiting_payment");
    expect(initiatedAmounts.get(res.reference)).toBe(100_000);
    let row = await txRow(res.reference);
    expect(row.customerPhone).toBe(CALLER_PHONE); // caller identity
    expect(row.metadata.phoneNumber).toBe(CALLER_PHONE); // default beneficiary
    expect(row.metadata.callerPhone).toBe(CALLER_PHONE);
    expect(row.metadata.network).toBe("MTN");
    expect(row.status).toBe("pending");
    expect(dispatchCounts.get(res.reference) ?? 0).toBe(0);

    const conf = await memberCaller.confirmVend({ reference: res.reference });
    expect(conf.captureStatus).toBe("captured");
    expect(conf.providerStatus).toBe("submitted");
    row = await txRow(res.reference);
    expect(row.metadata.providerStatus).toBe("submitted");
    expect(dispatchCounts.get(res.reference)).toBe(1);
  });

  it("a third-party beneficiary is allowed but NEVER re-scopes identity", async () => {
    configureRails();
    const res = await memberCaller.vend({
      network: "Airtel",
      phoneNumber: BENEFICIARY_PHONE,
      amountNGN: 200,
      idempotencyKey: "third-party1",
    });
    const row = await txRow(res.reference);
    expect(row.customerPhone).toBe(CALLER_PHONE); // caller scope, not beneficiary
    expect(row.metadata.phoneNumber).toBe(BENEFICIARY_PHONE);
    expect(row.metadata.memberCustomerId).toBe(4242);
  });

  it("idempotency: same key+payload replays; different payload → CONFLICT", async () => {
    configureRails();
    const replay = await memberCaller.vend({
      network: "MTN",
      amountNGN: 1000,
      idempotencyKey: "vend-key-001",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.reference).toBe("AV4242-vend-key-001");
    await expect(
      memberCaller.vend({
        network: "MTN",
        amountNGN: 2000, // different funds terms, same key
        idempotencyKey: "vend-key-001",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    const rows = await d!.execute(sql`
      SELECT COUNT(*)::int AS c FROM transactions WHERE ref = 'AV4242-vend-key-001'`);
    const c = (rows as any).rows?.[0]?.c ?? (rows as any)[0]?.c;
    expect(Number(c)).toBe(1);
  });

  it("ownership gate: foreign confirm → NOT_FOUND (non-enumerating)", async () => {
    configureRails();
    await expect(
      foreignCaller.confirmVend({ reference: "AV4242-vend-key-001" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unknown outcome is held pending and resolved via status lookup (no re-dispatch)", async () => {
    configureRails();
    const res = await memberCaller.vend({
      network: "9mobile",
      amountNGN: 300,
      idempotencyKey: "unknown-0001",
    });
    dispatchOverrides.set(res.reference, "malformed");
    const conf = await memberCaller.confirmVend({ reference: res.reference });
    expect(conf.providerStatus).toBe("unknown_outcome");
    expect(conf.status).toBe("pending");
    statusOverrides.set(res.reference, "completed");
    const resolved = await memberCaller.confirmVend({ reference: res.reference });
    expect(resolved.resolution).toBe("completed");
    expect(resolved.status).toBe("success");
    expect(dispatchCounts.get(res.reference)).toBe(1); // never re-sent
  });
});
