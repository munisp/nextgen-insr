/**
 * fileIntegrity.ts — B4: file-integrity monitoring (REAL scanner).
 *
 * Baselines and diffs are computed from the server's REAL filesystem with
 * real sha256 hashing (node:crypto). Nothing is simulated.
 *
 * Operator configuration: the monitored allowlist lives in system_config
 * under key `fim_monitored_paths` — a JSON array of paths relative to the
 * server process working directory. Entries may be individual files
 * (e.g. "package.json", "pnpm-lock.yaml", "drizzle/schema.ts") or
 * directories, which are scanned recursively (skipping node_modules/.git and
 * anything over 5 MB). If the key is unset the scanner FAILS LOUD with
 * configuration instructions rather than guessing what to watch.
 *
 * Baseline rows live in `file_integrity_baseline` (migration 0060) and are
 * written by securityAudit.recordFileBaseline (admin). getFileIntegrity
 * re-hashes the live files and reports a REAL diff:
 *   changed — hash differs from baseline
 *   missing — baselined path no longer exists on disk
 *   new     — file on disk inside the allowlist but not in the baseline
 * No baseline recorded -> PRECONDITION_FAILED (NO_BASELINE) with instructions.
 *
 * RUNTIME CONSTRAINT: this inspects the filesystem of the process that runs
 * the query. In CI/sandbox/test environments that is the checkout on the
 * test runner (integration tests therefore baseline their OWN temp files);
 * in a deployed container it is the container image's filesystem, which is
 * exactly what FIM is meant to watch. Multi-replica deployments should run
 * recordFileBaseline per replica image.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { eq, inArray } from "drizzle-orm";

import { systemConfig } from "../../drizzle/schema";
import {
  fileIntegrityBaseline,
  type FileIntegrityBaselineRow,
} from "../../drizzle/schema.additions";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export const FIM_CONFIG_KEY = "fim_monitored_paths";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next"]);

/** Real sha256 of a file's bytes. */
export async function computeFileSha256(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

export class FimConfigError extends Error {}
export class FimNoBaselineError extends Error {}

/**
 * Read the operator allowlist from system_config. Fails loud with
 * instructions when unset or malformed.
 */
export async function getMonitoredPaths(db: Db): Promise<string[]> {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, FIM_CONFIG_KEY))
    .limit(1);
  if (!row) {
    throw new FimConfigError(
      `file-integrity allowlist is not configured: insert a system_config row with key '${FIM_CONFIG_KEY}' and a JSON-array value of paths relative to the server working directory, e.g. ["package.json","pnpm-lock.yaml","drizzle/schema.ts","config"]`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    throw new FimConfigError(
      `system_config '${FIM_CONFIG_KEY}' is not valid JSON (expected an array of path strings)`
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(p => typeof p === "string" && p.length > 0)) {
    throw new FimConfigError(
      `system_config '${FIM_CONFIG_KEY}' must be a non-empty JSON array of path strings`
    );
  }
  return parsed as string[];
}

export interface ScannedFile {
  /** Path relative to rootDir, forward-slash separated. */
  path: string;
  sha256: string;
  fileSize: number;
}

async function scanOne(absPath: string, relPath: string, out: ScannedFile[]): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return; // nonexistent allowlist entry — surfaced via the baseline diff, not here
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      await scanOne(path.join(absPath, entry.name), `${relPath}/${entry.name}`, out);
    }
    return;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
  out.push({
    path: relPath,
    sha256: await computeFileSha256(absPath),
    fileSize: stat.size,
  });
}

/** Scan the allowlist against a real filesystem root. */
export async function scanAllowlist(
  allowlist: string[],
  rootDir: string = process.cwd()
): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  for (const entry of allowlist) {
    const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    // Contain the scan to rootDir — no absolute paths, no traversal.
    const abs = path.resolve(rootDir, normalized);
    if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) continue;
    await scanOne(abs, normalized, out);
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Record (or refresh) the baseline for the current allowlist. Returns the
 * real scan that was persisted.
 */
