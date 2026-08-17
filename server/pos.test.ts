/**
 * RE-ENABLED 2026-08-17 (F-12 remediation) — findings resolved; see
 * tests/QUARANTINE.md (QUARANTINED-OPEN-DEFECT section) for the verdicts.
 * Original quarantine header retained below for audit history.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: zod invalid_type + agent.login UNAUTHORIZED expectations fail on delivered POS routers (behavior drift).
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Behavior reconciled (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * InsurePortal InsurePortal Platform — Production Readiness Tests
 * Tests: agent auth, transaction creation, loyalty, fraud, chat, audit log
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }),
  getAgentByCode: vi.fn(),
  getAgentById: vi.fn(),
  createAgent: vi.fn(),
  updateAgentLastLogin: vi.fn(),
  updateAgentFloat: vi.fn(),
  updateAgentCommission: vi.fn(),
  addLoyaltyHistory: vi.fn(),
  writeAuditLog: vi.fn(),
  createTransaction: vi.fn(),
  getTransactionsByAgent: vi.fn(),
  getTransactionByRef: vi.fn(),
  updateTransactionStatus: vi.fn(),
  getFraudAlerts: vi.fn(),
  createFraudAlert: vi.fn(),
  updateFraudAlertStatus: vi.fn(),
  getLoyaltyHistory: vi.fn(),
  createChatSession: vi.fn(),
  getChatSession: vi.fn(),
  addChatMessage: vi.fn(),
  getChatMessages: vi.fn(),
  getAuditLog: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

// ─── Mock bcryptjs ────────────────────────────────────────────────────────────
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("$2b$10$hashedpin"),
  },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("$2b$10$hashedpin"),
}));

// ─── Mock jose ────────────────────────────────────────────────────────────────
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
      agentCode: "AGT001",
      name: "Emeka Obi",
      tier: "Gold",
      role: "agent",
    },
  }),
}));

// ─── Mock user for authenticated context ─────────────────────────────────────
const MOCK_USER = {
  id: 1,
  username: "test-agent",
  role: "admin" as const,
  agentCode: "AGT001",
  name: "Test Agent",
  email: "test@insureportal.io",
};

// ─── Test context factory ─────────────────────────────────────────────────────
function makeCtx(
  cookieOverride?: string,
  opts?: { authenticated?: boolean }
): TrpcContext {
  const cookies: string[] = [];
  const authenticated = opts?.authenticated ?? true;
  return {
    user: authenticated ? MOCK_USER : null,
    req: {
      headers: { cookie: cookieOverride ?? "agent_session=mock.jwt.token" },
      ip: "127.0.0.1",
      protocol: "http",
    } as any,
    res: {
      cookie: vi.fn((_name: string, _val: string) => cookies.push(_val)),
      clearCookie: vi.fn(),
    } as any,
  };
}

const MOCK_AGENT = {
  id: 1,
  agentId: "AGT001",
  name: "Emeka Obi",
  phone: "08012345678",
  email: null,
  location: "Lagos Island",
  terminalModel: "PAX A920 MAX",
  terminalSerial: "SNAGT0012026",
  tier: "Gold" as const,
  pinHash: "$2b$10$hashedpin",
  premiumReserve: "850000.00",
  floatLimit: "1000000.00",
  commissionBalance: "24500.00",
  loyaltyPoints: 18750,
  streak: 12,
  rank: 3,
  isActive: true,
  lastLoginAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Agent Auth Tests ─────────────────────────────────────────────────────────
describe("agent.login", () => {
  it("returns agent profile on valid credentials", async () => {
    const { getAgentByCode, updateAgentLastLogin, writeAuditLog } =
      await import("./db");
    vi.mocked(getAgentByCode).mockResolvedValue(MOCK_AGENT);
    vi.mocked(updateAgentLastLogin).mockResolvedValue(undefined);
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);

    const ctx = makeCtx("");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.login({
      agentId: "AGT001",
      pin: "1234",
    });

    expect(result.success).toBe(true);
    expect(result.agent.agentId).toBe("AGT001");
    expect(result.agent.name).toBe("Emeka Obi");
    expect(result.agent.tier).toBe("Gold");
  });

  it("throws UNAUTHORIZED for inactive agent", async () => {
    const { getAgentByCode } = await import("./db");
    vi.mocked(getAgentByCode).mockResolvedValue({
      ...MOCK_AGENT,
      isActive: false,
    });

    const ctx = makeCtx("");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.agent.login({ agentId: "AGT001", pin: "1234" })
    ).rejects.toThrow("Agent account is suspended");
  });

  it("throws UNAUTHORIZED for unknown agent code", async () => {
    const { getAgentByCode } = await import("./db");
    vi.mocked(getAgentByCode).mockResolvedValue(undefined);

    const ctx = makeCtx("");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.agent.login({ agentId: "UNKNOWN", pin: "0000" })
    ).rejects.toThrow("Invalid agent ID or PIN");
  });

  it("clears cookie on logout", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.logout();
    expect(result.success).toBe(true);
    expect(ctx.res.clearCookie).toHaveBeenCalledWith("agent_session", {
      path: "/",
    });
  });
});

// ─── Transaction Tests ────────────────────────────────────────────────────────
describe("transactions.create", () => {
  it("creates a Cash In transaction and returns ref", async () => {
    // F-12 DRIFT-verified: auth hardening added a FAIL-CLOSED velocity gate
    // (transactions.ts Gate 4): when the velocity store is unreachable the
    // router rejects with TOO_MANY_REQUESTS + fraud alert — the control was
    // verified working in this env. The router's documented loud opt-out
    // VELOCITY_FAIL_OPEN is set here so the happy-path creation flow itself
    // stays under test.
    process.env.VELOCITY_FAIL_OPEN = "true";
    const {
      getAgentById,
      createTransaction,
      updateAgentFloat,
      updateAgentCommission,
      addLoyaltyHistory,
      writeAuditLog,
    } = await import("./db");
    vi.mocked(getAgentById).mockResolvedValue(MOCK_AGENT);
    vi.mocked(createTransaction).mockResolvedValue({
      id: 1,
      ref: "TXNABC123",
      ...MOCK_AGENT,
    } as any);
    vi.mocked(updateAgentFloat).mockResolvedValue(undefined);
    vi.mocked(updateAgentCommission).mockResolvedValue(undefined);
    vi.mocked(addLoyaltyHistory).mockResolvedValue(undefined);
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);

    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.transactions.create({
      type: "Cash In",
      amount: 50000,
    });

    expect(result.success).toBe(true);
    expect(typeof result.ref).toBe("string");
    expect(result.ref.startsWith("TXN")).toBe(true);
    expect(result.commission).toBeGreaterThan(0);
  });

  it("throws BAD_REQUEST when Cash Out exceeds float", async () => {
    const { getAgentById } = await import("./db");
    vi.mocked(getAgentById).mockResolvedValue({
      ...MOCK_AGENT,
      premiumReserve: "1000.00",
    });

    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.transactions.create({ type: "Cash Out", amount: 500000 })
    ).rejects.toThrow("Insufficient premium reserve");
  });

  it("returns empty list when no transactions exist", async () => {
    const { getTransactionsByAgent } = await import("./db");
    vi.mocked(getTransactionsByAgent).mockResolvedValue([]);

    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.transactions.list({});
    expect(result).toEqual([]);
  });
});

// ─── Fraud Tests ──────────────────────────────────────────────────────────────
describe("fraud.list", () => {
  it("returns fraud alerts", async () => {
    const { getFraudAlerts } = await import("./db");
    vi.mocked(getFraudAlerts).mockResolvedValue([
      {
        id: 1,
        severity: "critical",
        type: "Structuring",
        reason: "Test",
        status: "open",
        amount: "150000",
        fraudScore: "0.92",
        agentId: null,
        transactionId: null,
        customerName: "Test",
        aiExplanation: null,
        assignedTo: null,
        resolvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any);

    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.fraud.list({});
    // fraud.list now returns paginated { items, total, page, limit }
    const items = (result as any).items ?? result;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("critical");
    expect(items[0].amount).toBe(150000);
  });
});

// ─── Loyalty Tests ────────────────────────────────────────────────────────────
describe("loyalty.profile", () => {
  it("returns loyalty profile with correct tier", async () => {
    const { getAgentById, getLoyaltyHistory } = await import("./db");
    vi.mocked(getAgentById).mockResolvedValue(MOCK_AGENT);
    vi.mocked(getLoyaltyHistory).mockResolvedValue([]);

    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.loyalty.profile();

    expect(result.points).toBe(18750);
    expect(result.tier).toBe("Gold");
    expect(result.nextTier).toBe("Platinum");
    expect(result.pointsToNextTier).toBe(50000 - 18750);
  });

  it("throws UNAUTHORIZED without session cookie", async () => {
    const ctx = makeCtx("", { authenticated: false });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.loyalty.profile()).rejects.toThrow(
      /login|unauthorized/i
    );
  });
});

// ─── Auth logout test (existing) ─────────────────────────────────────────────
describe("auth.logout", () => {
  it("clears the Manus session cookie", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});
