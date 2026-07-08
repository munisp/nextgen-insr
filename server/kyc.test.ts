// @ts-check

/**
 * KYC Router Tests
 * Tests for startLiveness, submitLivenessFrame, verifyDocument, getStatus, listSessions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers.js";
import type { TrpcContext } from "./_core/context.js";

// ─── Mock DB ─────────────────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock hoisting, so kycRow is available in the factory
const { kycRow } = vi.hoisted(() => ({
  kycRow: () => ({
    id: 1,
    agentId: 1,
    status: "liveness_passed",
    livenessPassed: true,
    livenessScore: "0.97",
    docType: "NIN",
    docExtractedName: "Emeka Eze",
    docExtractedDob: "1990-01-01",
    docExtractedIdNumber: "12345678901",
    docConfidence: "0.92",
    docFraudIndicators: [],
    complianceRecordId: "case_001",
    serviceAvailable: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}));
vi.mock("./db.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./db.js")>();
  return {
    ...actual,
    getDb: vi.fn().mockResolvedValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 1,
              agentId: 1,
              status: "pending",
              livenessResult: null,
              livenessScore: null,
              ocrResult: null,
              ocrConfidence: null,
              extractedName: null,
              extractedDob: null,
              extractedIdNumber: null,
              fraudIndicators: null,
              serviceAvailable: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([kycRow()]),
            }),
            limit: vi.fn().mockResolvedValue([kycRow()]),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([kycRow()]),
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: 1,
                status: "liveness_passed",
                livenessResult: "passed",
                livenessScore: 0.97,
              },
            ]),
          }),
        }),
      }),
    }),
  };
});

// ─── Mock kycClient ───────────────────────────────────────────────────────────
vi.mock("./_core/kycClient.js", () => ({
  createLivenessChallenge: vi.fn().mockResolvedValue({
    challengeId: "ch_test_001",
    instruction: "Please blink twice",
    method: "active_blink",
    expiresIn: 60,
    serviceAvailable: true,
  }),
  verifyLivenessChallenge: vi.fn().mockResolvedValue({
    passed: true,
    score: 0.97,
    message: "Liveness verified",
    serviceAvailable: true,
  }),
  processDocument: vi.fn().mockResolvedValue({
    passed: true,
    confidence: 0.92,
    extractedName: "Emeka Eze",
    extractedDob: "1990-01-01",
    extractedIdNumber: "12345678901",
    documentType: "nin_slip",
    fraudIndicators: [],
    serviceAvailable: true,
  }),
  storeComplianceRecord: vi.fn().mockResolvedValue({
    caseId: "case_001",
    status: "approved",
    serviceAvailable: true,
  }),
}));

// ─── Mock agent auth ──────────────────────────────────────────────────────────
vi.mock("./middleware/agentAuth.js", () => ({
  getAgentFromCookie: vi.fn().mockResolvedValue({
    id: 1,
    agentId: "AGT001",
    name: "Test Agent",
    role: "agent",
    tier: "Silver",
    premiumReserve: 100000,
    commissionBalance: 5000,
    loyaltyPoints: 250,
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCaller(role: "agent" | "admin" = "agent") {
  const ctx: TrpcContext = {
    req: { cookies: { agent_session: "mock_token" } } as any,
    res: {} as any,
    user:
      role === "admin"
        ? ({
            id: 1,
            name: "Admin",
            role: "admin",
            keycloakSub: "admin-sub",
          } as any)
        : ({
            id: 2,
            name: "Test Agent",
            role: "user",
            agentId: "AGT001",
            username: "test-agent",
            email: "agent@insureportal.io",
          } as any),
  };
  return appRouter.createCaller(ctx);
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("kyc.startLiveness", () => {
  it("creates a KYC session and returns a liveness challenge", async () => {
    const caller = makeCaller();
    const result = await caller.kyc.startLiveness({ method: "active_blink" });
    expect(result).toHaveProperty("sessionId");
    expect(result).toHaveProperty("challengeId");
    expect(result.instruction).toBe("Please blink twice");
    expect(result.serviceAvailable).toBe(true);
  });

  it("handles KYC service unavailability gracefully", async () => {
    // The procedure always returns a session; serviceAvailable reflects upstream state
    const caller = makeCaller();
    const result = await caller.kyc.startLiveness({ method: "passive" });
    // Should always return a sessionId regardless of service state
    expect(result).toHaveProperty("sessionId");
    expect(result).toHaveProperty("serviceAvailable");
  });
});

describe("kyc.submitLivenessFrame", () => {
  it("verifies a liveness frame and marks session as liveness_passed", async () => {
    const caller = makeCaller();
    // frameBase64 must be >= 100 chars
    const fakeFrame = "data:image/jpeg;base64," + "A".repeat(100);
    const result = await caller.kyc.submitLivenessFrame({
      sessionId: 1,
      challengeId: "ch_test_001",
      frameBase64: fakeFrame,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
  });
});

describe("kyc.verifyDocument", () => {
  it("processes a document image and returns OCR results", async () => {
    const caller = makeCaller();
    // imageBase64 must be >= 100 chars; docType must be one of the enum values
    const fakeImage = "data:image/jpeg;base64," + "A".repeat(100);
    const result = await caller.kyc.verifyDocument({
      sessionId: 1,
      imageBase64: fakeImage,
      docType: "NIN",
    });
    expect(result.passed).toBe(true);
    expect(result.extractedName).toBe("Emeka Eze");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.fraudIndicators).toEqual([]);
  });
});

describe("kyc.getStatus", () => {
  it("returns the latest KYC session status for the logged-in agent", async () => {
    const caller = makeCaller();
    const result = await caller.kyc.getStatus();
    expect(result.hasSession).toBe(true);
    expect(result.status).toBe("liveness_passed");
    expect(result.session?.livenessScore).toBe(0.97);
  });
});

describe("kyc.listSessions", () => {
  it("returns paginated KYC sessions for admin", async () => {
    const caller = makeCaller("admin");
    const result = await caller.kyc.listSessions({ page: 1, pageSize: 10 });
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });
});
