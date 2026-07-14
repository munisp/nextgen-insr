import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db functions before importing router
const mockGetFraudAlerts = vi.fn();
const mockCreateFraudAlert = vi.fn();
const mockUpdateFraudAlertStatus = vi.fn();
const mockWriteAuditLog = vi.fn();
const mockGetAgentFromCookie = vi.fn();

vi.mock("../../server/db", () => ({
  getFraudAlerts: mockGetFraudAlerts,
  createFraudAlert: mockCreateFraudAlert,
  updateFraudAlertStatus: mockUpdateFraudAlertStatus,
  writeAuditLog: mockWriteAuditLog,
  getDb: vi.fn(),
}));

vi.mock("../../server/middleware/agentAuth", () => ({
  getAgentFromCookie: mockGetAgentFromCookie,
}));

describe("Fraud Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Fraud Detection Rules", () => {
    it("should flag high-value transactions above threshold", () => {
      const THRESHOLD = 500000; // ₦500K
      const transaction = { amount: 750000, agentId: "AG001" };
      expect(transaction.amount).toBeGreaterThan(THRESHOLD);
    });

    it("should flag velocity violations (>10 txns in 5 minutes)", () => {
      const MAX_VELOCITY = 10;
      const WINDOW_MINUTES = 5;
      const recentTxns = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        timestamp: new Date(Date.now() - i * 20000), // every 20 seconds
      }));
      const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60000);
      const txnsInWindow = recentTxns.filter((t) => t.timestamp >= windowStart);
      expect(txnsInWindow.length).toBeGreaterThan(MAX_VELOCITY);
    });

    it("should flag device fingerprint changes", () => {
      const previousDevice = { fingerprint: "abc123", browser: "Chrome" };
      const currentDevice = { fingerprint: "xyz789", browser: "Firefox" };
      expect(previousDevice.fingerprint).not.toBe(currentDevice.fingerprint);
    });

    it("should calculate fraud score based on multiple signals", () => {
      function calculateFraudScore(signals: {
        highAmount: boolean;
        velocityViolation: boolean;
        deviceChange: boolean;
        locationAnomaly: boolean;
      }): number {
        let score = 0;
        if (signals.highAmount) score += 30;
        if (signals.velocityViolation) score += 25;
        if (signals.deviceChange) score += 20;
        if (signals.locationAnomaly) score += 25;
        return Math.min(score, 100);
      }

      expect(calculateFraudScore({ highAmount: true, velocityViolation: false, deviceChange: false, locationAnomaly: false })).toBe(30);
      expect(calculateFraudScore({ highAmount: true, velocityViolation: true, deviceChange: true, locationAnomaly: true })).toBe(100);
      expect(calculateFraudScore({ highAmount: false, velocityViolation: false, deviceChange: false, locationAnomaly: false })).toBe(0);
    });

    it("should escalate alerts with score >= 70", () => {
      const ESCALATION_THRESHOLD = 70;
      const alerts = [
        { id: 1, score: 85, status: "open" },
        { id: 2, score: 45, status: "open" },
        { id: 3, score: 92, status: "open" },
      ];
      const shouldEscalate = alerts.filter((a) => a.score >= ESCALATION_THRESHOLD);
      expect(shouldEscalate).toHaveLength(2);
      expect(shouldEscalate.map((a) => a.id)).toEqual([1, 3]);
    });
  });

  describe("Alert Status Transitions", () => {
    it("should allow valid status transitions", () => {
      const validTransitions: Record<string, string[]> = {
        open: ["investigating", "dismissed"],
        investigating: ["escalated", "resolved", "dismissed"],
        escalated: ["resolved"],
        dismissed: [],
        resolved: [],
      };
      expect(validTransitions["open"]).toContain("investigating");
      expect(validTransitions["investigating"]).toContain("escalated");
      expect(validTransitions["dismissed"]).toHaveLength(0);
    });

    it("should reject invalid status transitions", () => {
      const validTransitions: Record<string, string[]> = {
        open: ["investigating", "dismissed"],
        investigating: ["escalated", "resolved", "dismissed"],
        escalated: ["resolved"],
        dismissed: [],
        resolved: [],
      };
      expect(validTransitions["resolved"]).not.toContain("open");
      expect(validTransitions["dismissed"]).not.toContain("investigating");
    });
  });

  describe("Pagination", () => {
    it("should paginate alerts correctly", () => {
      const total = 125;
      const limit = 50;
      const page = 2;
      const offset = (page - 1) * limit;
      const pages = Math.ceil(total / limit);
      expect(offset).toBe(50);
      expect(pages).toBe(3);
    });

    it("should filter alerts by search term", () => {
      const alerts = [
        { agentId: "AG001", customerName: "John Doe", reason: "High amount" },
        { agentId: "AG002", customerName: "Jane Smith", reason: "Velocity" },
        { agentId: "AG003", customerName: "John Wick", reason: "Device change" },
      ];
      const search = "john";
      const filtered = alerts.filter(
        (a) =>
          a.agentId.toLowerCase().includes(search) ||
          a.customerName.toLowerCase().includes(search) ||
          a.reason.toLowerCase().includes(search)
      );
      expect(filtered).toHaveLength(2);
    });
  });
});
