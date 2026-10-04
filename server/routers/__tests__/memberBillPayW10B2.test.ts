/**
 * memberBillPayW10B2.test.ts — W10-B2 (2026-10-03)
 *
 * Real-behavior tests for memberBillPayments.pay / confirmPay
 * (server/routers/memberBillPayments.ts on server/lib/memberFunds.ts):
 * REAL embedded PostgreSQL (PGlite wire protocol, memberPayments.test.ts
 * harness pattern) + REAL local HTTP wire servers speaking the Paystack and
 * generic bill-provider response shapes (PAYSTACK_BASE_URL /
 * BILL_PROVIDER_URL overrides — the same real-wire ethos as the PGlite DB;
 * the ONLY doubles are the two external HTTP boundaries, nothing on the
 * production path is mocked).
 *
 * Covers: anonymous → UNAUTHORIZED; missing idempotency key → BAD_REQUEST;
 * gateway unconfigured → PRECONDITION_FAILED with NO rows written;
 * provider unconfigured → PRECONDITION_FAILED BEFORE any charge; amount
 * boundary enforcement (registry MIN/MAX); server-side daily limit over the
 * caller's own rows; happy path to PENDING (awaiting_payment → captured →
 * submitted, NEVER synchronous success); idempotency replay (same key+payload
 * adopted / different payload → CONFLICT); ownership gate (foreign reference
 * → NOT_FOUND); provider rejection after capture → failed + loud
 * failed_refund_pending; unknown outcome held and resolved via provider
 * status lookup (never re-dispatched).
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

let PG_PORT = 0;
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
  PG_PORT = await probeFreePort();
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PGLITE_PORT: String(PG_PORT),
      POSTGRES_URL: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
    },
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
  process.env.POSTGRES_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
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
  // transactions: faithful projection of the columns the rail writes/reads
  // (drizzle/schema.ts:393), including the unique ref + idempotencyKey.
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
      (4242, '09000000001', '1', 3),
      (9999, '09000000002', '2', 3)
    ON CONFLICT DO NOTHING`);
}

// ── Wire servers (external HTTP boundaries only) ────────────────────────────
let gatewayServer: Server | null = null;
let providerServer: Server | null = null;
let gatewayUrl = "";
let providerUrl = "";

const verifyOverrides = new Map<string, { status: string; amountKobo?: number }>();
const initiatedAmounts = new Map<string, number>();
// 2026-10-03 (W10-B2 r2): references whose NEXT initialize call must fail
// with a transient HTTP 500 (gateway error before any charge).
const initFailOnce = new Set<string>();
const initAttempts = new Map<string, number>();
// Provider dispatch scripting: path+reference → behavior.
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
        const ref = String(body.reference);
        initAttempts.set(ref, (initAttempts.get(ref) ?? 0) + 1);
        if (initFailOnce.has(ref)) {
          initFailOnce.delete(ref);
          res.statusCode = 500;
          res.end(JSON.stringify({ status: false, message: "gateway internal error" }));
          return;
        }
        initiatedAmounts.set(ref, Number(body.amount));
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
        const o = verifyOverrides.get(ref);
        res.end(JSON.stringify({
          status: true,
          message: "Verification successful",
          data: {
            status: o?.status ?? "success",
            amount: o?.amountKobo ?? initiatedAmounts.get(ref) ?? 0,
            reference: ref,
            id: 777002,
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
        res.end(JSON.stringify({
          status: statusOverrides.get(ref) ?? "pending",
          provider_ref: `PRV-${ref}`,
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/pay") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const ref = String(body.reference);
        dispatchCounts.set(ref, (dispatchCounts.get(ref) ?? 0) + 1);
        const behavior = dispatchOverrides.get(ref) ?? "accept";
        if (behavior === "accept") {
          res.end(JSON.stringify({ status: "accepted", provider_ref: `PRV-${ref}` }));
          return;
        }
        if (behavior === "reject") {
          res.statusCode = 422;
          res.end(JSON.stringify({ status: "failed", message: "biller rejected the account" }));
          return;
        }
        res.end(JSON.stringify({ unexpected: true })); // malformed 2xx
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
  process.env.BILL_PROVIDER_URL = providerUrl;
}
function unconfigureRails() {
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_BASE_URL;
  delete process.env.BILL_PROVIDER_URL;
}

type Caller = ReturnType<
  (typeof import("../memberBillPayments"))["memberBillPaymentsRouter"]["createCaller"]
>;
let memberCaller: Caller; // user 1 → customer 4242
let foreignCaller: Caller; // user 2 → customer 9999
let noProfileCaller: Caller; // user 3 → no customer profile
let anonCaller: Caller;

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  await startWireServers();
  const { memberBillPaymentsRouter } = await import("../memberBillPayments");
  memberCaller = memberBillPaymentsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 1, username: "member-a", role: "user", email: "a@example.io" } as never,
    })
  );
  foreignCaller = memberBillPaymentsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 2, username: "member-b", role: "user", email: "b@example.io" } as never,
    })
  );
  noProfileCaller = memberBillPaymentsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 3, username: "member-c", role: "user", email: "c@example.io" } as never,
    })
  );
  anonCaller = memberBillPaymentsRouter.createCaller(makeUnauthenticatedCtx());
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
    sql`SELECT status, amount::text, "failureReason", metadata, "customerAccount" FROM transactions WHERE ref = ${ref}`
  );
  return (rows as any).rows?.[0] ?? (rows as any)[0] ?? null;
}

describe("memberBillPayments.pay/confirmPay (W10-B2, 2026-10-03)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(
      anonCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 5000,
        idempotencyKey: "anon-key-01",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.confirmPay({ reference: "BP4242-anon-key-01" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires an idempotency key (missing → BAD_REQUEST)", async () => {
    configureRails();
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 5000,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires a member profile bound to the session (fail-closed)", async () => {
    configureRails();
    await expect(
      noProfileCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 5000,
        idempotencyKey: "noprof-key-01",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects amounts outside the registry MIN/MAX at the input boundary", async () => {
    configureRails();
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 50, // below ₦100 MIN
        idempotencyKey: "bounds-key-1",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 500_001, // above ₦500,000 MAX
        idempotencyKey: "bounds-key-2",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fails closed when the gateway is unconfigured — no rows written", async () => {
    unconfigureRails();
    process.env.BILL_PROVIDER_URL = providerUrl;
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 5000,
        idempotencyKey: "nogw-key-001",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("NOT initiated"),
    });
    expect(await txRow("BP4242-nogw-key-001")).toBeNull();
  });

  it("fails closed when the fulfillment provider is unconfigured — BEFORE any charge", async () => {
    unconfigureRails();
    process.env.PAYSTACK_SECRET_KEY = "sk_wire_test";
    process.env.PAYSTACK_BASE_URL = gatewayUrl;
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 5000,
        idempotencyKey: "noprovider1",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("fulfillment provider is not configured"),
    });
    expect(await txRow("BP4242-noprovider1")).toBeNull();
    expect(initiatedAmounts.has("BP4242-noprovider1")).toBe(false); // never charged
  });

  it("happy path: pay → awaiting_payment PENDING row (never synchronous success); confirm → captured → submitted", async () => {
    configureRails();
    const res = await memberCaller.pay({
      biller: "EKEDC",
      customerNumber: "0123456789",
      meterType: "prepaid",
      amountNGN: 7500,
      idempotencyKey: "happy-key-01",
    });
    expect(res.idempotent).toBe(false);
    expect(res.reference).toBe("BP4242-happy-key-01");
    expect(res.status).toBe("awaiting_payment");
    expect(res.amount).toBe("7500");
    expect(res.authorizationUrl).toBe(
      "http://gateway.test/checkout/BP4242-happy-key-01"
    );
    expect(initiatedAmounts.get(res.reference)).toBe(750_000); // kobo exact

    let row = await txRow(res.reference);
    expect(row.status).toBe("pending");
    expect(row.metadata.providerStatus).toBe("awaiting_payment");
    expect(row.metadata.memberCustomerId).toBe(4242);
    expect(row.metadata.biller).toBe("EKEDC");
    expect(row.customerAccount).toBe("0123456789");

    // Provider NOT contacted before the capture is verified.
    expect(dispatchCounts.get(res.reference) ?? 0).toBe(0);

    const conf = await memberCaller.confirmPay({ reference: res.reference });
    expect(conf.captureStatus).toBe("captured");
    expect(conf.providerStatus).toBe("submitted");
    expect(conf.status).toBe("pending"); // fulfilled asynchronously
    row = await txRow(res.reference);
    expect(row.metadata.providerStatus).toBe("submitted");
    expect(row.metadata.providerRef).toBe("PRV-BP4242-happy-key-01");
    expect(dispatchCounts.get(res.reference)).toBe(1);
  });

  it("idempotency: same key+payload replays (no second row/charge); different payload → CONFLICT", async () => {
    configureRails();
    const replay = await memberCaller.pay({
      biller: "EKEDC",
      customerNumber: "0123456789",
      meterType: "prepaid",
      amountNGN: 7500,
      idempotencyKey: "happy-key-01",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.reference).toBe("BP4242-happy-key-01");

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    const rows = await d!.execute(sql`
      SELECT COUNT(*)::int AS c FROM transactions WHERE ref = 'BP4242-happy-key-01'`);
    const c = (rows as any).rows?.[0]?.c ?? (rows as any)[0]?.c;
    expect(Number(c)).toBe(1);

    await expect(
      memberCaller.pay({
        biller: "DSTV", // different funds terms, same key
        customerNumber: "0123456789",
        amountNGN: 7500,
        idempotencyKey: "happy-key-01",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("confirm replay resolves via provider STATUS LOOKUP — never a second dispatch", async () => {
    configureRails();
    statusOverrides.set("BP4242-happy-key-01", "completed");
    const again = await memberCaller.confirmPay({ reference: "BP4242-happy-key-01" });
    expect(again.idempotent).toBe(true);
    expect(again.resolution).toBe("completed");
    expect(again.status).toBe("success");
    expect(dispatchCounts.get("BP4242-happy-key-01")).toBe(1); // no re-dispatch
    const row = await txRow("BP4242-happy-key-01");
    expect(row.status).toBe("success");
    expect(row.metadata.resolvedVia).toBe("provider_status_lookup");
  });

  it("ownership gate: a foreign member cannot confirm another member's reference (NOT_FOUND, non-enumerating)", async () => {
    configureRails();
    await expect(
      foreignCaller.confirmPay({ reference: "BP4242-happy-key-01" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cross-member same-key reuse (2026-10-03 W10-B2 r2, FUNDS-CRITICAL): member B with A's key + identical payload gets a FRESH operation under B's OWN scope — never a replay of A's initiation", async () => {
    configureRails();
    // Probe P1 regression: identical key AND byte-identical funds payload as
    // member A's "happy-key-01" payment above.
    const b = await foreignCaller.pay({
      biller: "EKEDC",
      customerNumber: "0123456789",
      meterType: "prepaid",
      amountNGN: 7500,
      idempotencyKey: "happy-key-01",
    });
    expect(b.idempotent).toBe(false);
    expect(b.reference).toBe("BP9999-happy-key-01"); // B's OWN derived ref
    expect(b.status).toBe("awaiting_payment");

    // B got his OWN row (own transactionId) — not A's row replayed.
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    const ids = await d!.execute(sql`
      SELECT ref, id, status, metadata FROM transactions
      WHERE ref IN ('BP4242-happy-key-01', 'BP9999-happy-key-01') ORDER BY ref`);
    const rows = (ids as any).rows ?? ids;
    expect(rows).toHaveLength(2);
    const aRow = rows.find((r: any) => r.ref === "BP4242-happy-key-01");
    const bRow = rows.find((r: any) => r.ref === "BP9999-happy-key-01");
    expect(b.transactionId).toBe(bRow.id);
    expect(bRow.id).not.toBe(aRow.id);
    expect(bRow.metadata.memberCustomerId).toBe(9999);
    expect(bRow.metadata.memberUserId).toBe(2);
    expect(bRow.status).toBe("pending");
    // B's charge is kobo-exact against B's OWN reference.
    expect(initiatedAmounts.get("BP9999-happy-key-01")).toBe(750_000);

    // Same-member replay within B's OWN scope still adopts.
    const replay = await foreignCaller.pay({
      biller: "EKEDC",
      customerNumber: "0123456789",
      meterType: "prepaid",
      amountNGN: 7500,
      idempotencyKey: "happy-key-01",
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.reference).toBe("BP9999-happy-key-01");
    expect(replay.transactionId).toBe(b.transactionId);

    // Payload-hash mismatch still CONFLICTs within B's own scope.
    await expect(
      foreignCaller.pay({
        biller: "DSTV", // different funds terms, same key, same member
        customerNumber: "0123456789",
        amountNGN: 7500,
        idempotencyKey: "happy-key-01",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // B can confirm his OWN reference; A's remains invisible to him.
    const conf = await foreignCaller.confirmPay({ reference: b.reference });
    expect(conf.captureStatus).toBe("captured");
    expect(conf.providerStatus).toBe("submitted");
    await expect(
      foreignCaller.confirmPay({ reference: "BP4242-happy-key-01" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unknown outcome is HELD (never success) and resolved later via status lookup", async () => {
    configureRails();
    const res = await memberCaller.pay({
      biller: "IKEDC",
      customerNumber: "9876543210",
      amountNGN: 2000,
      idempotencyKey: "unknown-key1",
    });
    dispatchOverrides.set(res.reference, "malformed"); // 2xx without status → unknown
    const conf = await memberCaller.confirmPay({ reference: res.reference });
    expect(conf.providerStatus).toBe("unknown_outcome");
    expect(conf.status).toBe("pending");
    let row = await txRow(res.reference);
    expect(row.status).toBe("pending");

    // Retry: status lookup says failed → honest failure, NO re-dispatch.
    statusOverrides.set(res.reference, "failed");
    const resolved = await memberCaller.confirmPay({ reference: res.reference });
    expect(resolved.resolution).toBe("failed");
    expect(resolved.status).toBe("failed");
    expect(dispatchCounts.get(res.reference)).toBe(1);
    row = await txRow(res.reference);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBeTruthy();
  });

  it("provider rejection AFTER capture → failed row + loud failed_refund_pending (never silent)", async () => {
    configureRails();
    const res = await memberCaller.pay({
      biller: "WAEC",
      customerNumber: "WAEC12345",
      amountNGN: 3500,
      idempotencyKey: "reject-key-1",
    });
    dispatchOverrides.set(res.reference, "reject");
    const conf = await memberCaller.confirmPay({ reference: res.reference });
    expect(conf.status).toBe("failed");
    expect(conf.refundStatus).toBe("failed_refund_pending");
    const row = await txRow(res.reference);
    expect(row.status).toBe("failed");
    expect(row.metadata.providerStatus).toBe("rejected");
    expect(row.metadata.refund.status).toBe("failed_refund_pending");
    expect(row.metadata.refund.capturedAmountNGN).toBe("3500.00");
  });

  it("honest unpaid surface: gateway 'failed' never captures or dispatches", async () => {
    configureRails();
    const res = await memberCaller.pay({
      biller: "GOtv",
      customerNumber: "1234567890",
      amountNGN: 1500,
      idempotencyKey: "unpaid-key-1",
    });
    verifyOverrides.set(res.reference, { status: "failed" });
    const conf = await memberCaller.confirmPay({ reference: res.reference });
    expect(conf.status).toBe("failed");
    expect(conf.captureStatus).toBe("failed");
    expect(dispatchCounts.get(res.reference) ?? 0).toBe(0);
  });

  it("refuses capture when the gateway amount does not match the recorded row", async () => {
    configureRails();
    const res = await memberCaller.pay({
      biller: "JAMB",
      customerNumber: "JAMB12345",
      amountNGN: 5000,
      idempotencyKey: "amt-mismatch1",
    });
    verifyOverrides.set(res.reference, { status: "success", amountKobo: 100 });
    await expect(
      memberCaller.confirmPay({ reference: res.reference })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    const row = await txRow(res.reference);
    expect(row.status).toBe("pending"); // never captured
    expect(dispatchCounts.get(res.reference) ?? 0).toBe(0);
  });

  it("enforces the server-side daily limit over the caller's OWN rows", async () => {
    configureRails();
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    // Seed a caller-owned bill row of ₦1,980,000 today (pending counts);
    // earlier tests in this file left ₦12,500 of counted caller rows, so
    // ₦7,500 of the ₦2,000,000 daily limit headroom remains.
    await d!.execute(sql`
      INSERT INTO transactions (ref, "agentId", type, amount, status, metadata, "createdAt")
      VALUES ('BPDAYLIM1', 1, 'Bill Payment', '1980000.00', 'pending',
              '{"memberCustomerId":4242,"biller":"EKEDC"}'::json, now())`);
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 10_000, // 1,992,500 + 10,000 > ₦2,000,000 daily limit
        idempotencyKey: "daylimit-01",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Daily bill payment limit"),
    });
    // A foreign member's rows never count against the caller.
    await d!.execute(sql`
      INSERT INTO transactions (ref, "agentId", type, amount, status, metadata, "createdAt")
      VALUES ('BPDAYLIM2', 2, 'Bill Payment', '1999900.00', 'pending',
              '{"memberCustomerId":9999,"biller":"EKEDC"}'::json, now())`);
    const ok = await memberCaller.pay({
      biller: "EKEDC",
      customerNumber: "0123456789",
      amountNGN: 100, // exactly at the remaining limit headroom
      idempotencyKey: "daylimit-02",
    });
    expect(ok.status).toBe("awaiting_payment");
  });

  it("gateway 500 → same-key retry succeeds cleanly (2026-10-03 W10-B2 r2, defect 2): pre-commitment failure never bricks the key", async () => {
    configureRails();
    const ref = "BP4242-retry-500-01";
    initFailOnce.add(ref); // first initialize → transient HTTP 500
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 1200,
        idempotencyKey: "retry-500-01",
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    // The uncommitted attempt left a failed row (nothing charged/dispatched).
    let row = await txRow(ref);
    expect(row.status).toBe("failed");
    expect(initiatedAmounts.has(ref)).toBe(false); // never a successful charge

    // Same key + same payload: the retry adopts and RESETS the uncommitted
    // failed row (dated audit note), then initiates cleanly.
    const retry = await memberCaller.pay({
      biller: "EKEDC",
      customerNumber: "0123456789",
      amountNGN: 1200,
      idempotencyKey: "retry-500-01",
    });
    expect(retry.idempotent).toBe(false);
    expect(retry.reference).toBe(ref);
    expect(retry.status).toBe("awaiting_payment");

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    const rows = await d!.execute(sql`
      SELECT COUNT(*)::int AS c, MIN(id)::int AS id FROM transactions WHERE ref = ${ref}`);
    const r0 = (rows as any).rows?.[0] ?? (rows as any)[0];
    expect(Number(r0.c)).toBe(1); // single final row
    expect(retry.transactionId).toBe(Number(r0.id)); // SAME row reused

    row = await txRow(ref);
    expect(row.status).toBe("pending");
    expect(row.metadata.providerStatus).toBe("awaiting_payment");
    expect(row.metadata.retryReset.at).toBeTruthy(); // dated audit note
    expect(String(row.metadata.retryReset.previousFailure)).toContain("500");
    expect(initAttempts.get(ref)).toBe(2); // failed attempt + one retry
    expect(initiatedAmounts.get(ref)).toBe(120_000); // exactly ONE charge

    // The recovered row completes the normal capture → dispatch path.
    const conf = await memberCaller.confirmPay({ reference: ref });
    expect(conf.captureStatus).toBe("captured");
    expect(conf.providerStatus).toBe("submitted");
    expect(dispatchCounts.get(ref)).toBe(1);
  });

  it("a row that DID reach provider commitment can NOT be voided/reset by a same-key retry (2026-10-03 W10-B2 r2)", async () => {
    configureRails();
    // Hand-seed a committed-then-failed row (captured + dispatched, provider
    // rejection after capture) with NO completed idempotency record, so the
    // retry reaches the row-adoption logic directly.
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    await d!.execute(sql`
      INSERT INTO transactions (ref, "agentId", type, amount, status, "failureReason", metadata)
      VALUES ('BP4242-noreset-001', 1, 'Bill Payment', '900.00', 'failed',
              'provider rejected after capture',
              '{"memberUserId":1,"memberCustomerId":4242,"biller":"EKEDC",
                "captureStatus":"captured","providerStatus":"rejected",
                "providerRef":"PRV-COMMIT-1","gatewayRef":"777002",
                "refund":{"status":"failed_refund_pending"}}'::json)`);
    await expect(
      memberCaller.pay({
        biller: "EKEDC",
        customerNumber: "0123456789",
        amountNGN: 900,
        idempotencyKey: "noreset-001",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("terminal state"),
    });
    // Untouched: still failed, commitment markers intact, never re-charged.
    const row = await txRow("BP4242-noreset-001");
    expect(row.status).toBe("failed");
    expect(row.metadata.providerStatus).toBe("rejected");
    expect(row.metadata.providerRef).toBe("PRV-COMMIT-1");
    expect(row.metadata.refund.status).toBe("failed_refund_pending");
    expect(row.metadata.retryReset).toBeUndefined();
    expect(initiatedAmounts.has("BP4242-noreset-001")).toBe(false);
  });
});
