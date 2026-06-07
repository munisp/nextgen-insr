// @ts-nocheck
/**
 * erp.ts — ERP Webhook Configuration & Sync Router
 *
 * Provides tRPC procedures for:
 *   - Reading/saving ERP connection configuration
 *   - Testing the webhook connection
 *   - Triggering a manual sync of pending transactions
 *   - Viewing the ERP sync log
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db.js";
import { erpConfig, erpSyncLog, transactions } from "../../drizzle/schema.js";
import { eq, desc, and, isNull } from "drizzle-orm";
import axios from "axios";

// ── Field mapping schema ──────────────────────────────────────────────────────

const FieldMappingsSchema = z.record(z.string(), z.string());

const ErpConfigInputSchema = z.object({
  erpType: z.enum([
    "odoo",
    "sap",
    "netsuite",
    "quickbooks",
    "sage",
    "dynamics365",
    "custom",
  ]),
  name: z.string().min(1).max(128),
  baseUrl: z.string().url("Must be a valid URL"),
  apiKey: z.string().optional(),
  username: z.string().optional(),
  database: z.string().optional(),
  fieldMappings: FieldMappingsSchema.optional(),
  syncEnabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  syncTransactions: z.boolean().optional(),
  syncAgents: z.boolean().optional(),
  syncInventory: z.boolean().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Admin-only guard */
function requireAdmin(ctx: { user: { role?: string } }) {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
  }
}

/** Get or create the singleton ERP config record */
async function getOrCreateConfig(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  const [existing] = await db.select().from(erpConfig).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(erpConfig)
    .values({
      erpType: "odoo",
      name: "Default ERP",
      baseUrl: "",
    })
    .returning();
  return created;
}

/** Build the ERP API request headers based on ERP type */
function buildHeaders(cfg: {
  erpType: string;
  apiKey?: string | null;
  username?: string | null;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) {
    if (cfg.erpType === "odoo") {
      headers["X-API-Key"] = cfg.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    }
  }
  return headers;
}

