/**
 * 2026-11-27 (W25-B): transactions.approveReversal / rejectReversal —
 * financialProcedure authz denial matrix
 *
 * Regression coverage for the W25-B authz fix in ./routers/transactions.ts:
 * the reversal approval flow ran on bare `protectedProcedure` while the main
 * repo (server/routers/transactions.ts) gates it with `financialProcedure`
 * (./_core/permifyMiddleware.ts — ported W25-B). The missing layers were:
 *   1. the local financial role-permission matrix (op "reversal" is held by
 *      admin/super_admin/supervisor only — NOT by plain "user"/agent), and
 *   2. the Permify financial check (billing_ledger:record), fail-closed.
 *
 * Contract under test (denial matrix, fail-closed):
 *   - unauthenticated (no ctx.user)                → UNAUTHORIZED
 *   - authenticated role without the "reversal" op → FORBIDDEN (middleware,
 *     before the handler body ever runs)
 *   - authenticated admin, Permify DENIES           → FORBIDDEN (fail-closed)
 *   - authenticated admin, Permify allows           → handler runs (happy path)
 *   - rejectReversal is gated identically (parity).
 *
 * Harness mirrors ./transactions.pendingReversals.test.ts (W24-B): direct
 * transactionsRouter import; db/agentAuth/permify/infra middlewares stubbed
 * at the module boundary — the procedure AND the financialProcedure
 * middleware logic under test run unmodified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { transactionsRouter } from "./routers/transactions";
import { router } from "./_core/trpc";
import { getDb, writeAuditLog, updateAgentFloat } from "./db";
import { getAgentFromCookie } from "./middleware/agentAuth";
import { permifyCheck } from "./_core/permify";

// financialProcedure's ROUTER_OPERATION_MAP is keyed by the FULL procedure
// path (e.g. "transactions.approveReversal"); mounting under the same
// namespace as server/routers.ts (line 547) keeps the lookup honest — a
// bare transactionsRouter caller would path as "approveReversal" and hit
// the middleware's fail-closed unmapped-mutation denial for the wrong reason.
const testRouter = router({ transactions: transactionsRouter });

// ── Mocks (module boundary only — procedure + middleware logic run real) ─────
vi.mock("./db", () => ({
  getDb: vi.fn(),
  createTransaction: vi.fn(),
  getTransactionsByAgent: vi.fn().mockResolvedValue([]),
  getTransactionsByAgentCursor: vi.fn(),
  getTransactionByRef: vi.fn(),
  updateTransactionStatus: vi.fn(),
  updateAgentFloat: vi.fn(),
  updateAgentCommission: vi.fn(),
  addLoyaltyHistory: vi.fn(),
  writeAuditLog: vi.fn(),
  getAgentById: vi.fn(),
  createFraudAlert: vi.fn(),
}));

const ADMIN_AGENT = {
  id: 1,
  agentId: "AGT001",
  name: "Emeka Obi",
  role: "admin",
  tier: "Gold",
  premiumReserve: 50000,
  pin: "$2b$10$hashedpin",
};

vi.mock("./middleware/agentAuth", () => ({
  getAgentFromCookie: vi.fn(),
}));

vi.mock("./tbClient", () => ({
  tbCreateTransfer: vi.fn().mockResolvedValue(null),
  tbEnsureAgentAccount: vi.fn().mockResolvedValue(true),
}));

vi.mock("./termii", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
  buildConfirmationSms: vi.fn().mockReturnValue("sms-body"),
}));

vi.mock("./socketSingleton", () => ({
  getIO: vi.fn().mockReturnValue(null),
}));

vi.mock("./_core/platformClient.js", () => ({
  floatPlatform: {
    utilize: vi.fn().mockResolvedValue({ success: true }),
    settle: vi.fn().mockResolvedValue({ success: true }),
    getBalance: vi.fn().mockResolvedValue(null),
    getTransactions: vi.fn().mockResolvedValue(null),
  },
  analyticsPlatform: {
    transactionSummary: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(undefined),
}));

// Permify is stubbed at the module boundary (same convention as
// transactions.pendingReversals.test.ts); each test pins the verdict so BOTH
// the allow and the deny (fail-closed) legs of financialProcedure are real.
vi.mock("./_core/permify", () => ({
  permifyCheck: vi.fn().mockResolvedValue(true),
}));

// Global instrumentation middlewares are fire-and-forget side-effect hooks
// (Kafka/Redis/sidecars); replace with pass-throughs so unit tests do not
// depend on brokers that do not exist here.
vi.mock("./middleware/sidecarIntegration", () => ({
  createSidecarMiddleware: (t: any) =>
    t.middleware(({ next }: any) => next()),
}));
vi.mock("./middleware/observabilityMiddleware", () => ({
  createObservabilityMiddleware: (t: any) =>
    t.middleware(({ next }: any) => next()),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCtx(user: Record<string, unknown> | null): any {
  return {
    user,
    req: { headers: { cookie: "agent_session=mock.jwt.token" } },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  };
}

const ADMIN_USER = {
  id: 1,
  username: "test-admin",
  role: "admin",
  agentId: "AGT001",
  name: "Test Admin",
  email: "test@insureportal.ng",
  tenantId: null,
};

/** Transaction row exactly as the approveReversal select would return it. */
const PENDING_TX = {
  id: 42,
  ref: "TXN-PEND-001",
  agentId: 7,
  type: "Premium Payment",
  amount: "5000.00",
  status: "pending_reversal_approval",
};

