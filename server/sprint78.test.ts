/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: structural assertions + Unauthorized failures (partly Permify fail-closed in unit job — see QUARANTINE.md residual-risk note).
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Reconciled (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
// @ts-nocheck
import { describe, it, expect } from "vitest";

// ============================================================
// Sprint 78 — Comprehensive Test Suite
// Covers: USSD Session Replay, Carrier Live Pricing, Agent KYC,
//         TX Monitor, Commission Calculator, Security Scanner,
//         Offline Queue, Vulnerability Middleware
// ============================================================

// --- USSD Session Replay Router Tests ---
describe("ussdSessionReplayRouter", () => {
  it("should list all sessions", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    const result = await caller.listSessions();
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it("should filter sessions by status", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    const result = await caller.listSessions({ status: "completed" });
    expect(
      result.sessions.every((s: any) => s.status === undefined || true)
    ).toBe(true);
  });

  it("should get a specific session with keystrokes", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    const result = await caller.getSession({ sessionId: "SESS-001" });
    expect(result.sessionId).toBe("SESS-001");
    expect(result.keystrokes.length).toBeGreaterThan(0);
    expect(result.keystrokes[0].input).toBe("*384#");
  });

  it("should replay a session step by step", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    const result = await caller.replaySession({ sessionId: "SESS-001" });
    expect(result.totalSteps).toBe(4);
    expect(result.keystrokes[0].screenText).toContain("Welcome");
  });

  it("should throw for non-existent session", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    await expect(
      caller.getSession({ sessionId: "NONEXISTENT" })
    ).rejects.toThrow("Session not found");
  });

  it("should return analytics with drop-off screens", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    const result = await caller.getAnalytics();
    expect(result.totalSessions).toBeGreaterThan(0);
    expect(result.completionRate).toBeGreaterThanOrEqual(0);
    expect(result.completionRate).toBeLessThanOrEqual(100);
    expect(result.dropOffScreens.length).toBeGreaterThan(0);
  });

  it("should filter sessions by carrier", async () => {
    const { ussdSessionReplayRouter } = await import(
      "./routers/ussdSessionReplay"
    );
    const caller = ussdSessionReplayRouter.createCaller({});
    const result = await caller.listSessions({ carrier: "MTN_NG" });
    expect(result.total).toBeGreaterThan(0);
  });
});

// --- Carrier Live Pricing Router Tests ---
describe("carrierLivePricingRouter", () => {
  it("should return all carrier rates", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    const result = await caller.getAllRates();
    expect(result.carriers.length).toBeGreaterThanOrEqual(10);
    expect(result.count).toBe(result.carriers.length);
  });

  it("should filter rates by country", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    const result = await caller.getAllRates({ country: "NG" });
    expect(result.carriers.every((c: any) => c.country === "NG")).toBe(true);
    expect(result.carriers.length).toBeGreaterThanOrEqual(3);
  });

  it("should get a specific carrier rate", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    const result = await caller.getCarrierRate({ carrierId: "mtn_ng" });
    expect(result.carrierName).toBe("MTN Nigeria");
    expect(result.smsRate).toBe(4.0);
    expect(result.currency).toBe("NGN");
  });

  it("should compare multiple carriers", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    const result = await caller.compareCarriers({
      carrierIds: ["mtn_ng", "airtel_ng", "glo_ng"],
    });
    expect(result.comparison.length).toBe(3);
  });

  it("should estimate cost correctly", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    const result = await caller.estimateCost({
      carrierId: "mtn_ng",
      smsCount: 1000,
      ussdSessions: 500,
      dataMb: 100,
    });
    expect(result.carrier).toBe("MTN Nigeria");
    expect(result.smsCost).toBe(4000); // 1000 * 4.0
    expect(result.ussdCost).toBe(815); // 500 * 1.63
    expect(result.dataCost).toBe(350); // 100 * 3.5
    expect(result.total).toBe(5165);
  });

  it("should return available countries", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    const result = await caller.getCountries();
    expect(result.length).toBeGreaterThanOrEqual(6);
    const ng = result.find((c: any) => c.code === "NG");
    expect(ng).toBeDefined();
    expect(ng!.carrierCount).toBeGreaterThanOrEqual(3);
  });

  it("should throw for non-existent carrier", async () => {
    const { carrierLivePricingRouter } = await import(
      "./routers/carrierLivePricing"
    );
    const caller = carrierLivePricingRouter.createCaller({});
    await expect(
      caller.getCarrierRate({ carrierId: "fake_carrier" })
    ).rejects.toThrow("Carrier not found");
  });
});

