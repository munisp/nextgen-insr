/**
 * actuaryDrizzleGenerate.test.ts — W34-D (2026-11-28) schema-generation
 * acceptance test for the actuary drizzle/schema.ts additions.
 *
 * Design acceptance (Appendix H, Leg D): "schema additions pass drizzle-kit
 * generate idempotency (re-generation = empty diff)".
 *
 * IMPORTANT CONTEXT (documented discrepancy): insureportal/drizzle.config.ts
 * points at ./shared/schema.ts but the LIVE schema is
 * insureportal/drizzle/schema.ts (design §10 open decision #2 — W33 scope,
 * deliberately NOT fixed here). This test therefore invokes drizzle-kit with
 * explicit CLI flags against drizzle/schema.ts directly, bypassing the
 * stale config, exactly like the hand-authored 0047/0048/0049 migrations do.
 *
 * Asserts:
 *   1. A first `drizzle-kit generate` against drizzle/schema.ts into a
 *      scratch output dir emits SQL containing all 12 actuary tables
 *      (proves the new definitions are generate-consistent — types, enums,
 *      FK references, index objects all parse).
 *   2. A SECOND generate against the same output dir is an EMPTY diff
 *      ("No schema changes, nothing to migrate") — re-generation is
 *      idempotent.
 *
 * The scratch dir lives inside insureportal (drizzle-kit 0.31.x mishandles
 * absolute --out paths; verified 2026-11-28) and is removed after the run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IP_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(IP_ROOT, "tests", ".tmp-actuary-dk");
const DRIZZLE_KIT = path.join(IP_ROOT, "node_modules", ".bin", "drizzle-kit");

const ACTUARY_TABLES = [
  "act_product_lines",
  "act_rate_versions",
  "act_rating_tables",
  "act_assumption_sets",
  "act_reserve_runs",
  "act_capital_runs",
  "act_referrals",
  "act_referral_rules",
  "act_exposure_limits",
  "act_accumulation_cells",
  "act_adequacy_alerts",
  "act_model_registry",
];

function generate(): string {
  return execFileSync(
    process.execPath,
    [
      DRIZZLE_KIT,
      "generate",
      "--schema=./drizzle/schema.ts",
      `--out=${path.relative(IP_ROOT, OUT_DIR)}`,
      "--dialect=postgresql",
    ],
    { cwd: IP_ROOT, encoding: "utf8", timeout: 300_000 }
  );
}

function sqlFiles(): string[] {
  return fs
    .readdirSync(OUT_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();
}

beforeAll(() => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("W34-D: drizzle-kit generate over the actuary schema additions", () => {
  it("first generate emits SQL containing all 12 actuary tables", () => {
    const out = generate();
    const files = sqlFiles();
    expect(files.length).toBe(1);
    const sql = fs.readFileSync(path.join(OUT_DIR, files[0]), "utf8");
    for (const t of ACTUARY_TABLES) {
      expect(sql, `generated SQL missing CREATE TABLE "${t}"`).toContain(
        `CREATE TABLE "${t}"`
      );
    }
    expect(out).toContain("Your SQL migration file");
  });

  it("second generate is an EMPTY diff (re-generation idempotency)", () => {
    const out = generate();
    expect(out).toContain("No schema changes, nothing to migrate");
    // Still exactly one migration file — no new SQL was emitted.
    expect(sqlFiles().length).toBe(1);
  });
});
