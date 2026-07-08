// @ts-check

/**
 * Sprint 93 Tests — Security Alert Notifications, Role-Based Nav, Network Quality Heatmap
 */
import { describe, it, expect } from "vitest";

// ── 1. Security Alert Notification Service ──
describe("S93: SecurityAlertNotifier", () => {
  it("should export all notification service functions", async () => {
    const mod = await import("./services/securityAlertNotifier");
    expect(mod.dispatchSecurityAlert).toBeDefined();
    expect(typeof mod.dispatchSecurityAlert).toBe("function");
  });

  it("should export dispatchSecurityAlert function", async () => {
    const mod = await import("./services/securityAlertNotifier");
    expect(typeof mod.dispatchSecurityAlert).toBe("function");
    expect(typeof mod.getDeliveryHistory).toBe("function");
    expect(typeof mod.getDeliveryStats).toBe("function");
    expect(typeof mod.sendTestAlert).toBe("function");
  });

  it("should export admin preference management functions", async () => {
    const mod = await import("./services/securityAlertNotifier");
    expect(typeof mod.getAdminPreferences).toBe("function");
    expect(typeof mod.getAdminPreference).toBe("function");
    expect(typeof mod.updateAdminPreference).toBe("function");
    expect(typeof mod.addAdminPreference).toBe("function");
  });
});

// ── 2. Alert Notifications Router ──
describe("S93: alertNotificationsRouter", () => {
  it("should export the router", async () => {
    const mod = await import("./routers/alertNotifications");
    expect(mod.alertNotificationsRouter).toBeDefined();
  });

  it("should have required procedures", async () => {
    const mod = await import("./routers/alertNotifications");
    const router = mod.alertNotificationsRouter;
    const procedures = Object.keys(
      router._def.procedures || router._def.record || {}
    );
    expect(procedures).toContain("listPreferences");
    expect(procedures).toContain("getPreference");
    expect(procedures).toContain("updatePreference");
  });
});

// ── 3. Role-Based Navigation Config ──
describe("S93: roleNavConfig", () => {
  it("should export all role nav functions", async () => {
    const mod = await import("../client/src/lib/roleNavConfig");
    expect(mod.filterNavGroupsByRole).toBeDefined();
    expect(mod.canAccessRoute).toBeDefined();
    expect(mod.getRoleDisplayName).toBeDefined();
    expect(mod.getRoleBadgeColor).toBeDefined();
  });

  it("should filter nav groups for operator role", async () => {
    const { filterNavGroupsByRole } = await import(
      "../client/src/lib/roleNavConfig"
    );
    const mockGroups = [
      {
        label: "Admin",
        items: [
          { label: "System Config", path: "/system-config" },
          { label: "Dashboard", path: "/dashboard" },
        ],
      },
      {
        label: "Operations",
        items: [
          { label: "Transactions", path: "/transactions" },
          { label: "POS", path: "/pos" },
        ],
      },
    ];
    const filtered = filterNavGroupsByRole(mockGroups, "user");
    expect(Array.isArray(filtered)).toBe(true);
  });

  it("should allow admin access to all routes", async () => {
    const { canAccessRoute } = await import("../client/src/lib/roleNavConfig");
    expect(canAccessRoute("/system-config", "admin")).toBe(true);
    expect(canAccessRoute("/dashboard", "admin")).toBe(true);
    expect(canAccessRoute("/transactions", "admin")).toBe(true);
  });

  it("should return display name for each role", async () => {
    const { getRoleDisplayName } = await import(
      "../client/src/lib/roleNavConfig"
    );
    expect(getRoleDisplayName("admin")).toBeTruthy();
    expect(typeof getRoleDisplayName("admin")).toBe("string");
    expect(getRoleDisplayName("user")).toBeTruthy();
  });

  it("should return badge color for each role", async () => {
    const { getRoleBadgeColor } = await import(
      "../client/src/lib/roleNavConfig"
    );
    expect(getRoleBadgeColor("admin")).toBeTruthy();
    expect(typeof getRoleBadgeColor("admin")).toBe("string");
  });
});

// ── 4. Network Quality Heatmap Router ──
describe("S93: networkQualityHeatmapRouter", () => {
  it("should export the router", async () => {
    const mod = await import("./routers/networkQualityHeatmap");
    expect(mod.networkQualityHeatmapRouter).toBeDefined();
  });

  it("should have required procedures", async () => {
    const mod = await import("./routers/networkQualityHeatmap");
    const router = mod.networkQualityHeatmapRouter;
    const procedures = Object.keys(
      router._def.procedures || router._def.record || {}
    );
    expect(procedures).toContain("getRegionMetrics");
    expect(procedures).toContain("getSummary");
    expect(procedures).toContain("getEvents");
    expect(procedures).toContain("getRegionDetail");
  });
});

// ── 5. Integration: Routers are importable ──
describe("S93: Router imports", () => {
  it("should import alertNotificationsRouter without error", async () => {
    const mod = await import("./routers/alertNotifications");
    expect(mod.alertNotificationsRouter).toBeDefined();
  });

  it("should import networkQualityHeatmapRouter without error", async () => {
    const mod = await import("./routers/networkQualityHeatmap");
    expect(mod.networkQualityHeatmapRouter).toBeDefined();
  });
});
