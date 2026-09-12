// Sprint 87: Regenerated — securityAudit
// F-12 (wave-3): the regenerated revision answered EVERY security procedure
// (DDoS status, backups, file integrity, policies, mitigations, audit chain)
// with rows from the AGENTS table — stub payloads unrelated to the security
// concepts requested. Remediation:
//   - getAuditChain is WIRED to the real tamper-evident audit_log hash chain
//     (F-08, server/lib/auditChain.ts).
//   - B3 (zero-undelivered-scope): the mitigation tracker is now REAL —
//     security_mitigations table + list/create/status-transition/stats
//     procedures below.
//   - B5 (zero-undelivered-scope): getBackupStatus / listBackupJobs are
//     WIRED to the real backup_jobs catalog (migration 0054 +
//     server/lib/backupCatalog.ts).
//   - Runtime-honest beats stub-honest: procedures without a delivered
//     data source FAIL LOUD instead of returning agent-registry rows.
//   - B6/B4 (zero-undelivered-scope, wave-2d): getDDoSStatus and
//     getFileIntegrity are REAL — server/lib/ddosTelemetry.ts and
//     server/lib/fileIntegrity.ts (migration 0060).
//   - B1 (zero-undelivered-scope, wave-2a): evaluateAccess / getPolicies are
//     now REAL — Permify permissions/check via permifyCheckDetailed (fail-
//     closed PRECONDITION_FAILED when Permify is unreachable, same
//     PERMIFY_FAIL_OPEN semantics as _core/permify.ts), a pbac_policies
//     store seeded by parsing the real schema file (migration 0057), and a
//     pbac_access_evaluations verdict log.
//   - B2 (zero-undelivered-scope, wave-2a): runSecurityScan is now REAL —
//     call-time scanner probing (trivy/semgrep), real bounded scan of the
//     repo tree, real parsed findings in security_scan_runs /
//     security_scan_findings (migration 0057); PRECONDITION_FAILED listing
//     the exact probes when no scanner is available.
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  securityMitigations,
  type SecurityMitigation,
} from "../../drizzle/schema.additions";
import { permifyCheckDetailed } from "../_core/permify";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { verifyAuditChain } from "../lib/auditChain";
import {
  getLatestBackupJob,
  listBackupJobsPage,
} from "../lib/backupCatalog";
import { getDdosStatus } from "../lib/ddosTelemetry";
import {
  checkIntegrity,
  FimConfigError,
  FimNoBaselineError,
  recordBaseline,
} from "../lib/fileIntegrity";
import {
  countPolicies,
  listAccessEvaluations,
  listPolicies,
  recordAccessEvaluation,
  syncPoliciesFromSchema,
} from "../lib/pbacPolicies";
import {
  executeScan,
  insertFindings,
  listScanFindings,
  listScanRuns,
  probeScanners,
  recordRunFinish,
  recordRunStart,
  REPO_ROOT,
  selectScanner,
  severityCounts,
} from "../lib/securityScanner";

