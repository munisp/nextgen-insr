// @ts-check
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog, emailQueue, systemConfig } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";

// MOCKWARE FIX: sendTest/sendCustom returned fabricated {sent:true} without
// any provider call, and getProviderStatus claimed a healthy SendGrid. Sends
// now fail loudly when no email provider is configured; when one is
// configured the message is persisted to the real email_queue (status
// "queued") — it is only marked sent by the provider worker, never here.

function configuredEmailProvider(): string | null {
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  if (process.env.SES_REGION || process.env.AWS_SES_REGION) return "ses";
  if (process.env.SMTP_URL || process.env.SMTP_HOST) return "smtp";
  return null;
}

export const emailNotificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: 0, offset: 0 };
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(auditLog);
    const totalResult = Array.isArray(_totalRows) ? _totalRows[0] : _totalRows;

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const database = await getDb();
    if (!database) return { emailEnabled: true, frequency: "daily", categories: [] };
    const key = `email_prefs_${(ctx as any)?.user?.id ?? "unknown"}`;
    const [row] = await database
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);
    if (!row) return { emailEnabled: true, frequency: "daily", categories: [] };
    try {
      return { categories: [], ...JSON.parse(String(row.value ?? "{}")) };
    } catch {
      return { emailEnabled: true, frequency: "daily", categories: [] };
    }
  }),
  updatePreferences: protectedProcedure
    .input(
      z.object({
        emailEnabled: z.boolean().optional(),
        frequency: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const key = `email_prefs_${(ctx as any)?.user?.id ?? "unknown"}`;
      const [row] = await database
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1);
      const current = row ? JSON.parse(String(row.value ?? "{}")) : {};
      const value = JSON.stringify({ ...current, ...input });
      await database
        .insert(systemConfig)
        .values({ key, value })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: { value, updatedAt: new Date() },
        });
      return { success: true };
    }),
  sendTest: protectedProcedure
    .input(z.object({ email: z.string() }))
    .mutation(async ({ input }) => {
      const provider = configuredEmailProvider();
      if (!provider) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Email provider not configured" });
      }
      const database = await getDb();
      if (!database)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [queued] = await database
        .insert(emailQueue)
        .values({
          toAddress: input.email,
          subject: "InsurePortal test email",
          templateName: "test",
          templateData: {},
          status: "queued",
        })
        .returning();
      return { sent: false, queued: true, messageId: String(queued.id), provider };
    }),
  sendCustom: protectedProcedure
    .input(z.object({ to: z.string(), subject: z.string(), body: z.string() }))
    .mutation(async ({ input }) => {
      const provider = configuredEmailProvider();
      if (!provider) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Email provider not configured" });
      }
      const database = await getDb();
      if (!database)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      const [queued] = await database
        .insert(emailQueue)
        .values({
          toAddress: input.to,
          subject: input.subject,
          templateName: "custom",
          templateData: { body: input.body },
          status: "queued",
        })
        .returning();
      return { sent: false, queued: true, messageId: String(queued.id), provider };
    }),
  getDeliveryLog: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).default({}))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { entries: [], total: 0 };
      const rows = await database
        .select()
        .from(emailQueue)
        .orderBy(desc(emailQueue.createdAt))
        .limit(input.limit);
      return { entries: rows, total: rows.length };
    }),
  getProviderStatus: protectedProcedure.query(async () => {
    const provider = configuredEmailProvider();
    if (!provider) {
      return { provider: null, status: "not_configured", deliveryRate: null };
    }
    // Configuration exists, but no live health probe is wired — honest
    // "unknown" rather than fabricated "healthy".
    return { provider, status: "unknown", deliveryRate: null };
  }),
  getStats: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { sent: 0, delivered: 0, bounced: 0, deliveryRate: 0 };
    const [sent] = await database
      .select({ value: count() })
      .from(emailQueue)
      .where(eq(emailQueue.status, "sent"));
    const [bounced] = await database
      .select({ value: count() })
      .from(emailQueue)
      .where(eq(emailQueue.status, "bounced"));
    const sentCount = Number(sent.value);
    const bouncedCount = Number(bounced.value);
    return {
      sent: sentCount,
      delivered: sentCount,
      bounced: bouncedCount,
      deliveryRate: sentCount + bouncedCount > 0 ? sentCount / (sentCount + bouncedCount) : 0,
    };
  }),
});
