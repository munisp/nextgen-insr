/**
 * httpApi.e2e.test.ts — public-interface HTTP end-to-end tests.
 *
 * Boots the REAL express/tRPC server (server/_core/index.ts createApp()) on an
 * ephemeral port with a real Postgres database (PGlite wire server locally,
 * postgres:16 service in CI) and drives raw HTTP requests through the FULL
 * middleware chain (helmet, rate limiting, security hardening, orchestrator,
 * financial attack prevention, tRPC express adapter, Keycloak session auth).
 *
 * Nothing is mocked: requests go over TCP, auth uses real signed kc_session
 * JWTs resolved against real users rows, and every mutation is verified by
 * reading the durable database state with drizzle — not just the HTTP status.
 *
 * Proves:
 *   1. GET /api/health → 200, db "connected" (real SELECT 1 through pg.Pool)
 *   2. Anonymous tRPC query → 401 UNAUTHORIZED with truthful error shape
 *   3. Anonymous tRPC mutation → 401 and ZERO rows written
 *   4. Non-admin on adminProcedure → 403 FORBIDDEN
 *   5. Malformed input → 400 BAD_REQUEST with zod error detail, no DB write
 *   6. Funds flow: dispute row → POST disputeRefund.initiateRefund →
 *      durable refunds row, status "pending", processedAt NULL (auto tier)
 *   7. Supervisor-tier refund → pending_approval, durable "pending" row
 *   8. NOT_IMPLEMENTED procedure → 501 with truthful "not implemented" message
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import { disputes, refunds } from "../../drizzle/schema";
import {
  bootServer,
  shutdownServer,
  apiUrl,
  sessionCookieFor,
  trpcGet,
  trpcPost,
  e2eAdmin,
  e2eAgent,
} from "./helpers/http";

const E2E_CUSTOMER_AUTO = 920101;
const E2E_CUSTOMER_SUPERVISOR = 920102;
const E2E_DISPUTE_REF_AUTO = "E2EDSP-AUTO-0001";
const E2E_DISPUTE_REF_SUP = "E2EDSP-SUP-0002";

let adminCookie: string;
let agentCookie: string;

async function refundRowsByRef(ref: string) {
  const db = (await getDb())!;
  return db.select().from(refunds).where(eq(refunds.ref, ref));
}

async function refundCountForCustomer(customerId: number): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ c: count() })
    .from(refunds)
    .where(eq(refunds.customerId, customerId));
  return Number(row?.c ?? 0);
}

describe("HTTP E2E — real server, real middleware chain, real DB", () => {
  beforeAll(async () => {
    await bootServer();
    adminCookie = await sessionCookieFor(e2eAdmin);
    agentCookie = await sessionCookieFor(e2eAgent);

    // Seed two real dispute rows (the refund flow's entry point).
    const db = (await getDb())!;
    await db
      .insert(disputes)
      .values([
        {
          ref: E2E_DISPUTE_REF_AUTO,
          agentId: 1,
          type: "double_charge",
          status: "open",
          priority: "high",
          description: "E2E: customer charged twice for premium",
          amount: "2500",
        },
        {
          ref: E2E_DISPUTE_REF_SUP,
          agentId: 1,
          type: "service_not_rendered",
          status: "open",
          priority: "medium",
          description: "E2E: policy not issued after debit",
          amount: "50000",
        },
      ])
      .onConflictDoNothing();
  }, 180_000);

  afterAll(async () => {
    await shutdownServer();
  });

  // ── 1. Health endpoint over the wire ───────────────────────────────────────
  it("GET /api/health returns 200 with db connected", async () => {
    const res = await fetch(apiUrl("/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.db).toBe("connected");
    expect(typeof body.latencies.db).toBe("number");
    expect(body.latencies.db).toBeGreaterThanOrEqual(0);
    expect(body).toHaveProperty("timestamp");
  });

  // ── 2. Auth rejection: anonymous query → 401 ───────────────────────────────
  it("anonymous tRPC query is rejected with 401 UNAUTHORIZED", async () => {
    const res = await trpcGet("disputeRefund.getSummary");
    expect(res.status).toBe(401);
    expect(res.error).toBeDefined();
    expect(res.error!.data.code).toBe("UNAUTHORIZED");
    expect(res.error!.data.httpStatus).toBe(401);
    expect(res.error!.data.path).toBe("disputeRefund.getSummary");
  });

  // ── 3. Auth rejection: anonymous mutation writes nothing ───────────────────
  it("anonymous refund mutation is rejected with 401 and persists nothing", async () => {
    const before = await refundCountForCustomer(E2E_CUSTOMER_AUTO);
    const res = await trpcPost("disputeRefund.initiateRefund", {
      disputeId: 1,
      amount: 2500,
      reason: "Anonymous attempt must be refused",
      customerId: E2E_CUSTOMER_AUTO,
      accountNumber: "0123456789",
    });
    expect(res.status).toBe(401);
    expect(res.error!.data.code).toBe("UNAUTHORIZED");
    expect(await refundCountForCustomer(E2E_CUSTOMER_AUTO)).toBe(before);
  });

  // ── 4. Authorization: non-admin on adminProcedure → 403 ───────────────────
  it("non-admin calling an adminProcedure is rejected with 403 FORBIDDEN", async () => {
    const res = await trpcPost(
      "management.agents.create",
      {
        agentId: "E2E-FORBIDDEN-AGENT",
        name: "Should Not Exist",
        phone: "08000000000",
        pinHash: "x".repeat(64),
      },
      agentCookie
    );
    expect(res.status).toBe(403);
    expect(res.error!.data.code).toBe("FORBIDDEN");
  });

  // ── 5. Validation failure: malformed input → 400, no DB write ─────────────
  it("malformed refund input is rejected with 400 BAD_REQUEST and writes nothing", async () => {
    const before = await refundCountForCustomer(E2E_CUSTOMER_AUTO);
    const res = await trpcPost(
      "disputeRefund.initiateRefund",
      {
        disputeId: "not-a-number",
        amount: -100, // violates .positive()
        reason: "short", // violates .min(10)
        customerId: E2E_CUSTOMER_AUTO,
        accountNumber: "0123456789",
      },
      adminCookie
    );
    expect(res.status).toBe(400);
    expect(res.error!.data.code).toBe("BAD_REQUEST");
    expect(res.error!.data.httpStatus).toBe(400);
    expect(res.error!.data.path).toBe("disputeRefund.initiateRefund");
    // Truthful validation detail: the default tRPC error formatter embeds the
    // stringified zod issues in the message — the offending field names must
    // be visible to the caller.
    expect(res.error!.message).toContain("amount");
    expect(res.error!.message).toContain("reason");
    expect(await refundCountForCustomer(E2E_CUSTOMER_AUTO)).toBe(before);
  });

  // ── 6. Funds flow: dispute → refund queued → durable DB row ───────────────
  it("auto-tier refund over HTTP persists a real pending refunds row", async () => {
    const db = (await getDb())!;
    const [dispute] = await db
      .select()
      .from(disputes)
      .where(eq(disputes.ref, E2E_DISPUTE_REF_AUTO));
    expect(dispute).toBeDefined();

    const res = await trpcPost(
      "disputeRefund.initiateRefund",
      {
        disputeId: dispute!.id,
        amount: 2500,
        reason: "Customer charged twice for premium",
        customerId: E2E_CUSTOMER_AUTO,
        accountNumber: "0123456789",
        agentId: 1,
      },
      adminCookie
    );

    expect(res.status).toBe(200);
    const data = res.data as any;
    expect(data.success).toBe(true);
    expect(data.approval).toBe("auto");
    expect(data.status).toBe("pending");
    expect(data.message).toContain("No funds have moved yet");
    expect(typeof data.refundId).toBe("string");

    // Durable effect, asserted via drizzle — not the HTTP response.
    const rows = await refundRowsByRef(data.refundId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.processedAt).toBeNull();
    expect(rows[0]!.refundAmount).toBe(2500);
    expect(rows[0]!.originalAmount).toBe(2500);
    expect(rows[0]!.customerId).toBe(E2E_CUSTOMER_AUTO);
    expect(rows[0]!.disputeId).toBe(dispute!.id);
    expect(rows[0]!.category).toBe("dispute_refund");
    expect(rows[0]!.notes).toContain("destination_account:0123456789");
  });

  // ── 7. Supervisor tier: pending_approval + durable queued row ──────────────
  it("supervisor-tier refund returns pending_approval and persists a pending row", async () => {
    const db = (await getDb())!;
    const [dispute] = await db
      .select()
      .from(disputes)
      .where(eq(disputes.ref, E2E_DISPUTE_REF_SUP));
    expect(dispute).toBeDefined();

    const res = await trpcPost(
      "disputeRefund.initiateRefund",
      {
        disputeId: dispute!.id,
        amount: 50000,
        reason: "Policy not issued after debit confirmed",
        customerId: E2E_CUSTOMER_SUPERVISOR,
        accountNumber: "0987654321",
        agentId: 1,
      },
      adminCookie
    );

    expect(res.status).toBe(200);
    const data = res.data as any;
    expect(data.success).toBe(true);
    expect(data.approval).toBe("supervisor");
    expect(data.status).toBe("pending_approval");

    const rows = await refundRowsByRef(data.refundId);
    expect(rows.length).toBe(1);
    // Queued only — never marked processed without the downstream flow.
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.processedAt).toBeNull();
    expect(rows[0]!.approvedAt).toBeNull();
    expect(rows[0]!.refundAmount).toBe(50000);
  });

  // ── 7b. Idempotency contract (F-01): replay safe, key reuse CONFLICT ──────
  it("idempotent refund retries replay; key reuse with different payload returns 409", async () => {
    const db = (await getDb())!;
    const [dispute] = await db
      .select()
      .from(disputes)
      .where(eq(disputes.ref, E2E_DISPUTE_REF_AUTO));
    const idemKey = "e2e-idem-key-000001";
    const payload = {
      disputeId: dispute!.id,
      amount: 3000,
      reason: "Duplicate debit confirmed by bank statement",
      customerId: 920103,
      accountNumber: "1122334455",
      agentId: 1,
      idempotencyKey: idemKey,
    };

    // First execution: persists exactly one row.
    const first = await trpcPost(
      "disputeRefund.initiateRefund",
      payload,
      adminCookie
    );
    expect(first.status).toBe(200);
    const firstData = first.data as any;
    expect(firstData.success).toBe(true);
    expect(firstData.idempotent).toBeUndefined();

    // Same key + same payload: replayed, no second row.
    const replay = await trpcPost(
      "disputeRefund.initiateRefund",
      payload,
      adminCookie
    );
    expect(replay.status).toBe(200);
    const replayData = replay.data as any;
    expect(replayData.idempotent).toBe(true);
    expect(replayData.refundId).toBe(firstData.refundId);

    const dbRows = await db
      .select()
      .from(refunds)
      .where(eq(refunds.idempotencyKey, idemKey));
    expect(dbRows.length).toBe(1);
    expect(dbRows[0]!.ref).toBe(firstData.refundId);
    expect(dbRows[0]!.status).toBe("pending");

    // Same key + different payload: explicit CONFLICT, nothing written.
    const conflict = await trpcPost(
      "disputeRefund.initiateRefund",
      { ...payload, amount: 3500 },
      adminCookie
    );
    expect(conflict.status).toBe(409);
    expect(conflict.error!.data.code).toBe("CONFLICT");
    const rowsAfter = await db
      .select()
      .from(refunds)
      .where(eq(refunds.idempotencyKey, idemKey));
    expect(rowsAfter.length).toBe(1);
  });

  // ── 8. NOT_IMPLEMENTED endpoint → truthful 501 ─────────────────────────────
  it("NOT_IMPLEMENTED procedure returns 501 with a truthful message", async () => {
    const res = await trpcGet(
      "analyticsDashboard.kpiSummary",
      undefined,
      adminCookie
    );
    expect(res.status).toBe(501);
    expect(res.error!.data.code).toBe("NOT_IMPLEMENTED");
    expect(res.error!.data.httpStatus).toBe(501);
    expect(res.error!.message).toMatch(/not implemented/i);
  });

  // ── 9. Cross-check: the seeded disputes are visible through the wire ──────
  it("authenticated list query over HTTP returns the seeded dispute rows", async () => {
    const res = await trpcGet(
      "disputeRefund.list",
      { limit: 50, offset: 0, status: "all" },
      adminCookie
    );
    expect(res.status).toBe(200);
    const data = res.data as any;
    const refs = (data.data as any[]).map(d => d.ref);
    expect(refs).toContain(E2E_DISPUTE_REF_AUTO);
    expect(refs).toContain(E2E_DISPUTE_REF_SUP);
    // Refund-tier enrichment is derived server-side from the real amount.
    const auto = (data.data as any[]).find(d => d.ref === E2E_DISPUTE_REF_AUTO);
    expect(auto.refundTier).toBe("auto");
  });
});
