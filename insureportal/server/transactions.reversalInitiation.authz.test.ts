/**
 * 2026-11-27 (W29): transactions.reverse / transactions.create —
 * financialProcedure authz denial matrix (reversal-initiation alignment)
 *
 * Regression coverage for the W29 authz fix in ./routers/transactions.ts:
 * reversal initiation (reverse) and transaction origination (create) ran on
 * bare `protectedProcedure` while the main repo (server/routers/
 * transactions.ts) gates both with `financialProcedure`
 * (./_core/permifyMiddleware.ts — ported W25-B, mappings already present:
 * transactions.reverse -> 'reversal', transactions.create -> 'transfer').
 * Mirrors the W25-B approveReversal/rejectReversal realignment
 * (./transactions.approveReversal.authz.test.ts).
 *
 * Contract under test (denial matrix, fail-closed):
 *   reverse ('reversal' op — admin/super_admin/supervisor only):
 *   - unauthenticated                      → UNAUTHORIZED
 *   - role 'user' (not in the matrix)      → FORBIDDEN, handler never runs
 *   - role 'agent' (agent cannot initiate reversals — user-decided product
 *     change)                              → FORBIDDEN, handler never runs
 *   - admin + Permify DENIES               → FORBIDDEN (fail-closed)
 *   - admin + Permify allows               → immediate reversal completes
 *   - supervisor + Permify allows          → immediate reversal completes
 *   create ('transfer' op — admin/super_admin/agent/broker):
 *   - unauthenticated                      → UNAUTHORIZED
 *   - role 'user'                          → FORBIDDEN, handler never runs
 *   - role 'supervisor' (no 'transfer' op) → FORBIDDEN (matches main)
 *   - role 'agent' + Permify allows        → middleware passes, handler runs
 *
 * Harness mirrors ./transactions.approveReversal.authz.test.ts (W25-B):
 * direct transactionsRouter import; db/agentAuth/permify/infra middlewares
 * stubbed at the module boundary — the procedure AND the financialProcedure
 * middleware logic under test run unmodified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { transactionsRouter } from "./routers/transactions";
import { router } from "./_core/trpc";
import {
  getDb,
  writeAuditLog,
  updateAgentFloat,
  updateTransactionStatus,
  getTransactionByRef,
  getAgentById,
} from "./db";
import { getAgentFromCookie } from "./middleware/agentAuth";
import { permifyCheck } from "./_core/permify";

// financialProcedure's ROUTER_OPERATION_MAP is keyed by the FULL procedure
// path (e.g. "transactions.reverse"); mounting under the same namespace as
// server/routers.ts keeps the lookup honest — a bare transactionsRouter
// caller would path as "reverse" and hit the middleware's fail-closed
// unmapped-mutation denial for the wrong reason.
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
// transactions.approveReversal.authz.test.ts); each test pins the verdict so
// BOTH the allow and the deny (fail-closed) legs of financialProcedure are
// real.
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

/** A reversible transaction owned by the session agent, below the default
 *  ₦10,000 approval threshold (getPlatformSetting double returns no rows, so
 *  the default applies) → the immediate-reversal path. */
const REVERSIBLE_TX = {
  id: 42,
  ref: "TXN-W29-REV",
  agentId: 1,
  type: "Premium Payment",
  amount: "5000.00",
  status: "success",
};

/** Query-builder double: selects return no rows (getPlatformSetting →
 *  defaults), updates capture their set() payloads. */
