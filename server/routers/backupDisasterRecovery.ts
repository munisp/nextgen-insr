import { z } from "zod";
import { publicProcedure, router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, sql, count } from "drizzle-orm";
import { backupSnapshots, auditLog } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const backupDisasterRecoveryRouter = router({
  listBackups: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = input?.status
          ? await db
              .select()
              .from(backupSnapshots)
              .where(eq(backupSnapshots.status, input.status))
              .orderBy(desc(backupSnapshots.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(backupSnapshots)
              .orderBy(desc(backupSnapshots.createdAt))
              .limit(input?.limit ?? 50);
        return { backups: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getBackup: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [backup] = await db
          .select()
          .from(backupSnapshots)
          .where(eq(backupSnapshots.id, input.id))
          .limit(1);
        return backup ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createBackup: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        type: z.enum(["full", "incremental", "differential"]).default("full"),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [backup] = await db
          .insert(backupSnapshots)
          .values({
            snapshotType: input.type,
            status: "in_progress",
            triggeredBy: input.name,
          })
          .returning();
        await db.insert(auditLog).values({
          action: "backup_created",
          resource: "backup_snapshots",
          resourceId: String(backup.id),
          status: "success",
          metadata: { name: input.name, type: input.type },
        });
        return backup;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  deleteBackup: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(backupSnapshots)
          .where(eq(backupSnapshots.id, input.id));
        await db.insert(auditLog).values({
          action: "backup_deleted",
          resource: "backup_snapshots",
          resourceId: String(input.id),
          status: "success",
          metadata: {},
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
  dashboard: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Backup/DR dashboard is not implemented yet",
    });
  }),

  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(backupSnapshots)
      .limit(100);
    return {
      totalBackups: Number(total.value),
      lastUpdated: new Date().toISOString(),
    };
  }),
  listSnapshots: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          status: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = input?.status
          ? await db
              .select()
              .from(backupSnapshots)
              .where(eq(backupSnapshots.status, input.status))
              .orderBy(desc(backupSnapshots.createdAt))
              .limit(input?.limit ?? 50)
          : await db
              .select()
              .from(backupSnapshots)
              .orderBy(desc(backupSnapshots.createdAt))
              .limit(input?.limit ?? 50);
        return { snapshots: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createSnapshot: protectedProcedure
    .input(
      z.object({
        snapshotType: z.enum(["full", "incremental", "differential"]),
        triggeredBy: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [snapshot] = await db
          .insert(backupSnapshots)
          .values({
            snapshotType: input.snapshotType,
            status: "in_progress",
            triggeredBy: input.triggeredBy,
          })
          .returning();
        await db.insert(auditLog).values({
          action: "backup_snapshot_created",
          resource: "backup_snapshots",
          resourceId: String(snapshot.id),
          status: "success",
          metadata: { snapshotType: input.snapshotType },
        });
        return {
          id: snapshot.id,
          snapshotType: input.snapshotType,
          status: "in_progress",
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
  restoreSnapshot: protectedProcedure
    .input(z.object({ snapshotId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [snapshot] = await db
          .select()
          .from(backupSnapshots)
          .where(eq(backupSnapshots.id, input.snapshotId))
          .limit(100);
        if (!snapshot) throw new Error("Snapshot not found");
        await db.insert(auditLog).values({
          action: "backup_restore_initiated",
          resource: "backup_snapshots",
          resourceId: String(input.snapshotId),
          status: "success",
          metadata: { snapshotType: snapshot.snapshotType },
        });
        return {
          snapshotId: input.snapshotId,
          status: "restoring",
          estimatedMinutes: snapshot.rtoMinutes ?? 30,
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

  triggerBackup: publicProcedure
    .input(z.object({ type: z.string().optional() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "On-demand backup trigger is not implemented yet",
      });
    }),
});
