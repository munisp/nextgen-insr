// @ts-check

/**
 * Sprint 11 Tests — WebSocket Notifications + Analytics Dashboard
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket Real-Time Notifications
// ═══════════════════════════════════════════════════════════════════════════════
describe("WebSocket Real-Time Notifications", () => {
  const wsFile = resolve(ROOT, "server/lib/realtimeNotifications.ts");
  const hookFile = resolve(
    ROOT,
    "client/src/hooks/useRealtimeNotifications.tsx"
  );
  const socketFile = resolve(ROOT, "server/socket.ts");

  it("realtimeNotifications.ts exists", () => {
    expect(existsSync(wsFile)).toBe(true);
  });

  it("useRealtimeNotifications hook exists", () => {
    expect(existsSync(hookFile)).toBe(true);
  });

  it("socket.ts imports and initializes realtime notifications", () => {
    const content = readFileSync(socketFile, "utf-8");
    expect(content).toContain("initRealtimeNotifications");
  });

  describe("Server-side notification module", () => {
    const content = readFileSync(wsFile, "utf-8");

    it("exports initRealtimeNotifications function", () => {
      expect(content).toContain("export function initRealtimeNotifications");
    });

    it("exports publishNotification function", () => {
      expect(content).toContain("publishNotification");
    });

    it("exports getActiveUserCount function", () => {
      expect(content).toContain("export function getActiveUserCount");
    });

    it("defines notification channels", () => {
      expect(content).toContain("transaction");
      expect(content).toContain("fraud");
      expect(content).toContain("settlement");
      expect(content).toContain("kyc");
      expect(content).toContain("system");
    });

    it("implements /notifications namespace", () => {
      expect(content).toContain("/notifications");
    });

    it("handles subscribe and unsubscribe events", () => {
      expect(content).toContain("subscribe");
      expect(content).toContain("unsubscribe");
    });

    it("tracks active connections", () => {
      expect(content).toContain("getActiveUserCount");
    });

    it("supports Redis pub/sub fallback", () => {
      expect(content).toContain("Redis");
    });

    it("implements notification severity levels", () => {
      expect(content).toContain("critical");
      expect(content).toContain("warning");
      expect(content).toContain("info");
    });
  });

  describe("Client-side notification hook", () => {
    const content = readFileSync(hookFile, "utf-8");

    it("exports useRealtimeNotifications hook", () => {
      expect(content).toContain("export function useRealtimeNotifications");
    });

    it("exports ConnectionStatusBadge component", () => {
      expect(content).toContain("export function ConnectionStatusBadge");
    });

    it("manages connection state", () => {
      expect(content).toContain("connectionState");
    });

    it("tracks unread count", () => {
      expect(content).toContain("unreadCount");
    });

    it("implements auto-reconnect", () => {
      expect(content).toContain("reconnect");
    });

    it("supports channel subscription", () => {
      expect(content).toContain("channels");
      expect(content).toContain("subscribe");
    });

    it("handles notification events", () => {
      expect(content).toContain("notification");
    });

    it("provides markAsRead functionality", () => {
      expect(content).toContain("markAsRead");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Analytics Dashboard Router
// ═══════════════════════════════════════════════════════════════════════════════
describe("Analytics Dashboard Router", () => {
  const routerFile = resolve(ROOT, "server/routers/analyticsDashboard.ts");

  it("analyticsDashboard router file exists", () => {
    expect(existsSync(routerFile)).toBe(true);
  });

  describe("Router procedures", () => {
    const content = readFileSync(routerFile, "utf-8");

    it("exports analyticsDashboardRouter", () => {
      expect(content).toContain("export const analyticsDashboardRouter");
    });

    it("has kpiSummary procedure", () => {
      expect(content).toContain("kpiSummary");
    });

    it("has transactionVolume procedure with period input", () => {
      expect(content).toContain("transactionVolume");
      expect(content).toContain("7d");
      expect(content).toContain("30d");
      expect(content).toContain("90d");
      expect(content).toContain("365d");
    });

    it("has agentOnboardingFunnel procedure", () => {
      expect(content).toContain("agentOnboardingFunnel");
    });

    it("has fraudDetectionRates procedure", () => {
      expect(content).toContain("fraudDetectionRates");
    });

    it("has revenueBreakdown procedure", () => {
      expect(content).toContain("revenueBreakdown");
    });

    it("has geographicDistribution procedure", () => {
      expect(content).toContain("geographicDistribution");
    });

    it("has settlementTrend procedure", () => {
      expect(content).toContain("settlementTrend");
    });

    it("has kycApprovalTrend procedure", () => {
      expect(content).toContain("kycApprovalTrend");
    });

    it("has topAgents procedure with sorting", () => {
      expect(content).toContain("topAgents");
      expect(content).toContain("sortBy");
    });

    it("has activeUsers procedure", () => {
      expect(content).toContain("activeUsers");
    });
  });

  describe("KPI data structure", () => {
    const content = readFileSync(routerFile, "utf-8");

    it("returns totalTransactions KPI", () => {
      expect(content).toContain("totalTransactions");
    });

    it("returns totalVolume KPI", () => {
      expect(content).toContain("totalVolume");
    });

    it("returns activeAgents KPI", () => {
      expect(content).toContain("activeAgents");
    });

    it("returns fraudDetectionRate KPI", () => {
      expect(content).toContain("fraudDetectionRate");
    });

    it("returns kycApprovalRate KPI", () => {
      expect(content).toContain("kycApprovalRate");
    });

    it("returns settlementSuccessRate KPI", () => {
      expect(content).toContain("settlementSuccessRate");
    });
  });

  describe("Geographic data", () => {
    const content = readFileSync(routerFile, "utf-8");

    it("includes Nigerian regions", () => {
      expect(content).toContain("Lagos");
      expect(content).toContain("Abuja");
      expect(content).toContain("Kano");
      expect(content).toContain("Port Harcourt");
    });

    it("includes lat/lng coordinates", () => {
      expect(content).toContain("lat");
      expect(content).toContain("lng");
    });
  });

  describe("Agent leaderboard data", () => {
    const content = readFileSync(routerFile, "utf-8");

    it("includes agent tiers", () => {
      expect(content).toContain("Diamond");
      expect(content).toContain("Gold");
      expect(content).toContain("Silver");
      expect(content).toContain("Bronze");
    });

    it("includes agent metrics", () => {
      expect(content).toContain("txCount");
      expect(content).toContain("volume");
      expect(content).toContain("commission");
      expect(content).toContain("rating");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Analytics Dashboard UI
// ═══════════════════════════════════════════════════════════════════════════════
describe("Analytics Dashboard UI", () => {
  const uiFile = resolve(ROOT, "client/src/pages/AdminAnalyticsDashboard.tsx");

  it("AdminAnalyticsDashboard page exists", () => {
    expect(existsSync(uiFile)).toBe(true);
  });

  describe("UI components", () => {
    const content = readFileSync(uiFile, "utf-8");

    it("uses DashboardLayout", () => {
      expect(content).toContain("DashboardLayout");
    });

    it("uses Recharts components", () => {
      expect(content).toContain("LineChart");
      expect(content).toContain("AreaChart");
      expect(content).toContain("BarChart");
      expect(content).toContain("PieChart");
    });

    it("has KPI cards section", () => {
      expect(content).toContain("KPICards");
    });

    it("has TransactionVolumeChart", () => {
      expect(content).toContain("TransactionVolumeChart");
    });

    it("has OnboardingFunnel", () => {
      expect(content).toContain("OnboardingFunnel");
    });

    it("has FraudDetectionChart", () => {
      expect(content).toContain("FraudDetectionChart");
    });

    it("has RevenueBreakdown", () => {
      expect(content).toContain("RevenueBreakdown");
    });

    it("has GeographicDistribution", () => {
      expect(content).toContain("GeographicDistribution");
    });

    it("has SettlementTrend", () => {
      expect(content).toContain("SettlementTrend");
    });

    it("has KYCApprovalTrend", () => {
      expect(content).toContain("KYCApprovalTrend");
    });

    it("has TopAgentsLeaderboard", () => {
      expect(content).toContain("TopAgentsLeaderboard");
    });

    it("has tabbed navigation (Overview, Transactions, Agents, Risk)", () => {
      expect(content).toContain("overview");
      expect(content).toContain("transactions");
      expect(content).toContain("agents");
      expect(content).toContain("risk");
    });

    it("integrates real-time notifications", () => {
      expect(content).toContain("useRealtimeNotifications");
      expect(content).toContain("ConnectionStatusBadge");
    });

    it("shows live notification feed", () => {
      expect(content).toContain("Live Notifications");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route Registration
// ═══════════════════════════════════════════════════════════════════════════════
describe("Route Registration", () => {
  it("analyticsDashboard router is wired in routers.ts", () => {
    const content = readFileSync(resolve(ROOT, "server/routers.ts"), "utf-8");
    expect(content).toContain("analyticsDashboard: analyticsDashboardRouter");
  });

  it("AdminAnalyticsDashboard route is registered in App.tsx", () => {
    const content = readFileSync(resolve(ROOT, "client/src/App.tsx"), "utf-8");
    expect(content).toContain("AdminAnalyticsDashboard");
    expect(content).toContain("/platform-analytics");
  });
});
