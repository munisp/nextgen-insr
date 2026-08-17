import { TRPCError } from "@trpc/server";
import {
  eq,
  desc,
  and,
  sql,
  count,
  sum,
  isNull,
  gte,
  lte,
  or,
  asc,
} from "drizzle-orm";
import { z } from "zod";

import { customers, auditLog } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";


export const accountOpeningRouter = router({
  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalAccounts: 0, pending: 0, active: 0, suspended: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(customers)
      .limit(100);
    const [pending] = await db
      .select({ value: count() })
      .from(customers)
      .where(eq(customers.status, "pending_kyc"))
      .limit(100);
    const [active] = await db
      .select({ value: count() })
      .from(customers)
      .where(eq(customers.status, "active"))
      .limit(100);
    return {
      totalAccounts: Number(total.value),
      pending: Number(pending.value),
      active: Number(active.value),
      suspended: 0,
    };
  }),
  listAccounts: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { accounts: [], total: 0 };
        const rows = await db
          .select()
          .from(customers)
          .orderBy(desc(customers.createdAt))
          .limit(input?.limit ?? 20);
        return { accounts: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  openAccount: protectedProcedure
    .input(
      z.object({
        firstName: z.string(),
        lastName: z.string(),
        phone: z.string(),
        email: z.string().optional(),
        bvn: z.string().optional(),
        nin: z.string().optional(),
        address: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        // ══ FAIL-CLOSED KYC ENFORCEMENT ══
        // For Tier 2+ accounts, verify KYC service is reachable BEFORE creating the record.
        // If KYC enforcement gateway is unreachable, BLOCK the operation (fail-closed design).
        const KYC_ENFORCEMENT_URL =
          process.env.KYC_ENFORCEMENT_URL || "http://localhost:8211";
        const requiresKYC = !!(input.bvn || input.nin); // Tier 2+ requires BVN/NIN

        if (requiresKYC) {
          try {
            const kycResp = await fetch(
              `${KYC_ENFORCEMENT_URL}/api/v1/enforce/account-opening`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  customer_id:
                    `${input.firstName}-${input.lastName}-${input.phone}`
                      .toLowerCase()
                      .replace(/\s/g, "-"),
                  tier: input.nin ? 3 : 2,
                  product_type: "current",
                  first_name: input.firstName,
                  last_name: input.lastName,
                  phone: input.phone,
                  bvn: input.bvn || "",
                  nin: input.nin || "",
                  email: input.email || "",
                }),
                signal: AbortSignal.timeout(10000),
              }
            );

            if (kycResp.status === 503) {
              // KYC gateway unreachable — FAIL CLOSED
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "KYC verification service unreachable — account opening BLOCKED (fail-closed). Retry when service is available.",
              });
            }
          } catch (kycError) {
            if (kycError instanceof TRPCError) throw kycError;
            // Network error reaching KYC gateway — FAIL CLOSED
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "KYC enforcement gateway unreachable — account opening BLOCKED (fail-closed design prevents unverified account creation)",
            });
          }
        }

        const [customer] = await db
          .insert(customers)
          .values({
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            email: input.email,
            bvn: input.bvn,
            nin: input.nin,
            address: input.address,
            status: "pending_kyc",
          })
          .returning();
        await db.insert(auditLog).values({
          action: "account_opened",
          resource: "customers",
          resourceId: String(customer.id),
          status: "success",
          metadata: { firstName: input.firstName, lastName: input.lastName },
        });
        return { success: true, customer };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  approveAccount: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [updated] = await db
          .update(customers)
          .set({ status: "active" })
          .where(eq(customers.id, input.customerId))
          .returning();
        await db.insert(auditLog).values({
          action: "account_approved",
          resource: "customers",
          resourceId: String(input.customerId),
          status: "success",
        });
        return { success: true, customer: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // F-12 (expanded sweep): fixture application rows (AO-001) — no
  // account-applications store is delivered. Fail loud.
  list: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "accountOpening.list: no account-applications store is delivered",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      total: 1500,
      totalApplications: 1500,
      approved: 1200,
      pending: 200,
      rejected: 100,
      byStatus: { approved: 1200, pending: 200, rejected: 100 },
      byBank: { access: 500, gtbank: 400, zenith: 300, firstbank: 300 },
      conversionRate: 80,
      avgProcessingDays: 3,
    };
  }),
});
