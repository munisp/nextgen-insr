// Sprint 87: Regenerated — securityAudit
// F-12 (wave-3): the regenerated revision answered EVERY security procedure
// (DDoS status, backups, file integrity, policies, mitigations, audit chain)
// with rows from the AGENTS table — stub payloads unrelated to the security
// concepts requested. Remediation:
//   - getAuditChain is WIRED to the real tamper-evident audit_log hash chain
//     (F-08, server/lib/auditChain.ts).
//   - getBackupStatus / listBackupJobs are WIRED to the real backup_jobs
//     catalog (B5, migration 0054 + server/lib/backupCatalog.ts).
//   - All other procedures have NO delivered data source (no DDoS telemetry,
//     no file-integrity store, no PBAC policy table, no mitigation tracker)
//     and now FAIL LOUD with NOT_IMPLEMENTED instead of returning
//     agent-registry rows. Runtime-honest beats stub-honest.
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { verifyAuditChain } from "../lib/auditChain";
import {
  getLatestBackupJob,
  listBackupJobsPage,
} from "../lib/backupCatalog";

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

const evaluateAccess = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(() => {
    throw notDelivered(
      "evaluateAccess",
      "no PBAC policy store exists (the previous revision listed agent-registry rows as 'access evaluations')"
    );
  });

const getPolicies = protectedProcedure.input(listInput).query(() => {
  throw notDelivered(
    "getPolicies",
    "no security-policy table exists in the runtime schema"
  );
});

const runSecurityScan = protectedProcedure
  .input(
    z.object({
      id: z.number().optional(),
      data: z.record(z.string(), z.any()).optional(),
    })
  )
  .mutation(() => {
    // Was a facade: returned {success:true} without scanning anything.
    throw notDelivered(
      "runSecurityScan",
      "no scanner integration is delivered; the previous revision echoed success without performing any scan"
    );
  });

const getMitigations = protectedProcedure.input(listInput).query(() => {
  throw notDelivered(
    "getMitigations",
    "no mitigation-tracking table exists in the runtime schema"
  );
});

const getFileIntegrity = protectedProcedure.input(listInput).query(() => {
  throw notDelivered(
    "getFileIntegrity",
    "no file-integrity monitoring store exists"
  );
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

const getDDoSStatus = protectedProcedure.input(listInput).query(() => {
  throw notDelivered(
    "getDDoSStatus",
    "no DDoS telemetry source is delivered"
  );
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
  getPolicies,
  runSecurityScan,
  getMitigations,
  getFileIntegrity,
  getBackupStatus,
  listBackupJobs,
  getDDoSStatus,
  getAuditChain,
});
