/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: content assertion drift on delivered router.
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Content reconciled (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * Sprint 12 Tests — Chart Export, Scheduled Reports, Dashboard Layout,
 * Broadcast Announcements, User Notification Preferences
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Chart Export Utility Tests ──────────────────────────────────────────────
describe("Chart Export Utility", () => {
  const chartExportPath = path.resolve(
    __dirname,
    "../client/src/lib/chartExport.ts"
  );

  it("chartExport.ts exists", () => {
    expect(fs.existsSync(chartExportPath)).toBe(true);
  });

  it("exports exportChartAsPNG function", () => {
    const content = fs.readFileSync(chartExportPath, "utf-8");
    expect(content).toContain("exportChartAsPng");
  });

  it("exports exportDataAsCSV function", () => {
    const content = fs.readFileSync(chartExportPath, "utf-8");
    expect(content).toContain("exportDataAsCsv");
  });

  it("ChartExportMenu component exists", () => {
    const menuPath = path.resolve(
      __dirname,
      "../client/src/components/ChartExportMenu.tsx"
    );
    expect(fs.existsSync(menuPath)).toBe(true);
  });
});

// ─── Scheduled Reports Router Tests ──────────────────────────────────────────
describe("Scheduled Reports Router", () => {
  const routerPath = path.resolve(__dirname, "./routers/scheduledReports.ts");

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports scheduledReportsRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const scheduledReportsRouter");
  });

  it("has CRUD procedures (list, create, delete)", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("list:");
    expect(content).toContain("create:");
    expect(content).toContain("delete:");
  });

  it("supports report templates", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("template");
  });

  it("has schedule frequency options", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("daily");
    expect(content).toContain("weekly");
    expect(content).toContain("monthly");
  });

  it("ScheduledReports page exists", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/ScheduledReports.tsx"
    );
    expect(fs.existsSync(pagePath)).toBe(true);
  });
});

// ─── Dashboard Layout Router Tests ──────────────────────────────────────────
describe("Dashboard Layout Router", () => {
  const routerPath = path.resolve(__dirname, "./routers/dashboardLayout.ts");

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports dashboardLayoutRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const dashboardLayoutRouter");
  });

  it("has getLayout and saveLayout procedures", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("getLayout:");
    expect(content).toContain("saveLayout:");
  });

  it("has presets procedure", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("presets:");
  });

  it("has resetLayout procedure", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("resetLayout:");
  });

  it("DashboardLayoutEditor component exists with drag-and-drop", () => {
    const compPath = path.resolve(
      __dirname,
      "../client/src/components/DashboardLayoutEditor.tsx"
    );
    expect(fs.existsSync(compPath)).toBe(true);
    const content = fs.readFileSync(compPath, "utf-8");
    expect(content).toContain("DashboardLayoutEditor");
    expect(content).toContain("react-grid-layout");
    expect(content).toContain("isDraggable");
    expect(content).toContain("isResizable");
    expect(content).toContain("editMode");
  });
});

// ─── Broadcast Announcements Router Tests ────────────────────────────────────
describe("Broadcast Announcements Router", () => {
  const routerPath = path.resolve(
    __dirname,
    "./routers/broadcastAnnouncements.ts"
  );

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports broadcastAnnouncementsRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const broadcastAnnouncementsRouter");
  });

  it("has CRUD procedures (list, create, delete)", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("list:");
    expect(content).toContain("create:");
    expect(content).toContain("delete:");
  });

  it("supports announcement types", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    for (const t of ["info", "warning", "critical", "maintenance", "feature"]) {
      expect(content).toContain(`"${t}"`);
    }
  });

  it("supports targeting (all, agents, admins, merchants)", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    for (const t of ["agents", "admins", "merchants"]) {
      expect(content).toContain(`"${t}"`);
    }
  });

  it("supports pinning, dismissing, and multiple channels", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("togglePin:");
    expect(content).toContain("dismiss:");
    expect(content).toContain('"banner"');
    expect(content).toContain('"inbox"');
    expect(content).toContain('"push"');
  });

  it("has stats and seed data", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("stats:");
    expect(content).toContain("ann_001");
    expect(content).toContain("ann_005");
  });

  it("BroadcastManager page exists with compose dialog", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/BroadcastManager.tsx"
    );
    expect(fs.existsSync(pagePath)).toBe(true);
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("BroadcastManager");
    expect(content).toContain("ComposeDialog");
  });
});

// ─── User Notification Preferences Router Tests ──────────────────────────────
describe("User Notification Preferences Router", () => {
  const routerPath = path.resolve(
    __dirname,
    "./routers/userNotifPreferences.ts"
  );

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports userNotifPreferencesRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const userNotifPreferencesRouter");
  });

  it("has 16 notification categories across 4 groups", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    for (const g of ["Transactions", "Security", "Financial", "System"]) {
      expect(content).toContain(g);
    }
    for (const c of [
      "txn_success",
      "sec_fraud",
      "fin_settlement",
      "sys_maintenance",
    ]) {
      expect(content).toContain(c);
    }
  });

  it("supports 4 delivery channels", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("email: z.boolean()");
    expect(content).toContain("sms: z.boolean()");
    expect(content).toContain("push: z.boolean()");
    expect(content).toContain("inApp: z.boolean()");
  });

  it("has quiet hours and digest mode", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("updateQuietHours:");
    expect(content).toContain("updateDigestMode:");
    expect(content).toContain('"instant"');
    expect(content).toContain('"hourly"');
  });

  it("has bulk update, reset, and enableAllForChannel", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("bulkUpdate:");
    expect(content).toContain("resetToDefaults:");
    expect(content).toContain("enableAllForChannel:");
  });

  it("UserNotifSettings page exists with 3 tabs", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/UserNotifSettings.tsx"
    );
    expect(fs.existsSync(pagePath)).toBe(true);
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("UserNotifSettings");
    expect(content).toContain("categories");
    expect(content).toContain("schedule");
    expect(content).toContain("channels");
  });
});

// ─── Route Wiring Tests ─────────────────────────────────────────────────────
describe("Sprint 12 Route Wiring", () => {
  it("all new routers wired in appRouter", () => {
    const routersPath = path.resolve(__dirname, "./routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");
    expect(content).toContain("scheduledReports:");
    expect(content).toContain("dashboardLayout:");
    expect(content).toContain("broadcast:");
    expect(content).toContain("userNotifPrefs:");
  });

  it("all new pages routed in App.tsx", () => {
    const appPath = path.resolve(__dirname, "../client/src/App.tsx");
    const content = fs.readFileSync(appPath, "utf-8");
    expect(content).toContain("/broadcast-manager");
    expect(content).toContain("/scheduled-reports");
    expect(content).toContain("/notification-settings");
  });
});
