#!/usr/bin/env node
/**
 * TypeScript error-count ratchet gate.
 *
 * 2026-11-25 (W18): Added after the W18 census proved CI's `tsc --noEmit`
 * gate is legitimately green (0 errors) and that a husked local
 * node_modules could masquerade as 3,753 "source errors". This script
 * REPLACES the bare `pnpm exec tsc --noEmit` CI step: it runs the exact
 * same compiler invocation against the root tsconfig, counts `error TS`
 * lines, and compares against scripts/tsc-baseline.json.
 *
 * Ratchet semantics (mirror scripts/check-eslint-baseline.mjs):
 *   - count  > baseline.errorCount  -> FAIL (exit 1): regression.
 *   - count == baseline.errorCount  -> PASS (exit 0).
 *   - count  < baseline.errorCount  -> PASS (exit 0) and prints an
 *     instruction to lower the baseline. The baseline may only shrink,
 *     and any lowering must carry a dated comment in the commit.
 *
 * Exit 2 = infrastructure failure (baseline unreadable, tsc crashed or
 * was killed). Exit 2 is a CI failure too: a crashed tsc must NEVER be
 * miscounted as "0 errors".
 *
 * Usage:
 *   node scripts/check-tsc-baseline.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts", "tsc-baseline.json");

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (err) {
  console.error(`check-tsc-baseline: cannot read ${baselinePath}: ${err.message}`);
  process.exit(2);
}
if (typeof baseline.errorCount !== "number" || baseline.errorCount < 0) {
  console.error("check-tsc-baseline: baseline.errorCount missing or invalid");
  process.exit(2);
}

// Resolve the repo's own TypeScript (same binary `pnpm exec tsc` would run),
// so the gate is faithful to the lockfile-pinned compiler version.
const require = createRequire(join(root, "package.json"));
let tscBin;
try {
  tscBin = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
} catch (err) {
  console.error(`check-tsc-baseline: cannot resolve typescript: ${err.message}`);
  process.exit(2);
}

// Heap matches the CI NODE_OPTIONS value (--max-old-space-size=3072); the
// full-program check OOMs with the default ~2 GB heap (W18 evidence).
const run = spawnSync(
  process.execPath,
  ["--max-old-space-size=3072", tscBin, "--noEmit", "--pretty", "false"],
  { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env }
);

if (run.error || run.signal) {
  console.error(
    `check-tsc-baseline: tsc execution failed ` +
      `(status=${run.status} signal=${run.signal} error=${run.error ? run.error.message : "none"})`
  );
  if (run.stderr) console.error(run.stderr.slice(0, 4000));
  process.exit(2);
}

const output = `${run.stdout || ""}\n${run.stderr || ""}`;
const lines = output.split("\n").filter((l) => /error TS\d+/.test(l));

// 2026-11-25 (W18): TS 5.9 exits 0 (clean), 1 or 2 (diagnostics present —
// 2 occurs with incremental/noEmit builds). If tsc exited NON-zero but
// emitted no parseable `error TS` lines, it crashed or was misconfigured;
// fail closed (exit 2) rather than miscounting a crash as "0 errors".
if (run.status !== 0 && lines.length === 0) {
  console.error(
    `check-tsc-baseline: tsc exited ${run.status} without emitting any 'error TS' ` +
      `lines — treating as infrastructure failure, not a clean run.`
  );
  console.error(output.slice(0, 4000));
  process.exit(2);
}
const count = lines.length;
const byCode = {};
for (const l of lines) {
  const m = l.match(/error (TS\d+)/);
  if (m) byCode[m[1]] = (byCode[m[1]] || 0) + 1;
}
const codeSummary = Object.entries(byCode)
  .sort((a, b) => b[1] - a[1])
  .map(([c, n]) => `${c}:${n}`)
  .join(" ");

const delta = count - baseline.errorCount;
console.log(
  `check-tsc-baseline: tsc --noEmit -> ${count} error(s); ` +
    `baseline=${baseline.errorCount}; delta=${delta >= 0 ? "+" : ""}${delta}` +
    (codeSummary ? `; byCode ${codeSummary}` : "")
);

if (delta > 0) {
  console.error(
    `FAIL: TypeScript error count regressed by +${delta} above the ratchet baseline ` +
      `(${baseline.errorCount}). Fix the new errors; do NOT raise the baseline without ` +
      `a dated comment and assurance-lead approval.`
  );
  // Show the first few offending lines to make CI logs actionable.
  for (const l of lines.slice(0, 25)) console.error(`  ${l}`);
  process.exit(1);
}

if (delta < 0) {
  console.log(
    `OK (ratchet down available): error count improved by ${-delta}. ` +
      `Lower scripts/tsc-baseline.json errorCount to ${count} in the same change, ` +
      `with a dated comment — the baseline may only shrink.`
  );
} else {
  console.log("OK: error count matches the ratchet baseline.");
}
process.exit(0);
