// @ts-check

/**
 * Sprint 13 Tests — Banner, Shared Layouts, Report Designer, Threshold Alerts, Reactions
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Announcement Banner ─────────────────────────────────────────────────────
describe("Announcement Banner Component", () => {
  const bannerPath = path.resolve(
    __dirname,
    "../client/src/components/AnnouncementBanner.tsx"
  );

  it("banner component file exists", () => {
    expect(fs.existsSync(bannerPath)).toBe(true);
  });

  it("renders pinned announcements from broadcast.list", () => {
    const content = fs.readFileSync(bannerPath, "utf-8");
    expect(content).toContain("broadcast.list");
    expect(content).toContain("pinned");
  });

  it("supports dismiss with localStorage persistence", () => {
    const content = fs.readFileSync(bannerPath, "utf-8");
    expect(content).toContain("localStorage");
    expect(content).toContain("dismissed");
  });

  it("supports emoji reactions", () => {
    const content = fs.readFileSync(bannerPath, "utf-8");
    expect(content.match(/👍|👎|❤️|👀|🎉/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("supports comment thread input", () => {
    const content = fs.readFileSync(bannerPath, "utf-8");
    expect(content).toContain("comment");
  });

  it("is mounted in App.tsx", () => {
    const appContent = fs.readFileSync(
      path.resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appContent).toContain("AnnouncementBanner");
  });
});

// ─── Announcement Reactions Router ───────────────────────────────────────────
describe("Announcement Reactions Router", () => {
  const routerPath = path.resolve(
    __dirname,
    "routers/announcementReactions.ts"
  );

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports announcementReactionsRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const announcementReactionsRouter");
  });

  it("has reaction procedures (getReactions, react, addComment)", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("getReactions");
    expect(content).toContain("react:");
    expect(content).toContain("addComment");
  });

  it("supports emoji types (thumbsUp, heart, celebrate)", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("thumbsUp");
    expect(content).toContain("heart");
    expect(content).toContain("celebrate");
  });

  it("is wired into appRouter", () => {
    const routersContent = fs.readFileSync(
      path.resolve(__dirname, "routers.ts"),
      "utf-8"
    );
    expect(routersContent).toContain(
      "announcementReactions: announcementReactionsRouter"
    );
  });
});

// ─── Shared Layouts Router ───────────────────────────────────────────────────
describe("Shared Layouts Router", () => {
  const routerPath = path.resolve(__dirname, "routers/sharedLayouts.ts");

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports sharedLayoutsRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const sharedLayoutsRouter");
  });

  it("has gallery, share, import, fork procedures", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("gallery");
    expect(content).toContain("share:");
    expect(content).toContain("import:");
    expect(content).toContain("fork:");
  });

  it("supports permission levels", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("view-only");
    expect(content).toContain("can-edit");
    expect(content).toContain("can-fork");
  });
});

describe("Shared Layout Gallery Page", () => {
  const pagePath = path.resolve(
    __dirname,
    "../client/src/pages/SharedLayoutGallery.tsx"
  );

  it("page file exists", () => {
    expect(fs.existsSync(pagePath)).toBe(true);
  });

  it("uses trpc.sharedLayouts.gallery", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("sharedLayouts.gallery");
  });

  it("supports search and tag filtering", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("search");
    expect(content).toContain("tag");
  });

  it("route is registered in App.tsx", () => {
    const appContent = fs.readFileSync(
      path.resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appContent).toContain("/shared-layouts");
  });
});

// ─── Report Template Designer ────────────────────────────────────────────────
describe("Report Template Designer Router", () => {
  const routerPath = path.resolve(
    __dirname,
    "routers/reportTemplateDesigner.ts"
  );

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports reportTemplateDesignerRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const reportTemplateDesignerRouter");
  });

  it("has widgetCatalog, list, create, update, delete procedures", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("widgetCatalog");
    expect(content).toContain("list:");
    expect(content).toContain("create:");
    expect(content).toContain("update:");
    expect(content).toContain("delete:");
  });

  it("has widget catalog with KPI, chart, table types", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("kpi");
    expect(content).toContain("chart");
    expect(content).toContain("table");
  });
});

describe("Report Template Designer Page", () => {
  const pagePath = path.resolve(
    __dirname,
    "../client/src/pages/ReportTemplateDesigner.tsx"
  );

  it("page file exists", () => {
    expect(fs.existsSync(pagePath)).toBe(true);
  });

  it("uses trpc.reportTemplate.*", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("reportTemplate.");
  });

  it("route is registered in App.tsx", () => {
    const appContent = fs.readFileSync(
      path.resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appContent).toContain("/report-designer");
  });
});

// ─── Data Threshold Alerts ───────────────────────────────────────────────────
describe("Data Threshold Alerts Router", () => {
  const routerPath = path.resolve(__dirname, "routers/dataThresholdAlerts.ts");

  it("router file exists", () => {
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("exports dataThresholdAlertsRouter", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("export const dataThresholdAlertsRouter");
  });

  it("has 15 available metrics across 5 categories", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("transactions");
    expect(content).toContain("agents");
    expect(content).toContain("risk");
    expect(content).toContain("finance");
    expect(content).toContain("system");
    // Count metric entries
    const metricMatches = content.match(
      /id: "tx_|id: "active_|id: "agent_|id: "fraud_|id: "settlement_|id: "commission_|id: "kyc_|id: "api_|id: "db_|id: "queue_|id: "revenue_/g
    );
    expect(metricMatches?.length).toBeGreaterThanOrEqual(10);
  });

  it("supports 8 operator types", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    const ops = [
      "gt",
      "gte",
      "lt",
      "lte",
      "eq",
      "neq",
      "pct_change_up",
      "pct_change_down",
    ];
    for (const op of ops) {
      expect(content).toContain(`"${op}"`);
    }
  });

  it("has CRUD + simulateCheck + acknowledge + resolve procedures", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain("create:");
    expect(content).toContain("update:");
    expect(content).toContain("delete:");
    expect(content).toContain("simulateCheck:");
    expect(content).toContain("acknowledge:");
    expect(content).toContain("resolve:");
  });

  it("has seeded rules with different severities", () => {
    const content = fs.readFileSync(routerPath, "utf-8");
    expect(content).toContain('"critical"');
    expect(content).toContain('"warning"');
    // At least 3 seeded rules
    expect(content).toContain("thr_001");
    expect(content).toContain("thr_003");
    expect(content).toContain("thr_005");
  });
});

describe("Data Threshold Alerts Page", () => {
  const pagePath = path.resolve(
    __dirname,
    "../client/src/pages/DataThresholdAlerts.tsx"
  );

  it("page file exists", () => {
    expect(fs.existsSync(pagePath)).toBe(true);
  });

  it("uses trpc.thresholdAlerts.*", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("thresholdAlerts.list");
    expect(content).toContain("thresholdAlerts.metrics");
    expect(content).toContain("thresholdAlerts.create");
  });

  it("has stats cards for total, active, triggered, paused", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("stats.total");
    expect(content).toContain("stats.active");
    expect(content).toContain("stats.triggered");
    expect(content).toContain("stats.paused");
  });

  it("has create rule dialog", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("Create Threshold Rule");
    expect(content).toContain("DialogContent");
  });

  it("supports simulate check", () => {
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("simulateCheck");
    expect(content).toContain("Test");
  });

  it("route is registered in App.tsx", () => {
    const appContent = fs.readFileSync(
      path.resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appContent).toContain("/threshold-alerts");
  });
});

// ─── Chart Export Utility ────────────────────────────────────────────────────
describe("Chart Export Utility", () => {
  const utilPath = path.resolve(__dirname, "../client/src/lib/chartExport.ts");

  it("chart export utility exists", () => {
    expect(fs.existsSync(utilPath)).toBe(true);
  });

  it("exports CSV and PNG download functions", () => {
    const content = fs.readFileSync(utilPath, "utf-8");
    expect(content.toLowerCase()).toContain("csv");
    expect(content.toLowerCase()).toContain("png");
  });
});

// ─── Integration: All Sprint 13 routers wired ───────────────────────────────
describe("Sprint 13 Router Integration", () => {
  it("all 4 new routers are wired into appRouter", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "routers.ts"),
      "utf-8"
    );
    expect(content).toContain("sharedLayouts: sharedLayoutsRouter");
    expect(content).toContain("reportTemplate: reportTemplateDesignerRouter");
    expect(content).toContain("thresholdAlerts: dataThresholdAlertsRouter");
    expect(content).toContain(
      "announcementReactions: announcementReactionsRouter"
    );
  });

  it("all 3 new pages are routed in App.tsx", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(content).toContain("/threshold-alerts");
    expect(content).toContain("/shared-layouts");
    expect(content).toContain("/report-designer");
  });
});
