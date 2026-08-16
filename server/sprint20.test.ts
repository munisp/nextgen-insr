/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUARANTINED-OPEN-DEFECT — genuine defect / partial delivery (fix routing in progress) — 2026-08-16 (assurance-lead approved; see tests/QUARANTINE.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * REASON: structural assertions on delivered code.
 * EVIDENCE: run 31969739386.
 * RE-ENABLE CONDITION: Reconciled (F-12).
 * NO assertion in this file has been modified or deleted — it runs as-is the
 * day the re-enable condition is met. Excluded from the default vitest run via
 * vitest.config.ts (config-level, auditable in one place).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from "vitest";
import {
  checkDbHealth,
  getLastHealthStatus,
  getHealthHistory,
  withRetry,
  getAverageLatency,
  getUptimePercentage,
} from "./lib/dbHealthCheck";

// ── DB Health Check Tests ───────────────────────────────────────────────────

describe("Database Health Check", () => {
  it("should return a valid health status", async () => {
    const status = await checkDbHealth();
    expect(status).toBeDefined();
    expect(status.connected).toBe(true);
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    expect(status.lastChecked).toBeTruthy();
    expect(status.version).toBe("PostgreSQL 16.2");
    expect(status.errors).toHaveLength(0);
  });

  it("should track health history", async () => {
    await checkDbHealth();
    await checkDbHealth();
    const history = getHealthHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[history.length - 1].connected).toBe(true);
  });

  it("should calculate average latency", async () => {
    await checkDbHealth();
    const avg = getAverageLatency();
    expect(avg).toBeGreaterThanOrEqual(0);
  });

  it("should calculate uptime percentage", async () => {
    await checkDbHealth();
    const uptime = getUptimePercentage();
    expect(uptime).toBeGreaterThanOrEqual(0);
    expect(uptime).toBeLessThanOrEqual(100);
  });

  it("should get last health status", () => {
    const status = getLastHealthStatus();
    expect(status).toBeDefined();
    expect(typeof status.connected).toBe("boolean");
  });
});

// ── Retry Logic Tests ───────────────────────────────────────────────────────

describe("withRetry", () => {
  it("should succeed on first attempt", async () => {
    const result = await withRetry(async () => "success");
    expect(result).toBe("success");
  });

  it("should retry on failure and eventually succeed", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary failure");
        return "recovered";
      },
      { maxRetries: 5, baseDelayMs: 10 }
    );
    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("should throw after max retries exhausted", async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error("permanent failure");
        },
        { maxRetries: 2, baseDelayMs: 10 }
      )
    ).rejects.toThrow("permanent failure");
  });
});

// ── GitHub Actions Workflow Validation ───────────────────────────────────────

describe("CI/CD Configuration", () => {
  it("should have GitHub Actions workflow file", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const workflowPath = path.resolve(
      import.meta.dirname,
      "../.github/workflows/e2e-playwright.yml"
    );
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, "utf-8");
    expect(content).toContain("Playwright");
    expect(content).toContain("postgres");
    expect(content).toContain("redis");
    expect(content).toContain("pnpm db:push");
    expect(content).toContain("seed-comprehensive");
    expect(content).toContain("npx playwright test");
  });

  it("should have Playwright config", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const configPath = path.resolve(
      import.meta.dirname,
      "../playwright.config.ts"
    );
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("should have E2E test specs", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const e2eDir = path.resolve(import.meta.dirname, "../e2e");
    expect(fs.existsSync(e2eDir)).toBe(true);
    const files = fs
      .readdirSync(e2eDir)
      .filter((f: string) => f.endsWith(".spec.ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
});

// ── Notification Context Tests ──────────────────────────────────────────────

describe("Notification Infrastructure", () => {
  it("should have NotificationContext provider", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const ctxPath = path.resolve(
      import.meta.dirname,
      "../client/src/contexts/NotificationContext.tsx"
    );
    expect(fs.existsSync(ctxPath)).toBe(true);
    const content = fs.readFileSync(ctxPath, "utf-8");
    expect(content).toContain("NotificationProvider");
    expect(content).toContain("useNotificationContext");
    expect(content).toContain("useRealtimeNotifications");
  });

  it("should have real-time notifications hook", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const hookPath = path.resolve(
      import.meta.dirname,
      "../client/src/hooks/useRealtimeNotifications.tsx"
    );
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("ConnectionStatusBadge");
    expect(content).toContain("useRealtimeNotifications");
    expect(content).toContain("socket.io");
  });

  it("should have NotificationProvider wired in main.tsx", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const mainPath = path.resolve(
      import.meta.dirname,
      "../client/src/main.tsx"
    );
    const content = fs.readFileSync(mainPath, "utf-8");
    expect(content).toContain("NotificationProvider");
  });
});
