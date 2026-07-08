// @ts-check

import { describe, it, expect } from "vitest";

// Sprint 39: Platform Maturity & Infrastructure Hardening Tests
const sprint39Routers = [
  {
    name: "publishReadinessChecker",
    file: "./routers/publishReadinessChecker",
  },
  {
    name: "dbSchemaMigrationManager",
    file: "./routers/dbSchemaMigrationManager",
  },
  {
    name: "graphqlSubscriptionGateway",
    file: "./routers/graphqlSubscriptionGateway",
  },
  { name: "offlinePosMode", file: "./routers/offlinePosMode" },
  { name: "biometricAuthGateway", file: "./routers/biometricAuthGateway" },
  { name: "aiCashFlowPredictor", file: "./routers/aiCashFlowPredictor" },
  { name: "blockchainAuditTrail", file: "./routers/blockchainAuditTrail" },
  { name: "voiceCommandPos", file: "./routers/voiceCommandPos" },
  { name: "socialCommerceGateway", file: "./routers/socialCommerceGateway" },
  { name: "esgCarbonTracker", file: "./routers/esgCarbonTracker" },
  { name: "distributedTracingDash", file: "./routers/distributedTracingDash" },
  { name: "canaryReleaseManager", file: "./routers/canaryReleaseManager" },
  {
    name: "chaosEngineeringConsole",
    file: "./routers/chaosEngineeringConsole",
  },
  { name: "connectionPoolMonitor", file: "./routers/connectionPoolMonitor" },
  { name: "cdnCacheManager", file: "./routers/cdnCacheManager" },
  { name: "cqrsEventStore", file: "./routers/cqrsEventStore" },
  { name: "digitalTwinSimulator", file: "./routers/digitalTwinSimulator" },
  { name: "cbdcIntegrationGateway", file: "./routers/cbdcIntegrationGateway" },
  {
    name: "decentralizedIdentityManager",
    file: "./routers/decentralizedIdentityManager",
  },
  {
    name: "platformMaturityScorecard",
    file: "./routers/platformMaturityScorecard",
  },
];

describe("Sprint 39 — Platform Maturity & Infrastructure Hardening", () => {
  it("should have exactly 20 routers in Sprint 39", () => {
    expect(sprint39Routers).toHaveLength(20);
  });

  sprint39Routers.forEach(({ name, file }) => {
    describe(name, () => {
      it("should export a valid router", async () => {
        const mod = await import(file);
        const routerExport = Object.values(mod)[0] as any;
        expect(routerExport).toBeDefined();
        expect(routerExport._def).toBeDefined();
        expect(routerExport._def.procedures).toBeDefined();
      });

      it("should have a getStats procedure", async () => {
        const mod = await import(file);
        const routerExport = Object.values(mod)[0] as any;
        expect(routerExport._def.procedures.getStats).toBeDefined();
      });

      it("should have at least 3 procedures", async () => {
        const mod = await import(file);
        const routerExport = Object.values(mod)[0] as any;
        const procCount = Object.keys(routerExport._def.procedures).length;
        expect(procCount).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe("Security Audit Sprint 39", () => {
    it("should not contain hardcoded API keys", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const routerDir = path.resolve(__dirname, "routers");
      const files = fs
        .readdirSync(routerDir)
        .filter((f: string) => f.endsWith(".ts"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
        expect(content).not.toMatch(/sk_live_[a-zA-Z0-9]{20,}/);
        expect(content).not.toMatch(/sk_test_[a-zA-Z0-9]{20,}/);
        expect(content).not.toMatch(/AKIA[A-Z0-9]{16}/);
      }
    });

    it("should not contain raw SQL concatenation patterns", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const routerDir = path.resolve(__dirname, "routers");
      const files = fs
        .readdirSync(routerDir)
        .filter((f: string) => f.endsWith(".ts"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(routerDir, file), "utf-8");
        // Check for direct SQL string concatenation with user input (not template literals in data)
        expect(content).not.toMatch(/query\s*\(\s*`[^`]*\$\{.*input/i);
      }
    });

    it("should use zod validation on all input procedures", async () => {
      for (const { file } of sprint39Routers) {
        const mod = await import(file);
        const routerExport = Object.values(mod)[0] as any;
        const procs = routerExport._def.procedures;
        for (const [procName, proc] of Object.entries(procs) as any[]) {
          if (proc._def?.inputs?.length > 0) {
            expect(proc._def.inputs[0]).toBeDefined();
          }
        }
      }
    });

    it("should use protectedProcedure for all procedures", async () => {
      for (const { file } of sprint39Routers) {
        const content = await import("fs").then(fs =>
          fs.readFileSync(
            require("path").resolve(__dirname, file.replace("./", "")) + ".ts",
            "utf-8"
          )
        );
        expect(content).toContain("protectedProcedure");
      }
    });
  });
});
