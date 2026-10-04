/**
 * memberMobileMoneyFundsW10B2.test.ts — W10-B2 (2026-10-03)
 *
 * Real-behavior tests for memberMobileMoney.cashIn / confirmCashIn / cashOut
 * (server/routers/memberMobileMoney.ts on server/lib/memberFunds.ts). REAL
 * PGlite PostgreSQL + REAL local HTTP wire servers for the Paystack and
 * mobile-money provider boundaries (env overrides) — the ONLY doubles are
 * the external HTTP boundaries (memberPayments.test.ts harness pattern).
 *
 * Covers: anonymous → UNAUTHORIZED; missing caller phone → fail-closed;
 * amount bounds; cashIn fail-closed when gateway OR provider unconfigured
 * (no charge, no rows); cashIn happy path → captured → /cashin submitted;
 * idempotency replay / CONFLICT; foreign confirm → NOT_FOUND; cashOut honest
 * v1: FAILS CLOSED (PRECONDITION_FAILED, nothing written) when
 * MOBILE_MONEY_PROVIDER_URL is absent; cashOut accepted → PENDING submitted
 * (settlement provider-side, never synchronous success); cashOut rejected →
 * loud PRECONDITION_FAILED + failed row; cashOut unknown outcome held and
 * resolved via status lookup without re-dispatch.
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
const dispatchOverrides = new Map<string, "accept" | "reject" | "malformed">();
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
            id: 777004,
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
      if (req.method === "POST" && (req.url === "/cashin" || req.url === "/cashout")) {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const ref = String(body.reference);
        dispatchCounts.set(`${req.url}:${ref}`, (dispatchCounts.get(`${req.url}:${ref}`) ?? 0) + 1);
        const behavior = dispatchOverrides.get(ref) ?? "accept";
        if (behavior === "accept") {
          res.end(JSON.stringify({ status: "accepted", provider_ref: `PRV-${ref}` }));
          return;
        }
        if (behavior === "reject") {
          res.statusCode = 422;
          res.end(JSON.stringify({ status: "failed", message: "wallet debit declined" }));
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

function configureAll() {
  process.env.PAYSTACK_SECRET_KEY = "sk_wire_test";
  process.env.PAYSTACK_BASE_URL = gatewayUrl;
  process.env.MOBILE_MONEY_PROVIDER_URL = providerUrl;
}
function unconfigureAll() {
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_BASE_URL;
  delete process.env.MOBILE_MONEY_PROVIDER_URL;
}

type Caller = ReturnType<
  (typeof import("../memberMobileMoney"))["memberMobileMoneyRouter"]["createCaller"]
>;
let memberCaller: Caller;
let foreignCaller: Caller;
let noProfileCaller: Caller;
let anonCaller: Caller;

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  await startWireServers();
  const { memberMobileMoneyRouter } = await import("../memberMobileMoney");
  memberCaller = memberMobileMoneyRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 1, username: "member-a", role: "user", email: "a@example.io" } as never,
    })
  );
  foreignCaller = memberMobileMoneyRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 2, username: "member-b", role: "user", email: "b@example.io" } as never,
    })
  );
  noProfileCaller = memberMobileMoneyRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 3, username: "member-c", role: "user", email: "c@example.io" } as never,
    })
  );
  anonCaller = memberMobileMoneyRouter.createCaller(makeUnauthenticatedCtx());
}, 90_000);

afterAll(async () => {
  unconfigureAll();
  pgliteChild?.kill();
  await new Promise(r => gatewayServer?.close(r));
  await new Promise(r => providerServer?.close(r));
});

async function txRow(ref: string) {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  const rows = await d!.execute(
    sql`SELECT status, type, amount::text, "customerPhone", "failureReason", metadata FROM transactions WHERE ref = ${ref}`
  );
  return (rows as any).rows?.[0] ?? (rows as any)[0] ?? null;
}

describe("memberMobileMoney funds mutations (W10-B2, 2026-10-03)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on all three mutations", async () => {
    await expect(
      anonCaller.cashIn({ provider: "MTN MoMo", amountNGN: 5000, idempotencyKey: "anon-key-01" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.confirmCashIn({ reference: "CI4242-anon-key-01" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.cashOut({ provider: "MTN MoMo", amountNGN: 5000, idempotencyKey: "anon-key-02" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails closed for a caller with no registered phone", async () => {
    configureAll();
    await expect(
      noProfileCaller.cashIn({ provider: "MTN MoMo", amountNGN: 5000, idempotencyKey: "nophone-001" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      noProfileCaller.cashOut({ provider: "MTN MoMo", amountNGN: 5000, idempotencyKey: "nophone-002" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("enforces the ₦100–₦300,000 bounds at the input boundary", async () => {
    configureAll();
    await expect(
      memberCaller.cashIn({ provider: "MTN MoMo", amountNGN: 99, idempotencyKey: "bounds-0001" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      memberCaller.cashOut({ provider: "MTN MoMo", amountNGN: 300_001, idempotencyKey: "bounds-0002" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("cashIn fails closed when the gateway is unconfigured — no rows written", async () => {
    unconfigureAll();
    process.env.MOBILE_MONEY_PROVIDER_URL = providerUrl;
    await expect(
      memberCaller.cashIn({ provider: "MTN MoMo", amountNGN: 5000, idempotencyKey: "ci-nogw-001" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await txRow("CI4242-ci-nogw-001")).toBeNull();
  });

  it("cashIn fails closed when the provider is unconfigured — BEFORE any charge", async () => {
    unconfigureAll();
    process.env.PAYSTACK_SECRET_KEY = "sk_wire_test";
    process.env.PAYSTACK_BASE_URL = gatewayUrl;
    await expect(
      memberCaller.cashIn({ provider: "MTN MoMo", amountNGN: 5000, idempotencyKey: "ci-noprov-01" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await txRow("CI4242-ci-noprov-01")).toBeNull();
    expect(initiatedAmounts.has("CI4242-ci-noprov-01")).toBe(false);
  });

  it("cashIn happy path: capture → confirm → provider credit submitted (never synchronous success)", async () => {
    configureAll();
    const res = await memberCaller.cashIn({
      provider: "MTN MoMo",
      amountNGN: 5000,
      idempotencyKey: "ci-happy-001",
    });
    expect(res.reference).toBe("CI4242-ci-happy-001");
    expect(res.status).toBe("awaiting_payment");
    expect(initiatedAmounts.get(res.reference)).toBe(500_000);
    let row = await txRow(res.reference);
    expect(row.type).toBe("Cash In");
    expect(row.customerPhone).toBe(CALLER_PHONE);
    expect(row.metadata.provider).toBe("MTN MoMo");
    expect(dispatchCounts.get(`/cashin:${res.reference}`) ?? 0).toBe(0);

    const conf = await memberCaller.confirmCashIn({ reference: res.reference });
    expect(conf.captureStatus).toBe("captured");
    expect(conf.providerStatus).toBe("submitted");
    expect(conf.status).toBe("pending"); // settled asynchronously by provider
    row = await txRow(res.reference);
    expect(row.metadata.providerStatus).toBe("submitted");
    expect(dispatchCounts.get(`/cashin:${res.reference}`)).toBe(1);
  });

  it("cashIn idempotency: replay adopted; different payload → CONFLICT", async () => {
    configureAll();
    const replay = await memberCaller.cashIn({
      provider: "MTN MoMo",
      amountNGN: 5000,
      idempotencyKey: "ci-happy-001",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.reference).toBe("CI4242-ci-happy-001");
    await expect(
      memberCaller.cashIn({
        provider: "Airtel Money", // different payload, same key
        amountNGN: 5000,
        idempotencyKey: "ci-happy-001",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("confirmCashIn ownership gate: foreign reference → NOT_FOUND", async () => {
    configureAll();
    await expect(
      foreignCaller.confirmCashIn({ reference: "CI4242-ci-happy-001" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cashOut FAILS CLOSED when MOBILE_MONEY_PROVIDER_URL is absent — nothing written, no success recorded", async () => {
    unconfigureAll();
    await expect(
      memberCaller.cashOut({ provider: "MTN MoMo", amountNGN: 2000, idempotencyKey: "co-noprov-01" })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("NOT recorded"),
    });
    expect(await txRow("CO4242-co-noprov-01")).toBeNull();
    // And the gateway is NEVER involved in cash-out (no invented payout leg).
    expect(initiatedAmounts.has("CO4242-co-noprov-01")).toBe(false);
  });

  it("cashOut accepted → PENDING request, provider-side settlement, honest metadata", async () => {
    configureAll();
    const res = await memberCaller.cashOut({
      provider: "Airtel Money",
      amountNGN: 8000,
      idempotencyKey: "co-happy-001",
    });
    expect(res.reference).toBe("CO4242-co-happy-001");
    expect(res.status).toBe("pending"); // NEVER synchronous success
    expect(res.providerStatus).toBe("submitted");
    const row = await txRow(res.reference);
    expect(row.type).toBe("Cash Out");
    expect(row.status).toBe("pending");
    expect(row.metadata.settlement).toBe("provider_side");
    expect(row.metadata.memberCustomerId).toBe(4242);
    expect(dispatchCounts.get(`/cashout:${res.reference}`)).toBe(1);
    // No Paystack capture exists for cash-out.
    expect(initiatedAmounts.has(res.reference)).toBe(false);
  });

  it("cashOut replay returns the recorded outcome without a second dispatch", async () => {
    configureAll();
    const replay = await memberCaller.cashOut({
      provider: "Airtel Money",
      amountNGN: 8000,
      idempotencyKey: "co-happy-001",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.reference).toBe("CO4242-co-happy-001");
    expect(dispatchCounts.get("/cashout:CO4242-co-happy-001")).toBe(1);
    await expect(
      memberCaller.cashOut({
        provider: "MTN MoMo",
        amountNGN: 9000,
        idempotencyKey: "co-happy-001",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cashOut rejected → loud PRECONDITION_FAILED + failed row (never silent)", async () => {
    configureAll();
    // Predict the derived reference to script the provider.
    dispatchOverrides.set("CO4242-co-reject-01", "reject");
    await expect(
      memberCaller.cashOut({ provider: "Glo Xtra", amountNGN: 1500, idempotencyKey: "co-reject-01" })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("rejected"),
    });
    // derived ref: CO4242-co-reject-01 (key is co-reject-01)
    const row = await txRow("CO4242-co-reject-01");
    expect(row.status).toBe("failed");
    expect(row.metadata.providerStatus).toBe("rejected");
    expect(row.failureReason).toContain("wallet debit declined");
  });

  it("cashOut unknown outcome is held pending and resolved via status lookup (no re-dispatch)", async () => {
    configureAll();
    dispatchOverrides.set("CO4242-co-unknown-1", "malformed");
    const res = await memberCaller.cashOut({
      provider: "9PSB",
      amountNGN: 2500,
      idempotencyKey: "co-unknown-1",
    });
    expect(res.providerStatus).toBe("unknown_outcome");
    expect(res.status).toBe("pending");

    // Retry with the same key replays the recorded pending outcome.
    const replay = await memberCaller.cashOut({
      provider: "9PSB",
      amountNGN: 2500,
      idempotencyKey: "co-unknown-1",
    });
    expect(replay.idempotent).toBe(true);
    expect(dispatchCounts.get("/cashout:CO4242-co-unknown-1")).toBe(1);
  });
});
