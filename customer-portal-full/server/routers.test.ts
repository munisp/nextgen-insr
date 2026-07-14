import { describe, it, expect, beforeEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";
import * as db from "./db";

// Mock the database module
vi.mock("./db", () => ({
  getPoliciesByUserId: vi.fn(),
  getPolicyById: vi.fn(),
  updatePolicy: vi.fn(),
  getClaimsByUserId: vi.fn(),
  getClaimById: vi.fn(),
  createClaim: vi.fn(),
  getPaymentsByUserId: vi.fn(),
  getPaymentById: vi.fn(),
  updatePayment: vi.fn(),
  upsertUser: vi.fn(),
}));

describe("tRPC Routers", () => {
  let mockContext: TrpcContext;
  let mockUser: User;

  beforeEach(() => {
    mockUser = {
      id: 1,
      openId: "test-user-123",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "oauth",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    mockContext = {
      req: {} as any,
      res: {} as any,
      user: mockUser,
    };

    vi.clearAllMocks();
  });

  describe("Auth Router", () => {
    it("should return current user with auth.me", async () => {
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.auth.me();
      expect(result).toEqual(mockUser);
    });

    it("should return null for unauthenticated user", async () => {
      const unauthContext = { ...mockContext, user: null };
      const caller = appRouter.createCaller(unauthContext);
      const result = await caller.auth.me();
      expect(result).toBeNull();
    });

    it("should logout successfully", async () => {
      const mockReq = {
        headers: {},
        protocol: "https",
      };
      const mockRes = {
        clearCookie: vi.fn(),
      };
      const contextWithRes = { ...mockContext, req: mockReq as any, res: mockRes as any };
      const caller = appRouter.createCaller(contextWithRes);
      
      const result = await caller.auth.logout();
      expect(result.success).toBe(true);
      expect(mockRes.clearCookie).toHaveBeenCalled();
    });
  });

  describe("Policies Router", () => {
    const mockPolicies = [
      {
        id: 1,
        userId: 1,
        policyNumber: "POL-001",
        name: "Health Insurance",
        type: "Health" as const,
        premium: "15000.00",
        status: "Active" as const,
        startDate: new Date(),
        expiryDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it("should list all policies for authenticated user", async () => {
      vi.mocked(db.getPoliciesByUserId).mockResolvedValue(mockPolicies);
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.policies.list();
      
      expect(db.getPoliciesByUserId).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockPolicies);
    });

    it("should get a specific policy", async () => {
      vi.mocked(db.getPolicyById).mockResolvedValue(mockPolicies[0]);
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.policies.get({ id: 1 });
      
      expect(db.getPolicyById).toHaveBeenCalledWith(1, mockUser.id);
      expect(result).toEqual(mockPolicies[0]);
    });

    it("should renew a policy", async () => {
      const policy = mockPolicies[0];
      vi.mocked(db.getPolicyById).mockResolvedValue(policy);
      vi.mocked(db.updatePolicy).mockResolvedValue({
        ...policy,
        status: "Active" as const,
      });
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.policies.renew({ id: 1 });
      
      expect(db.getPolicyById).toHaveBeenCalledWith(1, mockUser.id);
      expect(db.updatePolicy).toHaveBeenCalled();
      expect(result.status).toBe("Active");
    });

    it("should throw error when renewing non-existent policy", async () => {
      vi.mocked(db.getPolicyById).mockResolvedValue(undefined);
      
      const caller = appRouter.createCaller(mockContext);
      
      await expect(caller.policies.renew({ id: 999 })).rejects.toThrow("Policy not found");
    });
  });

  describe("Claims Router", () => {
    const mockClaims = [
      {
        id: 1,
        userId: 1,
        policyId: 1,
        claimNumber: "CLM-001",
        amount: "5000.00",
        status: "Submitted" as const,
        incidentDate: new Date(),
        description: "Test claim",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it("should list all claims for authenticated user", async () => {
      vi.mocked(db.getClaimsByUserId).mockResolvedValue(mockClaims);
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.claims.list();
      
      expect(db.getClaimsByUserId).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockClaims);
    });

    it("should get a specific claim", async () => {
      vi.mocked(db.getClaimById).mockResolvedValue(mockClaims[0]);
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.claims.get({ id: 1 });
      
      expect(db.getClaimById).toHaveBeenCalledWith(1, mockUser.id);
      expect(result).toEqual(mockClaims[0]);
    });

    it("should create a new claim", async () => {
      const newClaim = {
        policyId: 1,
        amount: "5000.00",
        incidentDate: new Date(),
        description: "New claim",
      };

      vi.mocked(db.createClaim).mockResolvedValue({
        ...mockClaims[0],
        ...newClaim,
      });
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.claims.create(newClaim);
      
      expect(db.createClaim).toHaveBeenCalled();
      expect(result.description).toBe(newClaim.description);
    });
  });

  describe("Payments Router", () => {
    const mockPayments = [
      {
        id: 1,
        userId: 1,
        policyId: 1,
        amount: "15000.00",
        status: "Pending" as const,
        dueDate: new Date(),
        paidDate: null,
        paymentMethod: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it("should list all payments for authenticated user", async () => {
      vi.mocked(db.getPaymentsByUserId).mockResolvedValue(mockPayments);
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.payments.list();
      
      expect(db.getPaymentsByUserId).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockPayments);
    });

    it("should get a specific payment", async () => {
      vi.mocked(db.getPaymentById).mockResolvedValue(mockPayments[0]);
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.payments.get({ id: 1 });
      
      expect(db.getPaymentById).toHaveBeenCalledWith(1, mockUser.id);
      expect(result).toEqual(mockPayments[0]);
    });

    it("should process a payment", async () => {
      vi.mocked(db.updatePayment).mockResolvedValue({
        ...mockPayments[0],
        status: "Completed" as const,
        paidDate: new Date(),
        paymentMethod: "Credit Card",
      });
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.payments.process({
        id: 1,
        paymentMethod: "Credit Card",
      });
      
      expect(db.updatePayment).toHaveBeenCalled();
      expect(result.status).toBe("Completed");
      expect(result.paymentMethod).toBe("Credit Card");
    });
  });

  describe("Profile Router", () => {
    it("should get current user profile", async () => {
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.profile.get();
      
      expect(result).toEqual(mockUser);
    });

    it("should update user profile", async () => {
      vi.mocked(db.upsertUser).mockResolvedValue();
      
      const caller = appRouter.createCaller(mockContext);
      const result = await caller.profile.update({
        name: "Updated Name",
        email: "updated@example.com",
      });
      
      expect(db.upsertUser).toHaveBeenCalledWith({
        openId: mockUser.openId,
        name: "Updated Name",
        email: "updated@example.com",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Protected Procedures", () => {
    it("should reject unauthenticated requests to protected procedures", async () => {
      const unauthContext = { ...mockContext, user: null };
      const caller = appRouter.createCaller(unauthContext);
      
      await expect(caller.policies.list()).rejects.toThrow();
      await expect(caller.claims.list()).rejects.toThrow();
      await expect(caller.payments.list()).rejects.toThrow();
      await expect(caller.profile.get()).rejects.toThrow();
    });
  });
});