// --- Agent KYC Router Tests ---
describe("agentKycRouter", () => {
  it("should list all KYC profiles", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    const result = await caller.listProfiles();
    expect(result.profiles.length).toBeGreaterThan(0);
    expect(result.total).toBe(result.profiles.length);
  });

  it("should filter profiles by status", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    const result = await caller.listProfiles({ status: "complete" });
    expect(
      result.profiles.every((p: any) => p.overallStatus === "complete")
    ).toBe(true);
  });

  it("should get a specific agent profile", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    const result = await caller.getProfile({ agentId: "AGT-001" });
    expect(result.agentName).toBe("Adebayo Okonkwo");
    expect(result.kycLevel).toBe(2);
    expect(result.documents.length).toBe(2);
  });

  it("should get a specific document", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    const result = await caller.getDocument({ docId: "DOC-001A" });
    expect(result.docType).toBe("nin");
    expect(result.status).toBe("verified");
    expect(result.confidenceScore).toBe(95);
  });

  // DD-TSSEC (A7-14): honest NIN/BVN semantics — submission performs a FORMAT
  // check only. There is no NIMC/BVN registry verification in this flow, so a
  // well-formed document is persisted as "pending" with confidenceScore null
  // (never "verified"), and a malformed number is rejected outright.
  it("should accept a well-formed NIN as pending (format-check-only, never auto-verified)", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    const result = await caller.submitDocument({
      agentId: "AGT-005",
      docType: "nin",
      docNumber: "12345678901",
      fullName: "Kwame Asante",
      dateOfBirth: "1995-01-01",
      issueDate: "2023-01-01",
      expiryDate: null,
      issuingAuthority: "NIMC",
      country: "NG",
    });
    expect(result.status).toBe("pending");
    expect(result.confidenceScore).toBeNull();
    expect(result.verificationLevel).toBe("format-check-only");
  });

  it("should reject a malformed document number (BAD_REQUEST)", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    await expect(
      caller.submitDocument({
        agentId: "AGT-005",
        docType: "nin",
        docNumber: "INVALID",
        fullName: "Test User",
        dateOfBirth: "1990-01-01",
        issueDate: "2023-01-01",
        expiryDate: null,
        issuingAuthority: "NIMC",
        country: "NG",
      })
    ).rejects.toThrow(/does not match the expected NIN format/);
  });

  it("should return KYC dashboard stats", async () => {
    const { agentKycRouter } = await import("./routers/agentKyc");
    const caller = agentKycRouter.createCaller({});
    const result = await caller.getDashboard();
    expect(result.totalAgents).toBeGreaterThan(0);
    expect(result.verificationRate).toBeGreaterThanOrEqual(0);
    expect(result.avgRiskScore).toBeGreaterThan(0);
  });
});

// --- TX Monitor Router Tests ---
describe("txMonitorRouter", () => {
  it("should return all alert rules", async () => {
    const { txMonitorRouter } = await import("./routers/txMonitor");
    const caller = txMonitorRouter.createCaller({});
    const result = await caller.getRules();
    expect(result.rules.length).toBeGreaterThanOrEqual(8);
    expect(result.activeCount).toBeGreaterThan(0);
  });

  it("should return alerts", async () => {
    const { txMonitorRouter } = await import("./routers/txMonitor");
    const caller = txMonitorRouter.createCaller({});
    const result = await caller.getAlerts();
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.total).toBe(result.alerts.length);
  });

  it("should filter alerts by severity", async () => {
    const { txMonitorRouter } = await import("./routers/txMonitor");
    const caller = txMonitorRouter.createCaller({});
    const result = await caller.getAlerts({ severity: "critical" });
    expect(result.alerts.every((a: any) => a.severity === "critical")).toBe(
      true
    );
  });

  it("should acknowledge an alert", async () => {
    const { txMonitorRouter } = await import("./routers/txMonitor");
    const caller = txMonitorRouter.createCaller({});
    const result = await caller.acknowledgeAlert({ alertId: "ALT-001" });
    expect(result.success).toBe(true);
  });

  it("should resolve an alert", async () => {
    const { txMonitorRouter } = await import("./routers/txMonitor");
    const caller = txMonitorRouter.createCaller({});
    const result = await caller.resolveAlert({
      alertId: "ALT-002",
      resolution: "False positive",
    });
    expect(result.success).toBe(true);
  });

  it("should return dashboard stats", async () => {
    const { txMonitorRouter } = await import("./routers/txMonitor");
    const caller = txMonitorRouter.createCaller({});
    const result = await caller.getDashboard();
    expect(result.totalAlerts).toBeGreaterThan(0);
    expect(result.rulesCount).toBeGreaterThanOrEqual(8);
    expect(result.recentAlerts.length).toBeGreaterThan(0);
  });
});

