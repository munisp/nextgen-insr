import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { auditLog, agents } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, count } from "drizzle-orm";
import { randomBytes } from "crypto";

/**
 * API Gateway Router
 * Manages API keys for insurance platform integrations (brokers, partners, third-party apps).
 * All keys stored in audit_log with type='api_key'. Keys are hashed before storage.
 */

function generateApiKey(): string {
  return `ak_live_${randomBytes(24).toString("hex")}`;
}

function hashKey(key: string): string {
  const { createHash } = require("crypto");
  return createHash("sha256").update(key).digest("hex");
}

export const apiGatewayRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: input.limit, offset: input.offset };
      const results = await database.select().from(auditLog)
        .where(eq(auditLog.action, "API_KEY_CREATED"))
        .orderBy(desc(auditLog.id)).limit(input.limit).offset(input.offset);
      const [totalRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_CREATED"));
      return { data: results, total: (totalRow as any)?.total ?? 0, limit: input.limit, offset: input.offset };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [record] = await database.select().from(auditLog).where(eq(auditLog.id, input.id)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: `Record ${input.id} not found` });
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalRecords: 0, lastUpdated: new Date().toISOString() };
    const [totalRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_CREATED"));
    const [activeRow] = await database.select({ total: count() }).from(auditLog)
      .where(and(eq(auditLog.action, "API_KEY_CREATED"), sql`metadata->>'status' = 'active'`));
    return {
      totalRecords: (totalRow as any)?.total ?? 0,
      activeKeys: (activeRow as any)?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      const since = new Date(Date.now() - input.days * 24 * 3600000);
      return database.select().from(auditLog)
        .where(and(eq(auditLog.action, "API_KEY_CREATED"), gte(auditLog.createdAt, since)))
        .orderBy(desc(auditLog.id)).limit(input.limit);
    }),

  dashboard: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalKeys: 0, activeKeys: 0, recentActivity: [], lastUpdated: new Date().toISOString() };
    const [totalRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_CREATED"));
    const [revokedRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_REVOKED"));
    const recentActivity = await database.select().from(auditLog)
      .where(sql`action LIKE 'API_KEY%'`)
      .orderBy(desc(auditLog.id)).limit(10);
    const total = (totalRow as any)?.total ?? 0;
    const revoked = (revokedRow as any)?.total ?? 0;
    return {
      totalKeys: total,
      activeKeys: total - revoked,
      revokedKeys: revoked,
      recentActivity,
      lastUpdated: new Date().toISOString(),
    };
  }),

  listApiKeys: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0 };
    const results = await database.select().from(auditLog)
      .where(eq(auditLog.action, "API_KEY_CREATED"))
      .orderBy(desc(auditLog.id)).limit(50);
    const [totalRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_CREATED"));
    // Return masked keys
    const masked = results.map((r: any) => ({
      id: r.id,
      keyPrefix: (r.metadata?.keyPrefix as string) ?? "ak_live_***",
      name: (r.metadata?.name as string) ?? "API Key",
      status: (r.metadata?.status as string) ?? "active",
      createdAt: r.createdAt,
      lastUsed: r.metadata?.lastUsed ?? null,
      scopes: (r.metadata?.scopes as string[]) ?? [],
    }));
    return { data: masked, total: (totalRow as any)?.total ?? 0 };
  }),

  getStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { totalRecords: 0, activeRecords: 0, lastUpdated: new Date().toISOString(), uptime: 99.9, version: "1.0.0" };
    const [totalRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_CREATED"));
    const [revokedRow] = await database.select({ total: count() }).from(auditLog).where(eq(auditLog.action, "API_KEY_REVOKED"));
    const total = (totalRow as any)?.total ?? 0;
    const revoked = (revokedRow as any)?.total ?? 0;
    // Get uptime from platform_health_checks
    const [healthRow] = (await database.execute(sql`
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'healthy') / NULLIF(COUNT(*), 0), 2) as uptime
      FROM platform_health_checks WHERE service_name = 'api-gateway' AND checked_at > NOW() - INTERVAL '24 hours'
    `)).rows;
    const uptime = Number((healthRow as any)?.uptime ?? 99.9);
    return {
      totalRecords: total,
      activeRecords: total - revoked,
      revokedRecords: revoked,
      lastUpdated: new Date().toISOString(),
      uptime: isNaN(uptime) ? 99.9 : uptime,
      version: "2.0.0",
    };
  }),

  createApiKey: protectedProcedure
    .input(z.object({
      name: z.string().min(3).max(100),
      scopes: z.array(z.string()).default(["read:policies", "read:claims"]),
      expiresInDays: z.number().min(1).max(365).default(90),
      agentId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rawKey = generateApiKey();
      const keyHash = hashKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12) + "***";
      const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 3600000);

      // Store hashed key in audit_log
      const [record] = await database.insert(auditLog).values({
        action: "API_KEY_CREATED",
        resource: "api_key",
        resourceId: keyHash.slice(0, 16),
        agentId: String(ctx.user?.id ?? "system"),
        metadata: {
          name: input.name,
          keyPrefix,
          keyHash,
          scopes: input.scopes,
          status: "active",
          expiresAt: expiresAt.toISOString(),
          agentId: input.agentId ?? null,
          createdBy: ctx.user?.id ?? "system",
        },
      }).returning();

      // Return the raw key ONCE — it will never be shown again
      return {
        id: record.id,
        key: rawKey, // Shown once only
        keyPrefix,
        name: input.name,
        scopes: input.scopes,
        expiresAt: expiresAt.toISOString(),
        status: "active",
        warning: "Store this key securely. It will not be shown again.",
      };
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [record] = await database.select().from(auditLog).where(eq(auditLog.id, input.id)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      await database.insert(auditLog).values({
        action: "API_KEY_REVOKED",
        resource: "api_key",
        resourceId: (record.metadata as any)?.keyHash?.slice(0, 16) ?? String(input.id),
        agentId: String(ctx.user?.id ?? "system"),
        metadata: { originalId: input.id, reason: input.reason ?? "manual_revocation", revokedBy: ctx.user?.id },
      });
      return { success: true, id: input.id, status: "revoked" };
    }),
});