function makeReverseDb() {
  const updates: any[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
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

// ── reverse: denial matrix ────────────────────────────────────────────────────
describe("transactions.reverse — financialProcedure authz (W29)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(permifyCheck).mockResolvedValue(true);
    vi.mocked(getAgentFromCookie).mockResolvedValue(ADMIN_AGENT as any);
    vi.mocked(getTransactionByRef).mockResolvedValue(REVERSIBLE_TX as any);
    const { db } = makeReverseDb();
    vi.mocked(getDb).mockResolvedValue(db as any);
  });

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const caller = testRouter.createCaller(makeCtx(null));
    await expect(
      caller.transactions.reverse({ ref: "TXN-W29-REV" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects role 'user' (not in the financial role matrix) — handler never runs", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "user" })
    );
    await expect(
      caller.transactions.reverse({ ref: "TXN-W29-REV" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Denied at the financialProcedure role matrix — the reversal handler
    // body must never run.
    expect(getAgentFromCookie).not.toHaveBeenCalled();
    expect(getTransactionByRef).not.toHaveBeenCalled();
  });

  it("rejects role 'agent' — agents can no longer initiate reversals (product change)", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "agent" })
    );
    await expect(
      caller.transactions.reverse({ ref: "TXN-W29-REV" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
    expect(getTransactionByRef).not.toHaveBeenCalled();
  });

  it("rejects admin when Permify denies the financial check (fail-closed)", async () => {
    vi.mocked(permifyCheck).mockResolvedValue(false);
    const caller = testRouter.createCaller(makeCtx(ADMIN_USER));
    await expect(
      caller.transactions.reverse({ ref: "TXN-W29-REV" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("allows an admin with Permify grant (immediate reversal completes)", async () => {
    const caller = testRouter.createCaller(makeCtx(ADMIN_USER));
    const result = await caller.transactions.reverse({
      ref: "TXN-W29-REV",
      reason: "customer dispute",
    });

    expect(result.success).toBe(true);
    expect(result.pendingApproval).toBe(false);
    expect(typeof result.reversalRef).toBe("string");
    // Status flipped and float debited back (Premium Payment reversal).
    expect(updateTransactionStatus).toHaveBeenCalledWith(
      42,
      "reversed",
      "customer dispute"
    );
    expect(updateAgentFloat).toHaveBeenCalledWith(1, -5000);
    // Audit trail written.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TRANSACTION_REVERSED",
        status: "success",
      })
    );
  });

  it("allows a supervisor with Permify grant (reversal op holder)", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "supervisor" })
    );
    const result = await caller.transactions.reverse({ ref: "TXN-W29-REV" });
    expect(result.success).toBe(true);
    expect(updateTransactionStatus).toHaveBeenCalled();
  });

  it("queues high-value reversals for approval (admin, amount > threshold)", async () => {
    vi.mocked(getTransactionByRef).mockResolvedValue({
      ...REVERSIBLE_TX,
      amount: "50000.00",
    } as any);
    const { db, updates } = makeReverseDb();
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = testRouter.createCaller(makeCtx(ADMIN_USER));
    const result = await caller.transactions.reverse({ ref: "TXN-W29-REV" });

    expect(result.success).toBe(true);
    expect(result.pendingApproval).toBe(true);
    // Transaction moved to the approval queue, not immediately reversed.
    expect(updates[0]).toMatchObject({
      status: "pending_reversal_approval",
      approvalRequired: true,
    });
    expect(updateTransactionStatus).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "REVERSAL_APPROVAL_REQUESTED" })
    );
  });
});

// ── create: denial matrix ─────────────────────────────────────────────────────
describe("transactions.create — financialProcedure authz (W29)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(permifyCheck).mockResolvedValue(true);
    vi.mocked(getAgentFromCookie).mockResolvedValue(ADMIN_AGENT as any);
    const { db } = makeReverseDb();
    vi.mocked(getDb).mockResolvedValue(db as any);
  });

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const caller = testRouter.createCaller(makeCtx(null));
    await expect(
      caller.transactions.create({ type: "Premium Payment", amount: 1000 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects role 'user' (fail-closed: 'user' holds no financial ops)", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "user" })
    );
    await expect(
      caller.transactions.create({ type: "Premium Payment", amount: 1000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("rejects role 'supervisor' (no 'transfer' op — matches the main repo)", async () => {
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "supervisor" })
    );
    await expect(
      caller.transactions.create({ type: "Premium Payment", amount: 1000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("rejects admin when Permify denies the financial check (fail-closed)", async () => {
    vi.mocked(permifyCheck).mockResolvedValue(false);
    const caller = testRouter.createCaller(makeCtx(ADMIN_USER));
    await expect(
      caller.transactions.create({ type: "Premium Payment", amount: 1000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("passes role 'agent' with Permify grant through to the handler", async () => {
    // Handler-entry proof without executing the money path: the agent record
    // lookup returns null, so the handler itself raises NOT_FOUND — which can
    // only happen AFTER financialProcedure granted access.
    vi.mocked(getAgentById).mockResolvedValue(null as any);
    const caller = testRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "agent" })
    );
    await expect(
      caller.transactions.create({ type: "Premium Payment", amount: 1000 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getAgentFromCookie).toHaveBeenCalled();
    expect(getAgentById).toHaveBeenCalledWith(1);
  });
});
