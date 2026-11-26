#!/usr/bin/env node
/**
 * InsurePortal esbuild parse/bundle gate (HARD fail, no ratchet).
 *
 * 2026-11-26 (W23): Added after W22-B found a hard SyntaxError in
 * insureportal/server/routers/transactions.ts that survived on main
 * because NO workflow builds or typechecks insureportal/ (root tsconfig
 * excludes it; the root build targets the main server/; every workflow
 * "insureportal" mention was image/helm/k8s naming only). A per-file
 * esbuild parse of the same tree fails on exactly that class of defect,
 * so this gate makes SyntaxErrors unmergeable.
 *
 * What it does:
 *   1. Parse sweep: runs esbuild on every .ts/.tsx under
 *      insureportal/{server,client/src,shared,drizzle,tests,e2e}.
 *      ANY parse error fails the gate (exit 1). No baseline, no ratchet.
 *   2. Bundle gate: bundles insureportal/server/_core/index.ts exactly
 *      like the server half of `npm run build` (see insureportal/
 *      package.json: `esbuild server/_core/index.ts --platform=node
 *      --packages=external --bundle --format=esm`). ANY error fails.
 *
 * Sole exclusion — drizzle/relations.ts:
 *   insureportal/tsconfig.json already excludes it, and nothing imports
 *   it (verified by grep 2026-11-26 (W23)). It carries a real measured
 *   defect: duplicate `export const usersRelations` at lines 113 and 710
 *   (esbuild: "Multiple exports with the same name"). It is drizzle-kit
 *   generated dead code; sweeping it would hard-fail CI on a file the
 *   project itself does not build or typecheck. The exclusion is
 *   documented here rather than silently widening the tsconfig hole.
 *
 * Exit 2 = infrastructure failure (esbuild missing/crashed). Exit 2 is a
 * CI failure too: a missing esbuild must NEVER masquerade as "0 errors".
 *
 * Usage:
 *   node scripts/check-insureportal-parse.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ipRoot = join(root, "insureportal");

// 2026-11-26 (W23): sole exclusion, documented in the header comment.
const EXCLUDED = new Set(["drizzle/relations.ts"]);

const SWEEP_DIRS = ["server", join("client", "src"), "shared", "drizzle", "tests", "e2e"];

// Resolve insureportal's own lockfile-pinned esbuild (devDependency, so the
// gate is faithful to insureportal/package-lock.json), not whatever happens
// to be on PATH.
const require = createRequire(join(ipRoot, "package.json"));
let esbuildBin;
try {
  const pkgJson = require.resolve("esbuild/package.json");
  esbuildBin = join(dirname(pkgJson), "bin", "esbuild");
  // Optional dependency hoisting can place the binary package differently;
  // the bin/esbuild JS shim always exists in the esbuild package itself.
} catch (err) {
  console.error(`check-insureportal-parse: cannot resolve esbuild from insureportal: ${err.message}`);
  console.error("Run `npm ci` in insureportal/ first (CI does this).");
  process.exit(2);
}
if (!existsSync(esbuildBin)) {
  console.error(`check-insureportal-parse: esbuild binary missing at ${esbuildBin}`);
  process.exit(2);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if ([".ts", ".tsx"].includes(extname(entry))) yield full;
  }
}

// ── Phase 1: per-file parse sweep ──────────────────────────────────────
const failures = [];
let swept = 0;
for (const dir of SWEEP_DIRS) {
  const abs = join(ipRoot, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = relative(ipRoot, file).split("\\").join("/");
    if (EXCLUDED.has(rel)) continue;
    swept++;
    const run = spawnSync(esbuildBin, [file, "--outfile=/dev/null", "--log-level=error"], {
      cwd: ipRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (run.error || run.signal) {
      console.error(`check-insureportal-parse: esbuild crashed on ${rel} (signal=${run.signal})`);
      process.exit(2);
    }
    if (run.status !== 0) {
      failures.push(rel);
      console.error(`PARSE FAIL: ${rel}`);
      if (run.stderr) console.error(run.stderr.slice(0, 2000));
    }
  }
}
console.log(`check-insureportal-parse: swept ${swept} file(s), ${failures.length} parse failure(s)`);
if (swept === 0) {
  console.error("check-insureportal-parse: 0 files swept — insureportal tree missing? Failing closed.");
  process.exit(2);
}
if (failures.length > 0) {
  console.error(
    `FAIL: ${failures.length} file(s) under insureportal/ have hard parse errors. ` +
      `This is the W22-B defect class (SyntaxError on main) — there is no ratchet; fix the syntax.`
  );
  process.exit(1);
}

// ── Phase 2: server bundle gate (mirrors `npm run build` server half) ──
const outdir = mkdtempSync(join(tmpdir(), "ip-esbuild-"));
const bundle = spawnSync(
  esbuildBin,
  [
    join("server", "_core", "index.ts"),
    "--platform=node",
    "--packages=external",
    "--bundle",
    "--format=esm",
    `--outdir=${outdir}`,
  ],
  { cwd: ipRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
if (bundle.error || bundle.signal) {
  console.error(`check-insureportal-parse: bundle esbuild crashed (signal=${bundle.signal})`);
  process.exit(2);
}
const errors = ((bundle.stderr || "").match(/\[ERROR\]/g) || []).length;
if (bundle.status !== 0 || errors > 0) {
  console.error(`FAIL: server bundle of insureportal/server/_core/index.ts produced ${errors} error(s):`);
  console.error((bundle.stderr || "").slice(0, 6000));
  process.exit(1);
}
console.log("check-insureportal-parse: server bundle gate OK (0 errors)");
console.log("OK: insureportal parse/bundle gate passed.");
process.exit(0);
