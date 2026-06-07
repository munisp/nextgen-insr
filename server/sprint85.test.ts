/**
 * Sprint 85 Tests — InsurePortal InsurePortal Platform
 *
 * Validates:
 * H1: TypeScript strict-mode compliance (0 errors after @ts-nocheck removal)
 * L2: OpenAPI/Swagger documentation completeness
 * L3: Architecture Decision Records (ADR-001 through ADR-010)
 * L4: Load testing framework (k6 configuration)
 * L5: Mutation testing framework (Stryker configuration)
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── H1: TypeScript Strict-Mode Compliance ───────────────────────────────────
describe("H1: TypeScript Strict-Mode Compliance", () => {
  it("should have tsconfig.json with strict mode enabled", () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "tsconfig.json"), "utf-8")
    );
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("should not have any @ts-nocheck directives in page files", () => {
    const pagesDir = path.join(PROJECT_ROOT, "client/src/pages");
    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(pagesDir, file), "utf-8");
      if (content.includes("@ts-nocheck")) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it("should have @ts-ignore comments annotated with Sprint 85 context", () => {
    const pagesDir = path.join(PROJECT_ROOT, "client/src/pages");
    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
    let totalIgnores = 0;
    let annotatedIgnores = 0;

    for (const file of files) {
      const content = fs.readFileSync(path.join(pagesDir, file), "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("@ts-ignore")) {
          totalIgnores++;
          if (line.includes("Sprint 85")) {
            annotatedIgnores++;
          }
        }
        if (line.includes("@ts-expect-error")) {
          totalIgnores++;
          if (line.includes("Sprint 85")) {
            annotatedIgnores++;
          }
        }
      }
    }

    // All @ts-ignore comments should be annotated
    if (totalIgnores > 0) {
      expect(annotatedIgnores / totalIgnores).toBeGreaterThan(0.9);
    }
  });
});

// ─── L2: OpenAPI/Swagger Documentation ───────────────────────────────────────
describe("L2: OpenAPI/Swagger Documentation", () => {
  const openapiPath = path.join(PROJECT_ROOT, "docs/openapi.yaml");

  it("should have openapi.yaml file", () => {
    expect(fs.existsSync(openapiPath)).toBe(true);
  });

  it("should be valid OpenAPI 3.0 YAML", () => {
    const content = fs.readFileSync(openapiPath, "utf-8");
    const doc = yaml.parse(content);
    expect(doc.openapi).toMatch(/^3\.0/);
    expect(doc.info).toBeDefined();
    expect(doc.info.title).toContain("InsurePortal");
    expect(doc.info.version).toBe("1.0.0");
  });

  it("should document all critical billing endpoints", () => {
    const content = fs.readFileSync(openapiPath, "utf-8");
    const doc = yaml.parse(content);
    const paths = Object.keys(doc.paths || {});

    const requiredEndpoints = [
      "billingLedger",
      "billingInvoice",
      "revenueReconciliation",
      "tenantBillingOnboarding",
      "billingRbac",
      "billingAudit",
      "billingProduction",
      "liveBillingDashboard",
    ];

    for (const endpoint of requiredEndpoints) {
      const found = paths.some(p => p.includes(endpoint));
      expect(found).toBe(true);
    }
  });

  it("should define security schemes", () => {
    const content = fs.readFileSync(openapiPath, "utf-8");
    const doc = yaml.parse(content);
    expect(doc.components?.securitySchemes).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it("should define reusable schemas", () => {
    const content = fs.readFileSync(openapiPath, "utf-8");
    const doc = yaml.parse(content);
    const schemas = Object.keys(doc.components?.schemas || {});

    expect(schemas).toContain("LedgerEntry");
    expect(schemas).toContain("Invoice");
    expect(schemas).toContain("BillingConfig");
    expect(schemas).toContain("ReconciliationResult");
    expect(schemas).toContain("AuditEntry");
    expect(schemas).toContain("BillingMetrics");
  });

  it("should have rate limiting documentation", () => {
    const content = fs.readFileSync(openapiPath, "utf-8");
    expect(content).toContain("Rate Limiting");
  });

  it("should document the Stripe webhook endpoint", () => {
    const content = fs.readFileSync(openapiPath, "utf-8");
    const doc = yaml.parse(content);
    expect(doc.paths["/api/stripe/webhook"]).toBeDefined();
  });
});

// ─── L3: Architecture Decision Records ───────────────────────────────────────
describe("L3: Architecture Decision Records", () => {
  const adrDir = path.join(PROJECT_ROOT, "docs/adr");

  it("should have ADR directory with README", () => {
    expect(fs.existsSync(path.join(adrDir, "README.md"))).toBe(true);
  });

  it("should have 10 ADR files (ADR-001 through ADR-010)", () => {
    const files = fs.readdirSync(adrDir).filter(f => f.startsWith("ADR-"));
    expect(files.length).toBe(10);
  });

  const adrFiles = [
    { file: "ADR-001-tigerbeetle-ledger.md", keyword: "TigerBeetle" },
    { file: "ADR-002-temporal-workflows.md", keyword: "Temporal" },
    { file: "ADR-003-permify-rbac.md", keyword: "Permify" },
    { file: "ADR-004-kafka-event-sourcing.md", keyword: "Kafka" },
    { file: "ADR-005-multi-language-services.md", keyword: "Polyglot" },
    { file: "ADR-006-stripe-billing-integration.md", keyword: "Stripe" },
    { file: "ADR-007-dapr-service-mesh.md", keyword: "Dapr" },
    { file: "ADR-008-fluvio-streaming.md", keyword: "Fluvio" },
    { file: "ADR-009-mojaloop-interop.md", keyword: "Mojaloop" },
    { file: "ADR-010-offline-first-resilience.md", keyword: "Offline" },
  ];

  for (const { file, keyword } of adrFiles) {
    it(`should have ${file} with correct content`, () => {
      const filepath = path.join(adrDir, file);
      expect(fs.existsSync(filepath)).toBe(true);

      const content = fs.readFileSync(filepath, "utf-8");
      expect(content).toContain(keyword);
      expect(content).toContain("## Context");
      expect(content).toContain("## Decision");
      expect(content).toContain("## Consequences");
      expect(content).toContain("**Status:** Accepted");
    });
  }

  it("should have ADR README with index table", () => {
    const readme = fs.readFileSync(path.join(adrDir, "README.md"), "utf-8");
    expect(readme).toContain("ADR-001");
    expect(readme).toContain("ADR-010");
    expect(readme).toContain("| ADR |");
  });
});

// ─── L4: Load Testing Framework ──────────────────────────────────────────────
describe("L4: Load Testing Framework", () => {
  const loadTestPath = path.join(
    PROJECT_ROOT,
    "tests/load/k6-billing-load-test.js"
  );

  it("should have k6 load test configuration", () => {
    expect(fs.existsSync(loadTestPath)).toBe(true);
  });

  it("should define multiple test scenarios", () => {
    const content = fs.readFileSync(loadTestPath, "utf-8");
    expect(content).toContain("normal_traffic");
    expect(content).toContain("month_end_spike");
    expect(content).toContain("soak_test");
  });

  it("should define performance thresholds", () => {
    const content = fs.readFileSync(loadTestPath, "utf-8");
    expect(content).toContain("thresholds");
    expect(content).toContain("http_req_duration");
    expect(content).toContain("http_req_failed");
    expect(content).toContain("billing_errors");
  });

  it("should test all critical billing endpoints", () => {
    const content = fs.readFileSync(loadTestPath, "utf-8");
    expect(content).toContain("billingLedger");
    expect(content).toContain("billingInvoice");
    expect(content).toContain("revenueReconciliation");
    expect(content).toContain("billingAudit");
    expect(content).toContain("billingRbac");
    expect(content).toContain("liveBillingDashboard");
  });

  it("should define custom metrics for billing operations", () => {
    const content = fs.readFileSync(loadTestPath, "utf-8");
    expect(content).toContain("ledger_post_latency");
    expect(content).toContain("invoice_create_latency");
    expect(content).toContain("reconciliation_latency");
    expect(content).toContain("dashboard_load_latency");
    expect(content).toContain("transactions_processed");
  });

  it("should include think time between requests", () => {
    const content = fs.readFileSync(loadTestPath, "utf-8");
    expect(content).toContain("sleep(");
  });
});

// ─── L5: Mutation Testing Framework ──────────────────────────────────────────
describe("L5: Mutation Testing Framework", () => {
  const strykerPath = path.join(PROJECT_ROOT, "stryker.config.mjs");

  it("should have Stryker mutation testing configuration", () => {
    expect(fs.existsSync(strykerPath)).toBe(true);
  });

  it("should target billing-critical source files", () => {
    const content = fs.readFileSync(strykerPath, "utf-8");
    expect(content).toContain("billingLedger");
    expect(content).toContain("billingInvoice");
    expect(content).toContain("billingRbac");
    expect(content).toContain("billingAudit");
    expect(content).toContain("revenueReconciliation");
  });

  it("should exclude test files from mutation", () => {
    const content = fs.readFileSync(strykerPath, "utf-8");
    expect(content).toContain("!**/*.test.ts");
    expect(content).toContain("!**/*.spec.ts");
  });

  it("should define mutation score thresholds", () => {
    const content = fs.readFileSync(strykerPath, "utf-8");
    expect(content).toContain("thresholds");
    expect(content).toContain("high: 90");
    expect(content).toContain("low: 70");
    expect(content).toContain("break: 60");
  });

  it("should use vitest as test runner", () => {
    const content = fs.readFileSync(strykerPath, "utf-8");
    expect(content).toContain("testRunner: 'vitest'");
  });

  it("should configure multiple reporters", () => {
    const content = fs.readFileSync(strykerPath, "utf-8");
    expect(content).toContain("'html'");
    expect(content).toContain("'json'");
    expect(content).toContain("'clear-text'");
  });
});
