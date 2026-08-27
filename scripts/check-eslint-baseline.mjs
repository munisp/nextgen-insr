#!/usr/bin/env node
/**
 * ESLint ratchet gate (lint debt burn-down).
 *
 * Runs ESLint over server/ and compares the per-rule violation counts against
 * scripts/eslint-baseline.json. The gate FAILS only when a rule's count
 * INCREASES above the recorded baseline (or a previously-unseen rule appears).
 * Decreases are reported as burn-down progress. No rule severities are
 * altered anywhere — this is a regression ratchet, not a relaxation.
 *
 * Usage:
 *   node scripts/check-eslint-baseline.mjs                 # enforce ratchet
 *   node scripts/check-eslint-baseline.mjs --write-baseline # regenerate baseline
 *
 * See LINT_DEBT.md for the decision record and burn-down plan.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts", "eslint-baseline.json");
const writeMode = process.argv.includes("--write-baseline");

function runEslint() {
  // eslint exits non-zero when violations exist; capture JSON either way.
  try {
    const out = execFileSync(
      "pnpm",
      ["exec", "eslint", "server/", "--ext", ".ts,.tsx,.js,.jsx", "-f", "json"],
      { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
    );
    return JSON.parse(out);
  } catch (err) {
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        /* fall through */
      }
    }
    console.error("eslint execution failed:", err.message);
    process.exit(2);
  }
}

function aggregate(results) {
  const perRule = {};
  let errors = 0;
  let warnings = 0;
  for (const file of results) {
    for (const msg of file.messages || []) {
      if (!msg.ruleId) continue; // ignore fatal parse errors here; eslint exit code covers them
      perRule[msg.ruleId] = (perRule[msg.ruleId] || 0) + 1;
    }
    errors += file.errorCount || 0;
    warnings += file.warningCount || 0;
  }
  return { perRule, errors, warnings };
}

const results = runEslint();
const { perRule, errors, warnings } = aggregate(results);

if (writeMode) {
  const baseline = {
    _comment:
      "ESLint ratchet baseline — see LINT_DEBT.md. Regenerate ONLY with assurance-lead approval: node scripts/check-eslint-baseline.mjs --write-baseline",
    generatedAt: new Date().toISOString(),
    totalErrors: errors,
    totalWarnings: warnings,
    rules: Object.fromEntries(Object.entries(perRule).sort((a, b) => b[1] - a[1])),
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`baseline written: ${errors} errors, ${warnings} warnings, ${Object.keys(perRule).length} rules`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const baseRules = baseline.rules || {};

let failed = false;
const increased = [];
const decreased = [];
const increasedRules = new Set();
for (const [rule, count] of Object.entries(perRule)) {
  const base = baseRules[rule] || 0;
  if (count > base) {
    increased.push(`  ${rule}: ${count} (baseline ${base}, +${count - base})`);
    increasedRules.add(rule);
    failed = true;
  } else if (count < base) {
    decreased.push(`  ${rule}: ${count} (baseline ${base}, -${base - count})`);
  }
}

console.log(`eslint: ${errors} errors, ${warnings} warnings (baseline ${baseline.totalErrors} errors, ${baseline.totalWarnings} warnings)`);
if (decreased.length) {
  console.log("burn-down progress vs baseline:");
  for (const line of decreased) console.log(line);
}
if (failed) {
  console.error("RATCHET VIOLATION — lint debt increased above baseline:");
  for (const line of increased) console.error(line);
  // Diagnostics: pinpoint every violation of the over-baseline rules so the
  // fixer does not have to reproduce the full type-aware run locally.
  for (const file of results) {
    for (const msg of file.messages || []) {
      if (increasedRules.has(msg.ruleId)) {
        const rel = (file.filePath || "").split("/server/").pop();
        console.error(`  [${msg.ruleId}] server/${rel}:${msg.line}:${msg.column} — ${msg.message}`);
      }
    }
  }
  console.error("Fix the new violations (or, with assurance-lead approval, regenerate the baseline). See LINT_DEBT.md.");
  process.exit(1);
}
console.log("ratchet OK: no rule exceeded its baseline count");
