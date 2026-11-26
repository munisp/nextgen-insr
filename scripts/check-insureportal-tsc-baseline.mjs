#!/usr/bin/env node
/**
 * InsurePortal TypeScript error-count ratchet gate.
 *
 * 2026-11-26 (W23): Added with the insureportal CI coverage job after
 * W22-B proved no workflow typechecks insureportal/ (root tsconfig
 * excludes it; scripts/check-tsc-baseline.mjs only covers the ROOT
 * tsconfig). This is the same ratchet pattern as
 * scripts/check-tsc-baseline.mjs (W18), pointed at insureportal/:
 * it runs `tsc --noEmit --pretty false` with insureportal's own
 * lockfile-pinned TypeScript (5.9.3) against insureportal/tsconfig.json,
 * counts `error TS` lines, and compares against
 * scripts/insureportal-tsc-baseline.json.
 *
 * Ratchet semantics (mirror scripts/check-tsc-baseline.mjs):
 *   - count  > baseline.errorCount  -> FAIL (exit 1): regression.
 *   - count == baseline.errorCount  -> PASS (exit 0).
 *   - count  < baseline.errorCount  -> PASS (exit 0) and prints an
 *     instruction to lower the baseline. The baseline may only shrink,
 *     and any lowering must carry a dated comment in the commit.
 *
 * The baseline is MEASURED, not aspirational: insureportal carries real
 * pre-existing type debt (see scripts/insureportal-tsc-baseline.json for
 * the exact measured count and command). The ratchet prevents
 * regressions while the hard parse gate
 * (scripts/check-insureportal-parse.mjs) catches SyntaxError-class
 * defects. Do NOT raise the baseline.
 *
 * Exit 2 = infrastructure failure (baseline unreadable, tsc crashed or
 * was killed, deps not installed). Exit 2 is a CI failure too: a crashed
 * tsc must NEVER be miscounted as "0 errors".
 *
 * Usage:
 *   node scripts/check-insureportal-tsc-baseline.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ipRoot = join(root, "insureportal");
const baselinePath = join(root, "scripts", "insureportal-tsc-baseline.json");

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (err) {
  console.error(`check-insureportal-tsc-baseline: cannot read ${baselinePath}: ${err.message}`);
  process.exit(2);
}
if (typeof baseline.errorCount !== "number" || baseline.errorCount < 0) {
  console.error("check-insureportal-tsc-baseline: baseline.errorCount missing or invalid");
  process.exit(2);
}

// Resolve insureportal's own lockfile-pinned TypeScript (5.9.3 per
// insureportal/package-lock.json), so the gate is faithful to the
// compiler the insureportal build actually uses.
const require = createRequire(join(ipRoot, "package.json"));
let tscBin;
try {
  tscBin = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
} catch (err) {
  console.error(`check-insureportal-tsc-baseline: cannot resolve typescript from insureportal: ${err.message}`);
  console.error("Run `npm ci` in insureportal/ first (CI does this).");
  process.exit(2);
}

// Heap matches the root ratchet's CI NODE_OPTIONS value
// (--max-old-space-size=3072); full-program checks OOM with the default
// ~2 GB heap (W18 evidence).
const run = spawnSync(
  process.execPath,
  ["--max-old-space-size=3072", tscBin, "--noEmit", "--pretty", "false"],
  { cwd: ipRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env }
);

if (run.error || run.signal) {
  console.error(
    `check-insureportal-tsc-baseline: tsc execution failed ` +
      `(status=${run.status} signal=${run.signal} error=${run.error ? run.error.message : "none"})`
  );
  if (run.stderr) console.error(run.stderr.slice(0, 4000));
  process.exit(2);
}

const output = `${run.stdout || ""}\n${run.stderr || ""}`;
const lines = output.split("\n").filter((l) => /error TS\d+/.test(l));

// Mirror check-tsc-baseline.mjs fail-closed rule: if tsc exited NON-zero
// but emitted no parseable `error TS` lines, it crashed or was
// misconfigured; fail closed (exit 2) rather than miscounting a crash
// as "0 errors".
if (run.status !== 0 && lines.length === 0) {
  console.error(
    `check-insureportal-tsc-baseline: tsc exited ${run.status} without emitting any 'error TS' ` +
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
  `check-insureportal-tsc-baseline: tsc --noEmit -> ${count} error(s); ` +
    `baseline=${baseline.errorCount}; delta=${delta >= 0 ? "+" : ""}${delta}` +
    (codeSummary ? `; byCode ${codeSummary}` : "")
);

if (delta > 0) {
  console.error(
    `FAIL: insureportal TypeScript error count regressed by +${delta} above the ratchet ` +
      `baseline (${baseline.errorCount}). Fix the new errors; do NOT raise the baseline ` +
      `without a dated comment and assurance-lead approval.`
  );
  for (const l of lines.slice(0, 25)) console.error(`  ${l}`);
  process.exit(1);
}

if (delta < 0) {
  console.log(
    `OK (ratchet down available): error count improved by ${-delta}. ` +
      `Lower scripts/insureportal-tsc-baseline.json errorCount to ${count} in the same ` +
      `change, with a dated comment — the baseline may only shrink.`
  );
} else {
  console.log("OK: error count matches the ratchet baseline.");
}
process.exit(0);