export async function recordBaseline(
  db: Db,
  opts: { baselinedBy?: string; rootDir?: string } = {}
): Promise<ScannedFile[]> {
  const allowlist = await getMonitoredPaths(db);
  const scanned = await scanAllowlist(allowlist, opts.rootDir);
  if (scanned.length === 0) {
    throw new FimConfigError(
      `recordBaseline: the configured allowlist (${allowlist.join(", ")}) matched no files under ${opts.rootDir ?? process.cwd()} — nothing to baseline`
    );
  }
  await db.delete(fileIntegrityBaseline);
  await db.insert(fileIntegrityBaseline).values(
    scanned.map(f => ({
      path: f.path,
      sha256: f.sha256,
      fileSize: f.fileSize,
      baselinedBy: opts.baselinedBy ?? null,
    }))
  );
  return scanned;
}

export interface FileIntegrityDiff {
  baselinedAt: Date | null;
  monitoredPaths: number;
  changed: { path: string; baselineSha256: string; currentSha256: string }[];
  missing: { path: string; baselineSha256: string }[];
  newFiles: { path: string; currentSha256: string; fileSize: number }[];
  unchanged: number;
  status: "clean" | "violations_detected";
}

/**
 * REAL diff of the live filesystem against the recorded baseline. Fails loud
 * (FimNoBaselineError) when no baseline exists.
 */
export async function checkIntegrity(
  db: Db,
  opts: { rootDir?: string } = {}
): Promise<FileIntegrityDiff> {
  const baselineRows: FileIntegrityBaselineRow[] = await db
    .select()
    .from(fileIntegrityBaseline);
  if (baselineRows.length === 0) {
    throw new FimNoBaselineError(
      "NO_BASELINE: no file-integrity baseline has been recorded. Call securityAudit.recordFileBaseline as an admin after configuring system_config key 'fim_monitored_paths'."
    );
  }
  const allowlist = await getMonitoredPaths(db);
  const scanned = await scanAllowlist(allowlist, opts.rootDir);
  const currentByPath = new Map(scanned.map(f => [f.path, f]));

  const changed: FileIntegrityDiff["changed"] = [];
  const missing: FileIntegrityDiff["missing"] = [];
  let unchanged = 0;
  let baselinedAt: Date | null = null;
  for (const row of baselineRows) {
    if (row.baselinedAt && (!baselinedAt || row.baselinedAt > baselinedAt)) {
      baselinedAt = row.baselinedAt;
    }
    const current = currentByPath.get(row.path);
    if (!current) {
      missing.push({ path: row.path, baselineSha256: row.sha256 });
    } else if (current.sha256 !== row.sha256) {
      changed.push({ path: row.path, baselineSha256: row.sha256, currentSha256: current.sha256 });
    } else {
      unchanged += 1;
    }
    currentByPath.delete(row.path);
  }
  const newFiles = [...currentByPath.values()].map(f => ({
    path: f.path,
    currentSha256: f.sha256,
    fileSize: f.fileSize,
  }));

  return {
    baselinedAt,
    monitoredPaths: baselineRows.length,
    changed,
    missing,
    newFiles,
    unchanged,
    status: changed.length + missing.length + newFiles.length > 0 ? "violations_detected" : "clean",
  };
}

/** Remove baselined paths that fall outside the current allowlist (housekeeping helper). */
export async function pruneBaselineToAllowlist(db: Db): Promise<number> {
  const allowlist = new Set(await getMonitoredPaths(db));
  const rows = await db.select().from(fileIntegrityBaseline);
  const stale = rows.filter(r => !allowlist.has(r.path)).map(r => r.id);
  if (stale.length > 0) {
    await db.delete(fileIntegrityBaseline).where(inArray(fileIntegrityBaseline.id, stale));
  }
  return stale.length;
}
