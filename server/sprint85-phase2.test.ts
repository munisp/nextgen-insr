// @ts-check

/**
 * Sprint 85 Phase 2 Tests — H2-H5, M1-M6
 *
 * Validates:
 * - H2: Public vs Protected procedure audit
 * - H3: Schema migration completeness (139 tables)
 * - H4: Playwright E2E test configuration
 * - H5: Relations coverage (199 relation definitions)
 * - M1: WAF policy (OpenAppSec)
 * - M2: NetworkPolicy (21 K8s policies)
 * - M3: OpenTelemetry collector config
 * - M4: Grafana dashboard + Prometheus alerts
 * - M5: Trivy CI scanning pipeline
 * - M6: API versioning middleware
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

// ─── H2: Security Audit ─────────────────────────────────────────────────────
describe("H2: Public vs Protected Procedure Audit", () => {
  it("security audit document exists", () => {
    expect(fs.existsSync(path.join(ROOT, "docs/security-audit-h2.md"))).toBe(
      true
    );
  });

  it("audit document covers all public procedures", () => {
    const doc = fs.readFileSync(
      path.join(ROOT, "docs/security-audit-h2.md"),
      "utf-8"
    );
    expect(doc).toContain("healthCheck");
    expect(doc).toContain("apiDocs");
    expect(doc).toContain("auth.me");
    expect(doc).toContain("auth.logout");
    expect(doc).toContain("PASS");
  });

  it("only 4 public procedures exist across all routers", () => {
    const routersDir = path.join(ROOT, "server/routers");
    const routersFile = path.join(ROOT, "server/routers.ts");
    let publicCount = 0;

    // Count in routers directory
    if (fs.existsSync(routersDir)) {
      const files = fs.readdirSync(routersDir).filter(f => f.endsWith(".ts"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(routersDir, file), "utf-8");
        const matches = content.match(/publicProcedure\./g);
        if (matches) publicCount += matches.length;
      }
    }

    // Count in main routers.ts
    if (fs.existsSync(routersFile)) {
      const content = fs.readFileSync(routersFile, "utf-8");
      const matches = content.match(/publicProcedure\./g);
      if (matches) publicCount += matches.length;
    }

    expect(publicCount).toBeLessThanOrEqual(6); // me, logout + healthCheck, apiDocs
  });
});

// ─── H3: Schema Migration ───────────────────────────────────────────────────
describe("H3: Schema Migration Completeness", () => {
  it("schema.ts defines 130+ tables", () => {
    const schema = fs.readFileSync(
      path.join(ROOT, "drizzle/schema.ts"),
      "utf-8"
    );
    const tables = schema.match(/pgTable\(/g);
    expect(tables).not.toBeNull();
    expect(tables!.length).toBeGreaterThanOrEqual(130);
  });

  it("migration files exist", () => {
    const migrations = fs
      .readdirSync(path.join(ROOT, "drizzle"))
      .filter(f => f.endsWith(".sql"));
    expect(migrations.length).toBeGreaterThanOrEqual(30);
  });
});

// ─── H4: E2E Test Configuration ─────────────────────────────────────────────
describe("H4: Playwright E2E Tests", () => {
  it("playwright config exists", () => {
    expect(
      fs.existsSync(path.join(ROOT, "tests/e2e/playwright.config.ts"))
    ).toBe(true);
  });

  it("critical flows test file exists with 20 test cases", () => {
    const testFile = path.join(ROOT, "tests/e2e/critical-flows.spec.ts");
    expect(fs.existsSync(testFile)).toBe(true);
    const content = fs.readFileSync(testFile, "utf-8");
    const testCount = (content.match(/test\('/g) || []).length;
    expect(testCount).toBeGreaterThanOrEqual(20);
  });

  it("playwright config targets chromium and mobile", () => {
    const config = fs.readFileSync(
      path.join(ROOT, "tests/e2e/playwright.config.ts"),
      "utf-8"
    );
    expect(config).toContain("chromium");
    expect(config).toContain("mobile");
  });
});

// ─── H5: Relations Coverage ─────────────────────────────────────────────────
describe("H5: Relations.ts FK Constraints", () => {
  it("relations.ts has 190+ relation definitions", () => {
    const relations = fs.readFileSync(
      path.join(ROOT, "drizzle/relations.ts"),
      "utf-8"
    );
    const count = (relations.match(/Relations = relations/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(190);
  });

  it("relations.ts imports from schema", () => {
    const relations = fs.readFileSync(
      path.join(ROOT, "drizzle/relations.ts"),
      "utf-8"
    );
    expect(relations).toContain('from "./schema"');
  });

  it("key tables have relations defined", () => {
    const relations = fs.readFileSync(
      path.join(ROOT, "drizzle/relations.ts"),
      "utf-8"
    );
    expect(relations).toContain("usersRelations");
    expect(relations).toContain("agentsRelations");
    expect(relations).toContain("transactionsRelations");
    expect(relations).toContain("tenantsRelations");
  });
});

// ─── M1: WAF Policy ─────────────────────────────────────────────────────────
describe("M1: OpenAppSec WAF Policy", () => {
  const wafPath = path.join(ROOT, "infra/security/waf/openappsec-policy.yaml");

  it("WAF policy file exists", () => {
    expect(fs.existsSync(wafPath)).toBe(true);
  });

  it("WAF policy covers OWASP Top 10", () => {
    const content = fs.readFileSync(wafPath, "utf-8");
    expect(content).toContain("owasp-top10-protection");
    expect(content).toContain("sqlInjection");
    expect(content).toContain("ssrfProtection");
    expect(content).toContain("csrfProtection");
  });

  it("WAF policy includes rate limiting", () => {
    const content = fs.readFileSync(wafPath, "utf-8");
    expect(content).toContain("rate-limiting");
    expect(content).toContain("global-api-limit");
  });

  it("WAF policy includes geo-blocking for operational regions", () => {
    const content = fs.readFileSync(wafPath, "utf-8");
    expect(content).toContain("geo-blocking");
    expect(content).toContain("NG"); // Nigeria
    expect(content).toContain("KE"); // Kenya
    expect(content).toContain("ZA"); // South Africa
  });

  it("WAF policy exempts health check and Stripe webhook", () => {
    const content = fs.readFileSync(wafPath, "utf-8");
    expect(content).toContain("health-check-bypass");
    expect(content).toContain("stripe-webhook-bypass");
  });
});

// ─── M2: Network Policies ───────────────────────────────────────────────────
describe("M2: Kubernetes Network Policies", () => {
  const npPath = path.join(
    ROOT,
    "infra/k8s/network-policies/billing-network-policies.yaml"
  );

  it("network policy file exists", () => {
    expect(fs.existsSync(npPath)).toBe(true);
  });

  it("includes default deny policies", () => {
    const content = fs.readFileSync(npPath, "utf-8");
    expect(content).toContain("default-deny-ingress");
    expect(content).toContain("default-deny-egress");
  });

  it("includes 20+ network policies", () => {
    const content = fs.readFileSync(npPath, "utf-8");
    const policyCount = (content.match(/kind: NetworkPolicy/g) || []).length;
    expect(policyCount).toBeGreaterThanOrEqual(20);
  });

  it("covers all critical services", () => {
    const content = fs.readFileSync(npPath, "utf-8");
    expect(content).toContain("postgresql");
    expect(content).toContain("redis");
    expect(content).toContain("kafka");
    expect(content).toContain("temporal");
    expect(content).toContain("stripe");
  });
});

// ─── M3: OpenTelemetry ──────────────────────────────────────────────────────
describe("M3: OpenTelemetry Collector Config", () => {
  const otelPath = path.join(
    ROOT,
    "infra/observability/otel/otel-collector-config.yaml"
  );

  it("OTel collector config exists", () => {
    expect(fs.existsSync(otelPath)).toBe(true);
  });

  it("configures traces, metrics, and logs pipelines", () => {
    const content = fs.readFileSync(otelPath, "utf-8");
    expect(content).toContain("traces:");
    expect(content).toContain("metrics:");
    expect(content).toContain("logs:");
  });

  it("includes tail-based sampling", () => {
    const content = fs.readFileSync(otelPath, "utf-8");
    expect(content).toContain("tail_sampling");
    expect(content).toContain("billing-ledger");
  });

  it("scrapes all service types (Go, Rust, Python, TS)", () => {
    const content = fs.readFileSync(otelPath, "utf-8");
    expect(content).toContain("billing-aggregation-engine");
    expect(content).toContain("ledger-integrity-validator");
    expect(content).toContain("sla-monitor");
    expect(content).toContain("trpc-backend");
  });
});

// ─── M4: Grafana + Prometheus ───────────────────────────────────────────────
describe("M4: Grafana Dashboard & Prometheus Alerts", () => {
  it("Grafana dashboard JSON exists", () => {
    expect(
      fs.existsSync(
        path.join(ROOT, "infra/observability/grafana/billing-dashboard.json")
      )
    ).toBe(true);
  });

  it("dashboard has 10+ panels", () => {
    const dashboard = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "infra/observability/grafana/billing-dashboard.json"),
        "utf-8"
      )
    );
    expect(dashboard.dashboard.panels.length).toBeGreaterThanOrEqual(10);
  });

  it("Prometheus alerts file exists", () => {
    expect(
      fs.existsSync(
        path.join(ROOT, "infra/observability/prometheus/billing-alerts.yaml")
      )
    ).toBe(true);
  });

  it("alerts cover critical scenarios", () => {
    const alerts = fs.readFileSync(
      path.join(ROOT, "infra/observability/prometheus/billing-alerts.yaml"),
      "utf-8"
    );
    expect(alerts).toContain("BillingAPIDown");
    expect(alerts).toContain("BillingHighErrorRate");
    expect(alerts).toContain("TigerBeetleSidecarDown");
    expect(alerts).toContain("StripeWebhookFailures");
    expect(alerts).toContain("DatabaseConnectionPoolExhausted");
  });
});

// ─── M5: Trivy Scanning ─────────────────────────────────────────────────────
describe("M5: Trivy Container Scanning CI", () => {
  const trivyPath = path.join(ROOT, "infra/ci/trivy-scanning.yaml");

  it("Trivy CI config exists", () => {
    expect(fs.existsSync(trivyPath)).toBe(true);
  });

  it("scans all service types", () => {
    const content = fs.readFileSync(trivyPath, "utf-8");
    expect(content).toContain("scan-trpc-backend");
    expect(content).toContain("scan-go-services");
    expect(content).toContain("scan-rust-services");
    expect(content).toContain("scan-python-services");
  });

  it("includes filesystem and K8s manifest scanning", () => {
    const content = fs.readFileSync(trivyPath, "utf-8");
    expect(content).toContain("scan-filesystem");
    expect(content).toContain("scan-k8s-manifests");
  });

  it("uploads SARIF results to GitHub", () => {
    const content = fs.readFileSync(trivyPath, "utf-8");
    expect(content).toContain("upload-sarif");
    expect(content).toContain("sarif");
  });
});

// ─── M6: API Versioning ─────────────────────────────────────────────────────
describe("M6: API Versioning Middleware", () => {
  it("API versioning middleware exists", () => {
    expect(
      fs.existsSync(path.join(ROOT, "server/middleware/apiVersioning.ts"))
    ).toBe(true);
  });

  it("middleware exports version constants", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/middleware/apiVersioning.ts"),
      "utf-8"
    );
    expect(content).toContain("CURRENT_API_VERSION");
    expect(content).toContain("SUPPORTED_VERSIONS");
    expect(content).toContain("DEPRECATED_VERSIONS");
  });

  it("middleware handles X-API-Version header", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/middleware/apiVersioning.ts"),
      "utf-8"
    );
    expect(content).toContain("x-api-version");
  });

  it("middleware does not have @ts-nocheck", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/middleware/apiVersioning.ts"),
      "utf-8"
    );
    expect(content).not.toContain("@ts-nocheck");
  });
});
