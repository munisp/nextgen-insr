/**
 * memberDisputes.test.ts — R3 batch 2 (2026-10-01, R3-b2)
 *
 * Real-behavior PGlite tests for server/routers/memberDisputes.ts (same
 * harness pattern as memberReferrals.test.ts / memberClaims.test.ts: real
 * embedded PostgreSQL via the PGlite wire-protocol server, minimal table
 * projections carrying exactly the columns the router touches, real SQL
 * execution):
 *   - anonymous caller → UNAUTHORIZED (protectedProcedure) on all procs
 *   - myDisputes scope isolation: disputes.agentId = ctx.user.id only
 *   - myDispute foreign id → NOT_FOUND (non-enumerating)
 *   - fileDispute mints a UNIQUE DSP- ref, forces agentId = ctx.user.id and
 *     status "open", and ownership-verifies the disputed transaction via the
 *     dual identity-space (transactions.agentId IN (users.id, customers.id));
 *     a foreign transaction → NOT_FOUND
 *   - replyDispute forces senderType "customer" (both message + content set),
 *     resolved disputes → PRECONDITION_FAILED, foreign dispute → NOT_FOUND
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// 2026-10-01 (R3-b2): probe an ephemeral free port instead of hardcoding
// (batch-1 CI hit EADDRINUSE on hardcoded ports; probeFreePort copied from
// memberReferrals.test.ts).
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
// as memberPolicies/memberReferrals) so protectedProcedure passes the base
// gate; the member authz under test is enforced by the router itself.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberDisputes"))["memberDisputesRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242 (dual-space)
let anonCaller: Caller;

const USER_ID = 1; // ctx.user.id of the authenticated caller
const CUSTOMER_ID = 4242; // customers.id resolved from keycloakSub "1"
const FOREIGN_ID = 9999; // foreign user-space party id

// Transactions: 101 owned in the users.id space, 102 owned in the resolved
// customers.id space, 103 foreign.
const TX_USER_SPACE = 101;
const TX_CUSTOMER_SPACE = 102;
const TX_FOREIGN = 103;

// Disputes: 201 caller's open, 202 caller's resolved, 203 foreign.
const DISPUTE_OPEN = 201;
const DISPUTE_RESOLVED = 202;
const DISPUTE_FOREIGN = 203;

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

  // Minimal tables carrying exactly the columns the router projects/inserts.
  // (drizzle/schema.ts:779 disputes, :819 dispute_messages, :4182
  // dispute_evidence (snake_case columns), :393 transactions, :1431
  // customers (only keycloakSub is read), :565 audit_log.) varchar stands in
  // for the pgEnum columns — inserts/selects are plain SQL strings either way.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS disputes (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "transactionId" integer,
      "transactionRef" varchar(32),
      "agentId" integer NOT NULL,
      reason varchar(256),
      evidence text,
      "resolvedBy" varchar(64),
      "slaDeadlineAt" timestamp,
      type varchar(64) DEFAULT 'general',
      status varchar(32) NOT NULL DEFAULT 'open',
      priority varchar(16) NOT NULL DEFAULT 'medium',
      description text DEFAULT '',
      resolution text,
      "assignedTo" varchar(64),
      "resolvedAt" timestamp,
      amount numeric(15,2) DEFAULT '0',
      "createdBy" varchar(64),
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dispute_messages (
      id serial PRIMARY KEY,
      "disputeId" integer NOT NULL,
      "authorId" integer,
      "authorName" varchar(128),
      "authorRole" varchar(32),
      message text,
      "senderType" varchar(32),
      "senderName" varchar(128),
      content text,
      "attachmentUrl" text,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dispute_evidence (
      id serial PRIMARY KEY,
      dispute_id integer NOT NULL,
      file_name varchar(256) NOT NULL,
      file_url text NOT NULL,
      file_key varchar(256) NOT NULL,
      mime_type varchar(64),
      file_size integer,
      uploaded_by varchar(64) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      ref varchar(32) NOT NULL UNIQUE,
      "idempotencyKey" varchar(64) UNIQUE,
      "agentId" integer NOT NULL,
      type varchar(32) NOT NULL,
      amount numeric(15,2) NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "keycloakSub" varchar(128) UNIQUE
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

  await db.execute(sql`
    INSERT INTO customers (id, "keycloakSub") VALUES
      (${CUSTOMER_ID}, '1'),
      (${FOREIGN_ID}, '2')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO transactions (id, ref, "agentId", type, amount) VALUES
      (${TX_USER_SPACE}, 'TXNUSER001', ${USER_ID}, 'Cash In', '5000.00'),
      (${TX_CUSTOMER_SPACE}, 'TXNCUST001', ${CUSTOMER_ID}, 'Cash In', '7500.00'),
      (${TX_FOREIGN}, 'TXNFRGN001', ${FOREIGN_ID}, 'Cash In', '9000.00')`);

  await db.execute(sql`
    INSERT INTO disputes (id, ref, "transactionId", "transactionRef", "agentId", reason, description, status, amount, type, priority) VALUES
      (${DISPUTE_OPEN}, 'DSP-SEEDOPEN1', ${TX_USER_SPACE}, 'TXNUSER001', ${USER_ID}, 'Double charge', 'I was charged twice.', 'open', '5000.00', 'customer', 'medium'),
      (${DISPUTE_RESOLVED}, 'DSP-SEEDRESO1', ${TX_USER_SPACE}, 'TXNUSER001', ${USER_ID}, 'Old issue', 'Resolved earlier.', 'resolved', '100.00', 'customer', 'medium'),
      (${DISPUTE_FOREIGN}, 'DSP-SEEDFRGN1', ${TX_FOREIGN}, 'TXNFRGN001', ${FOREIGN_ID}, 'Not mine', 'Foreign dispute.', 'open', '9000.00', 'customer', 'medium')`);

  await db.execute(sql`
    INSERT INTO dispute_messages ("disputeId", "senderType", "senderName", message, content) VALUES
      (${DISPUTE_OPEN}, 'customer', 'Test Agent', 'First message', 'First message')`);
}

async function disputeRowCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM disputes`);
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberDisputesRouter } = await import("../memberDisputes");
  memberCaller = memberDisputesRouter.createCaller(makeAuthenticatedCtx());
  anonCaller = memberDisputesRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberDisputes router (2026-10-01, R3-b2)", () => {
  it("rejects anonymous callers with UNAUTHORIZED", async () => {
    await expect(anonCaller.myDisputes()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.myDispute({ id: DISPUTE_OPEN })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.fileDispute({
        transactionId: TX_USER_SPACE,
        reason: "x",
        description: "x",
        amount: 1,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.replyDispute({ disputeId: DISPUTE_OPEN, content: "hi" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("myDisputes returns only the caller's disputes (scope isolation)", async () => {
    const result = await memberCaller.myDisputes({ limit: 20 });
    expect(result.count).toBe(2);
    const refs = result.disputes.map(d => d.ref).sort();
    expect(refs).toEqual(["DSP-SEEDOPEN1", "DSP-SEEDRESO1"]);
    expect(refs).not.toContain("DSP-SEEDFRGN1");

    const openOnly = await memberCaller.myDisputes({ status: "open" });
    expect(openOnly.count).toBe(1);
    expect(openOnly.disputes[0].ref).toBe("DSP-SEEDOPEN1");
  });

  it("myDispute returns detail + messages; foreign id is NOT_FOUND (non-enumerating)", async () => {
    const result = await memberCaller.myDispute({ id: DISPUTE_OPEN });
    expect(result.dispute.ref).toBe("DSP-SEEDOPEN1");
    expect(result.dispute.description).toBe("I was charged twice.");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("First message");
    expect(result.evidence).toHaveLength(0);

    await expect(
      memberCaller.myDispute({ id: DISPUTE_FOREIGN })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(memberCaller.myDispute({ id: 999999 })).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
  });

  it("fileDispute mints a UNIQUE DSP- ref and forces caller identity (users.id space)", async () => {
    const before = await disputeRowCount();
    const created = await memberCaller.fileDispute({
      transactionId: TX_USER_SPACE,
      reason: "Wrong amount",
      description: "Amount does not match the receipt.",
      amount: 5000,
    });
    expect(created.ref).toMatch(/^DSP-[0-9A-F-]{12}$/);
    expect(created.status).toBe("open");
    expect(await disputeRowCount()).toBe(before + 1);

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const r = await db.execute(
      sql`SELECT "agentId", "transactionRef", type, priority, amount FROM disputes WHERE id = ${created.id}`
    );
    const row = (r as any).rows?.[0] ?? (r as any)[0];
    expect(row.agentId).toBe(USER_ID); // forced — never client-supplied
    expect(row.transactionRef).toBe("TXNUSER001");
    expect(row.type).toBe("customer");
    expect(row.priority).toBe("medium");
    expect(Number(row.amount)).toBe(5000);
  });

  it("fileDispute accepts a transaction owned in the resolved customers.id space (dual identity)", async () => {
    const created = await memberCaller.fileDispute({
      transactionId: TX_CUSTOMER_SPACE,
      reason: "Duplicate debit",
      description: "Customer-space transaction.",
      amount: 7500,
    });
    expect(created.ref).toMatch(/^DSP-/);

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const r = await db.execute(
      sql`SELECT "agentId" FROM disputes WHERE id = ${created.id}`
    );
    const row = (r as any).rows?.[0] ?? (r as any)[0];
    expect(row.agentId).toBe(USER_ID);
  });

  it("fileDispute rejects a foreign transaction with NOT_FOUND and inserts nothing", async () => {
    const before = await disputeRowCount();
    await expect(
      memberCaller.fileDispute({
        transactionId: TX_FOREIGN,
        reason: "probe",
        description: "foreign",
        amount: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      memberCaller.fileDispute({
        transactionId: 999999,
        reason: "probe",
        description: "nonexistent",
        amount: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await disputeRowCount()).toBe(before);
  });

  it("replyDispute forces senderType 'customer' and sets both message and content", async () => {
    const reply = await memberCaller.replyDispute({
      disputeId: DISPUTE_OPEN,
      content: "Here is more information.",
    });
    expect(reply.senderType).toBe("customer");

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const r = await db.execute(
      sql`SELECT "senderType", "senderName", message, content, "authorId" FROM dispute_messages WHERE id = ${reply.id}`
    );
    const row = (r as any).rows?.[0] ?? (r as any)[0];
    expect(row.senderType).toBe("customer");
    expect(row.message).toBe("Here is more information.");
    expect(row.content).toBe("Here is more information.");
    expect(row.authorId).toBe(USER_ID);
  });

  it("replyDispute rejects replies on resolved disputes (PRECONDITION_FAILED)", async () => {
    await expect(
      memberCaller.replyDispute({
        disputeId: DISPUTE_RESOLVED,
        content: "too late",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("replyDispute on a foreign dispute is NOT_FOUND (non-enumerating)", async () => {
    await expect(
      memberCaller.replyDispute({
        disputeId: DISPUTE_FOREIGN,
        content: "not mine",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
