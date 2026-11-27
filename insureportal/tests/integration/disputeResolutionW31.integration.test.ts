/**
 * disputeResolutionW31.integration.test.ts — W31-C (2026-11-27) REAL-DB
 * (PGlite) integration tests for the dispute/refund flow guarded by
 * server/middleware/disputeMiddleware.ts (W23-B port) and its four router
 * importers:
 *
 *   - server/routers/disputeResolution.ts    (dashboard/getDisputes/createDispute/updateStatus)
 *   - server/routers/disputeWorkflowEngine.ts (createDispute/listDisputes/escalate/autoResolve/getSlaReport)
 *   - server/routers/disputeMediationAI.ts    (getStats/listMediations/analyzeDispute/acceptRecommendation/overrideRecommendation)
 *   - server/routers/disputeNotifications.ts  (listNotifications/getNotification/sendNotification/getDeliveryStats)
 *
 * plus direct middleware-function contracts (rate-limit fail-open, Permify
 * allow via the W24 wire double, event publish no-throw, 12-way health map).
 *
 * Harness mirrors ./w29Analytics.integration.test.ts /
 * ./w30SavingsPension.integration.test.ts: spawned PGlite wire server (repo-
 * root tests/integration/setup/pgliteServer.mjs), minimal DDL with
 * schema-verbatim column names/types/nullability for every column the
 * procedures touch, raw-SQL seeds, createCaller against the real routers.
 * No mocks on the procedures under test (the Permify wire-protocol double
 * and ioredis/kafkajs doubles come from vitest.setup.ts, exactly like the
 * PGlite double for Postgres).
 *
 * ⚠ SCHEMA-VERBATIM FINDING pinned by this suite: the migrated `disputes`
 * table keeps `"agentId" integer NOT NULL` with NO default (0003 creates it
 * NOT NULL; 0016 drops NOT NULL only from transactionId/transactionRef/
 * reason; nothing ever drops agentId's). Both createDispute procedures
 * omitted agentId from their INSERT — so against the real schema they
 * failed closed with INTERNAL_SERVER_ERROR (Postgres 23502) and persisted
 * NO partial state. W31-C asserted that fail-closed behavior.
 *
 * 2026-11-27 (W32-B) HONEST-CONTRACT REWRITE: the W31-C fail-closed
 * assertions documented a PRODUCTION OUTAGE (dispute creation down on
 * every call), not a contract worth keeping. W32-B fixed both procedures
 * to populate agentId from the caller identity forced server-side
 * (agentId = ctx.user.id — main's memberDisputes "worklist correction 1"
 * precedent; see the dated router comments for the full sourcing rule).
 * The two former fail-closed legs are rewritten below to assert SUCCESS
 * with correct agentId persistence; no DDL was relaxed (agentId stays
 * NOT NULL in the harness, exactly like the migrated schema).
 *
 * Seeded truth is computed in the header of each describe block so the
 * assertions trace to the seeds, not to the implementation. Mutation tests
 * run in a deliberate order (noted per block) because later assertions read
 * state written by earlier ones.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { TrpcContext } from "../../server/_core/context";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

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
let disputeResolutionRouter: typeof import("../../server/routers/disputeResolution").disputeResolutionRouter;
let disputeWorkflowEngineRouter: typeof import("../../server/routers/disputeWorkflowEngine").disputeWorkflowEngineRouter;
let disputeMediationAIRouter: typeof import("../../server/routers/disputeMediationAI").disputeMediationAIRouter;
let disputeNotificationsRouter: typeof import("../../server/routers/disputeNotifications").disputeNotificationsRouter;
let mw: typeof import("../../server/middleware/disputeMiddleware");
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

const adminUser = {
  id: 950031,
  email: "admin@w31.test",
  name: "W31 Admin User",
  role: "admin",
  keycloakSub: "k-w31-admin",
} as unknown as TrpcContext["user"];

// 2026-11-27 (W32-B): non-admin, non-agent caller for the createDispute
// edge leg — proves the agentId sourcing rule (filing principal's id) is
// resolvable for EVERY authenticated caller class, not just admins.
const plainUser = {
  id: 950032,
  email: "user@w31.test",
  name: "W31 Plain User",
  role: "user",
  keycloakSub: "k-w31-user",
} as unknown as TrpcContext["user"];

// Minimal DDL — schema-verbatim column names/types/NULLABILITY for every
// column the procedures under test touch (drizzle/schema.ts disputes,
// dispute_messages, sla_breaches + migrations 0003/0004/0016/0035). FKs and
// indexes omitted (K-wave harness convention: queries join by value, not by
// constraint). transactions is seeded for domain realism — disputes reference
// it via transactionId — although no procedure under test joins it.
const DDL = `
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL,
  "agentId" integer NOT NULL,
  "type" varchar(32) NOT NULL,
  "amount" numeric(15,2) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "disputes" (
  "id" serial PRIMARY KEY,
  "ref" varchar(32) NOT NULL UNIQUE,
  "transactionId" integer,
  "transactionRef" varchar(32),
  "agentId" integer NOT NULL,
  "reason" varchar(256),
  "evidence" text,
  "resolvedBy" varchar(64),
  "slaDeadlineAt" timestamp,
  "type" varchar(64) DEFAULT 'general',
  "status" varchar(32) DEFAULT 'open' NOT NULL,
  "priority" varchar(16) DEFAULT 'medium' NOT NULL,
  "description" text DEFAULT '',
  "resolution" text,
  "assignedTo" varchar(64),
  "resolvedAt" timestamp,
  "amount" numeric(15,2) DEFAULT '0',
  "createdBy" varchar(64),
  "deletedAt" timestamp,
  "tenantId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "dispute_messages" (
  "id" serial PRIMARY KEY,
  "disputeId" integer NOT NULL,
  "authorId" integer,
  "authorName" varchar(128),
  "authorRole" varchar(32),
  "message" text,
  "senderType" varchar(32),
  "senderName" varchar(128),
  "content" text,
  "attachmentUrl" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "sla_breaches" (
  "id" serial PRIMARY KEY,
  "sla_definition_id" integer NOT NULL,
  "breach_type" text NOT NULL,
  "actual_value" integer NOT NULL,
  "target_value" integer NOT NULL,
  "duration" integer,
  "impact_level" text NOT NULL DEFAULT 'medium',
  "resolved_at" timestamp,
  "resolution" text,
  "created_at" timestamp DEFAULT now()
);
`;

async function exec(sql: string) {
  const db = (await getDb())!;
  return db.execute(sql as never);
}

async function scalar(sql: string): Promise<unknown> {
  const db = (await getDb())!;
  // drizzle node-postgres execute() returns a pg QueryResult ({ rows, ... }),
  // not a bare array.
  const res = (await db.execute(sql as never)) as unknown as {
    rows: Array<Record<string, unknown>>;
  };
  const rows = Array.isArray(res) ? res : res.rows;
  return rows[0] ? Object.values(rows[0])[0] : undefined;
}

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

async function seed() {
  // ── Transactions (domain anchor for disputes.transactionId) ─────────────
  await exec(`INSERT INTO "transactions" ("id", "ref", "agentId", "type", "amount", "status") VALUES
    (7001, 'TXN-W31-DUP',   901, 'Bill Payment',  5000.00, 'success'),
    (7002, 'TXN-W31-FRAUD', 901, 'Transfer',     10000.00, 'success')`);

  // ── Disputes across the full status spectrum (+ one 'closed' decoy) ─────
  // createdAt staggered 4d..0d so recency ordering is deterministic:
  // id 5 is newest, id 1 oldest.
  await exec(`INSERT INTO "disputes"
    ("id", "ref", "transactionId", "agentId", "reason", "type", "status", "priority", "amount", "createdBy", "tenantId", "resolvedAt", "resolvedBy", "resolution", "createdAt") VALUES
    (1, 'DSP-W31-0001', 7001, 901, 'duplicate charge on bill payment', 'double_charge', 'open',      'medium',   5000.00, 'W31 Seeder', 1, NULL, NULL, NULL, now() - interval '4 days'),
    (2, 'DSP-W31-0002', NULL, 902, 'goods not_received by customer',   'non_delivery',  'open',      'high',     2500.00, 'W31 Seeder', 1, NULL, NULL, NULL, now() - interval '3 days'),
    (3, 'DSP-W31-0003', 7002, 901, 'unauthorized transaction reported','fraud',         'resolved',  'high',    10000.00, 'W31 Seeder', 1, now() - interval '1 days', 'W31 Seeder', 'Refund issued', now() - interval '2 days'),
    (4, 'DSP-W31-0004', NULL, 903, 'defective product delivered',      'quality',       'escalated', 'critical', 7500.00, 'W31 Seeder', 1, NULL, NULL, NULL, now() - interval '1 days'),
    (5, 'DSP-W31-0005', NULL, 902, 'customer keyed wrong amount',      'general',       'closed',    'low',       100.00, 'W31 Seeder', 1, NULL, NULL, NULL, now())`);
  await exec(`SELECT setval('disputes_id_seq', 5)`);

  // Decoy messages on dispute 5 — must never leak into dispute-1 mirror
  // assertions.
  await exec(`INSERT INTO "dispute_messages" ("disputeId", "authorName", "authorRole", "message", "content", "senderType", "senderName") VALUES
    (5, 'Decoy Customer', 'customer', 'decoy: wrong amount', 'decoy: wrong amount', 'customer', 'Decoy Customer'),
    (5, 'Decoy Admin', 'admin', 'decoy: acknowledged', 'decoy: acknowledged', 'admin', 'Decoy Admin')`);

  // One SLA breach → dashboard slaCompliance.within24h = round((5-1)/5*100) = 80
  await exec(`INSERT INTO "sla_breaches" ("sla_definition_id", "breach_type", "actual_value", "target_value") VALUES
    (1, 'response_time', 48, 24)`);
  // → fresh-state truth: total 5, open 2 (ids 1,2), resolved 1 (id 3),
  //   escalated 1 (id 4), closed 1 (id 5), amount sum 25100.00,
  //   escalationRate 20.0, avgResolutionDays round((25100/1/10000+1)*10)/10 = 3.5
}

describe("W31-C: dispute middleware + routers (real PGlite DB)", () => {
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
    getPool = dbMod.getPool;
    ({ disputeResolutionRouter } = await import(
      "../../server/routers/disputeResolution"
    ));
    ({ disputeWorkflowEngineRouter } = await import(
      "../../server/routers/disputeWorkflowEngine"
    ));
    ({ disputeMediationAIRouter } = await import(
      "../../server/routers/disputeMediationAI"
    ));
    ({ disputeNotificationsRouter } = await import(
      "../../server/routers/disputeNotifications"
    ));
    mw = await import("../../server/middleware/disputeMiddleware");
    const db = (await getDb())!;
    await db.execute(DDL as never);
    await seed();
  }, 120_000);

  afterAll(async () => {
    try {
      const pool = await getPool?.();
      await pool?.end();
    } catch {
      // best-effort cleanup; teardown must not mask a test failure
    }
    child?.kill("SIGTERM");
  });

  // ── Fresh-state reads (run BEFORE any mutation block) ──────────────────
  describe("fresh-state reads: dashboard, filters, lists", () => {
    it("dashboard mirrors the seeded aggregates exactly", async () => {
      const d = await disputeResolutionRouter
        .createCaller(ctxFor(adminUser))
        .dashboard();
      expect(d.totalDisputes).toBe(5);
      expect(d.openDisputes).toBe(2);
      expect(d.resolvedDisputes).toBe(1);
      expect(d.escalationRate).toBe(20);
      expect(d.totalDisputedAmount).toBe(25100);
      expect(d.avgResolutionDays).toBe(3.5);
      expect(d.slaCompliance).toEqual({
        within24h: 80,
        within48h: 85,
        within72h: 90,
      });
      const statusMap = Object.fromEntries(
        d.byStatus.map(s => [s.status, s.count])
      );
      expect(statusMap).toEqual({ open: 2, resolved: 1, escalated: 1, closed: 1 });
      // Recency: newest seed (id 5) first.
      expect(d.recentDisputes[0]?.ref).toBe("DSP-W31-0005");
      expect(d.recentDisputes).toHaveLength(5);
    });

    it("getDisputes filters by status with decoys excluded; total stays unfiltered", async () => {
      const caller = disputeResolutionRouter.createCaller(ctxFor(adminUser));
      const all = await caller.getDisputes({});
      expect(all.disputes).toHaveLength(5);
      expect(all.total).toBe(5);

      const open = await caller.getDisputes({ status: "open" });
      expect(open.disputes.map(r => r.id).sort()).toEqual([1, 2]);
      // Contract pin: `total` counts ALL disputes, not the filtered page.
      expect(open.total).toBe(5);
      // Decoy: the 'closed' dispute must not appear in the open filter.
      expect(open.disputes.find(r => r.status === "closed")).toBeUndefined();

      const fraud = await caller.getDisputes({ type: "fraud" });
      expect(fraud.disputes.map(r => r.ref)).toEqual(["DSP-W31-0003"]);
      expect(fraud.total).toBe(5);

      // Contract pin: when both are given, the status branch wins (type ignored).
      const both = await caller.getDisputes({ status: "open", type: "fraud" });
      expect(both.disputes).toHaveLength(2);

      const limited = await caller.getDisputes({ status: "open", limit: 1 });
      expect(limited.disputes).toHaveLength(1);
      expect(limited.total).toBe(5);
    });

    it("workflowEngine.listDisputes paginates deterministically over the seeds", async () => {
      const caller = disputeWorkflowEngineRouter.createCaller(
        ctxFor(adminUser)
      );
      const all = await caller.listDisputes({});
      expect(all.total).toBe(5);
      expect(all.items).toHaveLength(5);
      // createdAt desc → 5,4,3,2,1; page 2 of size 2 → ids 3,2
      const page2 = await caller.listDisputes({ limit: 2, page: 2 });
      expect(page2.items.map(i => i.id)).toEqual([3, 2]);
      const closed = await caller.listDisputes({ status: "closed" });
      expect(closed.items.map(i => i.ref)).toEqual(["DSP-W31-0005"]);
      // value mirrors disputes.amount as a number
      expect(all.items.find(i => i.id === 3)?.value).toBe(10000);
    });

    it("mediationAI.getStats mirrors seeded counts", async () => {
      const s = await disputeMediationAIRouter
        .createCaller(ctxFor(adminUser))
        .getStats();
      expect(s.totalMediations).toBe(5);
      expect(s.resolved).toBe(1);
      expect(s.pending).toBe(2);
      expect(s.autoResolved).toBe(Math.round(1 * 0.85)); // 1
      expect(s.humanOverride).toBe(Math.round(1 * 0.15)); // 0
    });

    it("mediationAI.listMediations annotates every row with a MED- id + recommendation", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      const all = await caller.listMediations({});
      expect(all.total).toBe(5);
      for (const m of all.mediations) {
        expect(m.mediationId).toBe(`MED-${m.id}`);
        expect(m.recommendation).toBeTruthy();
      }
      const open = await caller.listMediations({ status: "open" });
      expect(open.mediations).toHaveLength(2);
      expect(open.total).toBe(5);
      const windowed = await caller.listMediations({ limit: 2, offset: 1 });
      expect(windowed.mediations.map(m => m.id)).toEqual([4, 3]);
    });

    it("notifications.listNotifications derives one row per dispute with channel rotation", async () => {
      const n = await disputeNotificationsRouter
        .createCaller(ctxFor(adminUser))
        .listNotifications({});
      expect(n.total).toBe(5);
      expect(n.items).toHaveLength(5);
      expect(n.items[0]?.channel).toBe("email");
      expect(n.items[1]?.channel).toBe("sms");
      expect(n.items[2]?.channel).toBe("push");
      const forAgent901 = n.items.find(i => i.disputeRef === "DSP-W31-0001");
      expect(forAgent901?.recipient).toBe("agent-901@insureportal.ng");
    });
  });

  // ── Create paths (2026-11-27 W32-B honest-contract rewrite) ───────────
  // These two legs WERE the W31-C "fail-closed" assertions (every call →
  // INTERNAL_SERVER_ERROR, zero persisted). That pinned a production
  // outage, so W32-B fixed the routers (agentId = ctx.user.id, forced
  // server-side) and rewrote the contract to assert SUCCESS with correct
  // agentId persistence. The three disputes created here (ids 6, 7, 8 —
  // the seed setval pinned the sequence at 5) shift the global counts
  // asserted by the later getDeliveryStats / UNAUTHORIZED legs; those
  // expectations carry their own dated updates.
  describe("createDispute persists with server-side agentId (W32-B fix)", () => {
    it("disputeResolution.createDispute succeeds and persists agentId = caller id", async () => {
      const caller = disputeResolutionRouter.createCaller(ctxFor(adminUser));
      const r = await caller.createDispute({
        transactionId: "TXN-7001",
        type: "double_charge",
        reason: "charged twice",
        amount: 5000,
      });
      expect(r.status).toBe("open");
      expect(r.ref).toMatch(/^DSP-/);
      expect(r.id).toBe(6);
      // The outage column: agentId must persist as the filing principal.
      expect(await scalar(`SELECT "agentId" FROM "disputes" WHERE id = 6`)).toBe(
        adminUser.id
      );
      // Digit-parse of the transactionId input persists the PK 7001.
      expect(
        await scalar(`SELECT "transactionId" FROM "disputes" WHERE id = 6`)
      ).toBe(7001);
      expect(
        await scalar(`SELECT amount::float8 FROM "disputes" WHERE id = 6`)
      ).toBe(5000);
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 6`)).toBe(
        "open"
      );
      expect(
        await scalar(`SELECT "createdBy" FROM "disputes" WHERE id = 6`)
      ).toBe("W31 Admin User");
      // This procedure writes no mirror messages (workflowEngine does).
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 6`
        )
      ).toBe(0);
    });

    it("disputeWorkflowEngine.createDispute persists agentId + evidence mirror rows", async () => {
      const caller = disputeWorkflowEngineRouter.createCaller(
        ctxFor(adminUser)
      );
      const r = await caller.createDispute({
        transactionId: "TXN-FRAUD",
        reason: "fraud",
        description: "unauthorized debit",
        evidence: ["receipt.pdf", "photo.jpg"],
      });
      expect(r.success).toBe(true);
      expect(r.ref).toMatch(/^WF-/);
      expect(r.id).toBe(7);
      expect(await scalar(`SELECT "agentId" FROM "disputes" WHERE id = 7`)).toBe(
        adminUser.id
      );
      // "TXN-FRAUD" carries no digits → transactionId persists NULL.
      expect(
        await scalar(`SELECT "transactionId" FROM "disputes" WHERE id = 7`)
      ).toBeNull();
      expect(await scalar(`SELECT type FROM "disputes" WHERE id = 7`)).toBe(
        "workflow"
      );
      // Both evidence items mirror as customer messages on the new dispute.
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 7 AND "senderType" = 'customer' AND content LIKE 'Evidence: %'`
        )
      ).toBe(2);
      // Decoy guard: dispute 5's seeded messages are untouched.
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 5`
        )
      ).toBe(2);
    });

    it("non-agent caller class files with agentId = own user id (no INTERNAL_SERVER_ERROR)", async () => {
      // The sourcing rule (dated router comments, 2026-11-27 W32-B): no
      // users→agents join exists in the portal schema, so agentId is the
      // FILING PRINCIPAL's id — resolvable for every authenticated caller,
      // agent or not. A plain non-admin user with no agent record must
      // succeed, not explode.
      const caller = disputeResolutionRouter.createCaller(ctxFor(plainUser));
      const r = await caller.createDispute({
        transactionId: "TXN-W31-DUP",
        type: "general",
        reason: "non-agent filing",
        amount: 100,
      });
      expect(r.id).toBe(8);
      expect(await scalar(`SELECT "agentId" FROM "disputes" WHERE id = 8`)).toBe(
        plainUser.id
      );
    });
  });

  // ── AI mediation: deterministic recommendation map + allow/deny legs ────
  describe("mediationAI analyze → accept/override (allow/deny)", () => {
    it("analyzeDispute maps reason keywords to the deterministic recommendations", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      const dup = await caller.analyzeDispute({ disputeId: "1" });
      expect(dup.recommendation).toBe("full_refund");
      expect(dup.confidence).toBe(95);
      expect(dup.mediationId).toBe("MED-1");

      const fraud = await caller.analyzeDispute({ disputeId: "3" });
      expect(fraud.recommendation).toBe("full_refund");
      expect(fraud.confidence).toBe(92);

      const notReceived = await caller.analyzeDispute({ disputeId: "2" });
      expect(notReceived.recommendation).toBe("partial_refund");
      expect(notReceived.confidence).toBe(78);

      const defective = await caller.analyzeDispute({ disputeId: "4" });
      expect(defective.recommendation).toBe("merchant_credit");
      expect(defective.confidence).toBe(80);

      const other = await caller.analyzeDispute({ disputeId: "5" });
      expect(other.recommendation).toBe("escalate");
      expect(other.confidence).toBe(65);
    });

    it("analyzeDispute NOT_FOUND legs: unknown id and non-numeric garbage", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      await expectTrpcCode(
        caller.analyzeDispute({ disputeId: "DSP-999999" }),
        "NOT_FOUND"
      );
      await expectTrpcCode(
        caller.analyzeDispute({ disputeId: "garbage" }),
        "NOT_FOUND"
      );
    });

    it("acceptRecommendation (ALLOW leg) resolves the dispute and mirrors a system message", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      const r = await caller.acceptRecommendation({ mediationId: "MED-1" });
      expect(r.success).toBe(true);
      expect(r.status).toBe("resolved");
      expect(
        await scalar(
          `SELECT status FROM "disputes" WHERE id = 1`
        )
      ).toBe("resolved");
      expect(
        await scalar(
          `SELECT "resolvedBy" FROM "disputes" WHERE id = 1`
        )
      ).toBe("AI-mediation");
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 1 AND content = 'AI recommendation accepted' AND "senderType" = 'system'`
        )
      ).toBe(1);
      // Decoy guard: dispute 5's seeded messages are untouched.
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 5`
        )
      ).toBe(2);
    });

    it("overrideRecommendation newDecision=deny (DENY leg) closes the dispute with resolution=deny", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      const r = await caller.overrideRecommendation({
        mediationId: "MED-5",
        newDecision: "deny",
        reason: "Insufficient evidence",
      });
      expect(r.success).toBe(true);
      expect(r.newDecision).toBe("deny");
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 5`)).toBe(
        "closed"
      );
      expect(
        await scalar(`SELECT resolution FROM "disputes" WHERE id = 5`)
      ).toBe("deny");
      expect(
        await scalar(`SELECT "resolvedBy" FROM "disputes" WHERE id = 5`)
      ).toBe("W31 Admin User");
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 5 AND content = 'Override: deny. Insufficient evidence' AND "senderType" = 'admin'`
        )
      ).toBe(1);
    });

    it("overrideRecommendation newDecision=approve resolves (non-deny leg)", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      await caller.overrideRecommendation({
        mediationId: "MED-3",
        newDecision: "approve",
        reason: "Fraud confirmed",
      });
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 3`)).toBe(
        "resolved"
      );
      expect(
        await scalar(`SELECT resolution FROM "disputes" WHERE id = 3`)
      ).toBe("approve");
    });

    it("accept/override NOT_FOUND legs", async () => {
      const caller = disputeMediationAIRouter.createCaller(ctxFor(adminUser));
      await expectTrpcCode(
        caller.acceptRecommendation({ mediationId: "MED-999999" }),
        "NOT_FOUND"
      );
      await expectTrpcCode(
        caller.overrideRecommendation({
          mediationId: "MED-999999",
          newDecision: "deny",
          reason: "x",
        }),
        "NOT_FOUND"
      );
    });
  });

  // ── Status transitions + dispute_messages mirror ────────────────────────
  describe("status transitions mirror into dispute_messages", () => {
    it("disputeResolution.updateStatus without resolution leaves resolvedAt NULL", async () => {
      const caller = disputeResolutionRouter.createCaller(ctxFor(adminUser));
      const r = await caller.updateStatus({ disputeId: 4, status: "in_review" });
      expect(r.success).toBe(true);
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 4`)).toBe(
        "in_review"
      );
      expect(
        await scalar(`SELECT "resolvedAt" FROM "disputes" WHERE id = 4`)
      ).toBeNull();
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 4 AND content = 'Status changed to in_review' AND "senderType" = 'admin' AND "authorName" = 'W31 Admin User'`
        )
      ).toBe(1);
    });

    it("disputeResolution.updateStatus with resolution stamps resolvedAt/resolvedBy", async () => {
      const caller = disputeResolutionRouter.createCaller(ctxFor(adminUser));
      await caller.updateStatus({
        disputeId: 4,
        status: "resolved",
        resolution: "Merchant credited",
      });
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 4`)).toBe(
        "resolved"
      );
      expect(
        await scalar(`SELECT resolution FROM "disputes" WHERE id = 4`)
      ).toBe("Merchant credited");
      expect(
        await scalar(`SELECT "resolvedBy" FROM "disputes" WHERE id = 4`)
      ).toBe("W31 Admin User");
      expect(
        await scalar(
          `SELECT "resolvedAt" IS NOT NULL AS r FROM "disputes" WHERE id = 4`
        )
      ).toBe(true);
    });

    it("workflowEngine.escalate maps level→priority (critical→critical, else high) + mirror", async () => {
      const caller = disputeWorkflowEngineRouter.createCaller(
        ctxFor(adminUser)
      );
      await caller.escalate({
        disputeId: 1,
        level: "critical",
        reason: "VIP customer",
      });
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 1`)).toBe(
        "escalated"
      );
      expect(
        await scalar(`SELECT priority FROM "disputes" WHERE id = 1`)
      ).toBe("critical");
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 1 AND content = 'Escalated to critical: VIP customer' AND "senderType" = 'admin'`
        )
      ).toBe(1);

      await caller.escalate({ disputeId: 2, level: "major", reason: "SLA risk" });
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 2`)).toBe(
        "escalated"
      );
      expect(
        await scalar(`SELECT priority FROM "disputes" WHERE id = 2`)
      ).toBe("high");
    });

    it("workflowEngine.autoResolve stamps the auto-resolver identity + mirror", async () => {
      const caller = disputeWorkflowEngineRouter.createCaller(
        ctxFor(adminUser)
      );
      const r = await caller.autoResolve({ disputeId: 2 });
      expect(r.success).toBe(true);
      expect(await scalar(`SELECT status FROM "disputes" WHERE id = 2`)).toBe(
        "resolved"
      );
      expect(
        await scalar(`SELECT "resolvedBy" FROM "disputes" WHERE id = 2`)
      ).toBe("auto-resolver");
      expect(
        await scalar(`SELECT resolution FROM "disputes" WHERE id = 2`)
      ).toBe("Auto-resolved by system rules");
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 2 AND content = 'Dispute auto-resolved by system rules engine' AND "senderType" = 'system' AND "authorName" = 'Auto-Resolver'`
        )
      ).toBe(1);
    });

    it("NOT_FOUND legs: updateStatus / escalate / autoResolve on unknown ids", async () => {
      const resCaller = disputeResolutionRouter.createCaller(
        ctxFor(adminUser)
      );
      const wfCaller = disputeWorkflowEngineRouter.createCaller(
        ctxFor(adminUser)
      );
      await expectTrpcCode(
        resCaller.updateStatus({ disputeId: 999999, status: "resolved" }),
        "NOT_FOUND"
      );
      await expectTrpcCode(
        wfCaller.escalate({
          disputeId: 999999,
          level: "critical",
          reason: "x",
        }),
        "NOT_FOUND"
      );
      await expectTrpcCode(
        wfCaller.autoResolve({ disputeId: 999999 }),
        "NOT_FOUND"
      );
    });

    it("workflowEngine.getSlaReport mirrors the seeded breach as active", async () => {
      const caller = disputeWorkflowEngineRouter.createCaller(
        ctxFor(adminUser)
      );
      const r = await caller.getSlaReport({});
      expect(r.total).toBe(1);
      expect(r.items[0]?.name).toBe("SLA Breach 1");
      expect(r.items[0]?.status).toBe("active");
    });
  });

  // ── Notifications (mirror + soft-fail contract) ─────────────────────────
  describe("disputeNotifications send/get/delivery-stats", () => {
    it("sendNotification mirrors a Notification System message for a real dispute", async () => {
      const caller = disputeNotificationsRouter.createCaller(
        ctxFor(adminUser)
      );
      const r = await caller.sendNotification({
        disputeId: 3,
        channel: "sms",
      });
      expect(r.success).toBe(true);
      expect(r.id).toBe(1); // first in-process notificationLog entry
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 3 AND content = 'Status notification sent via sms' AND "senderType" = 'system' AND "authorName" = 'Notification System'`
        )
      ).toBe(1);
    });

    it("sendNotification on an unknown dispute soft-fails with success:false (NOT an error)", async () => {
      const caller = disputeNotificationsRouter.createCaller(
        ctxFor(adminUser)
      );
      // Contract pin: this leg returns 200 with success:false/id:0 instead of
      // throwing NOT_FOUND — callers must handle both shapes.
      const r = await caller.sendNotification({ disputeId: 999999 });
      expect(r.success).toBe(false);
      expect(r.message).toBe("Dispute not found");
      expect(r.id).toBe(0);
      expect(
        await scalar(
          `SELECT count(*)::int AS c FROM "dispute_messages" WHERE "disputeId" = 999999`
        )
      ).toBe(0);
    });

    it("getNotification returns the mirrored thread for a dispute; empty for unknown", async () => {
      const caller = disputeNotificationsRouter.createCaller(
        ctxFor(adminUser)
      );
      const thread = await caller.getNotification({ disputeId: 3 });
      // dispute 3 mirrors: updateStatus? no — override approve + sendNotification
      expect(thread.total).toBe(2);
      const contents = thread.items.map(i => i.content).sort();
      expect(contents).toEqual([
        "Override: approve. Fraud confirmed",
        "Status notification sent via sms",
      ]);
      expect(thread.items[0]?.disputeRef).toBe("DSP-W31-0003");

      const empty = await caller.getNotification({ disputeId: 999999 });
      expect(empty).toEqual({ items: [], total: 0 });
    });

    it("getDeliveryStats mirrors notificationLog + dispute count", async () => {
      const s = await disputeNotificationsRouter
        .createCaller(ctxFor(adminUser))
        .getDeliveryStats();
      // 2026-11-27 (W32-B): 1 logged send + 8 disputes (5 seeds + 3 created
      // by the W32-B createDispute success legs above; notificationLog is
      // in-process module state). Channels recompute from the same count:
      // ceil(8*0.5)=4, ceil(8*0.3)=3, ceil(8*0.2)=2.
      expect(s.totalSent).toBe(9);
      expect(s.delivered).toBe(9);
      expect(s.failed).toBe(0);
      expect(s.channels).toEqual({ email: 4, sms: 3, push: 2 });
    });
  });

  // ── Middleware function contracts (direct, fail-open / Permify allow) ───
  describe("disputeMiddleware function contracts", () => {
    it("checkDisputeRateLimit fails OPEN when Redis cannot count (doubled ioredis has no incr)", async () => {
      // vitest.setup.ts doubles ioredis without an `incr` method, so
      // cacheIncr's internal catch returns 0 — the middleware's documented
      // fail-open posture for the rate limiter.
      const r = await mw.checkDisputeRateLimit(901);
      expect(r).toEqual({ allowed: true, remaining: 10 });
    });

    it("canApproveDispute/canProcessRefund allow via the Permify wire double", async () => {
      // The W24 double answers CHECK_RESULT_ALLOWED, so even a plain role is
      // allowed; the role-fallback (admin/supervisor) only fires when Permify
      // is unreachable, which this harness does not simulate.
      await expect(mw.canApproveDispute("901", "user")).resolves.toBe(true);
      await expect(mw.canProcessRefund("901", "user")).resolves.toBe(true);
    });

    it("publishDisputeEvent never throws (fail-open Kafka publish)", async () => {
      await expect(
        mw.publishDisputeEvent({
          eventType: "dispute.raised",
          disputeId: 1,
          agentId: 901,
          amount: 5000,
          transactionRef: "TXN-W31-DUP",
        })
      ).resolves.toBeUndefined();
    });

    it("getDisputeMiddlewareHealth reports all 12 middleware with postgresql healthy", async () => {
      const h = await mw.getDisputeMiddlewareHealth();
      expect(Object.keys(h).sort()).toEqual(
        [
          "apisix",
          "dapr",
          "fluvio",
          "kafka",
          "keycloak",
          "lakehouse",
          "mojaloop",
          "permify",
          "postgresql",
          "redis",
          "temporal",
          "tigerbeetle",
        ].sort()
      );
      expect(h.postgresql.status).toBe("healthy");
      // No Temporal server in the test env → fail-open "degraded".
      expect(h.temporal.status).toBe("degraded");
      for (const v of Object.values(h)) {
        expect(typeof v.latencyMs).toBe("number");
        expect(["healthy", "degraded", "unavailable"]).toContain(v.status);
      }
    });
  });

  // ── UNAUTHORIZED legs (requireUser fires before any DB access) ──────────
  describe("UNAUTHORIZED legs", () => {
    it("every protected procedure rejects an anonymous caller", async () => {
      const anon = ctxFor(null);
      await expectTrpcCode(
        disputeResolutionRouter.createCaller(anon).dashboard(),
        "UNAUTHORIZED"
      );
      await expectTrpcCode(
        disputeResolutionRouter
          .createCaller(anon)
          .createDispute({
            transactionId: "TXN-W31-DUP",
            type: "x",
            reason: "x",
            amount: 1,
          }),
        "UNAUTHORIZED"
      );
      await expectTrpcCode(
        disputeWorkflowEngineRouter
          .createCaller(anon)
          .escalate({ disputeId: 1, level: "critical", reason: "x" }),
        "UNAUTHORIZED"
      );
      await expectTrpcCode(
        disputeWorkflowEngineRouter.createCaller(anon).autoResolve({ disputeId: 1 }),
        "UNAUTHORIZED"
      );
      await expectTrpcCode(
        disputeMediationAIRouter
          .createCaller(anon)
          .analyzeDispute({ disputeId: "1" }),
        "UNAUTHORIZED"
      );
      await expectTrpcCode(
        disputeMediationAIRouter
          .createCaller(anon)
          .acceptRecommendation({ mediationId: "MED-1" }),
        "UNAUTHORIZED"
      );
      await expectTrpcCode(
        disputeNotificationsRouter
          .createCaller(anon)
          .sendNotification({ disputeId: 1 }),
        "UNAUTHORIZED"
      );
      // Anonymous calls must not have written anything.
      // 2026-11-27 (W32-B): 5 seeds + 3 created by the W32-B success legs.
      expect(await scalar(`SELECT count(*)::int AS c FROM "disputes"`)).toBe(8);
    });
  });
});
