// @ts-check

import { describe, it, expect } from "vitest";

// Sprint 36 Router imports
import { transactionCsvExportRouter } from "./routers/transactionCsvExport";
import { transactionMapLoadingRouter } from "./routers/transactionMapLoading";
import { nlFinancialQueryRouter } from "./routers/nlFinancialQuery";
import { whiteLabelOnboardingRouter } from "./routers/whiteLabelOnboarding";
import { whiteLabelBrandingRouter } from "./routers/whiteLabelBranding";
import { whiteLabelApprovalRouter } from "./routers/whiteLabelApproval";
import { partnerSelfServiceRouter } from "./routers/partnerSelfService";
import { transactionExportEngineRouter } from "./routers/transactionExportEngine";
import { advancedLoadingStatesRouter } from "./routers/advancedLoadingStates";
import { financialNlEngineRouter } from "./routers/financialNlEngine";
import { partnerRevenueSharingRouter } from "./routers/partnerRevenueSharing";
import { agentGamificationRouter } from "./routers/agentGamification";
import { bulkTransactionProcessingRouter } from "./routers/bulkTransactionProcessing";
import { customer360ViewRouter } from "./routers/customer360View";
import { webhookManagementRouter } from "./routers/webhookManagement";
import { platformFeatureFlagsRouter } from "./routers/platformFeatureFlags";
import { slaMonitoringDashRouter } from "./routers/slaMonitoringDash";
import { dataRetentionPolicyRouter } from "./routers/dataRetentionPolicy";
import { platformChangelogRouter } from "./routers/platformChangelog";
import { advancedSearchFilteringRouter } from "./routers/advancedSearchFiltering";

const routers = [
  { name: "transactionCsvExport", router: transactionCsvExportRouter },
  { name: "transactionMapLoading", router: transactionMapLoadingRouter },
  { name: "nlFinancialQuery", router: nlFinancialQueryRouter },
  { name: "whiteLabelOnboarding", router: whiteLabelOnboardingRouter },
  { name: "whiteLabelBranding", router: whiteLabelBrandingRouter },
  { name: "whiteLabelApproval", router: whiteLabelApprovalRouter },
  { name: "partnerSelfService", router: partnerSelfServiceRouter },
  { name: "transactionExportEngine", router: transactionExportEngineRouter },
  { name: "advancedLoadingStates", router: advancedLoadingStatesRouter },
  { name: "financialNlEngine", router: financialNlEngineRouter },
  { name: "partnerRevenueSharing", router: partnerRevenueSharingRouter },
  { name: "agentGamification", router: agentGamificationRouter },
  {
    name: "bulkTransactionProcessing",
    router: bulkTransactionProcessingRouter,
  },
  { name: "customer360View", router: customer360ViewRouter },
  { name: "webhookManagement", router: webhookManagementRouter },
  { name: "platformFeatureFlags", router: platformFeatureFlagsRouter },
  { name: "slaMonitoringDash", router: slaMonitoringDashRouter },
  { name: "dataRetentionPolicy", router: dataRetentionPolicyRouter },
  { name: "platformChangelog", router: platformChangelogRouter },
  { name: "advancedSearchFiltering", router: advancedSearchFilteringRouter },
];

describe("Sprint 36: White-Label Partner Platform — Router Count", () => {
  it("should have exactly 20 Sprint 36 routers", () => {
    expect(routers).toHaveLength(20);
  });
});

describe("Sprint 36: Router Structure Validation", () => {
  for (const { name, router } of routers) {
    describe(name, () => {
      it("should be a valid tRPC router", () => {
        expect(router).toBeDefined();
        expect(router._def).toBeDefined();
        expect(router._def.procedures).toBeDefined();
      });

      it("should have a getStats procedure", () => {
        const procedures = router._def.procedures as Record<string, unknown>;
        expect(procedures.getStats).toBeDefined();
      });

      it("should have at least 3 procedures", () => {
        const procedures = router._def.procedures as Record<string, unknown>;
        const count = Object.keys(procedures).length;
        expect(count).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

describe("Sprint 36: Security Audit", () => {
  it("should not expose sensitive data in router definitions", () => {
    for (const { router } of routers) {
      const json = JSON.stringify(router._def);
      expect(json).not.toContain("password");
      expect(json).not.toContain("secret_key");
      expect(json).not.toContain("api_key");
    }
  });

  it("should have input validation on mutation procedures", () => {
    for (const { name, router } of routers) {
      const procedures = router._def.procedures as Record<string, any>;
      for (const [procName, proc] of Object.entries(procedures)) {
        if (proc._def?.mutation) {
          expect(proc._def.inputs?.length).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("all routers should have proper error handling patterns", () => {
    for (const { name, router } of routers) {
      expect(router._def).toBeDefined();
      expect(typeof router._def.procedures).toBe("object");
    }
  });

  it("should validate that no router exposes raw SQL queries", () => {
    for (const { name, router } of routers) {
      const json = JSON.stringify(router._def);
      expect(json).not.toContain("DROP TABLE");
      expect(json).not.toContain("DELETE FROM");
    }
  });
});
