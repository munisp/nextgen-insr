/**
 * securityScanner.ts — B2: REAL security scanner integration.
 *
 * Grammar: never canned findings. Availability is probed AT CALL TIME:
 *   - trivy:   `trivy --version` via PATH lookup (spawnSync)
 *   - semgrep: `semgrep --version` via PATH lookup; SEMGREP_APP_TOKEN (when
 *              present) is passed through for `semgrep scan --config auto`
 * When NO scanner is available the caller fails loud PRECONDITION_FAILED
 * listing exactly what was probed (see ScannerProbeReport). When a scanner
 * IS available the repo working tree is scanned for real (bounded timeout
 * and output buffer), the scanner's own JSON output is parsed, and rows are
 * persisted to security_scan_runs / security_scan_findings (migration 0057).
 */
import { execFile, execFileSync, spawnSync } from "child_process";
import path from "path";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  securityScanFindings,
  securityScanRuns,
  type SecurityScanFinding,
  type SecurityScanRun,
} from "../../drizzle/schema.additions";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type ScannerName = "trivy" | "semgrep";

export interface ScannerProbe {
  scanner: ScannerName;
  available: boolean;
  /** First line of `<scanner> --version` when available. */
  version?: string;
  /** Exact reason the probe failed when unavailable. */
  error?: string;
}

export interface ScannerProbeReport {
  probedAt: string;
  path: string;
  semgrepAppTokenPresent: boolean;
  probes: ScannerProbe[];
}

/** Repo working-tree root (server/lib → repo root). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function probeBinary(
  scanner: ScannerName,
  args: string[]
): ScannerProbe {
  const res = spawnSync(scanner, args, {
    encoding: "utf-8",
    timeout: 15_000,
    env: process.env,
  });
  if (res.error) {
    const err = res.error as NodeJS.ErrnoException;
    return {
      scanner,
      available: false,
      error:
        err.code === "ENOENT"
          ? `'${scanner}' binary not found on PATH`
          : `'${scanner} ${args.join(" ")}' failed to launch: ${err.message}`,
    };
  }
  if (res.status !== 0) {
    return {
      scanner,
      available: false,
      error: `'${scanner} ${args.join(" ")}' exited ${res.status}: ${(res.stderr ?? "").slice(0, 200)}`,
    };
  }
  const firstLine = (res.stdout ?? "").split("\n")[0]?.trim() || "unknown";
  return { scanner, available: true, version: firstLine.slice(0, 128) };
}

/**
 * Probe every supported scanner at call time. The report is returned in full
 * by the fail-loud path so the operator sees EXACTLY what was checked.
 */
export function probeScanners(): ScannerProbeReport {
  return {
    probedAt: new Date().toISOString(),
    path: process.env.PATH ?? "",
    semgrepAppTokenPresent: Boolean(process.env.SEMGREP_APP_TOKEN),
    probes: [
      probeBinary("trivy", ["--version"]),
      probeBinary("semgrep", ["--version"]),
    ],
  };
}

/** Pick the first available scanner (trivy preferred — repo-tree scanner). */
export function selectScanner(
  report: ScannerProbeReport
): ScannerProbe | null {
  return report.probes.find(p => p.available) ?? null;
}

// ── Finding model ────────────────────────────────────────────────────────────

export interface NormalisedFinding {
  ruleId: string;
  title: string;
  severity: string; // scanner-reported, upper-cased
  findingType: "vulnerability" | "secret" | "misconfig" | "code";
  target: string;
  packageName?: string;
  installedVersion?: string;
  fixedVersion?: string;
}

const VALID_SEVERITIES = new Set([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNKNOWN",
]);

function normaliseSeverity(raw: unknown): string {
  const sev = String(raw ?? "UNKNOWN").toUpperCase();
  return VALID_SEVERITIES.has(sev) ? sev : "UNKNOWN";
}

export function severityCounts(findings: NormalisedFinding[]) {
  const counts: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNKNOWN: 0,
  };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

// ── Trivy ────────────────────────────────────────────────────────────────────

