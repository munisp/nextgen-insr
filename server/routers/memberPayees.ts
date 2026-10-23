/**
 * memberPayees.ts — W11-B1a (2026-10-05): member payee directory surface.
 *
 * Member-scoped CRUD over the payee_directory table (drizzle/schema.ts,
 * migration 0090) — the saved beneficiaries of the member funds rails
 * (bill / airtime / momo), recorded server-side by
 * server/lib/memberPayees.ts recordPayee after gateway-verified successful
 * captures only. Mounted as `memberPayees`.
 *
 * Identity: the caller is resolved SESSION-SIDE ONLY
 * (customers.keycloakSub = String(ctx.user.id), the dual-identity customer
 * space — resolveMemberCustomer, memberFunds.ts); no customerId is ever
 * accepted from input. Every query is scoped customerId = <resolved id>, so
 * no cross-member row can be read, renamed, or deleted. Foreign or
 * nonexistent payee ids throw NOT_FOUND (never FORBIDDEN — non-enumerating,
 * memberGuards.ts precedent).
 *
 * PII: meterNumber / phone / walletNumber are AES-256-GCM encrypted at rest;
 * list decrypts server-side for the OWNING member only. There is no proc
 * that returns another member's rows.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no member profile → empty list
 * (non-enumerating) / NOT_FOUND for id-addressed mutations.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { payeeDirectory } from "../../drizzle/schema";
import { resolveMemberCustomer } from "../lib/memberFunds";
import type { DrizzleDb } from "../lib/memberGuards";
import { decryptPayeeRow, listPayees } from "../lib/memberPayees";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

const PAYEE_RAILS = ["bill", "airtime", "momo"] as const;

export const memberPayeesRouter = router({
  /**
   * Caller's saved payees (optionally filtered by rail), most-recently-used
   * first, capped at 50. Encrypted identifier columns are decrypted
   * server-side; only the caller's own rows are ever read.
   */
  list: protectedProcedure
    .input(z.object({ rail: z.enum(PAYEE_RAILS).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      // No member profile → the caller can have no payees; empty (never an
      // enumeration oracle for which customer ids exist).
      if (!customer) return { payees: [] };
      return { payees: await listPayees(d, customer.id, input?.rail, 50) };
    }),

  /**
   * Rename one of the CALLER'S payees. Ownership is enforced IN the UPDATE
   * predicate (customerId = resolved session customer) — a foreign id
   * matches 0 rows → NOT_FOUND, so foreign ids are never enumerable.
   */
  rename: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(120),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer)
        throw new TRPCError({ code: "NOT_FOUND", message: "Payee not found" });
      const [row] = await d
        .update(payeeDirectory)
        .set({ label: input.label, updatedAt: new Date() })
        .where(
          and(
            eq(payeeDirectory.id, input.id),
            eq(payeeDirectory.customerId, customer.id)
          )
        )
        .returning();
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Payee not found" });
      return { payee: decryptPayeeRow(row) };
    }),

  /**
   * Delete one of the CALLER'S payees. Same ownership-in-predicate,
   * NOT_FOUND-on-miss contract as rename.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer)
        throw new TRPCError({ code: "NOT_FOUND", message: "Payee not found" });
      const [row] = await d
        .delete(payeeDirectory)
        .where(
          and(
            eq(payeeDirectory.id, input.id),
            eq(payeeDirectory.customerId, customer.id)
          )
        )
        .returning({ id: payeeDirectory.id });
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Payee not found" });
      return { removed: true, id: row.id };
    }),
});