const notDelivered = (name: string, detail: string) =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${name}: capability not delivered — ${detail}`,
  });

const listInput = z.object({
  id: z.number().optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

// ── B1: REAL PBAC access evaluation + policy store ──────────────────────────
// evaluateAccess performs a REAL Permify permissions/check via
// permifyCheckDetailed (server/_core/permify.ts) and appends the verdict to
// the pbac_access_evaluations log. Permify unreachable + fail-closed (the
// default) → PRECONDITION_FAILED with the exact connection reason (a viewer
// must NEVER present "denied" when the engine itself is down). The insecure
// PERMIFY_FAIL_OPEN=true opt-in is honoured identically to _core/permify.ts
// and the verdict is labelled source='permify_fail_open'.
const evaluateAccess = protectedProcedure
  .input(
    z.object({
      subjectType: z.string().min(1).max(128),
      subjectId: z.string().min(1).max(256),
      entityType: z.string().min(1).max(128),
      entityId: z.string().min(1).max(256),
      permission: z.string().min(1).max(128),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const verdict = await permifyCheckDetailed({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      entityType: input.entityType,
      entityId: input.entityId,
      permission: input.permission,
    });
    if (!verdict.reachable && verdict.source === "permify") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          `evaluateAccess: Permify is unreachable and PERMIFY_FAIL_OPEN is not set ` +
          `(fail-closed) — no access verdict can be given. Reason: ${verdict.error ?? "unknown"}`,
      });
    }
    const row = await recordAccessEvaluation(db, {
      ...input,
      allowed: verdict.allowed === true,
      source: verdict.source,
      evaluatedBy: ctx.user?.id ?? null,
    });
    await writeAuditLog({
      action: "PBAC_ACCESS_EVALUATED",
      resource: "pbac_access_evaluations",
      resourceId: String(row.id),
      metadata: { ...input, allowed: row.allowed, source: row.source },
    });
    return {
      evaluationId: row.id,
      allowed: row.allowed,
      source: row.source,
      degraded: verdict.source === "permify_fail_open",
      evaluatedAt: row.createdAt.toISOString(),
    };
  });

// Paginated read of the REAL evaluation log (B1 viewer history).
const getAccessEvaluations = protectedProcedure
  .input(listInput)
  .query(async ({ input }) => {
    const db = await requireDb();
    return listAccessEvaluations(db, { page: input.page, limit: input.limit });
  });

// B1: REAL — rows from the pbac_policies store (migration 0057), seeded by
// parsing the actual Permify schema file (infra/permify/schema.perm) via
// syncPbacPolicies. Fails loud with the exact reason when the store is empty
// (sync never ran) — never an invented policy list.
const getPolicies = protectedProcedure
  .input(listInput)
  .query(async ({ input }) => {
    const db = await requireDb();
    const total = await countPolicies(db);
    if (total === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "getPolicies: the pbac_policies store is empty — run securityAudit.syncPbacPolicies " +
          "(admin) to seed it from the real Permify schema file (infra/permify/schema.perm)",
      });
    }
    return listPolicies(db, { page: input.page, limit: input.limit });
  });

// B1: admin-only sync of the policy store from the REAL in-repo Permify
// schema file. Re-parses on every call; upserts by (entity, permission).
const syncPbacPolicies = adminProcedure.mutation(async ({ ctx }) => {
  const db = await requireDb();
  const result = await syncPoliciesFromSchema(db);
  await writeAuditLog({
    action: "PBAC_POLICIES_SYNCED",
    resource: "pbac_policies",
    metadata: { ...result, syncedBy: ctx.user?.id ?? null },
  });
  return result;
});

// ── B2: REAL security scanner integration ────────────────────────────────────
// runSecurityScan probes scanner availability AT CALL TIME (trivy / semgrep
// binaries on PATH; SEMGREP_APP_TOKEN is reported in the probe). No scanner
// → PRECONDITION_FAILED listing exactly what was probed. A scanner → a REAL
// bounded scan of the repo working tree, real JSON parsed into
// security_scan_runs/security_scan_findings, real summary returned.
const runSecurityScan = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(async ({ ctx }) => {
    const report = probeScanners();
    const scanner = selectScanner(report);
    if (!scanner) {
      const detail = report.probes
        .map(p => `${p.scanner}: ${p.error ?? "unavailable"}`)
        .join("; ");
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "runSecurityScan: no security scanner is available — probed " +
          `[${detail}]; SEMGREP_APP_TOKEN ${report.semgrepAppTokenPresent ? "present" : "absent"}; ` +
          "install trivy or semgrep on PATH to enable real scans. " +
          "No scan was run and no findings were recorded.",
      });
    }
    const db = await requireDb();
    const run = await recordRunStart(db, {
      scanner: scanner.scanner,
      scannerVersion: scanner.version ?? "unknown",
      targetPath: REPO_ROOT,
      startedAt: new Date(),
      triggeredBy: ctx.user?.id ?? null,
    });
    try {
      const result = await executeScan(scanner, REPO_ROOT);
      const counts = severityCounts(result.findings);
      const inserted = await insertFindings(db, run.id, result.findings);
      const closed = await recordRunFinish(db, run.id, {
        finishedAt: result.finishedAt,
        status: "completed",
        totalFindings: result.findings.length,
        severityCounts: counts,
      });
      await writeAuditLog({
        action: "SECURITY_SCAN_COMPLETED",
        resource: "security_scan_runs",
        resourceId: String(run.id),
        metadata: {
          scanner: result.scanner,
          scannerVersion: result.scannerVersion,
          targetPath: result.targetPath,
          totalFindings: result.findings.length,
          severityCounts: counts,
          durationMs: result.durationMs,
        },
      });
      return {
        runId: closed.id,
        scanner: result.scanner,
        scannerVersion: result.scannerVersion,
        targetPath: result.targetPath,
        status: closed.status,
        totalFindings: result.findings.length,
        findingsRecorded: inserted,
        severityCounts: counts,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
        durationMs: result.durationMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordRunFinish(db, run.id, {
        finishedAt: new Date(),
        status: "failed",
        error: message,
      });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `runSecurityScan: real ${scanner.scanner} scan failed — ${message}`,
      });
    }
  });

// B2: REAL — paginated security_scan_runs history, newest first.
const getSecurityScanHistory = protectedProcedure
  .input(listInput)
  .query(async ({ input }) => {
    const db = await requireDb();
    return listScanRuns(db, { page: input.page, limit: input.limit });
  });

// B2: REAL — paginated security_scan_findings, filterable by run/severity.
const getSecurityScanFindings = protectedProcedure
  .input(
    z.object({
      runId: z.number().int().positive().optional(),
      severity: z
        .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"])
        .optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    })
  )
  .query(async ({ input }) => {
    const db = await requireDb();
    return listScanFindings(db, input);
  });

// ── B3 (F-11 Class-2): real mitigation tracker ──────────────────────────────
// Store: security_mitigations (migration 0056, drizzle/schema.additions.ts).

const mitigationStatusEnum = z.enum([
  "open",
  "in_progress",
  "resolved",
  "accepted_risk",
]);
const mitigationSeverityEnum = z.enum(["critical", "high", "medium", "low"]);

type MitigationStatus = z.infer<typeof mitigationStatusEnum>;

/**
 * Valid status transitions. Anything outside this set fails loud
 * (BAD_REQUEST) — a tracker that silently accepts resolved→accepted_risk
 * (or similar jumps) is not an audit-grade workflow.
 */
const VALID_TRANSITIONS: Record<MitigationStatus, readonly MitigationStatus[]> =
  {
    open: ["in_progress", "resolved", "accepted_risk"],
    in_progress: ["open", "resolved", "accepted_risk"],
    resolved: ["open"], // reopen only
    accepted_risk: ["open", "in_progress"],
  };

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "securityAudit: database unavailable",
    });
  }
  return db;
}

async function queryMitigations(filters: {
  id?: number;
  status?: MitigationStatus;
  severity?: z.infer<typeof mitigationSeverityEnum>;
  page?: number;
  limit?: number;
}): Promise<SecurityMitigation[]> {
  const db = await requireDb();
  const conditions = [
    filters.id != null ? eq(securityMitigations.id, filters.id) : undefined,
    filters.status != null
      ? eq(securityMitigations.status, filters.status)
      : undefined,
    filters.severity != null
      ? eq(securityMitigations.severity, filters.severity)
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c != null);
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const page = Math.max(filters.page ?? 1, 1);
  return db
    .select()
    .from(securityMitigations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(securityMitigations.createdAt), desc(securityMitigations.id))
    .limit(limit)
    .offset((page - 1) * limit);
}

const getMitigations = protectedProcedure
  .input(listInput)
  .query(async ({ input }) => {
    // REAL: rows from the security_mitigations tracker table (B3).
    return queryMitigations({
      id: input.id,
      page: input.page,
      limit: input.limit,
    });
  });

const listMitigations = protectedProcedure
  .input(
    z.object({
      status: mitigationStatusEnum.optional(),
      severity: mitigationSeverityEnum.optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    })
  )
  .query(async ({ input }) => {
    const data = await queryMitigations(input);
    const db = await requireDb();
    const conditions = [
      input.status != null
        ? eq(securityMitigations.status, input.status)
        : undefined,
      input.severity != null
        ? eq(securityMitigations.severity, input.severity)
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c != null);
    const [{ total }] = await db
      .select({ total: count() })
      .from(securityMitigations)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return { data, total: Number(total) };
  });

const createMitigation = adminProcedure
  .input(
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().min(1),
      severity: mitigationSeverityEnum,
      ownerUserId: z.number().int().positive().optional(),
      linkedFindingRef: z.string().max(128).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [row] = await db
      .insert(securityMitigations)
      .values({
        title: input.title,
        description: input.description,
        severity: input.severity,
        status: "open",
        ownerUserId: input.ownerUserId ?? null,
        linkedFindingRef: input.linkedFindingRef ?? null,
      })
      .returning();
    await writeAuditLog({
      action: "SECURITY_MITIGATION_CREATED",
      resource: "security_mitigations",
      resourceId: String(row.id),
      metadata: {
        title: row.title,
        severity: row.severity,
        createdBy: ctx.user?.id ?? null,
      },
    });
    return row;
  });

const updateMitigationStatus = adminProcedure
  .input(
    z.object({
      id: z.number().int().positive(),
      status: mitigationStatusEnum,
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [existing] = await db
      .select()
      .from(securityMitigations)
      .where(eq(securityMitigations.id, input.id))
      .limit(1);
    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `updateMitigationStatus: mitigation ${input.id} not found`,
      });
    }
    const from = existing.status as MitigationStatus;
    const to = input.status;
    if (from !== to && !VALID_TRANSITIONS[from].includes(to)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `updateMitigationStatus: invalid transition ${from} → ${to}. ` +
          `Valid transitions from '${from}': ${VALID_TRANSITIONS[from].join(", ")}`,
      });
    }
    const now = new Date();
    const [row] = await db
      .update(securityMitigations)
      .set({
        status: to,
        updatedAt: now,
        // resolvedAt is set on entry into 'resolved' and cleared on reopen.
        resolvedAt:
          to === "resolved" ? now : from === "resolved" ? null : existing.resolvedAt,
      })
      .where(eq(securityMitigations.id, input.id))
      .returning();
    await writeAuditLog({
      action: "SECURITY_MITIGATION_STATUS_CHANGED",
      resource: "security_mitigations",
      resourceId: String(row.id),
      metadata: { from, to, changedBy: ctx.user?.id ?? null },
    });
    return row;
  });

const getMitigationStats = protectedProcedure.query(async () => {
  const db = await requireDb();
  const [row] = await db
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where ${securityMitigations.status} = 'open')::int`,
      inProgress: sql<number>`count(*) filter (where ${securityMitigations.status} = 'in_progress')::int`,
      resolved: sql<number>`count(*) filter (where ${securityMitigations.status} = 'resolved')::int`,
      acceptedRisk: sql<number>`count(*) filter (where ${securityMitigations.status} = 'accepted_risk')::int`,
      critical: sql<number>`count(*) filter (where ${securityMitigations.severity} = 'critical')::int`,
      high: sql<number>`count(*) filter (where ${securityMitigations.severity} = 'high')::int`,
      medium: sql<number>`count(*) filter (where ${securityMitigations.severity} = 'medium')::int`,
      low: sql<number>`count(*) filter (where ${securityMitigations.severity} = 'low')::int`,
    })
    .from(securityMitigations);
  return {
    total: Number(row?.total ?? 0),
    byStatus: {
      open: Number(row?.open ?? 0),
      in_progress: Number(row?.inProgress ?? 0),
      resolved: Number(row?.resolved ?? 0),
      accepted_risk: Number(row?.acceptedRisk ?? 0),
    },
    bySeverity: {
      critical: Number(row?.critical ?? 0),
      high: Number(row?.high ?? 0),
      medium: Number(row?.medium ?? 0),
      low: Number(row?.low ?? 0),
    },
  };
});

