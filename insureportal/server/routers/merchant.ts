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
  merchantSettlementChangeRequests,
  disputes,
  auditLog,
} from "@schema";
import { router, protectedProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { sendSms } from "../termii";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * H-wave (2026-09, verifier-falsified finding): the LEGACY static
 * X-Merchant-Code bearer path is REMOVED — not deprecated — from this
 * deployed service. Merchant identity is the authenticated Keycloak
 * principal bound to a merchant row via merchants.keycloakSub (same
 * contract as platform G1): no principal → 401, no bound merchant → 403,
 * DB unavailable → 503-class fail-closed, suspended merchant → 403.
 */
async function getMerchantFromRequest(
  ctx: TrpcContext
): Promise<{ id: number; merchantCode: string; businessName: string }> {
  const user = ctx.user;
  if (!user?.keycloakSub) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Merchant session required",
    });
  }
  let db;
  try {
    db = await getDb();
    // FAIL-CLOSED (503-class): this tree's getDb() returns a truthy NO-OP
    // chain when the database is unreachable/unconfigured — a truthy value
    // is NOT proof of availability. getPool() exposes the real connection
    // state; a null pool means identity lookup is impossible and every
    // merchant/money path must refuse.
    const { getPool } = await import("../db");
    const pool = await getPool();
    if (!pool) db = null;
  } catch (err) {
    // FAIL-CLOSED (503-class): never degrade to anonymous/unbound access.
    console.error(
      `[merchant] identity lookup DB unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Merchant identity service unavailable",
    });
  }
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Merchant identity service unavailable",
    });
  }
  const rows = await db
    .select({
      id: merchants.id,
      merchantCode: merchants.merchantCode,
      businessName: merchants.businessName,
      status: merchants.status,
    })
    .from(merchants)
    .where(
      and(
        eq(merchants.keycloakSub, user.keycloakSub),
        isNull(merchants.deletedAt)
      )
    )
    .limit(1);
  const merchant = rows[0];
  if (!merchant) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No merchant account is bound to this identity",
    });
  }
  if (merchant.status === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Merchant account is suspended",
    });
  }
  return merchant;
}

// ─── Settlement-change OTP (H-wave; mirrors platform G1 CRIT-3) ──────────────

const SETTLEMENT_OTP_EXPIRY_MINUTES = 10;
const SETTLEMENT_OTP_MAX_ATTEMPTS = 5;
/** Cooling-off: payouts are blocked to a freshly-changed settlement account. */
const SETTLEMENT_HOLD_HOURS = 24;

function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const merchantRouter = router({
  /**
   * Get the authenticated merchant's profile.
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const merchant = await getMerchantFromRequest(ctx);
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
        // H-wave (2026-09): settlement (payout destination) fields are GONE
        // from this inline update — a silent swap of the payout account was
        // full merchant-takeover cash-out. Use requestSettlementChange +
        // confirmSettlementChange (OTP + audit + hold).
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx);

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
   * H-wave: request a settlement-account change. Never applies inline —
   * creates a pending request and sends a 6-digit OTP to the merchant's
   * REGISTERED phone (the number on file, not caller-supplied).
   */
  requestSettlementChange: protectedProcedure
    .input(
      z.object({
        newAccountNumber: z.string().min(10).max(20),
        newBankCode: z.string().min(3).max(10),
        newBankName: z.string().min(2).max(64),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx);
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const [profile] = await db
          .select({ phone: merchants.phone, email: merchants.email })
          .from(merchants)
          .where(eq(merchants.id, merchant.id))
          .limit(1);
        if (!profile?.phone)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No registered phone on file for OTP delivery",
          });

        // One live request at a time: expire any existing pending rows.
        await db
          .update(merchantSettlementChangeRequests)
          .set({ status: "expired" })
          .where(
            and(
              eq(merchantSettlementChangeRequests.merchantId, merchant.id),
              eq(merchantSettlementChangeRequests.status, "pending")
            )
          );

        const otp = generateOtp();
        const hashedOtp = await bcrypt.hash(otp, 10);
        const otpExpiresAt = new Date(
          Date.now() + SETTLEMENT_OTP_EXPIRY_MINUTES * 60 * 1000
        );
        const [request] = await db
          .insert(merchantSettlementChangeRequests)
          .values({
            merchantId: merchant.id,
            newAccountNumber: input.newAccountNumber,
            newBankCode: input.newBankCode,
            newBankName: input.newBankName,
            hashedOtp,
            otpExpiresAt,
            requestedBy: ctx.user!.id,
            status: "pending",
          })
          .returning({ id: merchantSettlementChangeRequests.id });

        const smsResult = await sendSms(
          profile.phone,
          `Your merchant settlement-account change code is: ${otp}. Valid for ${SETTLEMENT_OTP_EXPIRY_MINUTES} minutes. If you did not request this, contact support immediately.`
        );
        if (!smsResult.success) {
          // FAIL-CLOSED: without OTP delivery there is no verified channel.
          await db
            .update(merchantSettlementChangeRequests)
            .set({ status: "rejected" })
            .where(eq(merchantSettlementChangeRequests.id, request.id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Could not deliver the verification code; settlement change aborted",
          });
        }

        return {
          success: true,
          requestId: request.id,
          message: `A verification code has been sent to your registered phone. The change takes effect only after confirmation and a ${SETTLEMENT_HOLD_HOURS}h payout hold.`,
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
   * H-wave: confirm a settlement-account change with the OTP sent to the
   * registered phone. Applies the change, writes an audit row, and starts a
   * payout hold (cooling-off) on the new account.
   */
  confirmSettlementChange: protectedProcedure
    .input(
      z.object({
        requestId: z.number().int(),
        otp: z.string().length(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const merchant = await getMerchantFromRequest(ctx);
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const [request] = await db
          .select()
          .from(merchantSettlementChangeRequests)
          .where(
            and(
              eq(merchantSettlementChangeRequests.id, input.requestId),
              eq(merchantSettlementChangeRequests.merchantId, merchant.id)
            )
          )
          .limit(1);
        if (!request || request.status !== "pending")
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No pending settlement change request",
          });
        if (request.otpAttempts >= SETTLEMENT_OTP_MAX_ATTEMPTS) {
          await db
            .update(merchantSettlementChangeRequests)
            .set({ status: "locked" })
            .where(eq(merchantSettlementChangeRequests.id, request.id));
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Verification code locked after too many attempts; request a new code",
          });
        }
        if (request.otpExpiresAt.getTime() < Date.now()) {
          await db
            .update(merchantSettlementChangeRequests)
            .set({ status: "expired" })
            .where(eq(merchantSettlementChangeRequests.id, request.id));
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Verification code expired",
          });
        }
        const ok = await bcrypt.compare(input.otp, request.hashedOtp);
        if (!ok) {
          await db
            .update(merchantSettlementChangeRequests)
            .set({ otpAttempts: request.otpAttempts + 1 })
            .where(eq(merchantSettlementChangeRequests.id, request.id));
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Invalid verification code",
          });
        }

        const now = new Date();
        const holdUntil = new Date(
          now.getTime() + SETTLEMENT_HOLD_HOURS * 3600 * 1000
        );
        await db.transaction(async tx => {
          await tx
            .update(merchants)
            .set({
              settlementAccountNumber: request.newAccountNumber,
              settlementBankCode: request.newBankCode,
              settlementBankName: request.newBankName,
              updatedAt: now,
            })
            .where(eq(merchants.id, merchant.id));
          await tx
            .update(merchantSettlementChangeRequests)
            .set({ status: "applied", appliedAt: now, holdUntil })
            .where(eq(merchantSettlementChangeRequests.id, request.id));
          await tx.insert(auditLog).values({
            action: "MERCHANT_SETTLEMENT_ACCOUNT_CHANGED",
            resource: "merchants",
            resourceId: String(merchant.id),
            status: "success",
            metadata: {
              requestId: request.id,
              requestedBy: request.requestedBy,
              confirmedBy: ctx.user!.id,
              holdUntil: holdUntil.toISOString(),
            },
          });
        });

        return {
          success: true,
          holdUntil,
          message: `Settlement account updated. Payouts to the new account are held until ${holdUntil.toISOString()}.`,
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
        const merchant = await getMerchantFromRequest(ctx);
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
        const merchant = await getMerchantFromRequest(ctx);
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
        const merchant = await getMerchantFromRequest(ctx);
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
      const merchant = await getMerchantFromRequest(ctx);
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
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // H-wave (2026-09): registration is bound to the authenticated
        // Keycloak principal; re-registering with the same identity is
        // IDEMPOTENT (returns the existing application).
        const keycloakSub = ctx.user?.keycloakSub;
        if (!keycloakSub)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Authenticated identity required",
          });
        const [bound] = await db
          .select({
            id: merchants.id,
            merchantCode: merchants.merchantCode,
          })
          .from(merchants)
          .where(
            and(
              eq(merchants.keycloakSub, keycloakSub),
              isNull(merchants.deletedAt)
            )
          )
          .limit(1);
        if (bound) {
          return {
            success: true,
            idempotent: true as const,
            merchantCode: bound.merchantCode,
            message:
              "A merchant application already exists for this identity.",
          };
        }

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
            keycloakSub,
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
          idempotent: false as const,
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
        // G1 fix-wave (audit CRIT-2, 2026-06): return STATUS ONLY — the
        // merchantCode is the merchant credential and must never be an
        // email-keyed oracle.
        const [merchant] = await db
          .select({
            status: merchants.status,
            createdAt: merchants.createdAt,
          })
          .from(merchants)
          .where(
            and(eq(merchants.email, input.email), isNull(merchants.deletedAt))
          )
          .limit(1);
        if (!merchant) return { found: false as const };
        return {
          found: true as const,
          status: merchant.status,
          createdAt: merchant.createdAt,
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
});
