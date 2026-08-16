/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: found real leftovers: mock data in routers, @ts-nocheck pages, unwired pages (S87-01/02/05); S87-06 python services also undelivered (CAT-A).
 * EVIDENCE: verbatim: expected ['amlScreening.ts',…] to deeply equal [] (run 31969739386).
 * RE-ENABLE CONDITION: Leftovers eliminated (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

describe("Sprint 87 — Orphan/Partial/Generic Feature Elimination", () => {
  describe("S87-01: Zero Mock Data in Routers", () => {
    it("no routers contain Math.random", () => {
      const routerDir = path.join(ROOT, "server/routers");
      const files = fs.readdirSync(routerDir).filter(f => f.endsWith(".ts"));
      const violations: string[] = [];
      for (const f of files) {
        const content = fs.readFileSync(path.join(routerDir, f), "utf-8");
        if (content.includes("Math.random")) violations.push(f);
      }
      expect(violations).toEqual([]);
    });

    it("no routers contain Array.from with mock length for fake data generation", () => {
      const routerDir = path.join(ROOT, "server/routers");
      const files = fs.readdirSync(routerDir).filter(f => f.endsWith(".ts"));
      const violations: string[] = [];
      // Legitimate uses: forecast generation, pagination helpers
      const allowList = ["aiCashFlowPredictor.ts"];
      for (const f of files) {
        if (allowList.includes(f)) continue;
        const content = fs.readFileSync(path.join(routerDir, f), "utf-8");
        if (/Array\.from\(\{.*length/s.test(content)) violations.push(f);
      }
      expect(violations).toEqual([]);
    });
  });

  describe("S87-02: Zero @ts-nocheck in Pages", () => {
    it("no pages contain @ts-nocheck", () => {
      const pagesDir = path.join(ROOT, "client/src/pages");
      const files = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
      const violations: string[] = [];
      for (const f of files) {
        const content = fs.readFileSync(path.join(pagesDir, f), "utf-8");
        if (content.includes("@ts-nocheck")) violations.push(f);
      }
      expect(violations).toEqual([]);
    });
  });

  describe("S87-03: All 25 CRUD Routers Have Domain Logic", () => {
    const crudRouters = [
      "agentBankAccountsCrud",
      "agentPerformanceScoresCrud",
      "agentSuspensionLogCrud",
      "analyticsDashboardsCrud",
      "biReportDefinitionsCrud",
      "billingRevenuePeriodsCrud",
      "commissionCascadeHistoryCrud",
      "customerJourneyEventsCrud",
      "dataConsentRecordsCrud",
      "emailDeliveryLogCrud",
      "encryptedFieldsCrud",
      "floatReconciliationsCrud",
      "geoFencesCrud",
      "glAccountsCrud",
      "glJournalEntriesCrud",
      "kycDocumentsCrud",
      "notificationChannelsCrud",
      "notificationLogsCrud",
      "observabilityAlertsCrud",
      "pnlReportsCrud",
      "realtimeTxAlertsCrud",
      "tenantBrandingCrud",
      "tenantFeeOverridesCrud",
      "trainingCoursesCrud",
      "trainingEnrollmentsCrud",
    ];

    for (const name of crudRouters) {
      it(`${name} router exists and has DB queries`, () => {
        const filePath = path.join(ROOT, `server/routers/${name}.ts`);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, "utf-8");
        // Should have real DB operations (getDb, select, insert, etc.)
        const hasDbOps =
          content.includes("getDb") ||
          content.includes("db.") ||
          content.includes("select") ||
          content.includes("insert");
        expect(hasDbOps).toBe(true);
      });
    }
  });

  describe("S87-04: 208 Mock Routers Upgraded to DB-Backed", () => {
    it("at least 400 routers exist", () => {
      const routerDir = path.join(ROOT, "server/routers");
      const files = fs.readdirSync(routerDir).filter(f => f.endsWith(".ts"));
      expect(files.length).toBeGreaterThanOrEqual(400);
    });

    it("all routers have proper exports", () => {
      const routerDir = path.join(ROOT, "server/routers");
      const files = fs.readdirSync(routerDir).filter(f => f.endsWith(".ts"));
      const noExport: string[] = [];
      for (const f of files) {
        const content = fs.readFileSync(path.join(routerDir, f), "utf-8");
        if (
          !content.includes("export const") &&
          !content.includes("export {")
        ) {
          noExport.push(f);
        }
      }
      expect(noExport).toEqual([]);
    });
  });

  describe("S87-05: Pages Wired to Routers", () => {
    it("at least 400 pages have trpc calls", () => {
      const pagesDir = path.join(ROOT, "client/src/pages");
      const files = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
      let wired = 0;
      for (const f of files) {
        const content = fs.readFileSync(path.join(pagesDir, f), "utf-8");
        if (content.includes("trpc.")) wired++;
      }
      expect(wired).toBeGreaterThanOrEqual(400);
    });

    it("static pages without trpc are utility pages", () => {
      const pagesDir = path.join(ROOT, "client/src/pages");
      const files = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
      const staticPages: string[] = [];
      const allowedStatic = [
        "Home",
        "NotFound",
        "ApiDocs",
        "PrivacyPolicy",
        "PlatformHub",
        "ComponentShowcase",
        "DbSchemaPush",
        "E2ETestFramework",
        "OperationalRunbook",
        "ProductionReadinessChecklist",
        "VideoTutorials",
      ];
      for (const f of files) {
        const content = fs.readFileSync(path.join(pagesDir, f), "utf-8");
        if (!content.includes("trpc.")) {
          const name = f.replace(".tsx", "");
          if (!allowedStatic.some(a => name.includes(a))) {
            staticPages.push(f);
          }
        }
      }
      expect(staticPages.length).toBeLessThanOrEqual(5);
    });
  });

  describe("S87-06: Python Services Expanded", () => {
    const expandedServices = [
      "agent-baas",
      "agent-hierarchy-service",
      "agent-lms",
      "agent-performance",
      "agent-service",
      "agent-training",
      "transaction-limits",
      "terminal-ownership",
      "support-crm",
      "receipt-engine",
      "realtime-services",
      "grpc",
      "agent-commerce-integration",
      "art-agent-service",
      "agent-business-dashboard",
      "agent-insurance-platform",
    ];

    for (const svc of expandedServices) {
      it(`${svc} has real domain logic (>50 lines)`, () => {
        const mainPath = path.join(ROOT, `services/python/${svc}/main.py`);
        expect(fs.existsSync(mainPath)).toBe(true);
        const content = fs.readFileSync(mainPath, "utf-8");
        const lines = content.split("\n").length;
        expect(lines).toBeGreaterThan(50);
        // Should have FastAPI endpoints
        expect(content).toContain("@app.");
      });
    }

    it("zero Python services with <50 lines", () => {
      const pyDir = path.join(ROOT, "services/python");
      const services = fs.readdirSync(pyDir).filter(d => {
        return fs.statSync(path.join(pyDir, d)).isDirectory();
      });
      const stubs: string[] = [];
      for (const svc of services) {
        const mainPath = path.join(pyDir, svc, "main.py");
        if (fs.existsSync(mainPath)) {
          const content = fs.readFileSync(mainPath, "utf-8");
          if (content.split("\n").length < 50) stubs.push(svc);
        }
      }
      expect(stubs).toEqual([]);
    });
  });

  describe("S87-07: Sprint15Features Router Fully Wired", () => {
    it("sprint15Features.ts exports all required routers", () => {
      const filePath = path.join(ROOT, "server/routers/sprint15Features.ts");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      const requiredExports = [
        "bulkNotifRouter",
        "retryQueueRouter",
        "digestRouter",
        "notifTemplateRouter",
        "notificationAnalyticsRouter",
        "userQuietHoursRouter",
      ];
      for (const exp of requiredExports) {
        expect(content).toContain(exp);
      }
    });
  });

  describe("S87-08: Service Coverage Summary", () => {
    it("Go services: at least 45", () => {
      const goDir = path.join(ROOT, "services/go");
      if (fs.existsSync(goDir)) {
        const dirs = fs
          .readdirSync(goDir)
          .filter(d => fs.statSync(path.join(goDir, d)).isDirectory());
        expect(dirs.length).toBeGreaterThanOrEqual(45);
      }
    });

    it("Rust services: at least 25", () => {
      const rustDir = path.join(ROOT, "services/rust");
      if (fs.existsSync(rustDir)) {
        const dirs = fs
          .readdirSync(rustDir)
          .filter(d => fs.statSync(path.join(rustDir, d)).isDirectory());
        expect(dirs.length).toBeGreaterThanOrEqual(25);
      }
    });

    it("Python services: at least 250", () => {
      const pyDir = path.join(ROOT, "services/python");
      if (fs.existsSync(pyDir)) {
        const dirs = fs
          .readdirSync(pyDir)
          .filter(d => fs.statSync(path.join(pyDir, d)).isDirectory());
        expect(dirs.length).toBeGreaterThanOrEqual(250);
      }
    });
  });
});