// B4 (zero-undelivered-scope, Wave 2d): REAL file-integrity monitoring.
// Diffs the server's live filesystem against the recorded sha256 baseline
// (file_integrity_baseline, migration 0060) over the operator allowlist in
// system_config['fim_monitored_paths']. Fails loud:
//   - PRECONDITION_FAILED when the allowlist is unconfigured (with the exact
//     config instructions), and
//   - PRECONDITION_FAILED NO_BASELINE until recordFileBaseline has run.
// Runtime constraint: the diff inspects the filesystem of the serving
// process (deployed container image in production; checkout in CI).
const getFileIntegrity = protectedProcedure.input(listInput).query(async () => {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "database unavailable",
    });
  try {
    return await checkIntegrity(db);
  } catch (err) {
    if (err instanceof FimNoBaselineError || err instanceof FimConfigError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    }
    throw err;
  }
});

// Admin-only: record/refresh the sha256 baseline from the REAL filesystem.
const recordFileBaseline = adminProcedure
  .input(z.object({}).optional())
  .mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "database unavailable",
      });
    try {
      const scanned = await recordBaseline(db, {
        baselinedBy: ctx.user?.email ?? String(ctx.user?.id ?? "admin"),
      });
      return {
        success: true as const,
        baselinedFiles: scanned.length,
        paths: scanned.map(f => f.path),
      };
    } catch (err) {
      if (err instanceof FimConfigError) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      }
      throw err;
    }
  });

