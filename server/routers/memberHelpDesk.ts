/**
 * memberHelpDesk.ts — R3 batch 1 member helpdesk surface (2026-10-01, R3)
 *
 * Member-scoped helpdesk procs for the PWA (customer-portal-full
 * client/src/services/supportApi.ts → /support, /support/:id). The existing
 * helpDesk router (server/routers/helpDesk.ts) is deliberately NOT exposed
 * to members: every implemented proc there is IDOR-exposed (listTickets is
 * unscoped, getTicket has no ownership check, createTicket accepts a
 * caller-supplied agentId). This router is the member-safe surface:
 *
 *   - myTickets:    the caller's tickets (chatSessions.agentId = customer.id),
 *                   optional status filter.
 *   - myTicket:     one ticket + its message thread, ownership-checked;
 *                   cross-member ids get NOT_FOUND (non-enumerating).
 *   - createTicket: owner is FORCED to the caller's resolved customer id —
 *                   no client-supplied identity is accepted.
 *   - replyTicket:  ownership-checked append to the thread; resolved tickets
 *                   reject (BAD_REQUEST).
 *
 * Identity: customers.keycloakSub = ctx.user.id → customer.id; the ticket
 * party column is chatSessions.agentId (chat_sessions has no customerId —
 * same party-column convention as wallet/policies). A caller with no
 * customer profile is FORBIDDEN (fail-closed, never a silent empty set for
 * mutations).
 *
 * Schema notes (drizzle/schema.ts, verified 2026-10-01):
 *   - chat_sessions has no priority column; the member priority input is
 *     recorded in the audit_log metadata only (same convention as the
 *     existing helpDesk.createTicket).
 *   - sender_type enum is ("agent" | "support" | "system") — there is NO
 *     "customer" value. Following the existing helpDesk.createTicket
 *     convention, member-authored messages are written as senderType
 *     "agent" (the account-party side of a support chat; "support" is
 *     staff).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; nothing is fabricated.
 */
import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  auditLog,
  chatMessages,
  chatSessions,
  customers,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  }
  return d;
}

/**
 * Resolve the caller's customer row (keycloakSub = ctx.user.id). Fail-closed:
 * an authenticated principal with no customer profile cannot own tickets, so
 * every proc denies rather than guessing a scope.
 */
async function resolveCustomerId(d: DrizzleDb, userId: number): Promise<number> {
  const [customer] = await d
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No customer profile is linked to this account",
    });
  }
  return customer.id;
}

/**
 * Human-unique ticket reference, mirroring the CHT-… generator in
 * server/db.ts (sessionRef is NOT NULL UNIQUE on chat_sessions).
 */
function newSessionRef(): string {
  return `CHT-${Date.now().toString(36).toUpperCase()}-${randomUUID()
    .slice(0, 3)
    .toUpperCase()}`;
}

const TICKET_STATUSES = ["open", "assigned", "resolved", "escalated"] as const;

export const memberHelpDeskRouter = router({
  /**
   * Caller's tickets, newest first. Optional status filter; limit capped at
   * 50. Read-only.
   */
  myTickets: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(TICKET_STATUSES).optional(),
          limit: z.number().int().min(1).max(50).default(50),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customerId = await resolveCustomerId(d, ctx.user.id);
      const scope = input?.status
        ? and(
            eq(chatSessions.agentId, customerId),
            eq(chatSessions.status, input.status)
          )
        : eq(chatSessions.agentId, customerId);
      const rows = await d
        .select()
        .from(chatSessions)
        .where(scope)
        .orderBy(desc(chatSessions.createdAt))
        .limit(input?.limit ?? 50);
      return { tickets: rows, total: rows.length };
    }),

  /**
   * One of the caller's tickets with its full message thread. NOT_FOUND is
   * non-enumerating: cross-member ids and nonexistent ids are
   * indistinguishable.
   */
  myTicket: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customerId = await resolveCustomerId(d, ctx.user.id);
      const [ticket] = await d
        .select()
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.id, input.id),
            eq(chatSessions.agentId, customerId)
          )
        )
        .limit(1);
      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      const messages = await d
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.id))
        .orderBy(asc(chatMessages.createdAt))
        .limit(500);
      return { ticket, messages };
    }),

  /**
   * Open a ticket for the caller. The owner (chatSessions.agentId) is forced
   * to the caller's customer id — no identity is accepted from the client.
   * The description becomes the first message of the thread.
   */
  createTicket: protectedProcedure
    .input(
      z.object({
        subject: z.string().min(1).max(256),
        description: z.string().min(1).max(4000),
        // No "critical" for members — staff triage sets that.
        priority: z.enum(["low", "medium", "high"]).default("low"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customerId = await resolveCustomerId(d, ctx.user.id);
      const [customer] = await d
        .select({ firstName: customers.firstName, lastName: customers.lastName })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      const senderName = customer
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : null;

      const [ticket] = await d
        .insert(chatSessions)
        .values({
          sessionRef: newSessionRef(),
          agentId: customerId,
          subject: input.subject,
          status: "open",
        })
        .returning();
      // senderType "agent" = the account-party side of a support chat (the
      // sender_type enum has no "customer" value — see header).
      await d.insert(chatMessages).values({
        sessionId: ticket.id,
        senderType: "agent",
        senderName,
        content: input.description,
      });
      await d.insert(auditLog).values({
        agentId: customerId,
        action: "member_helpdesk_ticket_created",
        resource: "chat_sessions",
        resourceId: String(ticket.id),
        status: "success",
        metadata: {
          subject: input.subject,
          priority: input.priority,
        },
      });
      return ticket;
    }),

  /**
   * Append a member reply to one of the caller's own tickets. Ownership is
   * re-checked (NOT_FOUND, non-enumerating); resolved tickets are rejected
   * (BAD_REQUEST) — a resolved thread is reopened by staff, not by appending.
   */
  replyTicket: protectedProcedure
    .input(
      z.object({
        ticketId: z.number().int().positive(),
        content: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customerId = await resolveCustomerId(d, ctx.user.id);
      const [ticket] = await d
        .select({ id: chatSessions.id, status: chatSessions.status })
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.id, input.ticketId),
            eq(chatSessions.agentId, customerId)
          )
        )
        .limit(1);
      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      if (ticket.status === "resolved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This ticket is resolved and can no longer be replied to",
        });
      }
      const [customer] = await d
        .select({ firstName: customers.firstName, lastName: customers.lastName })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      const senderName = customer
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : null;

      await d.insert(chatMessages).values({
        sessionId: ticket.id,
        senderType: "agent", // see header — account-party side, not staff
        senderName,
        content: input.content,
      });
      await d
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, ticket.id));
      return { success: true };
    }),
});