/** Push a single transaction to the ERP via webhook */
async function pushTransactionToErp(
  cfg: Awaited<ReturnType<typeof getOrCreateConfig>>,
  tx: Record<string, unknown>
): Promise<{ success: boolean; erpDocName?: string; error?: string }> {
  if (!cfg.baseUrl)
    return { success: false, error: "ERP base URL not configured" };
  try {
    const endpoint =
      cfg.erpType === "odoo"
        ? `${cfg.baseUrl}/api/method/insureportal.api.create_journal_entry`
        : `${cfg.baseUrl}/api/transactions`;
    const mappings = (cfg.fieldMappings as Record<string, string>) ?? {};
    const payload = {
      ref: tx.ref,
      type: tx.type,
      amount: tx.amount,
      fee: tx.fee,
      commission: tx.commission,
      agentId: tx.agentId,
      channel: tx.channel,
      status: tx.status,
      createdAt: tx.createdAt,
      // Apply field mappings
      glAccount: mappings.glAccount ?? "1200",
      costCenter: mappings.costCenter ?? "",
      profitCenter: mappings.profitCenter ?? "",
      journalId: mappings.journalId ?? "1",
      currency: mappings.currency ?? "NGN",
    };
    const { data } = await axios.post(endpoint, payload, {
      headers: buildHeaders(cfg),
      timeout: 10_000,
    });
    return { success: true, erpDocName: data?.name ?? data?.id ?? "created" };
  } catch (e: unknown) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const erpRouter = router({
  /** Get the current ERP configuration (admin only) */
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    try {
      requireAdmin(ctx);
      const db = (await getDb())!;
      const cfg = await getOrCreateConfig(db);
      // Mask API key for display
      return {
        ...cfg,
        apiKey: cfg.apiKey
          ? `${cfg.apiKey.slice(0, 4)}${"*".repeat(Math.max(0, (cfg.apiKey?.length ?? 0) - 8))}${cfg.apiKey.slice(-4)}`
          : "",
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /** Save / update the ERP configuration (admin only) */
  saveConfig: protectedProcedure
    .input(ErpConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        requireAdmin(ctx);
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const existing = await getOrCreateConfig(db);
        const [updated] = await db
          .update(erpConfig)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(eq(erpConfig.id, existing.id))
          .returning();
        return { success: true, config: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Test the webhook connection (admin only) */
  testWebhook: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      requireAdmin(ctx);
      const db = (await getDb())!;
      const cfg = await getOrCreateConfig(db);
      if (!cfg.baseUrl) {
        return {
          success: false,
          latencyMs: null,
          message:
            "ERP base URL is not configured. Save a configuration first.",
        };
      }
      const start = Date.now();
      try {
        const pingUrl =
          cfg.erpType === "odoo"
            ? `${cfg.baseUrl}/api/method/ping`
            : `${cfg.baseUrl}/api/health`;
        await axios.get(pingUrl, {
          headers: buildHeaders(cfg),
          timeout: 8_000,
        });
        const latencyMs = Date.now() - start;
        return {
          success: true,
          latencyMs,
          message: `Connected to ${cfg.name} (${cfg.erpType}) in ${latencyMs}ms`,
        };
      } catch (e: unknown) {
        const latencyMs = Date.now() - start;
        return {
          success: false,
          latencyMs,
          message: `Cannot reach ERP: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /** Trigger a manual sync of pending transactions (admin only) */
  syncNow: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      requireAdmin(ctx);
      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });
      const cfg = await getOrCreateConfig(db);
      if (!cfg.syncEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ERP sync is disabled. Enable it in configuration first.",
        });
      }
      if (!cfg.baseUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ERP base URL is not configured.",
        });
      }
      // Find transactions not yet synced to ERP
      const pendingLogs = await db
        .select({ entityId: erpSyncLog.entityId })
        .from(erpSyncLog)
        .where(
          and(
            eq(erpSyncLog.entityType, "transaction"),
            eq(erpSyncLog.status, "synced")
          )
        );
      const syncedIds = new Set(pendingLogs.map(r => r.entityId));
      const allTx = await db
        .select()
        .from(transactions)
        .orderBy(desc(transactions.createdAt))
        .limit(100);
      const toSync = allTx.filter(tx => !syncedIds.has(String(tx.id)));
      let synced = 0;
      let failed = 0;
      for (const tx of toSync) {
        const result = await pushTransactionToErp(
          cfg,
          tx as unknown as Record<string, unknown>
        );
        await db.insert(erpSyncLog).values({
          entityType: "transaction",
          entityId: String(tx.id),
          erpDocType: "journal_entry",
          erpDocName: result.erpDocName ?? null,
          status: result.success ? "synced" : "failed",
          errorMessage: result.error ?? null,
          payload: tx as unknown as Record<string, unknown>,
          syncedAt: result.success ? new Date() : null,
        });
        if (result.success) synced++;
        else failed++;
      }
      // Update last sync status
      await db
        .update(erpConfig)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus:
            failed === 0 ? "success" : synced > 0 ? "partial" : "failed",
          lastSyncCount: synced,
          lastSyncError:
            failed > 0 ? `${failed} transaction(s) failed to sync` : null,
          updatedAt: new Date(),
        })
        .where(eq(erpConfig.id, cfg.id));
      return { synced, failed, total: toSync.length };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /** Get recent ERP sync log entries with pagination (admin only) */
  getSyncLog: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        status: z.enum(["pending", "synced", "failed"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        requireAdmin(ctx);
        const db = (await getDb())!;
        if (!db) return { rows: [], total: 0 };
        const conditions: ReturnType<typeof eq>[] = [];
        if (input.status) conditions.push(eq(erpSyncLog.status, input.status));
        const rows = await db
          .select()
          .from(erpSyncLog)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(erpSyncLog.createdAt))
          .limit(input.limit)
          .offset(input.offset);
        return { rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Retry a failed ERP sync log entry (admin only) */
  retrySync: protectedProcedure
    .input(z.object({ logId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      try {
        requireAdmin(ctx);
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const cfg = await getOrCreateConfig(db);
        const [logEntry] = await db
          .select()
          .from(erpSyncLog)
          .where(eq(erpSyncLog.id, input.logId))
          .limit(1);
        if (!logEntry)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Sync log entry not found",
          });
        if (logEntry.entityType !== "transaction") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only transaction sync entries can be retried",
          });
        }
        const result = await pushTransactionToErp(
          cfg,
          (logEntry.payload ?? {}) as Record<string, unknown>
        );
        await db
          .update(erpSyncLog)
          .set({
            status: result.success ? "synced" : "failed",
            errorMessage: result.error ?? null,
            erpDocName: result.erpDocName ?? logEntry.erpDocName,
            syncedAt: result.success ? new Date() : null,
          })
          .where(eq(erpSyncLog.id, input.logId));
        return { success: result.success, error: result.error };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
