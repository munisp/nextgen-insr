/**
 * noMockDataGuard.test.tsx — source-level regression guard for the PR #114
 * page fixes (fabricated dashboard data removal).
 *
 * Asserts the high-risk page sources contain NO mock-data constants or
 * random data generators. This is a grep-style guard: it reads the actual
 * page source files and fails if known fabrication patterns reappear.
 *
 * Allowed and deliberately NOT flagged:
 *   - zero-filled placeholder series (e.g. FraudDashboard's fallbackHourly,
 *     which is 24 hours of honest zeros, explicitly derived with alerts: 0)
 *   - "mock" inside SECURITY comments describing SQL display strings
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const GUARDED_PAGES = [
  "client/src/pages/FraudDashboard.tsx",
  "client/src/pages/BillingAnalyticsDashboardPage.tsx",
  "client/src/pages/AgentFloatForecasting.tsx",
  "client/src/pages/SystemHealth.tsx",
];

// Patterns that indicate fabricated data in page code. Each is a
// case-sensitive token that must not appear outside of comments.
const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "MOCK_ constants", re: /\bMOCK_[A-Z0-9_]+\b/ },
  { name: "mockEvents/mockData variables", re: /\bmock(?:Events|Data|Alerts|Metrics|Forecast)\b/ },
  { name: "SEED_ constants", re: /\bSEED_[A-Z0-9_]+\b/ },
  { name: "DUMMY_ constants", re: /\bDUMMY_[A-Z0-9_]+\b/ },
  { name: "Math.random data fabrication", re: /Math\.random\(/ },
  { name: "faker usage", re: /\bfaker\b/ },
  { name: "hardcoded sample arrays", re: /\bSAMPLE_[A-Z0-9_]+\b/ },
];

/** Strip line and block comments so SECURITY banners can't false-positive. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("no-mock-data guard (PR #114 regression)", () => {
  for (const page of GUARDED_PAGES) {
    it(`${page} contains no mock-data constants or generators`, () => {
      const source = stripComments(
        readFileSync(path.join(repoRoot, page), "utf8")
      );
      for (const { name, re } of BANNED_PATTERNS) {
        const match = source.match(re);
        expect(
          match,
          `${page} contains banned pattern "${name}": ${match?.[0]}`
        ).toBeNull();
      }
    });
  }

  it("guarded page files exist (guard cannot silently vacate)", () => {
    for (const page of GUARDED_PAGES) {
      const source = readFileSync(path.join(repoRoot, page), "utf8");
      expect(source.length).toBeGreaterThan(1000);
    }
  });
});
