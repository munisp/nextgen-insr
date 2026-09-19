/**
 * commissionApproveK.integration.test.ts — K-wave (2026-09) REAL-DB tests
 * for the two commission approvePayout procedures
 * (agentCommissionCalc + commissionEngine), mirroring the
 * merchantPayoutSettlement H2/J standard: admin-only, guarded pending-only
 * transition, maker-checker, and an actor-attributed audit row written in
 * the SAME transaction as the claim.
 *
 * Fixture note: commission_payouts.agent_id references agents.id in the real
 * schema; the FK is omitted here (documented) because neither procedure
 * touches the agents table — all columns used by the real RETURNING clause
 * are present with schema-verbatim names/types.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PGLITE_PORT = 54332;
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PGLITE_PORT}/postgres`;

let child: ChildProcess;
let agentCommissionCalcRouter: typeof import("../../server/routers/agentCommissionCalc").agentCommissionCalcRouter;
let commissionEngineRouter: typeof import("../../server/routers/commissionEngine").commissionEngineRouter;
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

const adminA = {
  id: 940010,
  email: "adminA@kwave.test",
  name: "Admin A",
  role: "admin",
  keycloakSub: "k-admin-a",
} as unknown as TrpcContext["user"];

const adminB = {
  id: 940011,
  email: "adminB@kwave.test",
  name: "Admin B",
  role: "admin",
  keycloakSub: "k-admin-b",
} as unknown as TrpcContext["user"];

const plainUser = {
  id: 940020,
  email: "user@kwave.test",
  name: "User",
  role: "user",
  keycloakSub: "k-user",
} as unknown as TrpcContext["user"];

const DDL = `
CREATE TABLE IF NOT EXISTS "commission_payouts" (
  "id" serial PRIMARY KEY,
  "agent_id" integer NOT NULL,
  "agent_code" varchar(32) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "currency" varchar(3) DEFAULT 'NGN' NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "requested_by" integer,
  "approved_by" integer,
  "rejected_by" integer,
  "rejection_reason" text,
  "bank_code" varchar(10),
  "account_number" varchar(20),
  "account_name" varchar(100),
  "nuban_ref" varchar(64),
  "processed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "commission_audit_trail" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" varchar(32) NOT NULL,
  "action" varchar(32) NOT NULL,
  "previous_value" json,
  "new_value" json,
  "performed_by" varchar(64) NOT NULL,
  "reason" text,
  "ip_address" varchar(45),
  "created_at" timestamp DEFAULT now() NOT NULL
);
`;

async function seedPayout(requestedBy: number | null): Promise<number> {
  const db = (await getDb())!;
  const rb = requestedBy == null ? "NULL" : String(requestedBy);
  const r = (await db.execute(
    `INSERT INTO commission_payouts (agent_id, agent_code, amount, requested_by) VALUES (900001, 'AG-KWAVE', 5000, ${rb}) RETURNING id` as never
  )) as unknown as { rows?: Array<{ id: number }> };
  return (r.rows ?? [])[0].id;
}

async function auditRowsFor(entityId: string) {
  const db = (await getDb())!;
  const r = (await db.execute(
    `SELECT action, performed_by, new_value FROM commission_audit_trail WHERE entity_type = 'payout' AND entity_id = '${entityId}'` as never
  )) as unknown as {
    rows?: Array<{
      action: string;
      performed_by: string;
      new_value: { approvedBy?: number } | null;
    }>;
  };
  return r.rows ?? [];
}

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

describe("K-wave: commission approvePayout hardening (real PGlite DB)", () => {
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
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    ({ agentCommissionCalcRouter } = await import(
      "../../server/routers/agentCommissionCalc"
    ));
    ({ commissionEngineRouter } = await import(
      "../../server/routers/commissionEngine"
    ));
    const db = (await getDb())!;
    await db.execute(DDL as never);
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
  });

  it("agentCommissionCalc.approvePayout: guarded + atomic actor-attributed audit", async () => {
    const pid = await seedPayout(null);
    const caller = agentCommissionCalcRouter.createCaller(ctxFor(adminA));

    const res = await caller.approvePayout({ payoutId: String(pid) });
    expect(res.success).toBe(true);

    const rows = await auditRowsFor(String(pid));
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("payout_approved");
    expect(rows[0].performed_by).toBe(String(940010));
    expect(rows[0].new_value?.approvedBy).toBe(940010);

    // Re-approval: guarded CONFLICT, and NO second audit row.
    await expectTrpcCode(caller.approvePayout({ payoutId: String(pid) }), "CONFLICT");
    expect((await auditRowsFor(String(pid))).length).toBe(1);

    // Maker-checker: requester cannot approve their own batch.
    const pid2 = await seedPayout(940010);
    await expectTrpcCode(
      caller.approvePayout({ payoutId: String(pid2) }),
      "FORBIDDEN"
    );
    expect((await auditRowsFor(String(pid2))).length).toBe(0);

    // Non-admin: rejected at the gate, nothing written.
    await expectTrpcCode(
      agentCommissionCalcRouter
        .createCaller(ctxFor(plainUser))
        .approvePayout({ payoutId: String(pid2) }),
      "FORBIDDEN"
    );
  }, 60_000);

  it("commissionEngine.approvePayout: guarded + atomic actor-attributed audit", async () => {
    const pid = await seedPayout(null);
    const cpId = `CP-${pid}`;
    const caller = commissionEngineRouter.createCaller(ctxFor(adminB));

    // NOTE (pre-existing saga semantics, disclosed): the procedure commits
    // the guarded approval + audit row FIRST, then records the TigerBeetle
    // ledger credit. The TB sidecar is unreachable in the test sandbox, so
    // the post-commit ledger step throws fail-loud — the committed DB state
    // (approved exactly once + exactly one audit row) is what we assert.
    await expectTrpcCode(caller.approvePayout({ id: cpId }), "INTERNAL_SERVER_ERROR");

    const rows = await auditRowsFor(cpId);
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("approved");
    expect(rows[0].performed_by).toBe(String(940011));

    // Re-approval: guarded — honest failure (not pending), no second audit row.
    const res2 = await caller.approvePayout({ id: cpId }).catch(() => null);
    if (res2 !== null) expect(res2.success).toBe(false);
    expect((await auditRowsFor(cpId)).length).toBe(1);

    // Maker-checker.
    const pid2 = await seedPayout(940011);
    await expectTrpcCode(
      caller.approvePayout({ id: `CP-${pid2}` }),
      "FORBIDDEN"
    );

    // Non-admin rejected at the gate.
    await expectTrpcCode(
      commissionEngineRouter
        .createCaller(ctxFor(plainUser))
        .approvePayout({ id: `CP-${pid2}` }),
      "FORBIDDEN"
    );
  }, 60_000);
});
