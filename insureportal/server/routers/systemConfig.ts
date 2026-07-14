/**
 * systemConfig router
 *
 * Admin-settable key-value configuration store backed by the system_config table.
 * Provides:
 *   - getSystemConfig: read one or all config values (protected procedure)
 *   - setSystemConfig: write a config value (admin-only)
 *   - listSystemConfig: list all config entries (admin-only)
 *
 * Default seeds (applied at first migration):
 *   dead_letter_auto_retry_threshold = "5"
 *   alert_throttle_window_minutes    = "30"
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { systemConfig } from "@schema";
import { eq } from "drizzle-orm";

export const systemConfigRouter = router({
  // ── Get a single config value by key ─────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { key: input.key, value: null };
        const rows = await db
          .select()
          .from(systemConfig)
          .where(eq(systemConfig.key, input.key))
          .limit(1);
        if (rows.length === 0) return { key: input.key, value: null };
        return {
          key: rows[0].key,
          value: rows[0].value,
          description: rows[0].description,
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

  // ── List all config entries (admin-only) ─────────────────────────────────
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (ctx.user.role !== "admin" && ctx.user.role !== "supervisor") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }
      const db = (await getDb())!;
      if (!db) return { entries: [] };
      const rows = await db
        .select()
        .from(systemConfig)
        .orderBy(systemConfig.key)
        .limit(100);
      return { entries: rows };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  // ── Set a config value (admin-only) ──────────────────────────────────────
  set: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1).max(128),
        value: z.string().max(4096),
        description: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (ctx.user.role !== "admin" && ctx.user.role !== "supervisor") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admin access required",
          });
        }
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const now = new Date();
        const updatedBy = ctx.user.name ?? ctx.user.email ?? "unknown";

        // Upsert: insert if not exists, update if exists
        await db
          .insert(systemConfig)
          .values({
            key: input.key,
            value: input.value,
            description: input.description,
            updatedBy,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: {
              value: input.value,
              description: input.description ?? undefined,
              updatedBy,
              updatedAt: now,
            },
          });

        return {
          key: input.key,
          value: input.value,
          updatedBy,
          updatedAt: now,
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
});
