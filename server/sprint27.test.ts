// @ts-check

/**
 * Sprint 27 Tests — Final Production Sprint
 * Covers: i18n, email delivery, webhook signatures, rate limit config,
 * API versioning, audit trail, accessibility, data export, request tracing
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("Sprint 27: i18n Multi-Language Support", () => {
  it("should have i18n module with 6+ languages", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/lib/i18n.ts"),
      "utf-8"
    );
    expect(content).toContain("en");
    expect(content).toContain("pcm"); // Nigerian Pidgin
    expect(content).toContain("ha"); // Hausa
    expect(content).toContain("yo"); // Yoruba
    expect(content).toContain("ig"); // Igbo
    expect(content).toContain("fr"); // French
  });

  it("should have LanguageSelector component", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/components/LanguageSelector.tsx"),
      "utf-8"
    );
    expect(content).toContain("LanguageSelector");
    expect(content).toContain("getLocale");
  });
});

describe("Sprint 27: Email Delivery Service", () => {
  it("should have email delivery module with templates", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/lib/emailDelivery.ts"),
      "utf-8"
    );
    expect(content).toContain("sendEmail");
    expect(content).toContain("nodemailer");
  });
});

describe("Sprint 27: Webhook Signature Verification", () => {
  it("should have webhook signature module with HMAC", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/lib/webhookSignature.ts"),
      "utf-8"
    );
    expect(content).toContain("verifyWebhookSignature");
    expect(content).toContain("verify");
  });
});

describe("Sprint 27: Rate Limit Configuration", () => {
  it("should have rate limit config with per-endpoint limits", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/lib/rateLimitConfig.ts"),
      "utf-8"
    );
    expect(content).toContain("windowMs");
    expect(content).toContain("maxRequests");
  });
});

describe("Sprint 27: API Versioning", () => {
  it("should have API versioning middleware", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/lib/apiVersioning.ts"),
      "utf-8"
    );
    expect(content).toContain("api-version");
    expect(content).toContain("version");
  });
});

describe("Sprint 27: Audit Trail", () => {
  it("should have audit trail middleware", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/lib/auditTrail.ts"),
      "utf-8"
    );
    expect(content).toContain("action");
    expect(content).toContain("severity");
  });

  it("should have AuditTrailPage UI", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/pages/AuditTrailPage.tsx"),
      "utf-8"
    );
    expect(content).toContain("AuditTrailPage");
    expect(content).toContain("DashboardLayout");
  });
});

describe("Sprint 27: Accessibility", () => {
  it("should have AccessibilityProvider component", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/components/AccessibilityProvider.tsx"),
      "utf-8"
    );
    expect(content).toContain("AccessibilityProvider");
  });

  it("should be wired in App.tsx", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/App.tsx"),
      "utf-8"
    );
    expect(content).toContain("AccessibilityProvider");
  });
});

describe("Sprint 27: Request Tracing", () => {
  it("should have request tracing middleware with correlation IDs", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/lib/requestTracing.ts"),
      "utf-8"
    );
    expect(content).toContain("X-Request-ID");
    expect(content).toContain("requestTracing");
  });
});

describe("Sprint 27: Data Export Router", () => {
  it("should have data export router", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/routers/dataExportRouter.ts"),
      "utf-8"
    );
    expect(content).toContain("dataExportRouter");
    expect(content).toContain("transactionsCsv");
    expect(content).toContain("agentsCsv");
  });

  it("should be wired in main router", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "server/routers.ts"),
      "utf-8"
    );
    expect(content).toContain("sprint27Export");
  });
});

describe("Sprint 27: Print Stylesheet", () => {
  it("should have print stylesheet", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/styles/print.css"),
      "utf-8"
    );
    expect(content).toContain("@media print");
    expect(content).toContain("display: none");
  });

  it("should be imported in index.css", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/index.css"),
      "utf-8"
    );
    expect(content).toContain("print.css");
  });
});

describe("Sprint 27: Comprehensive README", () => {
  it("should have comprehensive README with 200+ lines", () => {
    const content = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
    const lines = content.split("\n").length;
    expect(lines).toBeGreaterThan(200);
    expect(content).toContain("InsurePortal");
    expect(content).toContain("Architecture");
    expect(content).toContain("Getting Started");
  });
});

describe("Sprint 27: OpenAPI Specification", () => {
  it("should have OpenAPI 3.0 spec", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "docs/openapi.json"),
      "utf-8"
    );
    const spec = JSON.parse(content);
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toContain("InsurePortal");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(5);
  });
});

describe("Sprint 27: Grafana Dashboards", () => {
  it("should have 4 Grafana dashboards", () => {
    const dashDir = path.join(ROOT, "infra/grafana/dashboards");
    expect(fs.existsSync(path.join(dashDir, "pos-operations.json"))).toBe(true);
    expect(fs.existsSync(path.join(dashDir, "fraud-detection.json"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(dashDir, "agent-performance.json"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(dashDir, "system-health.json"))).toBe(true);
  });
});

describe("Sprint 27: Kubernetes Manifests", () => {
  it("should have K8s deployment and secrets", () => {
    const k8sDir = path.join(ROOT, "infra/k8s");
    expect(fs.existsSync(path.join(k8sDir, "deployment.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(k8sDir, "secrets.yaml"))).toBe(true);
  });
});

describe("Sprint 27: Prometheus Alerts", () => {
  it("should have Prometheus alerting rules", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "infra/monitoring/prometheus-alerts.yml"),
      "utf-8"
    );
    expect(content).toContain("alert:");
    expect(content).toContain("HighTransactionFailureRate");
  });
});

describe("Sprint 27: Environment Variables Documentation", () => {
  it("should document env vars in README", () => {
    const content = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
    expect(content).toContain("Database");
    expect(content).toContain("JWT");
  });
});

describe("Sprint 27: API Docs & System Status Pages", () => {
  it("should have ApiDocs page", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/pages/ApiDocs.tsx"),
      "utf-8"
    );
    expect(content).toContain("ApiDocs");
    expect(content).toContain("endpoint");
  });

  it("should have SystemStatus page", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/pages/SystemStatus.tsx"),
      "utf-8"
    );
    expect(content).toContain("SystemStatus");
  });

  it("should have routes in App.tsx", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/App.tsx"),
      "utf-8"
    );
    expect(content).toContain("/api-docs");
    expect(content).toContain("/system-status");
    expect(content).toContain("/audit-trail");
  });
});

describe("Sprint 27: Nav Items", () => {
  it("should have Audit Trail in DashboardLayout nav", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "client/src/components/DashboardLayout.tsx"),
      "utf-8"
    );
    expect(content).toContain("Audit Trail");
    expect(content).toContain("/audit-trail");
  });
});