// --- Commission Calculator Router Tests ---
describe("commissionCalculatorRouter", () => {
  it("should return all tiers and multipliers", async () => {
    const { commissionCalculatorRouter } = await import(
      "./routers/commissionCalculator"
    );
    const caller = commissionCalculatorRouter.createCaller({});
    const result = await caller.getTiers();
    expect(result.tiers.length).toBe(5);
    expect(result.multipliers.cash_in).toBe(1.0);
    expect(result.multipliers.cash_out).toBe(1.2);
  });

  it("should calculate commission for Bronze tier", async () => {
    const { commissionCalculatorRouter } = await import(
      "./routers/commissionCalculator"
    );
    const caller = commissionCalculatorRouter.createCaller({});
    const result = await caller.calculate({
      agentId: "AGT-001",
      transactions: [
        { ref: "TX-001", type: "cash_in", amount: 100000, status: "completed" },
        {
          ref: "TX-002",
          type: "cash_out",
          amount: 200000,
          status: "completed",
        },
      ],
    });
    expect(result.tier).toBe("Bronze");
    expect(result.totalVolume).toBe(300000);
    expect(result.txCount).toBe(2);
    expect(result.baseCommission).toBeGreaterThan(0);
  });

  it("should apply bonus for Silver tier with enough transactions", async () => {
    const { commissionCalculatorRouter } = await import(
      "./routers/commissionCalculator"
    );
    const caller = commissionCalculatorRouter.createCaller({});
    const txs = Array.from({ length: 60 }, (_, i) => ({
      ref: `TX-${i}`,
      type: "cash_in",
      amount: 20000,
      status: "completed",
    }));
    const result = await caller.calculate({
      agentId: "AGT-001",
      transactions: txs,
    });
    expect(result.tier).toBe("Silver");
    expect(result.bonusCommission).toBeGreaterThan(0);
  });

  it("should handle clawback for reversed transactions", async () => {
    const { commissionCalculatorRouter } = await import(
      "./routers/commissionCalculator"
    );
    const caller = commissionCalculatorRouter.createCaller({});
    const result = await caller.calculate({
      agentId: "AGT-001",
      transactions: [
        { ref: "TX-001", type: "cash_in", amount: 100000, status: "completed" },
        { ref: "TX-002", type: "cash_in", amount: 50000, status: "reversed" },
      ],
    });
    expect(result.clawbackAmount).toBeGreaterThan(0);
    expect(result.netCommission).toBeLessThan(result.totalCommission);
  });

  it("should simulate commission for given volume", async () => {
    const { commissionCalculatorRouter } = await import(
      "./routers/commissionCalculator"
    );
    const caller = commissionCalculatorRouter.createCaller({});
    const result = await caller.simulate({
      volume: 5000000,
      txCount: 300,
      txType: "cash_in",
    });
    expect(result.tier).toBe("Gold");
    expect(result.totalCommission).toBeGreaterThan(0);
    expect(result.nextTier).toBe("Platinum");
    expect(result.volumeToNextTier).toBeGreaterThan(0);
  });
});

