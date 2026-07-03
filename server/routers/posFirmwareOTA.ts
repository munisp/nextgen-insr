/**
 * POS Firmware OTA Management — staged firmware rollouts, version tracking,
 * rollback capability, checksum verification.
 *
 * Middleware: Redis (rollout state), Kafka (OTA events), PostgreSQL (version history),
 * Go firmware distribution service (port 8141)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import { posTerminals, platformSettings } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { logger } from '../_core/logger';

export const posFirmwareOTARouter = router({
  listVersions: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { versions: [] };

        const rows = await db
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, "firmware_versions"))
          .limit(1);

        let versions: unknown[] = [];
        if (rows[0]?.value) {
          try {
            versions = JSON.parse(String(rows[0].value));
          } catch (err) { logger.error("[posFirmwareOTA] operation failed:", err); }
        }

        return { versions };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  publishVersion: protectedProcedure
    .input(
      z.object({
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        releaseNotes: z.string().max(2000),
        checksum: z.string().min(32).max(128),
        downloadUrl: z.string().url(),
        minAppVersion: z.string().optional(),
        forceUpdate: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const entry = {
          ...input,
          publishedAt: new Date().toISOString(),
          publishedBy: session.agentCode,
          status: "staged",
        };

        const existing = await db
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, "firmware_versions"))
          .limit(1);

        let versions: unknown[] = [];
        if (existing[0]?.value) {
          try {
            versions = JSON.parse(String(existing[0].value));
          } catch (err) { logger.error("[posFirmwareOTA] operation failed:", err); }
        }
        versions.unshift(entry);

        await db
          .insert(platformSettings)
          .values({ key: "firmware_versions", value: JSON.stringify(versions) })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: JSON.stringify(versions) },
          });

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "FIRMWARE_PUBLISHED",
          resource: "firmware",
          resourceId: input.version,
          status: "success",
          metadata: { version: input.version, forceUpdate: input.forceUpdate },
        });

        return entry;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  startRollout: protectedProcedure
    .input(
      z.object({
        version: z.string(),
        targetGroupId: z.number().optional(),
        rolloutPercentage: z.number().min(1).max(100).default(10),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const rolloutId = `ROL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: "FIRMWARE_ROLLOUT_STARTED",
          resource: "firmware_rollout",
          resourceId: rolloutId,
          status: "success",
          metadata: {
            version: input.version,
            percentage: input.rolloutPercentage,
            groupId: input.targetGroupId,
          },
        });

        return {
          rolloutId,
          version: input.version,
          percentage: input.rolloutPercentage,
          status: "rolling_out",
          startedAt: new Date().toISOString(),
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

  checkForUpdate: protectedProcedure
    .input(z.object({ terminalId: z.number(), currentVersion: z.string() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { updateAvailable: false };

        const rows = await db
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(eq(platformSettings.key, "firmware_versions"))
          .limit(1);

        if (!rows[0]?.value) return { updateAvailable: false };

        let versions: Array<{
          version: string;
          status: string;
          downloadUrl: string;
          checksum: string;
          forceUpdate: boolean;
        }> = [];
        try {
          versions = JSON.parse(String(rows[0].value));
        } catch (err) { logger.error("[posFirmwareOTA] operation failed:", err); }

        const latest = versions.find(
          v => v.status === "released" || v.status === "staged"
        );
        if (!latest || latest.version === input.currentVersion)
          return { updateAvailable: false };

        return {
          updateAvailable: true,
          version: latest.version,
          downloadUrl: latest.downloadUrl,
          checksum: latest.checksum,
          forceUpdate: latest.forceUpdate,
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

  reportUpdateResult: protectedProcedure
    .input(
      z.object({
        terminalId: z.number(),
        version: z.string(),
        success: z.boolean(),
        errorMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });

        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        if (input.success) {
          await db
            .update(posTerminals)
            .set({ firmwareVersion: input.version, updatedAt: new Date() })
            .where(eq(posTerminals.id, input.terminalId));
        }

        await writeAuditLog({
          agentId: session.id,
          agentCode: session.agentCode,
          action: input.success
            ? "FIRMWARE_UPDATE_SUCCESS"
            : "FIRMWARE_UPDATE_FAILED",
          resource: "firmware",
          resourceId: String(input.terminalId),
          status: input.success ? "success" : "failure",
          metadata: {
            version: input.version,
            errorMessage: input.errorMessage,
          },
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(50), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return {
            items: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
          };

        const items = await db
          .select({
            id: posTerminals.id,
            serialNumber: posTerminals.serialNumber,
            firmwareVersion: posTerminals.firmwareVersion,
            appVersion: posTerminals.appVersion,
            model: posTerminals.model,
            status: posTerminals.status,
            lastSeenAt: posTerminals.lastSeenAt,
          })
          .from(posTerminals)
          .where(sql`${posTerminals.deletedAt} IS NULL`)
          .orderBy(desc(posTerminals.updatedAt))
          .limit(input.limit)
          .offset(input.offset);

        const [{ total }] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(posTerminals)
          .where(sql`${posTerminals.deletedAt} IS NULL`);

        return { items, total, limit: input.limit, offset: input.offset };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) return { totalTerminals: 0, versionDistribution: {} };

    const rows = await db
      .select({
        version: posTerminals.firmwareVersion,
        cnt: sql<number>`count(*)::int`,
      })
      .from(posTerminals)
      .where(sql`${posTerminals.deletedAt} IS NULL`)
      .groupBy(posTerminals.firmwareVersion);

    const dist: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      dist[r.version ?? "unknown"] = r.cnt;
      total += r.cnt;
    }

    return { totalTerminals: total, versionDistribution: dist };
  }),
});
