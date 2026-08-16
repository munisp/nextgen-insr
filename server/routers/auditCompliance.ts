/**
 * auditCompliance.ts — admin-gated audit chain verification, export, and
 * retention policy surface (F-08 engineering remediation).
 *
 * Procedures:
 *  - auditCompliance.verifyChain     — recompute the audit_log hash chain and
 *                                      report the exact broken link on tamper.
 *  - auditCompliance.export          — paginated audit export (chain order)
 *                                      including prevHash/entryHash so an
 *                                      external auditor can independently
 *                                      re-verify the chain offline.
 *  - auditCompliance.retentionPolicy — current retention configuration and the
 *                                      honest state of deletion/anchoring.
 *
 * Every export is itself written to the audit chain (AUDIT_EXPORT) so export
 * activity is tamper-evident too.
 *
 * Retention (honest state): retention DAYS are configurable here, but
 * retention ENFORCEMENT (deletion) is intentionally NOT implemented — any
 * deletion of audit rows breaks the chain by design. The documented path is
 * a privileged, itself-audited procedure that tombstones (preserves hash
 * fields, redacts content) and re-anchors the tip externally. See
 * COMPLIANCE_MATRIX.md (open items).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { verifyAuditChain } from "../lib/auditChain";

const DEFAULT_RETENTION_DAYS = 3650; // 10 years, per gdprDashboard policy statement

export const auditComplianceRouter = router({
  /**
   * Recompute the whole hash chain (up to maxRows) and verify every link.
   * Fails closed: returns ok=false with the exact rowId of the broken link.
   */
  verifyChain: adminProcedure
    .input(
      z
        .object({
          maxRows: z.number().int().min(1).max(500_000).default(50_000),
          /**
           * Tolerate rows with NULL hashes (legacy rows or direct-insert
           * bypass paths). Chained segments are still fully verified.
           * Default false = fail on any unchained row.
           */
          allowUnchained: z.boolean().default(false),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      }
      const result = await verifyAuditChain(db, {
        maxRows: input?.maxRows ?? 50_000,
        strict: !(input?.allowUnchained ?? false),
      });
      return {
        ...result,
        verifiedAt: new Date().toISOString(),
        chainVersion: "insureportal-audit-v1",
      };
    }),

  /**
   * Paginated audit export in chain order (ascending id). Each row includes
   * prevHash/entryHash so an external auditor can recompute the chain
   * offline. cursor = last exported id; pass nextCursor to continue.
   * The export action itself is audit-logged.
   */
  export: adminProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(1000).default(100),
        action: z.string().max(128).optional(),
        tenantId: z.number().int().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      }

      const conditions = [gt(auditLog.id, input.cursor)];
      if (input.action) conditions.push(eq(auditLog.action, input.action));
      if (input.tenantId !== undefined)
        conditions.push(eq(auditLog.tenantId, input.tenantId));

      const items = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(asc(auditLog.id))
        .limit(input.limit);

      // Chain tip at export time (pre-export-event state): the last CHAINED
      // row (untrained bypass rows can sit at the physical end of the table).
      const [tip] = await db
        .select({ id: auditLog.id, entryHash: auditLog.entryHash })
        .from(auditLog)
        .where(isNotNull(auditLog.entryHash))
        .orderBy(desc(auditLog.id))
        .limit(1);

      // The export itself is auditable and chained.
      await writeAuditLog({
        agentId: ctx.user.id,
        action: "AUDIT_EXPORT",
        resource: "audit_log",
        resourceId: `${input.cursor}+${input.limit}`,
        status: "success",
        metadata: {
          cursor: input.cursor,
          limit: input.limit,
          action: input.action ?? null,
          tenantId: input.tenantId ?? null,
          rowsExported: items.length,
          tipAtExport: tip ?? null,
        },
      });

      const nextCursor =
        items.length === input.limit ? items[items.length - 1]!.id : null;
      return {
        items,
        nextCursor,
        chainVersion: "insureportal-audit-v1",
        tipAtExport: tip ?? null,
        exportedAt: new Date().toISOString(),
      };
    }),

  /**
   * Current retention configuration and the honest state of deletion and
   * external anchoring. No deletion path exists: audit rows are never
   * deleted by application code, because deletion breaks the chain.
   */
  retentionPolicy: adminProcedure.query(async () => {
    const parsed = Number.parseInt(process.env.AUDIT_RETENTION_DAYS ?? "", 10);
    const retentionDays =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
    return {
      retentionDays,
      source: Number.isFinite(parsed) && parsed > 0 ? "env:AUDIT_RETENTION_DAYS" : "default",
      enforcement: {
        deletionImplemented: false,
        status: "OPEN ITEM",
        policy:
          "No audit retention deletion is implemented. Deleting audit rows " +
          "breaks the hash chain by design. The approved approach is a " +
          "privileged, itself-audited tombstone procedure: content fields " +
          "are redacted while prevHash/entryHash/createdAt are preserved so " +
          "the chain still verifies, and the post-tombstone tip is re-anchored " +
          "externally. Until that ships, rows older than retentionDays MUST " +
          "not be purged by application code.",
      },
      externalAnchoring: {
        implemented: false,
        status: "OPEN ITEM",
        policy:
          "Hash chaining detects tampering of stored rows but cannot stop a " +
          "DB superuser from rewriting the whole chain. The next step is WORM " +
          "anchoring: publish a signed daily tip hash to an external store.",
      },
    };
  }),
});
