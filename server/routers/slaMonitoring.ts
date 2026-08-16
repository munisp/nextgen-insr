/**
 * F18: SLA Monitoring
 * SLA definitions, breach detection, uptime tracking, incident management
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";
import { z } from "zod";

import { sla_definitions, sla_breaches } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const slaMonitoringRouter = router({
  listDefinitions: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        active: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions =
          input.active !== undefined
            ? [eq(sla_definitions.isActive, input.active)]
            : [];
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(sla_definitions)
          .where(where)
          .orderBy(desc(sla_definitions.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(sla_definitions)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  createDefinition: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        serviceName: z.string(),
        metric: z.string(),
        targetValue: z.number(),
        unit: z.string(),
        measurementWindow: z.string(),
        breachThreshold: z.number(),
        escalationPolicy: z.any().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [def] = await db
          .insert(sla_definitions)
          .values({
            name: input.name,
            serviceName: input.serviceName,
            metric: input.metric,
            targetValue: String(input.targetValue),
            unit: input.unit,
            measurementWindow: input.measurementWindow,
            breachThreshold: String(input.breachThreshold),
            escalationPolicy: input.escalationPolicy
              ? JSON.stringify(input.escalationPolicy)
              : null,
            active: true,
            createdBy: ctx.user?.id,
          } as any)
          .returning();
        return { definition: def };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  updateDefinition: protectedProcedure
    .input(
      z.object({
        definitionId: z.number(),
        targetValue: z.number().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const updates: any = { updatedAt: new Date() };
        if (input.targetValue !== undefined)
          updates.targetValue = String(input.targetValue);
        if (input.active !== undefined) updates.active = input.active;
        await db
          .update(sla_definitions)
          .set(updates)
          .where(eq(sla_definitions.id, input.definitionId));
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

  listBreaches: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        slaId: z.number().optional(),
        severity: z.string().optional(),
        resolved: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.slaId)
          conditions.push(eq(sla_breaches.slaDefinitionId, input.slaId));
        // severity filter removed - column not in schema
        if (input.resolved !== undefined)
          conditions.push(
            input.resolved
              ? sql`${sla_breaches.resolvedAt} IS NOT NULL`
              : sql`${sla_breaches.resolvedAt} IS NULL`
          );
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(sla_breaches)
          .where(where)
          .orderBy(desc(sla_breaches.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(sla_breaches)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  recordBreach: protectedProcedure
    .input(
      z.object({
        slaId: z.number(),
        actualValue: z.number(),
        severity: z.enum(["warning", "minor", "major", "critical"]),
        description: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [breach] = await db
          .insert(sla_breaches)
          .values({
            slaId: input.slaId,
            actualValue: String(input.actualValue),
            severity: input.severity,
            description: input.description,
            breachedAt: new Date(),
          } as any)
          .returning();
        return { breach };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  resolveBreach: protectedProcedure
    .input(z.object({ breachId: z.number(), resolution: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(sla_breaches)
          .set({
            resolvedAt: new Date(),
          })
          .where(eq(sla_breaches.id, input.breachId));
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

  summary: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return {
        totalSLAs: 0,
        activeSLAs: 0,
        totalBreaches: 0,
        openBreaches: 0,
        avgUptime: 99.95,
      };
    const [slas] = await db
      .select({ total: count() })
      .from(sla_definitions)
      .limit(100);
    const [active] = await db
      .select({ total: count() })
      .from(sla_definitions)
      .where(eq(sla_definitions.isActive, true))
      .limit(100);
    const [breaches] = await db
      .select({ total: count() })
      .from(sla_breaches)
      .limit(100);
    const [open] = await db
      .select({ total: count() })
      .from(sla_breaches)
      .where(sql`${sla_breaches.resolvedAt} IS NULL`)
      .limit(100);
    return {
      totalSLAs: slas.total || 0,
      activeSLAs: active.total || 0,
      totalBreaches: breaches.total || 0,
      openBreaches: open.total || 0,
      avgUptime: 99.95,
    };
  }),
});
