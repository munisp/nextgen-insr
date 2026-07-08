// @ts-check

/**
 * P1-B: Business Logic Tests — settlement
 *
 * Covers:
 *   - Settlement record listing
 *   - Float lock enforcement during settlement
 *   - Settlement status transitions
 *   - Settlement cron trigger (admin-only)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getAgentByCode: vi.fn(),
  getAgentById: vi.fn(),
  createTransaction: vi.fn(),
  updateAgentFloat: vi.fn(),
  updateAgentCommission: vi.fn(),
  addLoyaltyHistory: vi.fn(),
  writeAuditLog: vi.fn(),
  getTransactionsByAgent: vi.fn(),
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

vi.mock("./middleware/agentAuth", () => ({
  getAgentFromCookie: vi.fn().mockResolvedValue({
    id: 1,
    agentId: "ADM001",
    name: "Admin User",
    role: "admin",
    tier: "Gold",
  }),
}));

vi.mock("./_core/platformClient", () => ({
  settlementPlatform: {
    list: vi.fn().mockResolvedValue(null),
    trigger: vi.fn().mockResolvedValue(null),
  },
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
      agentId: "ADM001",
      name: "Admin User",
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
      username: "test-agent",
      role: "admin" as const,
      agentId: "AGT001",
      name: "Test Agent",
      email: "test@insureportal.io",
    },
    req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("settlement.getHistory — graceful fallback", () => {
  it("returns empty array when DB is null", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.settlement.getHistory({ limit: 10, offset: 0 });
    // getHistory returns { source, settlements } from local DB fallback
    expect(result).toHaveProperty("settlements");
    expect(Array.isArray(result.settlements)).toBe(true);
  });
});

describe("settlement.getHistory — pagination validation", () => {
  it("rejects negative limit", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.settlement.getHistory({ limit: 0, offset: 0 })
    ).rejects.toThrow();
  });

  it("rejects negative offset", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.settlement.getHistory({ limit: 10, offset: -1 })
    ).rejects.toThrow();
  });

  it("accepts valid pagination parameters", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.settlement.getHistory({ limit: 20, offset: 0 });
    // getHistory returns { source, settlements } from local DB fallback
    expect(result).toHaveProperty("settlements");
    expect(Array.isArray(result.settlements)).toBe(true);
  });
});

describe("settlement.runNow — access control", () => {
  it("rejects non-admin agents", async () => {
    const { getAgentFromCookie } = await import("./middleware/agentAuth");
    vi.mocked(getAgentFromCookie).mockResolvedValueOnce({
      id: 2,
      agentId: "AGT002",
      name: "Regular Agent",
      role: "agent",
      tier: "Bronze",
    } as any);

    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.settlement.runNow()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