// B5: REAL — latest row from the backup_jobs catalog (migration 0054),
// recorded by scripts/backup/pg_backup.sh / server/lib/backupCatalog.ts.
// Fails loud only when the catalog is EMPTY (honest 'no backups recorded').
const getBackupStatus = protectedProcedure
  .input(listInput)
  .query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "getBackupStatus: database unavailable",
      });
    }
    const latest = await getLatestBackupJob(db);
    if (!latest) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "getBackupStatus: no backups recorded — the backup_jobs catalog is empty (run scripts/backup/pg_backup.sh or record via server/lib/backupCatalog.ts)",
      });
    }
    return { latest, asOf: new Date().toISOString() };
  });

// B5: REAL — paginated backup_jobs catalog listing, most recent first.
const listBackupJobs = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "listBackupJobs: database unavailable",
      });
    }
    const page = await listBackupJobsPage(db, input.limit, input.offset);
    return { ...page, limit: input.limit, offset: input.offset };
  });

// B6 (zero-undelivered-scope, Wave 2d): REAL DDoS self-telemetry. The
// ddosTelemetryMiddleware (registered first in server/_core/index.ts) counts
// requests per client key per 60s window and persists finished windows to
// ddos_rate_windows (migration 0060); threshold breaches are recorded as
// they are observed. This procedure reports ONLY rows really recorded:
// instrumented-but-quiet -> {status:'no_anomalies', windowsObserved:N};
// no windows ever persisted -> PRECONDITION_FAILED (capture not running).
const getDDoSStatus = protectedProcedure.input(listInput).query(async () => {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "database unavailable",
    });
  try {
    return await getDdosStatus(db);
  } catch (err) {
    if ((err as { code?: string }).code === "PRECONDITION_FAILED") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: (err as Error).message,
      });
    }
    throw err;
  }
});

const getAuditChain = protectedProcedure
  .input(
    z.object({
      maxRows: z.number().min(1).max(50000).optional(),
    })
  )
  .query(async ({ input }) => {
    // REAL: verify the F-08 tamper-evident hash chain over audit_log.
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "getAuditChain: database unavailable",
      });
    }
    const result = await verifyAuditChain(db, {
      maxRows: input.maxRows ?? 50_000,
    });
    return {
      chainValid: result.ok,
      checkedRows: result.checkedRows,
      unchainedRows: result.unchainedRows,
      totalRows: result.totalRows,
      genesisId: result.genesisId,
      tipId: result.tipId,
      tipHash: result.tipHash,
      failure: result.failure,
      verifiedAt: new Date().toISOString(),
    };
  });

export const securityAuditRouter = router({
  evaluateAccess,
  getAccessEvaluations,
  getPolicies,
  syncPbacPolicies,
  runSecurityScan,
  getSecurityScanHistory,
  getSecurityScanFindings,
  getMitigations,
  listMitigations,
  createMitigation,
  updateMitigationStatus,
  getMitigationStats,
  getFileIntegrity,
  recordFileBaseline,
  getBackupStatus,
  listBackupJobs,
  getDDoSStatus,
  getAuditChain,
});
