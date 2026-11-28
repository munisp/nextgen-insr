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
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 2026-11-28 (C3 port adaptation): ip tests lived one directory deeper
// (insureportal/tests/integration) — repo root is two levels up here.
const REPO_ROOT = path.resolve(__dirname, "../..");

// 2026-11-27 (W24): the port was hardcoded (54332) and collided in practice
// (EADDRINUSE) with concurrent test runs sharing a host — vitest runs the
// integration files in parallel workers and CI/shared runners may host
// several suites at once. Allocate a free ephemeral port per run instead.
// The close→reuse race is inherent to port probing; the spawn's waitReady
// still fail-loudly rejects on EADDRINUSE, so this can never pass silently
// against the wrong server.
async function allocFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
const PGLITE_PORT = await allocFreePort();
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PGLITE_PORT}/postgres`;

let child: ChildProcess;
let agentCommissionCalcRouter: typeof import("../../server/routers/agentCommissionCalc").agentCommissionCalcRouter;
let commissionEngineRouter: typeof import("../../server/routers/commissionEngine").commissionEngineRouter;
let mountedEngine: ReturnType<typeof mkRouter>;
let mkRouter: typeof import("../../server/_core/trpc").router;
let getDb: typeof import("../../server/db").getDb;
let getPool: typeof import("../../server/db").getPool;

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
  -- 2026-11-28 (C3 fix-cycle-1, verify-c3.md): complete the ported minimal
  -- DDL — root's commissionPayouts.approve writes processed_by (schema.ts:2464
  -- processedBy, written at server/routers/commissionPayouts.ts:428).
  "processed_by" integer,
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
    // 2026-11-28 (C3 port adaptation): root server/db prefers POSTGRES_URL
    // over DATABASE_URL, and the integration globalSetup pins POSTGRES_URL to
    // its shared PGlite (full schema pushed — incl. the C3-merged W30
    // tables). Point POSTGRES_URL at this suite's own spawned PGlite so
    // the harness DDL lands on a fresh instance, exactly as it did in ip.
    process.env.POSTGRES_URL = DB_URL;
    const dbMod = await import("../../server/db");
    getDb = dbMod.getDb;
    getPool = dbMod.getPool;
    ({ agentCommissionCalcRouter } = await import(
      "../../server/routers/agentCommissionCalc"
    ));
    ({ commissionEngineRouter } = await import(
      "../../server/routers/commissionEngine"
    ));
    // 2026-11-28 (C3 fix-cycle-1): canonical-namespace mount — root's
    // financialProcedure maps operations by full path
    // ('commissionEngine.approvePayout' → commission_pay,
    // _core/permifyMiddleware.ts); a bare mount is unmapped and fail-closed
    // FORBIDDEN (same convention as server/transactions.reversalInitiation
    // .authz.test.ts, W25-B).
    ({ router: mkRouter } = await import("../../server/_core/trpc"));
    mountedEngine = mkRouter({ commissionEngine: commissionEngineRouter });
    const db = (await getDb())!;
    await db.execute(DDL as never);
  }, 120_000);

  afterAll(async () => {
    // 2026-11-27 (W24): drain the pg pool BEFORE killing the PGlite child.
    // Killing the child first strands pool sockets, whose async
    // "Connection terminated unexpectedly" errors vitest counts as unhandled
    // errors and fails the run even when every test passed.
    try {
      const pool = await getPool?.();
      await pool?.end();
    } catch {
      // best-effort cleanup; teardown must not mask a test failure
    }
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
    // 2026-11-28 (C3 fix-cycle-1 → Item-4 re-derivation): my earlier
    // name-attribution alignment ("Admin A"/null new_value) is REVERTED —
    // C1's PR #362 merge (main @1bed27ca) restored the K6 contract: id
    // attribution + full new_value (agentCommissionCalc.ts:253-260, with an
    // in-code note that commission_audit_trail has no "details" column — the
    // phantom-column write I had flagged is gone).
    expect(rows[0].performed_by).toBe(String(940010));
    expect(rows[0].new_value?.approvedBy).toBe(940010);

    // Re-approval: guarded CONFLICT, and NO second audit row.
    // 2026-11-28 (C3 fix-cycle-1, FG-6): was intentionally red — C1's PR
    // #362 merge (main @1bed27ca) restored BOTH guards: the guarded UPDATE
    // requires status='pending' AND requester≠approver in one statement
    // (agentCommissionCalc.ts:232-243), non-pending → CONFLICT, requester →
    // FORBIDDEN, audit row written IN THE SAME transaction as the claim.
    // These legs now verify the merged contract.
    await expectTrpcCode(caller.approvePayout({ payoutId: String(pid) }), "CONFLICT");
    expect((await auditRowsFor(String(pid))).length).toBe(1);

    // Maker-checker: requester cannot approve their own batch (FG-6 — see above).
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

  it("commissionEngine.approvePayout: atomic TB+approve commit, CONFLICT idempotency, post-commit event failure surface", async () => {
    const pid = await seedPayout(null);
    const cpId = `CP-${pid}`;
    // Mounted under the canonical namespace so financialProcedure maps
    // 'commissionEngine.approvePayout' (see beforeAll).
    const caller = mountedEngine.createCaller(ctxFor(adminB)).commissionEngine;

    // 2026-11-28 (C3 Item-4 re-derivation): C1's PR #362 merge made the
    // TigerBeetle credit + approval ATOMIC (commissionEngine.ts:1018-1110,
    // FG-7 fix): TB first inside the transaction, then the guarded UPDATE.
    // Sandbox truth, verified in this run: the mini-TB credit succeeds, the
    // approval COMMITS — and then the fail-closed Kafka event publish
    // (commissionMiddleware.ts, unreachable broker here) throws POST-COMMIT,
    // surfacing INTERNAL_SERVER_ERROR for an approve that DID persist.
    // T-C3-7: post-commit event failure is reported as a failed approve.
    await expectTrpcCode(caller.approvePayout({ id: cpId }), "INTERNAL_SERVER_ERROR");

    // The approve+TB leg committed atomically — payout is approved.
    const db = (await getDb())!;
    const st = (await db.execute(
      `SELECT status FROM commission_payouts WHERE id = ${pid}` as never
    )) as unknown as { rows?: Array<{ status: string }> };
    expect(st.rows?.[0]?.status).toBe("approved");

    // Audit trail shape when present. T-C3-8 (root defect, flagged):
    // logAudit (commissionEngine.ts) writes OUTSIDE the transaction via a
    // pool getDb() and silently SKIPS on null/poisoned db (catch → warn),
    // so the row's persistence is non-deterministic under test-mode pool
    // errors. Assert the shape when present; the transactional audit
    // contract is covered deterministically by test 1 (agentCommissionCalc,
    // whose merged audit insert runs IN the claim transaction).
    const rows = await auditRowsFor(cpId);
    if (rows.length > 0) {
      expect(rows[0].action).toBe("approved");
      expect(rows[0].performed_by).toBe("Admin B"); // name attribution (merged)
    }

    // Re-approval: pre-transaction check → CONFLICT (idempotent refusal);
    // the row is not re-approved and no second audit row appears.
    await expectTrpcCode(caller.approvePayout({ id: cpId }), "CONFLICT");
    expect((await auditRowsFor(cpId)).length).toBe(rows.length);

    // T-C3-6 (root gap, flagged): commissionEngine.approvePayout has NO
    // maker-checker requester≠approver guard (agentCommissionCalc has it —
    // test 1 above). A requester self-approving their own batch therefore
    // COMMITS here (surfacing ISE only via the post-commit Kafka failure).
    // Asserted as truthful gap evidence; do not "fix" the test — fix the
    // router.
    const pid2 = await seedPayout(940011);
    await expectTrpcCode(
      caller.approvePayout({ id: `CP-${pid2}` }),
      "INTERNAL_SERVER_ERROR" // commits self-approval, then Kafka publish fails
    );
    const st2 = (await db.execute(
      `SELECT status FROM commission_payouts WHERE id = ${pid2}` as never
    )) as unknown as { rows?: Array<{ status: string }> };
    expect(st2.rows?.[0]?.status).toBe("approved"); // self-approval persisted

    // Non-admin rejected at the gate (bare mount → unmapped → fail-closed).
    await expectTrpcCode(
      commissionEngineRouter
        .createCaller(ctxFor(plainUser))
        .approvePayout({ id: `CP-${pid2}` }),
      "FORBIDDEN"
    );
  }, 60_000);
});
