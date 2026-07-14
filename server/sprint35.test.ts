import { describe, it, expect } from "vitest";

// Sprint 35: Test all 20 new routers
import { transactionMapVizRouter } from "./routers/transactionMapViz";
import { reportBuilderTemplatesRouter } from "./routers/reportBuilderTemplates";
import { nlAnalyticsQueryRouter } from "./routers/nlAnalyticsQuery";
import { bankingWorkflowPatternsRouter } from "./routers/bankingWorkflowPatterns";
import { agentOnboardingWizardRouter } from "./routers/agentOnboardingWizard";
import { transactionReconciliationRouter } from "./routers/transactionReconciliation";
import { chargebackManagementRouter } from "./routers/chargebackManagement";
import { regulatoryReportingEngineRouter } from "./routers/regulatoryReportingEngine";
import { agentTerritoryMgmtRouter } from "./routers/agentTerritoryMgmt";
import { dynamicPricingEngineRouter } from "./routers/dynamicPricingEngine";
import { customerLoyaltyProgramRouter } from "./routers/customerLoyaltyProgram";
import { fraudCaseManagementRouter } from "./routers/fraudCaseManagement";
import { insuranceServiceFleetRouter } from "./routers/insuranceServiceFleet";
import { financialReconciliationDashRouter } from "./routers/financialReconciliationDash";
import { apiAnalyticsDashRouter } from "./routers/apiAnalyticsDash";
import { agentCommunicationHubRouter } from "./routers/agentCommunicationHub";
import { txDisputeArbitrationRouter } from "./routers/txDisputeArbitration";
import { complianceTrainingTrackerRouter } from "./routers/complianceTrainingTracker";
import { systemMigrationToolsRouter } from "./routers/systemMigrationTools";
import { advancedAuditLogViewerRouter } from "./routers/advancedAuditLogViewer";

describe("Sprint 35: All 20 Routers", () => {
  const routers = [
    { name: "transactionMapViz", router: transactionMapVizRouter },
    { name: "reportBuilderTemplates", router: reportBuilderTemplatesRouter },
    { name: "nlAnalyticsQuery", router: nlAnalyticsQueryRouter },
    { name: "bankingWorkflowPatterns", router: bankingWorkflowPatternsRouter },
    { name: "agentOnboardingWizard", router: agentOnboardingWizardRouter },
    {
      name: "transactionReconciliation",
      router: transactionReconciliationRouter,
    },
    { name: "chargebackManagement", router: chargebackManagementRouter },
    {
      name: "regulatoryReportingEngine",
      router: regulatoryReportingEngineRouter,
    },
    { name: "agentTerritoryMgmt", router: agentTerritoryMgmtRouter },
    { name: "dynamicPricingEngine", router: dynamicPricingEngineRouter },
    { name: "customerLoyaltyProgram", router: customerLoyaltyProgramRouter },
    { name: "fraudCaseManagement", router: fraudCaseManagementRouter },
    { name: "insuranceServiceFleet", router: insuranceServiceFleetRouter },
    {
      name: "financialReconciliationDash",
      router: financialReconciliationDashRouter,
    },
    { name: "apiAnalyticsDash", router: apiAnalyticsDashRouter },
    { name: "agentCommunicationHub", router: agentCommunicationHubRouter },
    { name: "txDisputeArbitration", router: txDisputeArbitrationRouter },
    {
      name: "complianceTrainingTracker",
      router: complianceTrainingTrackerRouter,
    },
    { name: "systemMigrationTools", router: systemMigrationToolsRouter },
    { name: "advancedAuditLogViewer", router: advancedAuditLogViewerRouter },
  ];

  it("should have exactly 20 new routers", () => {
    expect(routers).toHaveLength(20);
  });

  routers.forEach(({ name, router }) => {
    describe(name, () => {
      it("should be a valid tRPC router", () => {
        expect(router).toBeDefined();
        expect(router._def).toBeDefined();
        expect(router._def.procedures).toBeDefined();
      });

      it("should have at least 3 procedures", () => {
        const procedureCount = Object.keys(router._def.procedures).length;
        expect(procedureCount).toBeGreaterThanOrEqual(3);
      });

      it("should have a getStats procedure", () => {
        expect(router._def.procedures.getStats).toBeDefined();
      });
    });
  });
});

