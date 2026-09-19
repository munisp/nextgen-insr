/**
 * merchantPayoutH2.integration.test.ts — H2-wave (2026-09) REAL-DB tests for
 * the legacy insureportal payout path. Spawns the platform's PGlite
 * wire-protocol server (tests/integration/setup/pgliteServer.mjs) and points
 * insureportal's real getDb() at it, then calls the PRODUCTION tRPC
 * procedures through createCaller.
 *
 * Proves:
 *   - initiatePayout with ANOTHER merchant's id → 403 (caller↔merchant
 *     binding via keycloakSub)
 *   - keycloak principal with NO bound merchant → 403
 *   - insufficient wallet → payout rejected AND balance unchanged (the
 *     guarded debit is atomic with initiation)
 *   - a valid initiation debits the wallet atomically in the same tx
 *   - approvePayout: non-admin → 403, initiator approving own payout → 403
 *     (maker-checker), a second admin → success
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PGLITE_PORT = 54331;
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PGLITE_PORT}/postgres`;

let child: ChildProcess;
let merchantPayoutSettlementRouter: typeof import("../../server/routers/merchantPayoutSettlement").merchantPayoutSettlementRouter;
let getDb: typeof import("../../server/db").getDb;

function waitReady(proc: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("PGlite not ready")), timeoutMs);
    let stderr = "";
    proc.stderr?.on("data", c => (stderr += String(c)));
    proc.stdout?.on("data", c => {
      if (String(c).includes("PGLITE_READY")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", code => {
      clearTimeout(t);
      reject(new Error(`PGlite exited early (${code})\n${stderr}`));
    });
  });
}

function ctxFor(user: TrpcContext["user"]) {
  return {
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const merchantUser = {
  id: 930001,
  email: "m1@h2.test",
  name: "Merchant One",
  role: "user",
  keycloakSub: "h2-merchant-sub-1",
} as unknown as TrpcContext["user"];

const unboundUser = {
  id: 930002,
  email: "unbound@h2.test",
  name: "Unbound",
  role: "user",
  keycloakSub: "h2-unbound-sub",
} as unknown as TrpcContext["user"];

const adminA = {
  id: 930010,
  email: "adminA@h2.test",
  name: "Admin A",
  role: "admin",
  keycloakSub: "h2-admin-a",
} as unknown as TrpcContext["user"];

const adminB = {
  id: 930011,
  email: "adminB@h2.test",
  name: "Admin B",
  role: "admin",
  keycloakSub: "h2-admin-b",
} as unknown as TrpcContext["user"];

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS "merchants" (
  "id" serial PRIMARY KEY,
  "merchantCode" varchar(20) NOT NULL,
  "businessName" varchar(255) NOT NULL,
  "ownerName" varchar(255) NOT NULL,
  "email" varchar(320) NOT NULL,
  "phone" varchar(20) NOT NULL,
  "address" text,
  "category" varchar(32) DEFAULT 'other' NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "rcNumber" varchar(32),
  "tinNumber" varchar(32),
  "keycloakSub" varchar(128),
  "preferredAgentId" integer,
  "passwordHash" varchar(255),
  "tenantId" integer,
  "settlementAccountNumber" varchar(20),
  "settlementBankCode" varchar(10),
  "settlementBankName" varchar(64),
  "walletBalance" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "totalVolume" numeric(15,2) DEFAULT '0.00' NOT NULL,
  "totalTransactions" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "deletedAt" timestamp
);
CREATE TABLE IF NOT EXISTS "merchant_payouts" (
  "id" serial PRIMARY KEY,
  "merchant_id" integer NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "currency" text DEFAULT 'NGN' NOT NULL,
  "bank_code" text NOT NULL,
  "account_number" text NOT NULL,
  "account_name" text NOT NULL,
  "reference" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "processed_at" timestamp,
  "failure_reason" text,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "tx_count" integer DEFAULT 0,
  "initiated_by" integer,
  "created_at" timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigserial PRIMARY KEY,
  "agentId" integer,
  "userId" varchar(32),
  "action" varchar(128) NOT NULL,
  "resource" varchar(64),
  "resourceId" varchar(64),
  "ipAddress" varchar(45),
  "userAgent" varchar(256),
  "status" varchar(16) DEFAULT 'success',
  "metadata" json,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "merchant_settlement_change_requests" (
  "id" serial PRIMARY KEY,
  "merchantId" integer NOT NULL,
  "newAccountNumber" varchar(20) NOT NULL,
  "newBankCode" varchar(10) NOT NULL,
  "newBankName" varchar(64) NOT NULL,
  "hashedOtp" varchar(128) NOT NULL,
  "otpExpiresAt" timestamp NOT NULL,
  "otpAttempts" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "requestedBy" integer NOT NULL,
  "appliedAt" timestamp,
  "holdUntil" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
`;

async function seedMerchant(over: {
  merchantCode: string;
  keycloakSub?: string;
  status?: string;
  walletBalance?: string;
}) {
  const db = (await getDb())!;
  // Test fixture: all values are test-controlled constants.
  const sub = over.keycloakSub ? `'${over.keycloakSub}'` : "NULL";
  const r = await db.execute(
    `INSERT INTO merchants ("merchantCode","businessName","ownerName","email","phone","category","status","keycloakSub","settlementAccountNumber","settlementBankCode","settlementBankName","walletBalance")
     VALUES ('${over.merchantCode}','H2 Test Merchant','H2 Owner','${over.merchantCode.toLowerCase()}@h2.test','08030000001','retail','${over.status ?? "pending"}',${sub},'1112223334','044','Access Bank','${over.walletBalance ?? "0.00"}') RETURNING id` as never
  );
  const rows = (r as { rows?: Array<{ id: number }> }).rows ?? [];
  return rows[0].id;
}

async function walletOf(id: number): Promise<number> {
  const db = (await getDb())!;
  const r = await db.execute(
    `SELECT "walletBalance" FROM merchants WHERE id = ${id}` as never
  );
  const rows = (r as { rows?: Array<{ walletBalance: string }> }).rows ?? [];
  return Number(rows[0].walletBalance);
}

describe("H2-wave: payout binding + atomic debit (real PGlite DB)", () => {
  let ownMerchantId: number;
  let otherMerchantId: number;

  beforeAll(async () => {
    child = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "tests/integration/setup/pgliteServer.mjs")],
      {
        env: { ...process.env, PGLITE_PORT: String(PGLITE_PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    await waitReady(child);

    process.env.DATABASE_URL = DB_URL;
    // Import AFTER the URL is set — getDb() reads env lazily on first use.
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    ({ merchantPayoutSettlementRouter } = await import(
      "../../server/routers/merchantPayoutSettlement"
    ));

    const db = (await getDb())!;
    await db.execute(DDL as never);

    ownMerchantId = await seedMerchant({
      merchantCode: "MCH2OWN0001",
      keycloakSub: "h2-merchant-sub-1",
      status: "active",
      walletBalance: "10000.00",
    });
    otherMerchantId = await seedMerchant({
      merchantCode: "MCH2OTHER01",
      keycloakSub: "h2-merchant-sub-2",
      status: "active",
      walletBalance: "50000.00",
    });
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
  });

  it("initiatePayout for ANOTHER merchant's id → 403", async () => {
    const caller = merchantPayoutSettlementRouter.createCaller(ctxFor(merchantUser));
    await expectTrpcCode(
      caller.initiatePayout({ merchantId: otherMerchantId, amount: 1000 }),
      "FORBIDDEN"
    );
    expect(await walletOf(otherMerchantId)).toBe(50000);
  });

  it("principal with NO bound merchant → 403", async () => {
    const caller = merchantPayoutSettlementRouter.createCaller(ctxFor(unboundUser));
    await expectTrpcCode(
      caller.initiatePayout({ merchantId: ownMerchantId, amount: 1000 }),
      "FORBIDDEN"
    );
  });

  it("insufficient wallet → rejected and balance UNCHANGED (atomic, no partial debit)", async () => {
    const caller = merchantPayoutSettlementRouter.createCaller(ctxFor(merchantUser));
    await expectTrpcCode(
      caller.initiatePayout({ merchantId: ownMerchantId, amount: 999_999 }),
      "PRECONDITION_FAILED"
    );
    expect(await walletOf(ownMerchantId)).toBe(10000);
  });

  it("valid initiation debits the wallet atomically and pays the verified destination", async () => {
    const caller = merchantPayoutSettlementRouter.createCaller(ctxFor(merchantUser));
    const res = await caller.initiatePayout({
      merchantId: ownMerchantId,
      amount: 4000,
    });
    expect(res.payout.accountNumber).toBe("1112223334");
    expect(res.payout.bankCode).toBe("044");
    expect(res.payout.status).toBe("pending");
    expect(await walletOf(ownMerchantId)).toBe(6000);

    // Non-admin approval → 403.
    await expectTrpcCode(
      merchantPayoutSettlementRouter
        .createCaller(ctxFor(merchantUser))
        .approvePayout({ payoutId: res.payout.id }),
      "FORBIDDEN"
    );
    // Maker-checker: an admin who is ALSO the bound merchant initiates on
    // their own merchant, then cannot approve their own payout.
    const adminMerchantId = await seedMerchant({
      merchantCode: "MCH2ADMIN01",
      keycloakSub: "h2-admin-a",
      status: "active",
      walletBalance: "20000.00",
    });
    const adminCallerA = merchantPayoutSettlementRouter.createCaller(ctxFor(adminA));
    const res2 = await adminCallerA.initiatePayout({
      merchantId: adminMerchantId,
      amount: 1000,
    });
    await expectTrpcCode(
      adminCallerA.approvePayout({ payoutId: res2.payout.id }),
      "FORBIDDEN"
    );
    // A second admin approves.
    const ok = await merchantPayoutSettlementRouter
      .createCaller(ctxFor(adminB))
      .approvePayout({ payoutId: res2.payout.id });
    expect(ok.success).toBe(true);

    // J-wave: the approval wrote an actor-attributed audit row IN THE SAME
    // transaction (metadata.approvedBy = the approving admin, initiatedBy
    // preserved for the maker-checker trail).
    const db2 = (await getDb())!;
    const auditRows = (await db2.execute(
      `SELECT action, resource, "resourceId", metadata FROM audit_log WHERE action = 'MERCHANT_PAYOUT_APPROVED' AND "resourceId" = '${res2.payout.id}'` as never
    )) as unknown as { rows?: Array<{ action: string; metadata: { approvedBy?: number; initiatedBy?: number } }> };
    const ar = auditRows.rows ?? [];
    expect(ar.length).toBe(1);
    expect(ar[0].metadata.approvedBy).toBe(930011);
    expect(ar[0].metadata.initiatedBy).toBe(930010);
    // Re-approval is a guarded CONFLICT, not a silent overwrite.
    await expectTrpcCode(
      merchantPayoutSettlementRouter
        .createCaller(ctxFor(adminB))
        .approvePayout({ payoutId: res2.payout.id }),
      "CONFLICT"
    );
  }, 60_000);
});
