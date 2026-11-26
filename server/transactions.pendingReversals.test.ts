/**
 * 2026-11-27 (W24-B): transactions.pendingReversals — customerPhone selection
 *
 * Regression coverage for the W24-B fix in ./routers/transactions.ts:
 * the pendingReversals select omitted `customerPhone`, but the admin UI
 * (client/src/components/admin/SecurityTab.tsx, PendingReversalsSection)
 * renders `tx.customerName ?? tx.customerPhone ?? "—"`, so customers without
 * a recorded name always showed "—" even when a phone number existed.
 *
 * Contract under test:
 *   - The drizzle select passed to db.select() includes the REAL
 *     transactions.customerPhone schema column (identity-checked against
 *     drizzle/schema.ts — not a re-declared literal).
 *   - A pending-reversal row with customerName=null surfaces customerPhone
 *     in the procedure result (so the UI fallback chain resolves to it),
 *     and amount is coerced to a number.
 *   - The admin/supervisor role gate still rejects plain agents (fail-closed
 *     authz preserved).
 *
 * Mock pattern mirrors ./transactions.create.test.ts (vi.mock of ./db,
 * ./tbClient, ./middleware/agentAuth, ./_core/platformClient, bcryptjs, jose);
 * the db double is a query-builder chain that captures the select argument
 * and returns fixture rows — it stands in ONLY for the DB transport, never
 * for the procedure logic under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { getAgentFromCookie } from "./middleware/agentAuth";
import { transactions } from "../drizzle/schema";
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
function makeCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      username: "test-admin",
      role: "admin" as const,
      agentId: "AGT001",
      name: "Test Admin",
      email: "test@insureportal.io",
    },
    req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
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

    const caller = appRouter.createCaller(makeCtx());
    await caller.transactions.pendingReversals();

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

    const caller = appRouter.createCaller(makeCtx());
    const rows = await caller.transactions.pendingReversals();

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

    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.transactions.pendingReversals()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