describe("Sprint 35: Security Audit", () => {
  it("no hardcoded secrets in router files", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routerDir = path.join(__dirname, "routers");
    const sprint35Files = [
      "transactionMapViz.ts",
      "reportBuilderTemplates.ts",
      "nlAnalyticsQuery.ts",
      "bankingWorkflowPatterns.ts",
      "agentOnboardingWizard.ts",
      "transactionReconciliation.ts",
      "chargebackManagement.ts",
      "regulatoryReportingEngine.ts",
      "agentTerritoryMgmt.ts",
      "dynamicPricingEngine.ts",
      "customerLoyaltyProgram.ts",
      "fraudCaseManagement.ts",
      "insuranceServiceFleet.ts",
      "financialReconciliationDash.ts",
      "apiAnalyticsDash.ts",
      "agentCommunicationHub.ts",
      "txDisputeArbitration.ts",
      "complianceTrainingTracker.ts",
      "systemMigrationTools.ts",
      "advancedAuditLogViewer.ts",
    ];
    const secretPatterns = [
      /password\s*=\s*["'][^"']+["']/i,
      /api[_-]?key\s*=\s*["'][^"']+["']/i,
      /secret\s*=\s*["'][A-Za-z0-9]{16,}["']/i,
    ];
    for (const file of sprint35Files) {
      const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
      for (const pattern of secretPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });

  it("all routers use zod input validation", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routerDir = path.join(__dirname, "routers");
    const sprint35Files = [
      "transactionMapViz.ts",
      "reportBuilderTemplates.ts",
      "nlAnalyticsQuery.ts",
      "bankingWorkflowPatterns.ts",
      "agentOnboardingWizard.ts",
      "transactionReconciliation.ts",
      "chargebackManagement.ts",
      "regulatoryReportingEngine.ts",
      "agentTerritoryMgmt.ts",
      "dynamicPricingEngine.ts",
      "customerLoyaltyProgram.ts",
      "fraudCaseManagement.ts",
      "insuranceServiceFleet.ts",
      "financialReconciliationDash.ts",
      "apiAnalyticsDash.ts",
      "agentCommunicationHub.ts",
      "txDisputeArbitration.ts",
      "complianceTrainingTracker.ts",
      "systemMigrationTools.ts",
      "advancedAuditLogViewer.ts",
    ];
    for (const file of sprint35Files) {
      const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
      expect(content).toContain('import { z } from "zod"');
    }
  });

  it("no SQL injection vulnerabilities (no raw SQL strings)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routerDir = path.join(__dirname, "routers");
    const sprint35Files = [
      "transactionMapViz.ts",
      "reportBuilderTemplates.ts",
      "nlAnalyticsQuery.ts",
      "bankingWorkflowPatterns.ts",
      "agentOnboardingWizard.ts",
      "transactionReconciliation.ts",
      "chargebackManagement.ts",
      "regulatoryReportingEngine.ts",
      "agentTerritoryMgmt.ts",
      "dynamicPricingEngine.ts",
      "customerLoyaltyProgram.ts",
      "fraudCaseManagement.ts",
      "insuranceServiceFleet.ts",
      "financialReconciliationDash.ts",
      "apiAnalyticsDash.ts",
      "agentCommunicationHub.ts",
      "txDisputeArbitration.ts",
      "complianceTrainingTracker.ts",
      "systemMigrationTools.ts",
      "advancedAuditLogViewer.ts",
    ];
    for (const file of sprint35Files) {
      const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
      expect(content).not.toMatch(/db\.execute\s*\(\s*`/);
      expect(content).not.toMatch(/\.raw\s*\(\s*`/);
    }
  });

  it("no eval or Function constructor usage", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routerDir = path.join(__dirname, "routers");
    const sprint35Files = [
      "transactionMapViz.ts",
      "reportBuilderTemplates.ts",
      "nlAnalyticsQuery.ts",
      "bankingWorkflowPatterns.ts",
      "agentOnboardingWizard.ts",
      "transactionReconciliation.ts",
      "chargebackManagement.ts",
      "regulatoryReportingEngine.ts",
      "agentTerritoryMgmt.ts",
      "dynamicPricingEngine.ts",
      "customerLoyaltyProgram.ts",
      "fraudCaseManagement.ts",
      "insuranceServiceFleet.ts",
      "financialReconciliationDash.ts",
      "apiAnalyticsDash.ts",
      "agentCommunicationHub.ts",
      "txDisputeArbitration.ts",
      "complianceTrainingTracker.ts",
      "systemMigrationTools.ts",
      "advancedAuditLogViewer.ts",
    ];
    for (const file of sprint35Files) {
      const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
      expect(content).not.toMatch(/\beval\s*\(/);
      expect(content).not.toMatch(/new\s+Function\s*\(/);
    }
  });
});
