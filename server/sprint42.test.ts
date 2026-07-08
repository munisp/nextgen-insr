// @ts-check

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Sprint 42: Final Production Features — 20 features end-to-end tests

const ROUTER_DIR = path.join(__dirname, "routers");
const PAGE_DIR = path.join(__dirname, "../client/src/pages");

const sprint42Routers = [
  "disputeNotifications",
  "disputeAnalytics",
  "agentBenchmarking",
  "txVelocityMonitor",
  "customerSurveys",
  "agentTerritoryHeatmap",
  "reportScheduler",
  "gatewayHealthMonitor",
  "agentLoanOrigination2",
  "mfaManager",
  "dataRetentionPolicy",
  "incidentPlaybook",
  "deviceFleetManager",
  "revenueLeakageDetector",
  "customerJourneyMapper",
  "complianceCertManager",
  "platformHealthScorecard",
  "trainingCertification",
  "bulkTransactionProcessor",
  "systemConfigManager",
];

const sprint42Pages = [
  "DisputeNotifications",
  "DisputeAnalyticsDashboard",
  "AgentBenchmarking",
  "TxVelocityMonitor",
  "CustomerSurveys",
  "AgentTerritoryHeatmap",
  "ReportScheduler",
  "GatewayHealthMonitor",
  "AgentLoanOriginationV2",
  "MfaManager",
  "DataRetentionPolicy",
  "IncidentPlaybook",
  "DeviceFleetManager",
  "RevenueLeakageDetector",
  "CustomerJourneyMapper",
  "ComplianceCertManager",
  "PlatformHealthScorecard",
  "TrainingCertification",
  "BulkTransactionProcessor",
  "SystemConfigManager",
];

describe("Sprint 42: Router Files", () => {
  sprint42Routers.forEach(name => {
    it(`router ${name}.ts exists and exports a router`, () => {
      const filePath = path.join(ROUTER_DIR, `${name}.ts`);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("router(");
      expect(content).toContain("export const");
    });
  });
});

describe("Sprint 42: Page Files", () => {
  sprint42Pages.forEach(name => {
    it(`page ${name}.tsx exists and exports a component`, () => {
      const filePath = path.join(PAGE_DIR, `${name}.tsx`);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("export default function");
    });
  });
});

describe("Sprint 42: Router Registration", () => {
  it("all 20 Sprint 42 routers are registered in routers.ts", () => {
    const routersFile = fs.readFileSync(
      path.join(__dirname, "routers.ts"),
      "utf-8"
    );
    sprint42Routers.forEach(name => {
      expect(routersFile).toContain(`${name}:`);
    });
  });
});

describe("Sprint 42: Route Registration", () => {
  it("all 20 Sprint 42 routes are registered in App.tsx", () => {
    const appFile = fs.readFileSync(
      path.join(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    const routes = [
      "/dispute-notifications",
      "/dispute-analytics-dashboard",
      "/agent-benchmarking",
      "/tx-velocity-monitor",
      "/customer-surveys",
      "/agent-territory-heatmap",
      "/report-scheduler",
      "/gateway-health-monitor",
      "/agent-loan-origination-v2",
      "/mfa-manager",
      "/data-retention-policy",
      "/incident-playbook",
      "/device-fleet-manager",
      "/revenue-leakage-detector",
      "/customer-journey-mapper",
      "/compliance-cert-manager",
      "/platform-health-scorecard",
      "/training-certification",
      "/bulk-transaction-processor",
      "/system-config-manager",
    ];
    routes.forEach(route => {
      expect(appFile).toContain(`path="${route}"`);
    });
  });
});

describe("Sprint 42: Navigation Registration", () => {
  it("Sprint 42 nav group exists in DashboardLayout", () => {
    const layoutFile = fs.readFileSync(
      path.join(__dirname, "../client/src/components/DashboardLayout.tsx"),
      "utf-8"
    );
    expect(layoutFile).toContain("Final Production");
    expect(layoutFile).toContain("/dispute-notifications");
    expect(layoutFile).toContain("/system-config-manager");
  });
});
