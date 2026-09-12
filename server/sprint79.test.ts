/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HONEST-CONTRACT REWRITE — 2026-09-12 (W5c-finisher mission, assurance protocol)
 * ═══════════════════════════════════════════════════════════════════════════
 * Previously quarantined CAT-A (2026-08-16): billing microservices had zero
 * commits AND the router assertions encoded the F-12 wave-3 REMOVED facade.
 *
 * What was replaced, and why (per tests/QUARANTINE.md honest-rewrite note):
 *
 * billingLedger describe:
 *  - OLD: recordSplit input {transactionId: "TX-...", clientId, agentId: "AGENT-..."}
 *    returning {id: /^BL-/, netRevenue, splitRatio, syncedToTigerBeetle: true,
 *    syncedToOpenSearch: true} — the facade echoed sync claims while
 *    persisting NOTHING. NEW: real input schema (transactionId int,
 *    transactionRef idempotency key, agentId int), real server-computed
 *    fields (platformNetFee = platformShare - switchFee - aggregatorFee,
 *    revenueSharePct, tenantId stamped server-side from agents.tenantId),
 *    fail-loud PRECONDITION_FAILED without a database, and explicit absence
 *    of the fabricated sync flags. Real persistence + duplicate-transactionRef
 *    idempotency is covered against real PG by
 *    tests/integration/billingLedger.integration.test.ts (delivered F-12 w3).
 *  - OLD: query/aggregateRevenue/getLiveSplitMetrics asserting fixture totals
 *    (total>0 on canned data, splitEfficiency.currentSplitPct===28). NEW:
 *    real contract — fail-loud without DB; tenant scoping FORBIDDEN for a
 *    tenant caller requesting a foreign tenantId (F-12 wave-5 B15).
 *  - OLD: getClientBillingConfig {"CLIENT-001" -> 28% contract fixture}.
 *    NEW: real behavior — client-keyed lookup is explicitly NOT_IMPLEMENTED
 *    (tenant_billing_config is keyed by tenant_id); admin tenant-keyed lookup
 *    returns the real row or null (honest absence).
 *
 * revenueReconciliation / liveBillingDashboard describes:
 *  - OLD: fabricated batch results (batchId /^RB-/, matchRatePct>90/99,
 *    exportedToLakehouse: true, fileReceived: true), fabricated dashboard
 *    monthly series and KPI totals. The underlying capability was never
 *    delivered; the routers were converted (F-12 wave-3/4) to fail loud.
 *  - NEW: every procedure must reject with NOT_IMPLEMENTED (honest fail-loud,
 *    no fabricated success) and still enforce authentication.
 *
 * Billing Engine Data Integrity describe:
 *  - OLD: cross-router consistency built on the two facades above. NEW: the
 *    real invariant — recordSplit's server-computed arithmetic — plus the
 *    honest guarantee that reconciliation/dashboard never return fabricated
 *    numbers to be "consistent" with.
 *
 * Sprint 79 Microservice Infrastructure describe:
 *  - OLD: 10 speculative service names (billing-aggregator, revenue-reconciler,
 *    settlement-ledger-sync, realtime-fee-splitter, billing-stream-processor,
 *    ledger-integrity-validator, revenue-forecast-ml, billing-anomaly-detector,
 *    sla-billing-reporter, billing-reconciliation-engine) — zero-commit,
 *    never delivered under those names. NEW: the DELIVERED billing service
 *    family on main (go: billing-provisioning-workflow [W5a], settlement-gateway,
 *    telemetry-api-gateway [W5c]; rust: billing-event-processor,
 *    fee-splitter-realtime [W5c]; python: billing-analytics-pipeline,
 *    billing-sla-monitor, billing-webhook-dispatcher, invoice-generator,
 *    fraud-ml-service [W5c]) — real entrypoints + Dockerfiles.
 *
 * Financial Model Integration describe:
 *  - OLD: asserted an absolute dev-machine artifact
 *    (/home/ubuntu/insureportal-financial-model/...v4_OFFLINE.html) that is
 *    not and never was a repo deliverable. NEW: the live-data integration
 *    surface (liveBillingDashboard.getSummary/getFinancialModelData/
 *    exportForFinancialModel) must fail loud NOT_IMPLEMENTED until the
 *    dashboard data source lands — no fabricated "Live Data" contract.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));