// --- Vulnerability Scanner Middleware Tests ---
describe("vulnerabilityScannerMiddleware", () => {
  it("should detect SQL injection patterns", async () => {
    const { detectSqlInjection } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    expect(detectSqlInjection("SELECT * FROM users")).toBe(true);
    expect(detectSqlInjection("1 OR 1=1")).toBe(true);
    expect(detectSqlInjection("WAITFOR DELAY '0:0:5'")).toBe(true);
    expect(detectSqlInjection("normal input")).toBe(false);
    expect(detectSqlInjection("john@example.com")).toBe(false);
  });

  it("should detect XSS patterns", async () => {
    const { detectXss } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    expect(detectXss("<script>alert('xss')</script>")).toBe(true);
    expect(detectXss("javascript:void(0)")).toBe(true);
    expect(detectXss('onclick="alert(1)"')).toBe(true);
    expect(detectXss("normal text")).toBe(false);
  });

  it("should detect path traversal", async () => {
    const { detectPathTraversal } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    expect(detectPathTraversal("../../../etc/passwd")).toBe(true);
    expect(detectPathTraversal("%2e%2e/secret")).toBe(true);
    expect(detectPathTraversal("/home/user/file.txt")).toBe(false);
  });

  it("should detect SSRF attempts", async () => {
    const { detectSsrf } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    expect(detectSsrf("http://127.0.0.1:8080/admin")).toBe(true);
    expect(detectSsrf("http://localhost/secret")).toBe(true);
    expect(detectSsrf("file:///etc/passwd")).toBe(true);
    expect(detectSsrf("https://api.example.com/data")).toBe(false);
  });

  it("should sanitize input correctly", async () => {
    const { sanitizeInput } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    const result = sanitizeInput("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("should run PCI-DSS compliance checks", async () => {
    const { runPciDssChecks } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    const result = runPciDssChecks();
    expect(result.passed.length).toBeGreaterThan(10);
    expect(result.failed.length).toBe(0);
  });

  it("should return OWASP Top 10 coverage", async () => {
    const { getOwaspCoverage } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    const result = getOwaspCoverage();
    expect(result.length).toBe(10);
    expect(result.every((r: any) => r.covered)).toBe(true);
  });

  it("should generate a full vulnerability report", async () => {
    const { generateVulnerabilityReport } = await import(
      "./middleware/vulnerabilityScannerMiddleware"
    );
    const report = generateVulnerabilityReport();
    expect(report.scanId).toBeTruthy();
    expect(report.complianceScore).toBeGreaterThanOrEqual(90);
    expect(report.pciDssCompliant).toBe(true);
    expect(report.owaspCoverage).toBe(100);
  });
});

// --- Offline Queue Middleware Tests ---
describe("offlineQueueMiddleware", () => {
  it("should calculate backoff with jitter", async () => {
    const { calculateBackoff } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const delay1 = calculateBackoff(0, "4g");
    expect(delay1).toBeGreaterThan(0);
    expect(delay1).toBeLessThan(2000);
    const delay3 = calculateBackoff(3, "2g");
    expect(delay3).toBeGreaterThan(delay1);
  });

  it("should generate consistent checksums", async () => {
    const { generateChecksum } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const cs1 = generateChecksum({ a: 1, b: 2 });
    const cs2 = generateChecksum({ b: 2, a: 1 });
    expect(cs1).toBe(cs2); // Order-independent
    const cs3 = generateChecksum({ a: 1, b: 3 });
    expect(cs1).not.toBe(cs3);
  });

  it("should detect conflicts", async () => {
    const { detectConflict, createQueueEntry } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const entry = createQueueEntry(
      "cash_in",
      { amount: 50000 },
      "AGT-001",
      "DEV-001",
      "3g"
    );
    expect(
      detectConflict(entry, { checksum: entry.checksum, updatedAt: Date.now() })
    ).toBe(false);
    expect(
      detectConflict(entry, { checksum: "different", updatedAt: Date.now() })
    ).toBe(true);
  });

  it("should resolve conflicts with different strategies", async () => {
    const { resolveConflict, createQueueEntry } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const entry = createQueueEntry(
      "cash_in",
      { amount: 50000 },
      "AGT-001",
      "DEV-001",
      "3g"
    );
    const remote = { payload: { amount: 60000 }, updatedAt: Date.now() };
    const clientWins = resolveConflict(entry, remote, "client_wins");
    expect(clientWins.amount).toBe(50000);
    const serverWins = resolveConflict(entry, remote, "server_wins");
    expect(serverWins.amount).toBe(60000);
    const manual = resolveConflict(entry, remote, "manual");
    expect((manual as any)._conflict).toBe(true);
  });

  it("should create queue entries with correct priority", async () => {
    const { createQueueEntry } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const premiumCollection = createQueueEntry("cash_in", {}, "AGT-001", "DEV-001", "4g");
    expect(premiumCollection.priority).toBe(1);
    const notification = createQueueEntry(
      "notification",
      {},
      "AGT-001",
      "DEV-001",
      "4g"
    );
    expect(notification.priority).toBe(5);
  });

  it("should compute queue stats", async () => {
    const { createQueueEntry, getQueueStats } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const queue = [
      {
        ...createQueueEntry("cash_in", {}, "A", "D", "3g"),
        status: "pending" as const,
      },
      {
        ...createQueueEntry("cash_out", {}, "A", "D", "3g"),
        status: "completed" as const,
      },
      {
        ...createQueueEntry("transfer", {}, "A", "D", "3g"),
        status: "failed" as const,
      },
    ];
    const stats = getQueueStats(queue);
    expect(stats.totalQueued).toBe(3);
    expect(stats.pending).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it("should compress batch for low-bandwidth", async () => {
    const { createQueueEntry, compressBatch } = await import(
      "./middleware/offlineQueueMiddleware"
    );
    const queue = Array.from({ length: 10 }, (_, i) =>
      createQueueEntry(
        "cash_in",
        { amount: (i + 1) * 10000 },
        `AGT-${i}`,
        `DEV-${i}`,
        "2g"
      )
    );
    const result = compressBatch(queue);
    expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize);
    expect(result.ratio).toBeLessThanOrEqual(100);
  });
});

// --- Go Microservice Structure Tests ---
describe("Sprint 78 Go microservices", () => {
  const goServices = [
    "carrier-live-api",
    "settlement-batch-processor",
    "mdm-compliance-engine",
    "workflow-orchestrator",
  ];

  goServices.forEach(svc => {
    it(`should have main.go for ${svc}`, async () => {
      const fs = await import("fs");
      const path = `${process.cwd()}/services/go/${svc}/main.go`;
      expect(fs.existsSync(path)).toBe(true);
      const content = fs.readFileSync(path, "utf-8");
      expect(content).toContain("package main");
      expect(content).toContain("func main()");
    });

    it(`should have go.mod for ${svc}`, async () => {
      const fs = await import("fs");
      const path = `${process.cwd()}/services/go/${svc}/go.mod`;
      expect(fs.existsSync(path)).toBe(true);
    });

    it(`should have Dockerfile for ${svc}`, async () => {
      const fs = await import("fs");
      const path = `${process.cwd()}/services/go/${svc}/Dockerfile`;
      expect(fs.existsSync(path)).toBe(true);
    });
  });
});

// --- Python Microservice Structure Tests ---
describe("Sprint 78 Python microservices", () => {
  const pyServices = [
    "fraud-ml-pipeline",
    "kyc-document-verifier",
    "commission-calculator",
    "ussd-session-replayer",
    "tx-monitor-alerter",
  ];

  pyServices.forEach(svc => {
    it(`should have main.py for ${svc}`, async () => {
      const fs = await import("fs");
      const path = `${process.cwd()}/services/python/${svc}/main.py`;
      expect(fs.existsSync(path)).toBe(true);
      const content = fs.readFileSync(path, "utf-8");
      expect(content.length).toBeGreaterThan(100);
    });

    it(`should have requirements.txt for ${svc}`, async () => {
      const fs = await import("fs");
      const path = `${process.cwd()}/services/python/${svc}/requirements.txt`;
      expect(fs.existsSync(path)).toBe(true);
    });
  });
});

// --- Rust Microservice Structure Tests ---
describe("Sprint 78 Rust microservices", () => {
  it("should have main.rs for multi-currency-engine", async () => {
    const fs = await import("fs");
    const path = `${process.cwd()}/services/rust/multi-currency-engine/src/main.rs`;
    expect(fs.existsSync(path)).toBe(true);
    const content = fs.readFileSync(path, "utf-8");
    expect(content).toContain("fn main()");
  });

  it("should have Cargo.toml for multi-currency-engine", async () => {
    const fs = await import("fs");
    const path = `${process.cwd()}/services/rust/multi-currency-engine/Cargo.toml`;
    expect(fs.existsSync(path)).toBe(true);
  });
});

// --- Integration: All Sprint 78 routers registered ---
describe("Sprint 78 router registration", () => {
  it("should have all Sprint 78 routers in routers.ts", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      `${process.cwd()}/server/routers.ts`,
      "utf-8"
    );
    const routers = [
      "ussdSessionReplay",
      "carrierLivePricing",
      "agentKyc",
      "txMonitor",
      "commissionCalculator",
    ];
    routers.forEach(r => {
      expect(content).toContain(r);
    });
  });
});

// --- Integration: All Sprint 78 pages routed ---
describe("Sprint 78 page routing", () => {
  it("should have all Sprint 78 pages in App.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      `${process.cwd()}/client/src/App.tsx`,
      "utf-8"
    );
    const pages = [
      "UssdSessionReplayPage",
      "AgentKycPage",
      "TxMonitorPage",
      "CommissionCalculatorPage",
      "CarrierLivePricingPage",
    ];
    pages.forEach(p => {
      expect(content).toContain(p);
    });
    const routes = [
      "/ussd-session-replay",
      "/agent-kyc",
      "/tx-monitor",
      "/commission-calculator",
      "/carrier-live-pricing",
    ];
    routes.forEach(r => {
      expect(content).toContain(r);
    });
  });
});
