import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { chatSessions, chatMessages, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const helpDeskRouter = router({
  listTickets: protectedProcedure
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
      try {
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
        return { tickets: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getTicket: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [ticket] = await db
          .select()
          .from(chatSessions)
          .where(eq(chatSessions.id, input.id))
          .limit(1);
        if (!ticket) return null;
        const messages = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.sessionId, input.id))
          .orderBy(chatMessages.createdAt)
          .limit(100);
        return { ...ticket, messages };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  createTicket: protectedProcedure
    .input(
      z.object({
        subject: z.string(),
        description: z.string(),
        priority: z
          .enum(["low", "medium", "high", "critical"])
          .default("medium"),
        agentId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [ticket] = await db
          .insert(chatSessions)
          .values({
            status: "open",
            subject: input.subject,
            agentId: input.agentId,
          } as any)
          .returning();
        await db.insert(chatMessages).values({
          sessionId: ticket.id,
          content: input.description,
          senderType: "agent",
        } as any);
        await db.insert(auditLog).values({
          action: "helpdesk_ticket_created",
          resource: "chat_sessions",
          resourceId: String(ticket.id),
          status: "success",
          metadata: { subject: input.subject, priority: input.priority },
        } as any);
        return ticket;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  resolveTicket: protectedProcedure
    .input(z.object({ id: z.number(), resolution: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .update(chatSessions)
          .set({ status: "resolved" })
          .where(eq(chatSessions.id, input.id));
        await db.insert(auditLog).values({
          action: "helpdesk_ticket_resolved",
          resource: "chat_sessions",
          resourceId: String(input.id),
          status: "success",
          metadata: { resolution: input.resolution },
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
      message: "Help desk dashboard is not implemented yet",
    });
  }),

  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [total] = await db
      .select({ value: count() })
      .from(chatSessions)
      .limit(100);
    const [open] = await db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.status, "open"))
      .limit(100);
    const [resolved] = await db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.status, "resolved"))
      .limit(100);
    return {
      totalTickets: Number(total.value),
      openTickets: Number(open.value),
      resolvedTickets: Number(resolved.value),
    };
  }),

  searchTickets: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "Ticket search is not implemented yet",
    });
  }),
  knowledgeBase: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          category: z.string().optional(),
        })
        .optional()
    )
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Knowledge base is not implemented yet",
      });
    }),
});