interface TrivyVulnerability {
  VulnerabilityID?: string;
  Title?: string;
  Severity?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
}
interface TrivySecret {
  RuleID?: string;
  Title?: string;
  Severity?: string;
}
interface TrivyMisconfiguration {
  ID?: string;
  AVDID?: string;
  Title?: string;
  Severity?: string;
}
interface TrivyResult {
  Target?: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[] | null;
  Secrets?: TrivySecret[] | null;
  Misconfigurations?: TrivyMisconfiguration[] | null;
}
interface TrivyReport {
  Results?: TrivyResult[];
}

/**
 * Parse REAL trivy `--format json` output into normalised findings. Throws
 * (fail loud) when the payload is not trivy JSON — a scanner whose output we
 * cannot parse must not silently yield "0 findings".
 */
export function parseTrivyJson(jsonText: string): NormalisedFinding[] {
  let report: TrivyReport;
  try {
    report = JSON.parse(jsonText) as TrivyReport;
  } catch (err) {
    throw new Error(
      `parseTrivyJson: scanner output is not valid JSON (${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (!report || typeof report !== "object" || !("Results" in report)) {
    throw new Error(
      "parseTrivyJson: scanner output has no 'Results' key — not trivy JSON"
    );
  }
  const findings: NormalisedFinding[] = [];
  for (const result of report.Results ?? []) {
    const target = result.Target ?? "";
    for (const v of result.Vulnerabilities ?? []) {
      findings.push({
        ruleId: v.VulnerabilityID ?? "UNKNOWN-CVE",
        title: v.Title ?? v.VulnerabilityID ?? "untitled vulnerability",
        severity: normaliseSeverity(v.Severity),
        findingType: "vulnerability",
        target,
        packageName: v.PkgName,
        installedVersion: v.InstalledVersion,
        fixedVersion: v.FixedVersion ?? undefined,
      });
    }
    for (const s of result.Secrets ?? []) {
      findings.push({
        ruleId: s.RuleID ?? "UNKNOWN-SECRET-RULE",
        title: s.Title ?? s.RuleID ?? "untitled secret",
        severity: normaliseSeverity(s.Severity),
        findingType: "secret",
        target,
      });
    }
    for (const m of result.Misconfigurations ?? []) {
      findings.push({
        ruleId: m.ID ?? m.AVDID ?? "UNKNOWN-MISCONFIG",
        title: m.Title ?? m.ID ?? "untitled misconfiguration",
        severity: normaliseSeverity(m.Severity),
        findingType: "misconfig",
        target,
      });
    }
  }
  return findings;
}

// ── Semgrep ──────────────────────────────────────────────────────────────────

interface SemgrepResult {
  check_id?: string;
  path?: string;
  extra?: { message?: string; severity?: string };
}
interface SemgrepReport {
  results?: SemgrepResult[];
}

/** Parse REAL semgrep `--json` output into normalised findings. */
export function parseSemgrepJson(jsonText: string): NormalisedFinding[] {
  let report: SemgrepReport;
  try {
    report = JSON.parse(jsonText) as SemgrepReport;
  } catch (err) {
    throw new Error(
      `parseSemgrepJson: scanner output is not valid JSON (${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (!report || typeof report !== "object" || !("results" in report)) {
    throw new Error(
      "parseSemgrepJson: scanner output has no 'results' key — not semgrep JSON"
    );
  }
  return (report.results ?? []).map(r => ({
    ruleId: r.check_id ?? "UNKNOWN-RULE",
    title: r.extra?.message ?? r.check_id ?? "untitled finding",
    severity: normaliseSeverity(r.extra?.severity),
    findingType: "code" as const,
    target: r.path ?? "",
  }));
}

// ── Execution ────────────────────────────────────────────────────────────────

export interface ScanExecution {
  scanner: ScannerName;
  scannerVersion: string;
  targetPath: string;
  startedAt: Date;
  finishedAt: Date;
  findings: NormalisedFinding[];
  durationMs: number;
}

const SCAN_TIMEOUT_MS = 240_000; // bounded: 4 minutes
const SCAN_MAX_BUFFER = 64 * 1024 * 1024; // bounded: 64 MiB of JSON

function execScanner(
  scanner: ScannerName,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      scanner,
      args,
      {
        encoding: "utf-8",
        timeout: SCAN_TIMEOUT_MS,
        maxBuffer: SCAN_MAX_BUFFER,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `'${scanner}' execution failed: ${error.message}` +
                (stderr ? ` — stderr: ${String(stderr).slice(0, 500)}` : "")
            )
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

/**
 * Execute a REAL scan of the repo working tree with the given scanner.
 * Fails loud on execution/parse errors — callers record the failed run.
 */
export async function executeScan(
  probe: ScannerProbe,
  targetPath: string = REPO_ROOT
): Promise<ScanExecution> {
  const startedAt = new Date();
  let findings: NormalisedFinding[];
  if (probe.scanner === "trivy") {
    const { stdout } = await execScanner("trivy", [
      "fs",
      "--format",
      "json",
      "--scanners",
      "vuln,secret,misconfig",
      "--quiet",
      targetPath,
    ]);
    findings = parseTrivyJson(stdout);
  } else {
    const { stdout } = await execScanner("semgrep", [
      "scan",
      "--config",
      "auto",
      "--json",
      "--quiet",
      targetPath,
    ]);
    findings = parseSemgrepJson(stdout);
  }
  const finishedAt = new Date();
  return {
    scanner: probe.scanner,
    scannerVersion: probe.version ?? "unknown",
    targetPath,
    startedAt,
    finishedAt,
    findings,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

export async function recordRunStart(
  db: Db,
  run: {
    scanner: string;
    scannerVersion: string;
    targetPath: string;
    startedAt: Date;
    triggeredBy?: number | null;
  }
): Promise<SecurityScanRun> {
  const [row] = await db
    .insert(securityScanRuns)
    .values({
      scanner: run.scanner,
      scannerVersion: run.scannerVersion,
      targetPath: run.targetPath,
      startedAt: run.startedAt,
      status: "running",
      triggeredBy: run.triggeredBy ?? null,
    })
    .returning();
  return row;
}

export async function recordRunFinish(
  db: Db,
  runId: number,
  outcome: {
    finishedAt: Date;
    status: "completed" | "failed";
    totalFindings?: number;
    severityCounts?: Record<string, number>;
    error?: string;
  }
): Promise<SecurityScanRun> {
  const [row] = await db
    .update(securityScanRuns)
    .set({
      finishedAt: outcome.finishedAt,
      status: outcome.status,
      totalFindings: outcome.totalFindings ?? null,
      severityCounts: outcome.severityCounts ?? null,
      error: outcome.error ?? null,
    })
    .where(eq(securityScanRuns.id, runId))
    .returning();
  return row;
}

export async function insertFindings(
  db: Db,
  runId: number,
  findings: NormalisedFinding[]
): Promise<number> {
  if (findings.length === 0) return 0;
  // Bound row width per insert batch.
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < findings.length; i += BATCH) {
    const batch = findings.slice(i, i + BATCH).map(f => ({
      runId,
      ruleId: f.ruleId.slice(0, 256),
      title: f.title,
      severity: f.severity,
      findingType: f.findingType,
      target: f.target,
      packageName: f.packageName?.slice(0, 256) ?? null,
      installedVersion: f.installedVersion?.slice(0, 128) ?? null,
      fixedVersion: f.fixedVersion?.slice(0, 128) ?? null,
    }));
    await db.insert(securityScanFindings).values(batch);
    inserted += batch.length;
  }
  return inserted;
}

export async function listScanRuns(
  db: Db,
  opts: { page?: number; limit?: number }
): Promise<{ data: SecurityScanRun[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const data = await db
    .select()
    .from(securityScanRuns)
    .orderBy(desc(securityScanRuns.startedAt), desc(securityScanRuns.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(securityScanRuns);
  return { data, total: Number(total ?? 0) };
}

export async function listScanFindings(
  db: Db,
  opts: { runId?: number; severity?: string; page?: number; limit?: number }
): Promise<{ data: SecurityScanFinding[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);
  const conditions = [
    opts.runId != null ? eq(securityScanFindings.runId, opts.runId) : undefined,
    opts.severity != null
      ? eq(securityScanFindings.severity, opts.severity.toUpperCase())
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c != null);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const data = await db
    .select()
    .from(securityScanFindings)
    .where(where)
    .orderBy(desc(securityScanFindings.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(securityScanFindings)
    .where(where);
  return { data, total: Number(total ?? 0) };
}

/** Synchronous binary probe usable in environments without async spawn. */
export function probeBinaryVersion(scanner: ScannerName): string | null {
  try {
    const out = execFileSync(scanner, ["--version"], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    return out.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}