const mockedGetDb = vi.mocked(getDb);

// Helper: create authenticated platform-admin context
function makeAuthCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "billing-test-user",
      email: "billing@insureportal.com",
      name: "Billing Test User",
      loginMethod: "manus",
      role: "admin",
      tenantId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// Helper: authenticated TENANT caller (non-admin, tenant-bound)
function makeTenantCtx(tenantId: number): TrpcContext {
  const ctx = makeAuthCtx();
  (ctx.user as any).role = "user";
  (ctx.user as any).tenantId = tenantId;
  return ctx;
}

// Helper: create unauthenticated context
function makePublicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const VALID_SPLIT = {
  transactionId: 900001,
  transactionRef: "S79-RS-1",
  transactionType: "cash_out",
  grossAmount: 15000,
  grossFee: 150,
  clientShare: 108,
  platformShare: 42,
  agentCommission: 22.5,
  switchFee: 4.5,
  aggregatorFee: 1.5,
  billingModel: "revenue_share" as const,
  agentId: 17,
  currency: "NGN",
};

/** Minimal faithful mock of the drizzle chains billingLedger uses; captures
 * insert values so the server-computed fields are asserted for real. */
function makeCapturingDb(agentTenantId: number | null) {
  const captured: { insertValues?: any } = {};
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ tenantId: agentTenantId }],
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          captured.insertValues = v;
          return [{ id: 4242, ...v, createdAt: new Date() }];
        },
      }),
    }),
  };
  return { db, captured };
}

