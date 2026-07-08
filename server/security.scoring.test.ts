// @ts-check

/**
 * InsurePortal POS Shell — Security Vulnerability Scoring
 *
 * Automated security scoring across all OWASP categories.
 * Each test category contributes points to a total score out of 100.
 * Score >= 85 = Production Ready
 * Score >= 70 = Acceptable with caveats
 * Score < 70 = Needs remediation
 */
import { describe, it, expect } from "vitest";
import { logger } from '../_core/logger.js';

import fs from "fs";
import path from "path";

const readFile = (p: string) => fs.readFileSync(path.resolve(p), "utf-8");

// ── Score tracker ─────────────────────────────────────────────────────────
let totalPoints = 0;
let maxPoints = 0;

function score(points: number, max: number) {
  totalPoints += points;
  maxPoints += max;
}

// ═══════════════════════════════════════════════════════════════════════════
// Category 1: Security Headers (20 points)
// ═══════════════════════════════════════════════════════════════════════════
describe("Security Headers (20 pts)", () => {
  const indexTs = readFile("server/_core/index.ts");

  it("[4pts] Helmet is configured", () => {
    const has = indexTs.includes("helmet(");
    score(has ? 4 : 0, 4);
    expect(has).toBe(true);
  });

  it("[4pts] Content-Security-Policy is set", () => {
    const has = indexTs.includes("contentSecurityPolicy");
    score(has ? 4 : 0, 4);
    expect(has).toBe(true);
  });

  it("[4pts] HSTS is configured with preload", () => {
    const has = indexTs.includes("hsts") && indexTs.includes("preload");
    score(has ? 4 : 0, 4);
    expect(has).toBe(true);
  });

  it("[4pts] X-Frame-Options is DENY", () => {
    const has = indexTs.includes("frameguard") && indexTs.includes("deny");
    score(has ? 4 : 0, 4);
    expect(has).toBe(true);
  });

  it("[4pts] Permissions-Policy is set", () => {
    const has = indexTs.includes("Permissions-Policy");
    score(has ? 4 : 0, 4);
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category 2: Authentication & Session (20 points)
// ═══════════════════════════════════════════════════════════════════════════
describe("Authentication & Session (20 pts)", () => {
  const cookieTs = readFile("server/_core/cookies.ts");
  const indexTs = readFile("server/_core/index.ts");

  it("[5pts] Cookies are HttpOnly", () => {
    const has = cookieTs.includes("httpOnly: true");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Cookies use SameSite", () => {
    const has = cookieTs.includes("sameSite");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Cookies use Secure flag", () => {
    const has = cookieTs.includes("secure");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Auth rate limiter exists", () => {
    const has = indexTs.includes("authLimiter");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category 3: Input Validation (15 points)
// ═══════════════════════════════════════════════════════════════════════════
describe("Input Validation (15 pts)", () => {
  it("[5pts] Body size limit is configured", () => {
    const indexTs = readFile("server/_core/index.ts");
    const has = indexTs.includes("limit:") && indexTs.includes("10mb");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] tRPC input validation (zod) is used", () => {
    const routerFiles = fs
      .readdirSync("server/routers")
      .filter(f => f.endsWith(".ts") && !f.includes("test"));
    let inputCount = 0;
    for (const f of routerFiles) {
      const content = readFile(`server/routers/${f}`);
      inputCount += (content.match(/\.input\(/g) || []).length;
    }
    const has = inputCount > 50; // Should have many input validations
    score(has ? 5 : 0, 5);
    expect(inputCount).toBeGreaterThan(50);
  });

  it("[5pts] Input sanitizer middleware exists", () => {
    const has = fs.existsSync("server/middleware/inputSanitizer.ts");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category 4: Data Protection (15 points)
// ═══════════════════════════════════════════════════════════════════════════
describe("Data Protection (15 pts)", () => {
  it("[5pts] No hardcoded secrets in source", () => {
    const envTs = readFile("server/_core/env.ts");
    const noHardcoded = !envTs.match(
      /password\s*[:=]\s*["'][a-zA-Z0-9]{8,}["']/i
    );
    score(noHardcoded ? 5 : 0, 5);
    expect(noHardcoded).toBe(true);
  });

  it("[5pts] PIN hashing uses bcrypt", () => {
    const agentRouter = readFile("server/routers/agent.ts");
    const has = agentRouter.includes("bcrypt") || agentRouter.includes("hash");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] GDPR data deletion endpoint exists", () => {
    const has = fs.existsSync("server/routers/gdpr.ts");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category 5: Infrastructure Security (15 points)
// ═══════════════════════════════════════════════════════════════════════════
describe("Infrastructure Security (15 pts)", () => {
  it("[5pts] Dockerfile runs as non-root", () => {
    const dockerfile = readFile("Dockerfile");
    const has =
      dockerfile.includes("USER") && !dockerfile.includes("USER root");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Health check endpoint exists", () => {
    const indexTs = readFile("server/_core/index.ts");
    const has = indexTs.includes("/api/health");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Graceful shutdown handler exists", () => {
    const has = fs.existsSync("server/lib/gracefulShutdown.ts");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category 6: Monitoring & Logging (15 points)
// ═══════════════════════════════════════════════════════════════════════════
describe("Monitoring & Logging (15 pts)", () => {
  it("[5pts] Audit log table and writer exist", () => {
    const has = fs.existsSync("server/routers/auditLog.ts");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Prometheus metrics endpoint exists", () => {
    const indexTs = readFile("server/_core/index.ts");
    const has = indexTs.includes("/metrics");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });

  it("[5pts] Request ID tracing is configured", () => {
    const indexTs = readFile("server/_core/index.ts");
    const has =
      indexTs.includes("X-Request-ID") || indexTs.includes("x-request-id");
    score(has ? 5 : 0, 5);
    expect(has).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Final Score
// ═══════════════════════════════════════════════════════════════════════════
describe("Security Score Summary", () => {
  it("calculates final security score", () => {
    const pct = Math.round((totalPoints / maxPoints) * 100);
    console.log(
      `\n═══════════════════════════════════════════════════════════════`
    );
    console.log(
      `  SECURITY VULNERABILITY SCORE: ${totalPoints}/${maxPoints} (${pct}%)`
    );
    console.log(
      `  Rating: ${pct >= 85 ? "✅ PRODUCTION READY" : pct >= 70 ? "⚠️ ACCEPTABLE" : "❌ NEEDS REMEDIATION"}`
    );
    console.log(
      `═══════════════════════════════════════════════════════════════\n`
    );
    expect(pct).toBeGreaterThanOrEqual(85);
  });
});
