#!/usr/bin/env node
/**
 * verify-claims.mjs — feature-claim manifest gate (finding F-10).
 *
 * Validates claims/claims.yaml:
 *   - unique stable IDs, known statuses, required fields
 *   - every `verified` claim has >= 1 evidence path, and every evidence path
 *     exists in the repo
 *   - every evidence path that is a test file (*.test.ts / *.spec.ts) is
 *     covered by an `include` glob in vitest.config.ts or
 *     vitest.integration.config.ts (i.e. the test is actually runnable, not
 *     orphaned)
 *   - every `incomplete` claim carries a non-empty `reason`
 *
 * Dependency-free by design (runs in CI before `pnpm install`): it parses the
 * constrained YAML subset used by claims/claims.yaml. If the manifest ever
 * needs richer YAML, swap the parser for js-yaml after install.
 *
 * Usage: node scripts/verify-claims.mjs
 * Exit:  0 = all claims consistent; 1 = stale/missing/invalid evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(REPO_ROOT, "claims", "claims.yaml");
const VITEST_CONFIGS = ["vitest.config.ts", "vitest.integration.config.ts"];

const failures = [];
const notes = [];
const fail = msg => failures.push(msg);

// ── Minimal YAML-subset parser ────────────────────────────────────────────────
// Supports exactly the claims.yaml shape:
//   top-level scalars, `claims:` list of maps, scalar values (optionally
//   double-quoted), and nested string lists (`evidence:`).
function parseManifest(text) {
  const lines = text.split("\n");
  const doc = { claims: [] };
  let current = null;
  let inClaims = false;
  let listKey = null;

  const unquote = v => {
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    return v;
  };

  for (const raw of lines) {
    const noComment = raw.replace(/(^|\s)#.*$/, "");
    if (!noComment.trim()) continue;
    const indent = noComment.length - noComment.trimStart().length;
    const line = noComment.trim();

    if (indent === 0) {
      listKey = null;
      if (line === "claims:") {
        inClaims = true;
      } else if (line.includes(":")) {
        inClaims = false;
        const [k, ...rest] = line.split(":");
        doc[k.trim()] = unquote(rest.join(":"));
      }
      continue;
    }

    if (!inClaims) continue;

    if (line.startsWith("- ")) {
      const body = line.slice(2);
      if (indent === 2) {
        // new claim item: "- id: CLAIM-001"
        current = {};
        doc.claims.push(current);
        listKey = null;
        const [k, ...rest] = body.split(":");
        current[k.trim()] = unquote(rest.join(":"));
      } else if (current && listKey) {
        current[listKey].push(unquote(body));
      }
      continue;
    }

    if (current && line.includes(":")) {
      const [k, ...rest] = line.split(":");
      const key = k.trim();
      const value = rest.join(":").trim();
      if (value === "") {
        current[key] = [];
        listKey = key;
      } else {
        current[key] = unquote(value);
        listKey = null;
      }
    }
  }
  return doc;
}

// ── Vitest include globs ──────────────────────────────────────────────────────
function collectTestGlobs() {
  const configs = [];
  for (const cfg of VITEST_CONFIGS) {
    const p = path.join(REPO_ROOT, cfg);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const grab = key => {
      const out = [];
      for (const m of text.matchAll(new RegExp(key + ":\\s*\\[([\\s\\S]*?)\\]", "g"))) {
        for (const s of m[1].matchAll(/"([^"]+)"/g)) out.push(s[1]);
      }
      return out;
    };
    configs.push({ config: cfg, include: grab("include"), exclude: grab("exclude") });
  }
  return configs;
}

function globToRegExp(glob) {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more path segments; trailing `**` matches all
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if ("\\^$.|+?()[]{}".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(MANIFEST)) {
  console.error(`verify-claims: manifest not found at ${path.relative(REPO_ROOT, MANIFEST)}`);
  process.exit(1);
}

const doc = parseManifest(fs.readFileSync(MANIFEST, "utf8"));
const claims = doc.claims;
if (!Array.isArray(claims) || claims.length === 0) {
  fail("manifest contains no claims");
}

const configs = collectTestGlobs().map(c => ({
  ...c,
  includeRe: c.include.map(g => ({ glob: g, re: globToRegExp(g) })),
  excludeRe: c.exclude.map(g => ({ glob: g, re: globToRegExp(g) })),
}));
if (configs.every(c => c.includeRe.length === 0)) {
  fail("no vitest include globs found — cannot validate test evidence");
}

// A test file is "registered" in a config iff it matches an include glob and
// is not excluded by that config's exclude globs.
function registrationFor(file) {
  for (const c of configs) {
    const inc = c.includeRe.find(g => g.re.test(file));
    if (!inc) continue;
    const exc = c.excludeRe.find(g => g.re.test(file));
    if (exc) continue;
    return { config: c.config, glob: inc.glob };
  }
  return null;
}

const seen = new Set();
let verifiedCount = 0;
let incompleteCount = 0;

for (const claim of claims) {
  const id = claim.id ?? "<missing id>";
  const where = `claim ${id}`;

  if (!claim.id || !/^CLAIM-\d{3,}$/.test(claim.id)) fail(`${where}: id missing or not CLAIM-NNN`);
  if (seen.has(claim.id)) fail(`${where}: duplicate id`);
  seen.add(claim.id);

  if (!claim.title) fail(`${where}: missing title`);
  if (!["verified", "incomplete"].includes(claim.status)) {
    fail(`${where}: status must be "verified" or "incomplete", got "${claim.status ?? ""}"`);
    continue;
  }

  if (claim.status === "incomplete") {
    incompleteCount++;
    if (!claim.reason) fail(`${where}: incomplete claim must carry a non-empty reason`);
  }

  if (claim.status === "verified") {
    verifiedCount++;
    if (!claim.verification) {
      fail(`${where}: verified claim must describe the executed verification (verification: field)`);
    }
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
    if (evidence.length === 0) {
      fail(`${where}: verified claim must cite at least one evidence path`);
    }
    for (const ev of evidence) {
      const abs = path.join(REPO_ROOT, ev);
      if (!fs.existsSync(abs)) {
        fail(`${where}: evidence path does not exist: ${ev}`);
        continue;
      }
      if (/\.(test|spec)\.ts$/.test(ev)) {
        const hit = registrationFor(ev);
        if (!hit) {
          fail(`${where}: test evidence ${ev} is not registered in any vitest config include (or is excluded) — it is orphaned and cannot run`);
        } else {
          notes.push(`${id}: ${ev} runs under ${hit.config} (${hit.glob})`);
        }
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`  ✓ ${n}`);
console.log(
  `\nverify-claims: ${claims.length} claims (${verifiedCount} verified, ${incompleteCount} incomplete), revision ${doc.revision ?? "unset"}`,
);

if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nverify-claims: FAILED (${failures.length} problem(s))`);
  process.exit(1);
}
console.log("verify-claims: PASSED");