describe("Sprint 79: Real-Time Billing Engine", () => {
  beforeEach(() => {
    mockedGetDb.mockReset();
  });

  // ===== BILLING LEDGER ROUTER (real DB-backed contract) =====
  describe("billingLedger", () => {
    it("recordSplit persists via real insert with server-computed fields", async () => {
      const { db, captured } = makeCapturingDb(7);
      mockedGetDb.mockResolvedValue(db as any);
      const caller = appRouter.createCaller(makeAuthCtx());

      const row = await caller.billingLedger.recordSplit(VALID_SPLIT);

      expect(row.id).toBe(4242);
      const v = captured.insertValues;
      // Real server-side arithmetic (not client-supplied):
      expect(v.platformNetFee).toBe(String(42 - 4.5 - 1.5)); // 36
      expect(v.revenueSharePct).toBe(String((42 / 150) * 100)); // 28
      expect(v.clientRevenue).toBe(String(108));
      expect(v.platformRevenue).toBe(String(42));
      expect(v.transactionRef).toBe("S79-RS-1");
      // Tenant attribution stamped SERVER-SIDE from the agent's tenant:
      expect(v.tenantId).toBe(7);
      // The F-12 REMOVED facade fields must NOT be part of the contract:
      expect(row).not.toHaveProperty("syncedToTigerBeetle");
      expect(row).not.toHaveProperty("syncedToOpenSearch");
    });

    it("recordSplit stamps NULL tenant for unknown agents (no client-supplied tenant)", async () => {
      const { db, captured } = makeCapturingDb(null);
      mockedGetDb.mockResolvedValue(db as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await caller.billingLedger.recordSplit({
        ...VALID_SPLIT,
        transactionRef: "S79-RS-2",
      });
      expect(captured.insertValues.tenantId).toBeNull();
    });

    it("recordSplit supports all delivered billing models", async () => {
      const { db } = makeCapturingDb(7);
      mockedGetDb.mockResolvedValue(db as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      for (const billingModel of ["revenue_share", "subscription", "hybrid"] as const) {
        const row = await caller.billingLedger.recordSplit({
          ...VALID_SPLIT,
          transactionRef: `S79-${billingModel}`,
          billingModel,
        });
        expect(row.billingModel).toBe(billingModel);
      }
    });

    it("recordSplit fails loud (PRECONDITION_FAILED) when the database is unavailable", async () => {
      mockedGetDb.mockResolvedValue(null as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.billingLedger.recordSplit(VALID_SPLIT)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("recordSplit rejects invalid input against the real schema", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      // string transactionId (facade shape) is not the real contract
      await expect(
        caller.billingLedger.recordSplit({
          ...VALID_SPLIT,
          transactionId: "TX-test-001" as any,
        })
      ).rejects.toThrow();
      // missing transactionRef idempotency key
      await expect(
        caller.billingLedger.recordSplit({
          ...VALID_SPLIT,
          transactionRef: undefined as any,
        })
      ).rejects.toThrow();
    });

    it("query fails loud when the database is unavailable", async () => {
      mockedGetDb.mockResolvedValue(null as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.billingLedger.query({ page: 1, pageSize: 10 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("query enforces tenant scoping (F-12 wave-5 B15)", async () => {
      mockedGetDb.mockResolvedValue({} as any); // db present; scoping throws first
      const caller = appRouter.createCaller(makeTenantCtx(5));
      await expect(
        caller.billingLedger.query({ tenantId: 6, page: 1, pageSize: 10 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("aggregateRevenue fails loud when the database is unavailable", async () => {
      mockedGetDb.mockResolvedValue(null as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.billingLedger.aggregateRevenue({ period: "daily" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("getClientBillingConfig: client-keyed lookup is honestly NOT_IMPLEMENTED", async () => {
      mockedGetDb.mockResolvedValue({} as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.billingLedger.getClientBillingConfig({ clientId: "CLIENT-001" })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("getLiveSplitMetrics fails loud when the database is unavailable", async () => {
      mockedGetDb.mockResolvedValue(null as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.billingLedger.getLiveSplitMetrics({})
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("rejects unauthenticated access to recordSplit", async () => {
      const caller = appRouter.createCaller(makePublicCtx());
      await expect(
        caller.billingLedger.recordSplit(VALID_SPLIT)
      ).rejects.toThrow();
    });
  });

  // ===== REVENUE REVENUE RECONCILIATION ROUTER (honest fail-loud contract) =====
  describe("revenueReconciliation", () => {
    it("runReconciliation fails loud NOT_IMPLEMENTED (no fabricated batch)", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.revenueReconciliation.runReconciliation({
          clientId: "CLIENT-001",
          source: "tigerbeetle",
          target: "postgres",
          periodHours: 24,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("getBatches fails loud NOT_IMPLEMENTED (no fabricated history)", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.revenueReconciliation.getBatches({ clientId: "CLIENT-001", limit: 10 })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("getDiscrepancies fails loud NOT_IMPLEMENTED", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.revenueReconciliation.getDiscrepancies({
          batchId: "RB-test-batch-001",
          page: 1,
          pageSize: 10,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("resolveDiscrepancy fails loud NOT_IMPLEMENTED", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.revenueReconciliation.resolveDiscrepancy({
          entryId: "RE-test-001",
          resolution: "auto_corrected",
          note: "Timing difference resolved",
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("getMetrics fails loud NOT_IMPLEMENTED (no fabricated 99% match rate)", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.revenueReconciliation.getMetrics({})
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("getSettlementFileStatus fails loud NOT_IMPLEMENTED (no fabricated fileReceived)", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.revenueReconciliation.getSettlementFileStatus({
          switchProvider: "interswitch",
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("rejects unauthenticated access to runReconciliation", async () => {
      const caller = appRouter.createCaller(makePublicCtx());
      await expect(
        caller.revenueReconciliation.runReconciliation({
          clientId: "CLIENT-001",
          source: "tigerbeetle",
          target: "postgres",
          periodHours: 24,
        })
      ).rejects.toThrow();
    });
  });

  // ===== LIVE BILLING DASHBOARD ROUTER (honest fail-loud contract) =====
  describe("liveBillingDashboard", () => {
    it("getFinancialModelData fails loud NOT_IMPLEMENTED (no fabricated monthly series)", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.getFinancialModelData({
          clientId: "CLIENT-001",
          billingModel: "revenue_share",
          projectionYears: 5,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("getRevenueStream fails loud NOT_IMPLEMENTED (no fabricated realtime counters)", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.getRevenueStream({
          clientId: "CLIENT-001",
          intervalSeconds: 60,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("exportForFinancialModel fails loud NOT_IMPLEMENTED", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.exportForFinancialModel({
          clientId: "CLIENT-001",
          format: "json",
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("rejects unauthenticated access to getFinancialModelData", async () => {
      const caller = appRouter.createCaller(makePublicCtx());
      await expect(
        caller.liveBillingDashboard.getFinancialModelData({
          clientId: "CLIENT-001",
          billingModel: "revenue_share",
          projectionYears: 5,
        })
      ).rejects.toThrow();
    });
  });

  // ===== MICROSERVICE INFRASTRUCTURE (delivered family on main) =====
  describe("Sprint 79 Microservice Infrastructure", () => {
    const goServices = [
      "billing-provisioning-workflow",
      "settlement-gateway",
      "telemetry-api-gateway",
    ];
    const rustServices = ["billing-event-processor", "fee-splitter-realtime"];
    const pythonServices = [
      "billing-analytics-pipeline",
      "billing-sla-monitor",
      "billing-webhook-dispatcher",
      "invoice-generator",
      "fraud-ml-service",
    ];

    it("all Go billing microservices have an entrypoint and Dockerfile", async () => {
      const fs = await import("fs");
      for (const svc of goServices) {
        const rootMain = `services/go/${svc}/main.go`;
        const cmdMain = `services/go/${svc}/cmd/main.go`;
        const dockerPath = `services/go/${svc}/Dockerfile`;
        const goModPath = `services/go/${svc}/go.mod`;
        expect(
          fs.existsSync(rootMain) || fs.existsSync(cmdMain),
          `${svc} entrypoint should exist (root or cmd layout)`
        ).toBe(true);
        expect(fs.existsSync(dockerPath), `${dockerPath} should exist`).toBe(true);
        expect(fs.existsSync(goModPath), `${goModPath} should exist`).toBe(true);
      }
    });

    it("all Rust billing microservices have main.rs and Dockerfile", async () => {
      const fs = await import("fs");
      for (const svc of rustServices) {
        const mainPath = `services/rust/${svc}/src/main.rs`;
        const dockerPath = `services/rust/${svc}/Dockerfile`;
        const cargoPath = `services/rust/${svc}/Cargo.toml`;
        expect(fs.existsSync(mainPath), `${mainPath} should exist`).toBe(true);
        expect(fs.existsSync(dockerPath), `${dockerPath} should exist`).toBe(true);
        expect(fs.existsSync(cargoPath), `${cargoPath} should exist`).toBe(true);
      }
    });

    it("all Python billing microservices have main.py and Dockerfile", async () => {
      const fs = await import("fs");
      for (const svc of pythonServices) {
        const mainPath = `services/python/${svc}/main.py`;
        const dockerPath = `services/python/${svc}/Dockerfile`;
        const reqPath = `services/python/${svc}/requirements.txt`;
        expect(fs.existsSync(mainPath), `${mainPath} should exist`).toBe(true);
        expect(fs.existsSync(dockerPath), `${dockerPath} should exist`).toBe(true);
        expect(fs.existsSync(reqPath), `${reqPath} should exist`).toBe(true);
      }
    });

    it("Go services implement real health endpoints", async () => {
      const fs = await import("fs");
      for (const svc of goServices) {
        const rootMain = `services/go/${svc}/main.go`;
        const cmdMain = `services/go/${svc}/cmd/main.go`;
        const entry = fs.existsSync(rootMain) ? rootMain : cmdMain;
        const content = fs.readFileSync(entry, "utf-8");
        expect(content.toLowerCase(), `${svc} should expose health`).toContain("health");
      }
    });

    it("Rust services implement real health endpoints", async () => {
      const fs = await import("fs");
      for (const svc of rustServices) {
        const content = fs.readFileSync(`services/rust/${svc}/src/main.rs`, "utf-8");
        expect(content.toLowerCase(), `${svc} should expose health`).toContain("health");
      }
    });

    it("Python services have FastAPI integration", async () => {
      const fs = await import("fs");
      for (const svc of pythonServices) {
        const content = fs.readFileSync(`services/python/${svc}/main.py`, "utf-8");
        expect(content).toContain("health");
        expect(
          content.toLowerCase().includes("fastapi") ||
            content.toLowerCase().includes("httpserver") ||
            content.toLowerCase().includes("uvicorn")
        ).toBe(true);
      }
    });
  });

  // ===== BILLING ENGINE DATA INTEGRITY (real invariants) =====
  describe("Billing Engine Data Integrity", () => {
    it("recordSplit server-side arithmetic is consistent", async () => {
      const { db, captured } = makeCapturingDb(7);
      mockedGetDb.mockResolvedValue(db as any);
      const caller = appRouter.createCaller(makeAuthCtx());
      await caller.billingLedger.recordSplit({
        ...VALID_SPLIT,
        transactionRef: "S79-INT-1",
        grossFee: 200,
        clientShare: 144,
        platformShare: 56,
        agentCommission: 30,
        switchFee: 6,
        aggregatorFee: 2,
      });

      const v = captured.insertValues;
      // platformNetFee is derived server-side, never trusted from the client
      expect(Number(v.platformNetFee)).toBe(56 - 6 - 2);
      // revenue share pct is derived from the real amounts
      expect(Number(v.revenueSharePct)).toBeCloseTo((56 / 200) * 100, 6);
      // client + platform shares reconcile to the gross fee by construction
      expect(Number(v.clientRevenue) + Number(v.platformRevenue)).toBe(200);
    });

    it("reconciliation never returns a fabricated match rate", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      // The honest contract: NOT_IMPLEMENTED, never a made-up >99% match rate
      await expect(
        caller.revenueReconciliation.runReconciliation({
          clientId: "CLIENT-INT",
          source: "tigerbeetle",
          target: "postgres",
          periodHours: 24,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("live dashboard never returns fabricated model data", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.getFinancialModelData({
          clientId: "CLIENT-INT",
          billingModel: "revenue_share",
          projectionYears: 5,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });
  });

  // ===== FINANCIAL MODEL INTEGRATION (honest contract) =====
  describe("Financial Model Integration", () => {
    it("live-data integration surface fails loud until the data source lands", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.getSummary()
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("financial-model data feed fails loud NOT_IMPLEMENTED", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.getFinancialModelData({
          clientId: "CLIENT-001",
          billingModel: "revenue_share",
          projectionYears: 5,
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });

    it("financial-model export fails loud NOT_IMPLEMENTED", async () => {
      const caller = appRouter.createCaller(makeAuthCtx());
      await expect(
        caller.liveBillingDashboard.exportForFinancialModel({
          clientId: "CLIENT-001",
          format: "json",
        })
      ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    });
  });

  // ===== DATABASE SCHEMA (unchanged — was already green) =====
  describe("Database Schema", () => {
    it("billing ledger table is defined in schema", async () => {
      const fs = await import("fs");
      const schema = fs.readFileSync("drizzle/schema.ts", "utf-8");
      expect(schema).toContain("platform_billing_ledger");
      expect(schema).toContain("revenue_periods");
      expect(schema).toContain("reconciliation");
    });
  });
});
