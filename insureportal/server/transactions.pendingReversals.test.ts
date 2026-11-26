/**
 * 2026-11-27 (W24-B): transactions.pendingReversals — customerPhone selection
 *
 * Regression coverage for the W24-B fix in ./routers/transactions.ts
 * (mirrors the main repo's server/transactions.pendingReversals.test.ts):
 * the pendingReversals select omitted `customerPhone`, but the admin UI
 * (client/src/components/admin/SecurityTab.tsx, PendingReversalsSection)
 * renders `tx.customerName ?? tx.customerPhone ?? "—"`, so customers without
 * a recorded name always showed "—" even when a phone number existed.
 *
 * Contract under test:
 *   - The drizzle select passed to db.select() includes the REAL
 *     transactions.customerPhone schema column (identity-checked against
 *     @schema — not a re-declared literal).
 *   - A pending-reversal row with customerName=null surfaces customerPhone
 *     in the procedure result (so the UI fallback chain resolves to it),
 *     and amount is coerced to a number.
 *   - The admin/supervisor role gate still rejects plain agents (fail-closed
 *     authz preserved).
 *
 * Divergence note: the main-repo test imports the full appRouter (matching
 * server/transactions.create.test.ts); this client repo has no such
 * full-app unit test, so — like its tests/integration/*.test.ts files — we
 * import the transactionsRouter directly to keep the module graph minimal.
 * Infra middlewares (sidecar/observability instrumentation) and the Permify
 * client are stubbed at the module boundary, consistent with the repo's
 * unit-test convention (cf. server/_core/permifyBootGuardW23.test.ts); the
 * procedure logic under test is never stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { transactionsRouter } from "./routers/transactions";
import { getDb } from "./db";
import { getAgentFromCookie } from "./middleware/agentAuth";
import { transactions } from "@schema";

// ── Mocks ─────────────────────────────────────────────────────────────────────
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

// Permify points at no live server in unit tests; the base-access check is
// stubbed to allow so the procedure's OWN role gate is what these tests
// exercise (policy-level coverage is the W23-documented disclosed gap).
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
function makeCtx(): any {
  return {
    user: {
      id: 1,
      username: "test-admin",
      role: "admin",
      agentId: "AGT001",
      name: "Test Admin",
      email: "test@insureportal.ng",
    },
    req: { headers: { cookie: "agent_session=mock.jwt.token" } },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  };
}

/**
 * Query-builder double: captures the exact select object the procedure hands
 * to drizzle, then resolves the terminal .where() with the fixture rows.
 */
function makeCapturingDb(rows: any[]) {
  const captured: { select?: Record<string, unknown> } = {};
  const db = {
    select: (sel: Record<string, unknown>) => {
      captured.select = sel;
      return {
        from: () => ({
          leftJoin: () => ({
            where: async () => rows,
          }),
        }),
      };
    },
  };
  return { db, captured };
}

// One row exactly as the pending_reversal_approval query would return it,
// with customerName NULL so the UI fallback chain must reach customerPhone.
const FIXTURE_ROW = {
  id: 42,
  ref: "TXN-PEND-001",
  agentNumericId: 7,
  type: "cash_out",
  amount: "15000.00",
  customerName: null,
  customerPhone: "08012345678",
  failureReason: "Agent-initiated reversal",
  createdAt: new Date("2026-11-27T10:00:00.000Z"),
  agentId: "AGT001",
  agentName: "Emeka Obi",
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("transactions.pendingReversals — customerPhone selection (W24-B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentFromCookie).mockResolvedValue(ADMIN_AGENT as any);
  });

  it("selects the real transactions.customerPhone column", async () => {
    const { db, captured } = makeCapturingDb([FIXTURE_ROW]);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = transactionsRouter.createCaller(makeCtx());
    await caller.pendingReversals();

    expect(captured.select).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(captured.select, "customerPhone")
    ).toBe(true);
    // Identity check: the key maps to the actual schema column object, so the
    // assertion would fail if anyone re-pointed it at a literal or renamed it.
    expect(captured.select!.customerPhone).toBe(transactions.customerPhone);
  });

  it("returns customerPhone for a nameless customer (UI fallback resolves)", async () => {
    const { db } = makeCapturingDb([FIXTURE_ROW]);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = transactionsRouter.createCaller(makeCtx());
    const rows = await caller.pendingReversals();

    expect(rows).toHaveLength(1);
    const row = rows[0] as any;
    expect(row.customerName).toBeNull();
    expect(row.customerPhone).toBe("08012345678");
    expect(row.amount).toBe(15000); // numeric string coerced by the procedure
    // Mirror of the exact UI expression in SecurityTab.tsx line 677:
    // {tx.customerName ?? tx.customerPhone ?? "—"}
    expect(row.customerName ?? row.customerPhone ?? "—").toBe("08012345678");
  });

  it("rejects non-admin/non-supervisor agents (fail-closed role gate)", async () => {
    const { db } = makeCapturingDb([FIXTURE_ROW]);
    vi.mocked(getDb).mockResolvedValue(db as any);
    vi.mocked(getAgentFromCookie).mockResolvedValue({
      ...ADMIN_AGENT,
      role: "agent",
    } as any);

    const caller = transactionsRouter.createCaller(makeCtx());
    await expect(caller.pendingReversals()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