/** Query-builder double for the handler's select + update chains. */
function makeApproveDb(txRow: any) {
  const updates: any[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (txRow ? [txRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: async () => {
          updates.push(v);
        },
      }),
    }),
  };
  return { db, updates };
}

// ── Denial matrix ─────────────────────────────────────────────────────────────
describe("transactions.approveReversal — financialProcedure authz (W25-B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(permifyCheck).mockResolvedValue(true);
    vi.mocked(getAgentFromCookie).mockResolvedValue(ADMIN_AGENT as any);
    const { db } = makeApproveDb(PENDING_TX);
    vi.mocked(getDb).mockResolvedValue(db as any);
  });

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const caller = testRouter.createCaller(makeCtx(null));
    await expect(
      caller.transactions.approveReversal({ transactionId: 42 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects authenticated users whose role lacks the 'reversal' op (FORBIDDEN)", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "user" })
    );
    await expect(
      caller.transactions.approveReversal({ transactionId: 42 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Denied at the financialProcedure role matrix — the handler body (and
    // its own admin gate) must never run.
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("rejects admin when Permify denies the financial check (fail-closed)", async () => {
    vi.mocked(permifyCheck).mockResolvedValue(false);
    const caller = testRouter.createCaller(makeCtx(ADMIN_USER));
    await expect(
      caller.transactions.approveReversal({ transactionId: 42 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("allows an admin with Permify grant (handler runs to completion)", async () => {
    const { db, updates } = makeApproveDb(PENDING_TX);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = testRouter.createCaller(makeCtx(ADMIN_USER));
    const result = await caller.transactions.approveReversal({
      transactionId: 42,
      notes: "customer dispute resolved",
    });

    expect(result.success).toBe(true);
    expect(typeof result.reversalRef).toBe("string");
    // Funds moved back: Premium Payment reversal debits the agent float.
    expect(updateAgentFloat).toHaveBeenCalledWith(7, -5000);
    // Transaction flipped to reversed by the approving admin.
    expect(updates[0]).toMatchObject({ status: "reversed", approvedBy: "AGT001" });
    // Audit trail written.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "REVERSAL_APPROVED", status: "success" })
    );
  });

  it("gates rejectReversal identically (role without op → FORBIDDEN)", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "user" })
    );
    await expect(
      caller.transactions.rejectReversal({ transactionId: 42, reason: "not justified" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
