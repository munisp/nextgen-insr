/**
 * 2026-11-27 (W25-B): transactions.approveReversal / rejectReversal —
 * financialProcedure authz denial matrix (main repo)
 *
 * Companion to the W25-B insureportal fix: the portal's reversal approval
 * flow ran on bare `protectedProcedure` while THIS repo gates it with
 * `financialProcedure` (./_core/permifyMiddleware.ts: role-permission matrix
 * + Permify financial check, fail-closed). These tests pin the main-repo
 * contract the portal was realigned to, so a future regression here (or a
 * re-divergence there) fails loudly:
 *   - unauthenticated (no ctx.user)                 → UNAUTHORIZED
 *   - authenticated role without the "reversal" op  → FORBIDDEN (middleware,
 *     before the handler body runs)
 *   - authenticated admin (Permify fail-open unit   → handler runs (happy path)
 *     env, see vitest.config.ts)
 *   - rejectReversal is gated identically (parity).
 *
 * 2026-11-28 (insureportal→root merge): the Permify-DENIES leg, previously
 * only covered in the portal's sibling test
 * (insureportal/server/transactions.approveReversal.authz.test.ts), is now
 * merged INTO this suite — ./_core/permify is stubbed at the module
 * boundary (same convention as ./transactions.pendingReversals.test.ts), so
 * the deny (fail-closed) verdict is reproducible here without depending on
 * the PERMIFY_FAIL_OPEN unit-env setting. The suite is the union of both
 * sides' cases; no assertion was weakened (the stronger contract — portal's
 * mounted-router harness replaced by this suite's full appRouter harness —
 * was kept).
 *
 * Mock pattern mirrors ./transactions.pendingReversals.test.ts (W24-B): the
 * db double is a query-builder chain standing in ONLY for the DB transport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { getDb, writeAuditLog, updateAgentFloat } from "./db";
import { getAgentFromCookie } from "./middleware/agentAuth";
import { permifyCheck, permifyCheckCached } from "./_core/permify";
import type { TrpcContext } from "./_core/context";

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
  getAgentByCode: vi.fn(),
  getAgentById: vi.fn(),
  createTransaction: vi.fn(),
  updateAgentFloat: vi.fn(),
  updateAgentCommission: vi.fn(),
  addLoyaltyHistory: vi.fn(),
  writeAuditLog: vi.fn(),
  getTransactionsByAgent: vi.fn().mockResolvedValue([]),
  getTransactionByRef: vi.fn(),
  updateTransactionStatus: vi.fn(),
  updateFraudAlertStatus: vi.fn(),
  getLoyaltyHistory: vi.fn(),
  createChatSession: vi.fn(),
  getChatSession: vi.fn(),
  addChatMessage: vi.fn(),
  getChatMessages: vi.fn(),
  getAuditLog: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getUserByKeycloakSub: vi.fn(),
  withTransaction: vi.fn().mockImplementation(async (fn: any) => fn({})),
  softDelete: vi.fn(),
}));

vi.mock("./tbClient", () => ({
  tbIsHealthy: vi.fn().mockResolvedValue(false),
  tbCreateTransfer: vi.fn().mockResolvedValue(null),
  tbEnsureAgentAccount: vi.fn().mockResolvedValue(true),
  tbGetAgentBalance: vi.fn().mockResolvedValue(null),
  tbGetSyncStatus: vi.fn().mockResolvedValue(null),
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

// 2026-11-28 (merge, from the portal sibling suite): Permify is stubbed at
// the module boundary so BOTH the allow and the deny (fail-closed) legs of
// financialProcedure are exercised in-repo. Real exports are preserved;
// only the two verdict functions are pinned per test.
vi.mock("./_core/permify", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./_core/permify")>();
  return {
    ...mod,
    permifyCheck: vi.fn().mockResolvedValue(true),
    permifyCheckCached: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("./_core/platformClient", () => ({
  floatPlatform: {
    utilize: vi.fn().mockResolvedValue({ success: true }),
    settle: vi.fn().mockResolvedValue({ success: true }),
    getBalance: vi.fn().mockResolvedValue(null),
    getTransactions: vi.fn().mockResolvedValue(null),
  },
  analyticsPlatform: {
    transactionSummary: vi.fn().mockResolvedValue(null),
  },
  fraudPlatform: {
    score: vi.fn().mockResolvedValue(null),
  },
  geofencingPlatform: {
    check: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("$2b$10$hash"),
  },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("$2b$10$hash"),
}));

vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock.jwt.token"),
  })),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: {
      sub: "1",
      agentId: "AGT001",
      name: "Emeka Obi",
      role: "admin",
      tier: "Gold",
    },
  }),
  createRemoteJWKSet: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCtx(user: Record<string, unknown> | null): TrpcContext {
  return {
    user: user as any,
    req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  };
}

const ADMIN_USER = {
  id: 1,
  username: "test-admin",
  role: "admin" as const,
  agentId: "AGT001",
  name: "Test Admin",
  email: "test@insureportal.io",
};

/** Transaction row exactly as the approveReversal select would return it. */
const PENDING_TX = {
  id: 42,
  ref: "TXN-PEND-001",
  agentId: 7,
  type: "Cash In",
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
    vi.mocked(permifyCheckCached).mockResolvedValue(true);
    vi.mocked(getAgentFromCookie).mockResolvedValue(ADMIN_AGENT as any);
    const { db } = makeApproveDb(PENDING_TX);
    vi.mocked(getDb).mockResolvedValue(db as any);
  });

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.transactions.approveReversal({ transactionId: 42 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects authenticated users whose role lacks the 'reversal' op (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "user" as const })
    );
    await expect(
      caller.transactions.approveReversal({ transactionId: 42 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Denied at the financialProcedure role matrix — the handler body (and
    // its own admin gate) must never run.
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  // 2026-11-28 (merge): case unioned in from the portal sibling suite —
  // pins the Permify-DENIES leg of financialProcedure (fail-closed).
  it("rejects admin when Permify denies the financial check (fail-closed)", async () => {
    vi.mocked(permifyCheckCached).mockResolvedValue(false);
    const caller = appRouter.createCaller(makeCtx(ADMIN_USER));
    await expect(
      caller.transactions.approveReversal({ transactionId: 42 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getAgentFromCookie).not.toHaveBeenCalled();
  });

  it("allows an admin (Permify fail-open unit env) — handler runs to completion", async () => {
    const { db, updates } = makeApproveDb(PENDING_TX);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx(ADMIN_USER));
    const result = await caller.transactions.approveReversal({
      transactionId: 42,
      notes: "customer dispute resolved",
    });

    expect(result.success).toBe(true);
    expect(typeof result.reversalRef).toBe("string");
    // Funds moved back: Cash In reversal debits the agent float.
    expect(updateAgentFloat).toHaveBeenCalledWith(7, -5000);
    // Transaction flipped to reversed by the approving admin. NOTE: the
    // (unmocked, fire-and-forget) observability middleware also issues db
    // updates via lib/analyticsMetrics against the same getDb double, so we
    // select the reversal write by shape rather than by call order.
    const reversalUpdate = updates.find(
      (u: any) => u && u.status === "reversed"
    );
    expect(reversalUpdate).toMatchObject({ status: "reversed", approvedBy: "AGT001" });
    // Audit trail written.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "REVERSAL_APPROVED", status: "success" })
    );
  });

  it("gates rejectReversal identically (role without op → FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(
      makeCtx({ ...ADMIN_USER, role: "user" as const })
    );
    await expect(
      caller.transactions.rejectReversal({ transactionId: 42, reason: "not justified" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
