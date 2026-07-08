// @ts-check

/**
 * merchant.ts — P3-A Merchant Portal Router
 *
 * Procedures for the merchant-facing portal:
 *  - merchant.getProfile       — get own merchant profile
 *  - merchant.getTransactions  — list transactions processed via this merchant
 *  - merchant.getSettlements   — list settlement records
 *  - merchant.raiseDispute     — raise a dispute on a transaction
 *  - merchant.getDashboard     — summary stats (volume, count, balance)
 *  - merchant.updateProfile    — update contact details
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc, and, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  merchants,
  transactions,
  merchantSettlements,
  disputes,
} from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";
import crypto from "crypto";

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Extracts merchant session from cookie or Authorization header.
 * In production this would validate a JWT; here we use a simple lookup
 * by merchantCode passed in the X-Merchant-Code header (for demo purposes).
 */
async function getMerchantFromRequest(
  req: any
): Promise<{ id: number; merchantCode: string; businessName: string } | null> {
  const merchantCode = req.headers?.["x-merchant-code"] as string | undefined;
  if (!merchantCode) return null;
  const db = (await getDb())!;
  if (!db) throw new Error("Database connection unavailable");
  const rows = await db
    .select({
      id: merchants.id,
      merchantCode: merchants.merchantCode,
      businessName: merchants.businessName,
    })
    .from(merchants)
    .where(
      and(eq(merchants.merchantCode, merchantCode), isNull(merchants.deletedAt))
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const merchantRouter = router({
  /**
   * Get the authenticated merchant's profile.
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const merchant = await getMerchantFromRequest(ctx.req);
      if (!merchant)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Merchant session required",
        });

      const db = (await getDb())!;
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      const rows = await db
        .select()
        .from(merchants)
        .where(and(eq(merchants.id, merchant.id), isNull(merchants.deletedAt)))
        .limit(1);

      if (!rows[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Merchant not found",
        });

      const m = rows[0];
      return {
        id: m.id,
        merchantCode: m.merchantCode,
        businessName: m.businessName,
        ownerName: m.ownerName,
        email: m.email,
        phone: m.phone,
        address: m.address,
        category: m.category,
        status: m.status,
        rcNumber: m.rcNumber,
        tinNumber: m.tinNumber,
        settlementAccountNumber: m.settlementAccountNumber,
        settlementBankName: m.settlementBankName,
        walletBalance: Number(m.walletBalance),
        totalVolume: Number(m.totalVolume),
        totalTransactions: m.totalTransactions,
        createdAt: m.createdAt,
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

  /**
   * Update merchant contact details.
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        phone: z.string().min(10).max(20).optional(),
        address: z.string().max(512).optional(),
        settlementAccountNumber: z.string().max(20).optional(),
        settlementBankCode: z.string().max(10).optional(),
        settlementBankName: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx.req);
        if (!merchant)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Merchant session required",
          });

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (input.email !== undefined) updateData.email = input.email;
        if (input.phone !== undefined) updateData.phone = input.phone;
        if (input.address !== undefined) updateData.address = input.address;
        if (input.settlementAccountNumber !== undefined)
          updateData.settlementAccountNumber = input.settlementAccountNumber;
        if (input.settlementBankCode !== undefined)
          updateData.settlementBankCode = input.settlementBankCode;
        if (input.settlementBankName !== undefined)
          updateData.settlementBankName = input.settlementBankName;

        await db
          .update(merchants)
          .set(updateData)
          .where(eq(merchants.id, merchant.id));
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

  /**
   * List transactions processed via this merchant.
   */
  getTransactions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx.req);
        if (!merchant)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Merchant session required",
          });

        const db = (await getDb())!;
        if (!db) return { transactions: [], total: 0 };

        // Transactions are linked to merchants via the preferredAgentId relationship.
        // Get the merchant's preferredAgentId first, then query transactions.
        const [merchantProfile] = await db
          .select({ preferredAgentId: merchants.preferredAgentId })
          .from(merchants)
          .where(eq(merchants.id, merchant.id))
          .limit(1);

        if (!merchantProfile?.preferredAgentId) {
          return { transactions: [], total: 0 };
        }

        const rows = await db
          .select({
            id: transactions.id,
            ref: transactions.ref,
            type: transactions.type,
            amount: transactions.amount,
            fee: transactions.fee,
            status: transactions.status,
            customerPhone: transactions.customerPhone,
            createdAt: transactions.createdAt,
          })
          .from(transactions)
          .where(eq(transactions.agentId, merchantProfile.preferredAgentId))
          .orderBy(desc(transactions.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        return {
          transactions: rows.map((t: any) => ({
            ...t,
            amount: Number(t.amount),
            fee: Number(t.fee),
          })),
          total: rows.length,
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

  /**
   * List settlement records for this merchant.
   */
  getSettlements: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx.req);
        if (!merchant)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Merchant session required",
          });

        const db = (await getDb())!;
        if (!db) return { settlements: [] };

        const rows = await db
          .select()
          .from(merchantSettlements)
          .where(eq(merchantSettlements.merchantId, merchant.id))
          .orderBy(desc(merchantSettlements.createdAt))
          .limit(input.limit)
          .offset(input.offset);

        return {
          settlements: rows.map((s: any) => ({
            ...s,
            grossAmount: Number(s.grossAmount),
            feeAmount: Number(s.feeAmount),
            netAmount: Number(s.netAmount),
          })),
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

  /**
   * Raise a dispute on a transaction.
   */
  raiseDispute: protectedProcedure
    .input(
      z.object({
        transactionRef: z.string().min(1),
        reason: z.string().min(10).max(1000),
        amount: z.number().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx.req);
        if (!merchant)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Merchant session required",
          });

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Verify transaction exists
        const txRows = await db
          .select({
            id: transactions.id,
            amount: transactions.amount,
            status: transactions.status,
          })
          .from(transactions)
          .where(eq(transactions.ref, input.transactionRef))
          .limit(1);

        if (!txRows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        const tx = txRows[0];

        // Create dispute record
        const inserted = await db
          .insert(disputes)
          .values({
            transactionId: tx.id,
            raisedBy: "merchant",
            raisedByRef: merchant.merchantCode,
            reason: input.reason,
            amount: input.amount ? String(input.amount) : tx.amount,
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .returning({ id: disputes.id });

        return {
          success: true,
          disputeId: inserted[0]?.id,
          message:
            "Dispute raised successfully. Our team will review within 3 business days.",
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

  /**
   * Dashboard summary: total volume, transaction count, wallet balance, recent activity.
   */
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    try {
      const merchant = await getMerchantFromRequest(ctx.req);
      if (!merchant)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Merchant session required",
        });

      const db = (await getDb())!;
      if (!db) {
        return {
          walletBalance: 0,
          totalVolume: 0,
          totalTransactions: 0,
          pendingSettlements: 0,
          recentTransactions: [],
        };
      }

      const [profile] = await db
        .select({
          walletBalance: merchants.walletBalance,
          totalVolume: merchants.totalVolume,
          totalTransactions: merchants.totalTransactions,
          preferredAgentId: merchants.preferredAgentId,
        })
        .from(merchants)
        .where(eq(merchants.id, merchant.id))
        .limit(1);

      const recentTxs = await db
        .select({
          id: transactions.id,
          ref: transactions.ref,
          type: transactions.type,
          amount: transactions.amount,
          status: transactions.status,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .where(eq(transactions.agentId, profile?.preferredAgentId ?? 0))
        .orderBy(desc(transactions.createdAt))
        .limit(5);

      const pendingSettlements = await db
        .select({
          id: merchantSettlements.id,
          netAmount: merchantSettlements.netAmount,
        })
        .from(merchantSettlements)
        .where(
          and(
            eq(merchantSettlements.merchantId, merchant.id),
            eq(merchantSettlements.status, "pending")
          )
        );

      const pendingTotal = pendingSettlements.reduce(
        (sum: any, s: any) => sum + Number(s.netAmount),
        0
      );

      return {
        walletBalance: Number(profile?.walletBalance ?? 0),
        totalVolume: Number(profile?.totalVolume ?? 0),
        totalTransactions: profile?.totalTransactions ?? 0,
        pendingSettlements: pendingTotal,
        recentTransactions: recentTxs.map((t: any) => ({
          ...t,
          amount: Number(t.amount),
        })),
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

  /**
   * Register a new merchant (self-service onboarding).
   * Creates a merchant record with status=pending awaiting admin approval.
   */
  register: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(2).max(128),
        ownerName: z.string().min(2).max(128),
        email: z.string().email(),
        phone: z.string().min(10).max(20),
        address: z.string().min(5).max(500),
        category: z.enum([
          "retail",
          "food_beverage",
          "health",
          "education",
          "transport",
          "utilities",
          "government",
          "other",
        ]),
        rcNumber: z.string().min(6).max(32).optional(),
        tinNumber: z.string().min(8).max(32).optional(),
        settlementAccountNumber: z.string().min(10).max(20),
        settlementBankCode: z.string().min(3).max(10),
        settlementBankName: z.string().min(2).max(64),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        // Check for duplicate email
        const existing = await db
          .select({ id: merchants.id })
          .from(merchants)
          .where(
            and(eq(merchants.email, input.email), isNull(merchants.deletedAt))
          )
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A merchant account with this email already exists",
          });
        }
        // Generate unique merchant code: MC + 8 random hex chars
        const merchantCode = `MC${crypto.randomBytes(10).toString("hex").slice(0, 10).toUpperCase()}`;
        const [merchant] = await db
          .insert(merchants)
          .values({
            merchantCode,
            businessName: input.businessName,
            ownerName: input.ownerName,
            email: input.email,
            phone: input.phone,
            address: input.address,
            category: input.category,
            status: "pending",
            rcNumber: input.rcNumber ?? null,
            tinNumber: input.tinNumber ?? null,
            settlementAccountNumber: input.settlementAccountNumber,
            settlementBankCode: input.settlementBankCode,
            settlementBankName: input.settlementBankName,
            walletBalance: "0.00",
            totalVolume: "0.00",
            totalTransactions: 0,
          })
          .returning({
            id: merchants.id,
            merchantCode: merchants.merchantCode,
            businessName: merchants.businessName,
            status: merchants.status,
          });
        return {
          success: true,
          merchantCode: merchant.merchantCode,
          message:
            "Registration submitted successfully. Your account is pending review and will be activated within 1-3 business days.",
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

  /**
   * Check registration status by email (for returning applicants).
   */
  checkRegistrationStatus: protectedProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const [merchant] = await db
          .select({
            merchantCode: merchants.merchantCode,
            businessName: merchants.businessName,
            status: merchants.status,
            createdAt: merchants.createdAt,
          })
          .from(merchants)
          .where(
            and(eq(merchants.email, input.email), isNull(merchants.deletedAt))
          )
          .limit(1);
        if (!merchant) return { found: false as const };
        return { found: true as const, ...merchant };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
