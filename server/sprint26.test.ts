import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function fileExists(path: string) {
  return existsSync(join(ROOT, path));
}

function readFile(path: string) {
  try {
    return readFileSync(join(ROOT, path), "utf-8");
  } catch {
    return "";
  }
}

describe("Sprint 26: Final Production Completion", () => {
  // ─── Grafana Dashboards ───
  describe("Grafana Dashboards", () => {
    it("should have Grafana provisioning datasource config", () => {
      expect(
        fileExists("infra/grafana/provisioning/datasources/prometheus.yml")
      ).toBe(true);
    });

    it("should have Grafana dashboard provisioning config", () => {
      expect(
        fileExists("infra/grafana/provisioning/dashboards/dashboards.yml")
      ).toBe(true);
    });

    it("should have POS Operations dashboard", () => {
      expect(fileExists("infra/grafana/dashboards/field-operations.json")).toBe(
        true
      );
      const content = readFile("infra/grafana/dashboards/field-operations.json");
      const parsed = JSON.parse(content);
      expect(parsed.title).toContain("POS Operations");
      expect(parsed.panels.length).toBeGreaterThan(0);
    });

    it("should have Fraud Detection dashboard", () => {
      expect(fileExists("infra/grafana/dashboards/fraud-detection.json")).toBe(
        true
      );
      const content = readFile("infra/grafana/dashboards/fraud-detection.json");
      const parsed = JSON.parse(content);
      expect(parsed.title).toContain("Fraud Detection");
    });

    it("should have Agent Performance dashboard", () => {
      expect(
        fileExists("infra/grafana/dashboards/agent-performance.json")
      ).toBe(true);
    });

    it("should have System Health dashboard", () => {
      expect(fileExists("infra/grafana/dashboards/system-health.json")).toBe(
        true
      );
    });
  });

  // ─── OpenAPI Specification ───
  describe("OpenAPI Specification", () => {
    it("should have OpenAPI spec file", () => {
      expect(fileExists("docs/openapi.json")).toBe(true);
    });

    it("should be valid OpenAPI 3.0", () => {
      const content = readFile("docs/openapi.json");
      const parsed = JSON.parse(content);
      expect(parsed.openapi).toBe("3.0.3");
      expect(parsed.info.title).toBeDefined();
      expect(parsed.paths).toBeDefined();
    });

    it("should have at least 10 API paths", () => {
      const content = readFile("docs/openapi.json");
      const parsed = JSON.parse(content);
      expect(Object.keys(parsed.paths).length).toBeGreaterThanOrEqual(10);
    });
  });

  // ─── Email Delivery Service ───
  describe("Email Delivery Service", () => {
    it("should have email delivery service file", () => {
      expect(fileExists("server/lib/emailDelivery.ts")).toBe(true);
    });

    it("should support multiple email templates", () => {
      const content = readFile("server/lib/emailDelivery.ts");
      expect(content).toContain("sendEmail");
      expect(content).toContain("subject");
    });
  });

  // ─── Prometheus Alerts ───
  describe("Prometheus Alerts", () => {
    it("should have Prometheus alerting rules", () => {
      expect(fileExists("infra/monitoring/prometheus-alerts.yml")).toBe(true);
    });

    it("should have POS-specific alert rules", () => {
      const content = readFile("infra/monitoring/prometheus-alerts.yml");
      expect(content).toContain("alert:");
      expect(content).toContain("expr:");
    });
  });

  // ─── ProactiveHelp + Chat Integration ───
  describe("ProactiveHelp + Chat Integration", () => {
    it("should have ProactiveHelp component", () => {
      expect(fileExists("client/src/components/ProactiveHelp.tsx")).toBe(true);
    });

    it("should dispatch events to LiveChatWidget", () => {
      const content = readFile("client/src/components/ProactiveHelp.tsx");
      expect(content).toContain("proactive-help-chat");
      expect(content).toContain("CustomEvent");
    });

    it("should have LiveChatWidget listening for proactive events", () => {
      const content = readFile("client/src/components/LiveChatWidget.tsx");
      expect(content).toContain("proactive-help-chat");
    });
  });

  // ─── VideoTutorials Search ───
  describe("VideoTutorials Search", () => {
    it("should have VideoTutorials page", () => {
      expect(fileExists("client/src/pages/VideoTutorials.tsx")).toBe(true);
    });

    it("should have search functionality", () => {
      const content = readFile("client/src/pages/VideoTutorials.tsx");
      expect(content).toContain("search");
      expect(content).toContain("filter");
    });

    it("should have difficulty filter", () => {
      const content = readFile("client/src/pages/VideoTutorials.tsx");
      expect(content).toContain("difficulty");
    });
  });

  // ─── Feedback Analytics ───
  describe("Feedback Analytics", () => {
    it("should have FeedbackAnalytics page", () => {
      expect(fileExists("client/src/pages/FeedbackAnalytics.tsx")).toBe(true);
    });

    it("should show satisfaction metrics", () => {
      const content = readFile("client/src/pages/FeedbackAnalytics.tsx");
      expect(content).toContain("satisfaction");
    });

    it("should have route in App.tsx", () => {
      const content = readFile("client/src/App.tsx");
      expect(content).toContain("FeedbackAnalytics");
      expect(content).toContain("feedback-analytics");
    });
  });

  // ─── Kubernetes Manifests ───
  describe("Kubernetes Manifests", () => {
    it("should have K8s deployment manifest", () => {
      expect(fileExists("infra/k8s/deployment.yaml")).toBe(true);
    });

    it("should have K8s secrets template", () => {
      expect(fileExists("infra/k8s/secrets.yaml")).toBe(true);
    });

    it("should use non-root user in deployment", () => {
      const content = readFile("infra/k8s/deployment.yaml");
      expect(content).toContain("runAsNonRoot: true");
    });

    it("should have resource limits", () => {
      const content = readFile("infra/k8s/deployment.yaml");
      expect(content).toContain("resources:");
      expect(content).toContain("limits:");
    });

    it("should have health probes", () => {
      const content = readFile("infra/k8s/deployment.yaml");
      expect(content).toContain("livenessProbe:");
      expect(content).toContain("readinessProbe:");
    });

    it("should have HPA for autoscaling", () => {
      const content = readFile("infra/k8s/deployment.yaml");
      expect(content).toContain("HorizontalPodAutoscaler");
    });

    it("should have PodDisruptionBudget", () => {
      const content = readFile("infra/k8s/deployment.yaml");
      expect(content).toContain("PodDisruptionBudget");
    });
  });

  // ─── Request Tracing & Security Middleware ───
  describe("Request Tracing & Security Middleware", () => {
    it("should have request tracing middleware", () => {
      expect(fileExists("server/lib/requestTracing.ts")).toBe(true);
    });

    it("should add security headers", () => {
      const content = readFile("server/lib/requestTracing.ts");
      expect(content).toContain("X-Content-Type-Options");
      expect(content).toContain("X-Frame-Options");
      expect(content).toContain("Strict-Transport-Security");
    });

    it("should add request ID tracing", () => {
      const content = readFile("server/lib/requestTracing.ts");
      expect(content).toContain("X-Request-ID");
    });

    it("should sanitize input", () => {
      const content = readFile("server/lib/requestTracing.ts");
      expect(content).toContain("sanitizeInput");
    });
  });

  // ─── Enhanced Seed Data ───
  describe("Enhanced Seed Data", () => {
    it("should have Sprint 26 seed script", () => {
      expect(fileExists("scripts/seed-sprint26.mjs")).toBe(true);
    });
  });

  // ─── Security Audit ───
  describe("Security Audit v2", () => {
    it("should have security audit v2 script", () => {
      expect(fileExists("scripts/security-audit-v2.mjs")).toBe(true);
    });

    it("should cover 10 security categories", () => {
      const content = readFile("scripts/security-audit-v2.mjs");
      expect(content).toContain("Authentication");
      expect(content).toContain("Input Validation");
      expect(content).toContain("API Security");
      expect(content).toContain("Data Protection");
      expect(content).toContain("Infrastructure");
      expect(content).toContain("Dependency");
      expect(content).toContain("Code Quality");
      expect(content).toContain("Session Management");
      expect(content).toContain("Error Handling");
      expect(content).toContain("Logging");
    });
  });
});
