import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { chatSessions, chatMessages, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { getIO } from "../socketSingleton";

export const chatRouter = router({
  startSession: protectedProcedure
    .input(
      z.object({
        subject: z.string().optional(),
        category: z.string().optional(),
        agentId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      const [session] = await db
        .insert(chatSessions)
        .values({
          status: "open",
          agentId: input.agentId,
          subject: input.subject,
          category: input.category,
        } as any)
        .returning();
      await db.insert(auditLog).values({
        action: "chat_session_started",
        resource: "chat_sessions",
        resourceId: String(session.id),
        status: "success",
        metadata: {},
      } as any);
      return session;
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.number(),
        content: z.string(),
        senderType: z.enum(["agent", "support", "system"]).default("support"),
        senderName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      const [msg] = await db
        .insert(chatMessages)
        .values({
          sessionId: input.sessionId,
          content: input.content,
          senderType: input.senderType,
          senderName: input.senderName,
        } as any)
        .returning();
      const io = getIO();
      if (io) {
        io.of("/chat")
          .to(`session:${input.sessionId}`)
          .emit("chat:message", msg);
      }
      return msg;
    }),

  getMessages: protectedProcedure
    .input(z.object({ sessionId: z.number(), limit: z.number().default(100) }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId))
        .orderBy(chatMessages.createdAt)
        .limit(input.limit);
      return messages;
    }),

  listSessions: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().default(50),
          status: z
            .enum(["open", "assigned", "resolved", "escalated"])
            .optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const rows = input?.status
        ? await db
            .select()
            .from(chatSessions)
            .where(eq(chatSessions.status, input.status))
            .orderBy(desc(chatSessions.createdAt))
            .limit(input?.limit ?? 50)
        : await db
            .select()
            .from(chatSessions)
            .orderBy(desc(chatSessions.createdAt))
            .limit(input?.limit ?? 50);
      return { sessions: rows, total: rows.length };
    }),

  closeSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      await db
        .update(chatSessions)
        .set({ status: "resolved" })
        .where(eq(chatSessions.id, input.id));
      await db.insert(auditLog).values({
        action: "chat_session_closed",
        resource: "chat_sessions",
        resourceId: String(input.id),
        status: "success",
        metadata: {},
      });
      return { success: true };
    }),

  adminListSessions: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum(["open", "assigned", "resolved", "escalated"])
            .optional(),
          limit: z.number().default(100),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const rows = input?.status
        ? await db
            .select()
            .from(chatSessions)
            .where(eq(chatSessions.status, input.status))
            .orderBy(desc(chatSessions.createdAt))
            .limit(input?.limit ?? 100)
        : await db
            .select()
            .from(chatSessions)
            .orderBy(desc(chatSessions.createdAt))
            .limit(input?.limit ?? 100);
      return { sessions: rows, total: rows.length };
    }),

  adminGetMessages: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId))
        .orderBy(chatMessages.createdAt)
        .limit(500);
      return messages;
    }),

  adminDeleteSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      await db.delete(chatMessages).where(eq(chatMessages.sessionId, input.id));
      await db.delete(chatSessions).where(eq(chatSessions.id, input.id));
      return { success: true };
    }),

  adminStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db.select({ value: count() }).from(chatSessions);
    const [open] = await db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.status, "open"));
    const [assigned] = await db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.status, "assigned"));
    const [escalated] = await db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.status, "escalated"));
    const [resolved] = await db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.status, "resolved"));
    return {
      totalSessions: Number(total.value),
      openSessions: Number(open.value),
      assignedSessions: Number(assigned.value),
      escalatedSessions: Number(escalated.value),
      resolvedSessions: Number(resolved.value),
    };
  }),

  adminAssignSession: protectedProcedure
    .input(z.object({ sessionId: z.number(), supportAgentName: z.string() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      await db
        .update(chatSessions)
        .set({
          status: "assigned",
          supportAgentName: input.supportAgentName,
        } as any)
        .where(eq(chatSessions.id, input.sessionId));
      return { success: true };
    }),

  adminReply: protectedProcedure
    .input(
      z.object({
        sessionId: z.number(),
        content: z.string(),
        senderName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      const [msg] = await db
        .insert(chatMessages)
        .values({
          sessionId: input.sessionId,
          content: input.content,
          senderType: "support",
          senderName: input.senderName ?? "Admin",
        } as any)
        .returning();
      const io = getIO();
      if (io) {
        io.of("/chat")
          .to(`session:${input.sessionId}`)
          .emit("chat:message", msg);
      }
      return msg;
    }),

  adminEscalate: protectedProcedure
    .input(z.object({ sessionId: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      await db
        .update(chatSessions)
        .set({ status: "escalated" })
        .where(eq(chatSessions.id, input.sessionId));
      await db.insert(auditLog).values({
        action: "chat_session_escalated",
        resource: "chat_sessions",
        resourceId: String(input.sessionId),
        status: "success",
        metadata: { reason: input.reason },
      } as any);
      return { success: true };
    }),

  adminResolve: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = (await getDb())!;
      await db
        .update(chatSessions)
        .set({ status: "resolved" })
        .where(eq(chatSessions.id, input.sessionId));
      return { success: true };
    }),
});
