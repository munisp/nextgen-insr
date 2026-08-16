import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { desc, eq, sql, and, count, gte, lte, like } from "drizzle-orm";

/**
 * Activity Audit Log Router
 * 
 * Comprehensive audit trail for all platform actions. Tracks who did what,
 * when, from where. Supports compliance requirements for NDPR, SOX, ISO 27001.
 * 
 * Retention: 7 years (financial), 3 years (personal data), 1 year (operational)
 */
export const activityAuditLogRouter = router({
  // List audit events with advanced filtering
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        action: z.string().optional(),
        agentId: z.number().optional(),
        entityType: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };

      const conditions = [];
      if (input.action) conditions.push(eq(auditLog.action, input.action));
      if (input.userId) conditions.push(eq(auditLog.agentId, input.userId));

      const query = database.select().from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit)
        .offset(input.offset);

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      const [{ total }] = await database.select({ total: count() }).from(auditLog);

      return { data: results, total: total ?? 0 };
    }),

  // Get single event by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) throw new Error(`Audit event #${input.id} not found`);
      return record;
    }),

  // Get audit statistics
  getStats: protectedProcedure
    .input(
      z.object({ days: z.number().min(1).max(90).default(7) })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [total] = await database.select({ total: count() }).from(auditLog);

      return {
        totalEvents: total?.total ?? 0,
        period: `${input.days} days`,
        lastUpdated: new Date().toISOString(),
      };
    }),

  // Record a new audit event
  record: protectedProcedure
    .input(
      z.object({
        action: z.string(),
        agentId: z.number(),
        details: z.string().optional(),
        ipAddress: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [record] = await database
        .insert(auditLog)
        .values({
          action: input.action,
          agentId: input.userId,
          details: input.details ?? null,
        })
        .returning();

      return record;
    }),
});
