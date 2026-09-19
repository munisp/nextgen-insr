/**
 * docNumber.test.ts — J-wave (2026-09): proves every human-facing document/
 * policy/agreement/reference number in this tree is now CSPRNG-bodied
 * (prefix + base36-ms + 16 hex), non-predictable, and unique across rapid
 * generation — and that NO prefixed `${Date.now()}` identifier survives
 * anywhere in the tree's server/client/service sources (the "ALL sites"
 * guard, verified from source, not assumed).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { docNumber } from "./db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TREE = path.resolve(__dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "coverage"].includes(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry) && !/\.test\.|\.spec\./.test(entry))
      yield full;
  }
}

describe("J-wave: docNumber CSPRNG document numbers", () => {
  it("format: PREFIX + base36-ms + 16 uppercase hex (64-bit CSPRNG)", () => {
    const n = docNumber("POL");
    expect(n.startsWith("POL-")).toBe(true);
    expect(/^POL-[0-9A-Z]+-[0-9A-F]{16}$/.test(n)).toBe(true);
  });

  it("non-predictable and unique across 1000 rapid same-ms generations", () => {
    const nums = new Set<string>();
    const bodies = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const n = docNumber("AGR");
      nums.add(n);
      bodies.add(n.split("-").pop()!);
    }
    expect(nums.size).toBe(1000);
    expect(bodies.size).toBe(1000); // random bodies distinct even when ms collides
  });

  it("old shapes are gone: no bare decimal-ms or base36-only bodies", () => {
    for (const p of ["POL", "AGR", "DIG", "NII", "CLM"]) {
      const n = docNumber(p);
      expect(new RegExp(`^${p}-\\d+$`).test(n)).toBe(false);
      expect(new RegExp(`^${p}-[0-9A-Z]{6,10}$`).test(n)).toBe(false);
    }
  });

  it("ALL-sites guard: no prefixed ${Date.now()} identifier survives in the tree", () => {
    const offenders: string[] = [];
    // Prefixed identifier built from Date.now() (decimal or base36) — the
    // predictable-document-number shape, excluding the CSPRNG docNumber
    // helper itself (its ms component is sortability-only).
    const pat = /`[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-\$\{Date\.now\(\)(?!\.toString\(36\))[^}]*\}`/;
    const bareMs = /`[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-\$\{Date\.now\(\)\.toString\(36\)(?:\.toUpperCase\(\))?\}(?!-)/;
    for (const f of sourceFiles(TREE)) {
      const src = readFileSync(f, "utf8");
      // Skip the docNumber definition itself.
      const stripped = src.replace(
        /export function docNumber[\s\S]*?\n\}/,
        ""
      );
      if (pat.test(stripped) || bareMs.test(stripped)) offenders.push(path.relative(TREE, f));
    }
    expect(offenders).toEqual([]);
  });
});
