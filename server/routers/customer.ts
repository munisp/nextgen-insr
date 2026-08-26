/**
 * Customer Portal tRPC Router
 * Covers all 13 pages of the Customer Portal:
 * Home, Account, Transactions, Transfer, Bills, QR Pay,
 * Receipts, Notifications, Disputes, Loyalty, Profile, KYC, Support.
 *
 * Customers are identified by their phone number (unique) and authenticate
 * via OTP or Keycloak SSO. The customers table has no userId FK — we look
 * up by ctx.user.id mapped to customers.keycloakSub.
 */
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { eq, desc, and, gte, lte, count, sql } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  transactions,
  disputes,
  qrCodes,
  kycSessions,
  shareableLinks,
  fido2Credentials,
  fido2Challenges,
  creditScoreHistory,
  creditApplications,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ── Customer-scoped procedure ─────────────────────────────────────────────────
const customerProcedure = protectedProcedure;

/** Resolve the customer row for the currently authenticated user */
async function resolveCustomer(userId: number | string) {
  const db = (await getDb())!;
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.keycloakSub, String(userId)))
    .limit(100);
  if (!customer)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Customer profile not found",
    });
  return { db, customer };
}

export const customerRouter = router({
  // ── Account ────────────────────────────────────────────────────────────────
  account: router({
    me: customerProcedure.query(async ({ ctx }) => {
      try {
        const { customer } = await resolveCustomer(ctx.user.id);
        // Never return sensitive fields
        const { passwordHash: _, refreshToken: __, ...safe } = customer;
        return safe;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
    update: customerProcedure
      .input(
        z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          email: z.string().email().optional(),
          address: z.string().optional(),
          dateOfBirth: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const [updated] = await db
            .update(customers)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(customers.id, customer.id))
            .returning();
          const { passwordHash: _, refreshToken: __, ...safe } = updated;
          return safe;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    balance: customerProcedure.query(async ({ ctx }) => {
      try {
        const { customer } = await resolveCustomer(ctx.user.id);
        return {
          walletBalance: customer.walletBalance,
          dailyLimit: customer.dailyLimit,
          monthlyLimit: customer.monthlyLimit,
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
    register: protectedProcedure
      .input(
        z.object({
          firstName: z.string(),
          lastName: z.string(),
          phone: z.string(),
          email: z.string().email().optional(),
          bvn: z.string().length(11).optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          const [existing] = await db
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.phone, input.phone))
            .limit(100);
          if (existing)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Phone number already registered",
            });
          const [customer] = await db
            .insert(customers)
            .values(input as any)
            .returning();
          const { passwordHash: _, refreshToken: __, ...safe } = customer;
          return safe;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── Transactions ───────────────────────────────────────────────────────────
  transactions: router({
    list: customerProcedure
      .input(
        z.object({
          page: z.number().default(1),
          limit: z.number().default(20),
          from: z.date().optional(),
          to: z.date().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const offset = (input.page - 1) * input.limit;
          const conditions = [eq(transactions.customerPhone, customer.phone)];
          if (input.from)
            conditions.push(gte(transactions.createdAt, input.from));
          if (input.to) conditions.push(lte(transactions.createdAt, input.to));
          const where = and(...conditions);
          const [items, [{ total }]] = await Promise.all([
            db
              .select()
              .from(transactions)
              .where(where)
              .orderBy(desc(transactions.createdAt))
              .limit(input.limit)
              .offset(offset),
            db.select({ total: count() }).from(transactions).where(where),
          ]);
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
    receipt: protectedProcedure
      .input(z.object({ ref: z.string() }))
      .query(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "NOT_FOUND" });
          const [tx] = await db
            .select()
            .from(transactions)
            .where(eq(transactions.ref, input.ref))
            .limit(100);
          if (!tx)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Transaction not found",
            });
          return tx;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    stats: customerProcedure
      .input(
        z.object({ period: z.enum(["week", "month", "year"]).default("month") })
      )
      .query(async ({ ctx }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const from = new Date();
          from.setMonth(from.getMonth() - 1);
          const [stats] = await db
            .select({
              txCount: count(),
              volume: sql<string>`COALESCE(SUM(amount::numeric),0)`,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.customerPhone, customer.phone),
                gte(transactions.createdAt, from)
              )
            );
          return stats;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── QR Pay ────────────────────────────────────────────────────────────────
  qr: router({
    resolve: protectedProcedure
      .input(z.object({ code: z.string() }))
      .query(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "NOT_FOUND" });
          const [qr] = await db
            .select()
            .from(qrCodes)
            .where(eq(qrCodes.code, input.code))
            .limit(100);
          if (!qr)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "QR code not found",
            });
          if (qr.expiresAt && qr.expiresAt < new Date())
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "QR code has expired",
            });
          return qr;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    resolveLink: protectedProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "NOT_FOUND" });
          const [link] = await db
            .select()
            .from(shareableLinks)
            .where(eq(shareableLinks.slug, input.slug))
            .limit(100);
          if (!link)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Payment link not found",
            });
          if (link.expiresAt && link.expiresAt < new Date())
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Payment link has expired",
            });
          return link;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── Disputes ───────────────────────────────────────────────────────────────
  disputes: router({
    list: customerProcedure
      .input(
        z.object({ page: z.number().default(1), limit: z.number().default(10) })
      )
      .query(async ({ ctx, input }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const offset = (input.page - 1) * input.limit;
          // Filter by customer phone in transactionRef lookup — disputes are agent-owned
          // but we can find customer disputes by matching phone in the transaction
          const [items, [{ total }]] = await Promise.all([
            db
              .select()
              .from(disputes)
              .where(eq(disputes.agentId, customer.preferredAgentId ?? 0))
              .orderBy(desc(disputes.createdAt))
              .limit(input.limit)
              .offset(offset),
            db
              .select({ total: count() })
              .from(disputes)
              .where(eq(disputes.agentId, customer.preferredAgentId ?? 0)),
          ]);
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
    raise: customerProcedure
      .input(
        z.object({
          transactionRef: z.string(),
          transactionId: z.number(),
          reason: z.string(),
          evidence: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const ref = `DSP-C-${crypto.randomUUID().toUpperCase()}`;
          const [dispute] = await db
            .insert(disputes)
            .values({
              ref,
              agentId: customer.preferredAgentId ?? 0,
              transactionRef: input.transactionRef,
              transactionId: input.transactionId,
              reason: input.reason,
              evidence: input.evidence,
            })
            .returning();
          return dispute;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── KYC ────────────────────────────────────────────────────────────────────
  kyc: router({
    status: customerProcedure.query(async ({ ctx }) => {
      try {
        const { db, customer } = await resolveCustomer(ctx.user.id);
        const [session] = await db
          .select()
          .from(kycSessions)
          .where(eq(kycSessions.agentId, customer.preferredAgentId ?? 0))
          .orderBy(desc(kycSessions.createdAt))
          .limit(1);
        return session ?? null;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
    initiate: customerProcedure
      .input(
        z.object({
          docType: z.enum([
            "NIN",
            "BVN_CARD",
            "PASSPORT",
            "DRIVERS_LICENCE",
            "VOTER_CARD",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const [session] = await db
            .insert(kycSessions)
            .values({
              agentId: customer.preferredAgentId ?? 0,
              docType: input.docType,
            })
            .returning();
          return session;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── FIDO2 / WebAuthn CRUD ──────────────────────────────────────────────────
  fido2: router({
    listCredentials: customerProcedure.query(async ({ ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database connection unavailable");
        return db
          .select({
            id: fido2Credentials.id,
            credentialId: fido2Credentials.credentialId,
            deviceType: fido2Credentials.deviceType,
            transports: fido2Credentials.transports,
            status: fido2Credentials.status,
            lastUsedAt: fido2Credentials.lastUsedAt,
            createdAt: fido2Credentials.createdAt,
          })
          .from(fido2Credentials)
          .where(eq(fido2Credentials.userId, Number(ctx.user.id)))
          .limit(100);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
    // F6-10: passkey registration previously stored caller-supplied public
    // keys with NO attestation verification — a decorative control that let
    // any session register any "passkey". Attestation verification is not
    // wired in this deployment, so registration fails LOUD instead of
    // asserting an unverified authenticator.
    registerCredential: customerProcedure
      .input(
        z.object({
          credentialId: z.string(),
          publicKey: z.string(),
          deviceType: z.string().optional(),
          transports: z.array(z.string()).default([]),
        })
      )
      .mutation(() => {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "Passkey registration is unavailable: server-side WebAuthn attestation verification is not wired in this deployment, so credentials cannot be verified or trusted. Passkey sign-in is not offered.",
        });
      }),
    revokeCredential: customerProcedure
      .input(z.object({ credentialId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          await db
            .update(fido2Credentials)
            .set({ status: "revoked" })
            .where(
              and(
                eq(fido2Credentials.credentialId, input.credentialId),
                eq(fido2Credentials.userId, Number(ctx.user.id))
              )
            );
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
    // F6-10: challenges exist only to bootstrap registration/authentication
    // ceremonies that this deployment cannot verify — issuing them pretends a
    // passkey flow exists. Fail loud instead.
    createChallenge: protectedProcedure
      .input(
        z.object({
          type: z.enum(["registration", "authentication"]),
          userId: z.number().optional(),
        })
      )
      .mutation(() => {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "WebAuthn challenges are unavailable: no WebAuthn registration or authentication ceremony is implemented server-side in this deployment.",
        });
      }),
    verifyChallenge: protectedProcedure
      .input(z.object({ challenge: z.string() }))
      .query(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new Error("Database connection unavailable");
          const now = new Date();
          const [row] = await db
            .select()
            .from(fido2Challenges)
            .where(eq(fido2Challenges.challenge, input.challenge))
            .limit(1);
          if (!row || row.expiresAt < now) return null;
          await db
            .update(fido2Challenges)
            .set({ usedAt: now })
            .where(eq(fido2Challenges.id, row.id));
          return { valid: true, type: row.type, userId: row.userId };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── Credit Score & Applications CRUD ────────────────────────────────────────────
  credit: router({
    scoreHistory: customerProcedure
      .input(z.object({ agentId: z.number(), limit: z.number().default(12) }))
      .query(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new Error("Database connection unavailable");
          return db
            .select()
            .from(creditScoreHistory)
            .where(eq(creditScoreHistory.agentId, input.agentId))
            .orderBy(desc(creditScoreHistory.computedAt))
            .limit(input.limit);
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    addScore: protectedProcedure
      .input(
        z.object({
          agentId: z.number(),
          score: z.number().min(0).max(1000),
          factors: z.record(z.string(), z.number()).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          if (ctx.user.role !== "admin")
            throw new TRPCError({ code: "FORBIDDEN" });
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          const rating =
            input.score >= 800
              ? "AAA"
              : input.score >= 700
                ? "AA"
                : input.score >= 600
                  ? "A"
                  : input.score >= 500
                    ? "BBB"
                    : input.score >= 400
                      ? "BB"
                      : input.score >= 300
                        ? "B"
                        : input.score >= 200
                          ? "CCC"
                          : "D";
          const [row] = await db
            .insert(creditScoreHistory)
            .values({
              agentId: input.agentId,
              score: input.score,
              rating,
              factors: input.factors ?? {},
              computedAt: new Date(),
            })
            .returning();
          return row;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    listApplications: protectedProcedure
      .input(
        z.object({
          agentId: z.number().optional(),
          status: z.string().optional(),
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
      )
      .query(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new Error("Database connection unavailable");
          const conditions: ReturnType<typeof eq>[] = [];
          if (input.agentId)
            conditions.push(eq(creditApplications.agentId, input.agentId));
          if (input.status)
            conditions.push(
              sql`${creditApplications.status} = ${input.status}`
            );
          return db
            .select()
            .from(creditApplications)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(creditApplications.createdAt))
            .limit(input.limit)
            .offset(input.offset);
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    applyForCredit: customerProcedure
      .input(
        z.object({
          agentId: z.number(),
          requestedAmount: z.string(),
          termDays: z.number().default(30),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          const [row] = await db
            .insert(creditApplications)
            .values({
              agentId: input.agentId,
              requestedAmount: input.requestedAmount,
              termDays: input.termDays,
              status: "pending",
            })
            .returning();
          return row;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
    reviewApplication: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["approved", "rejected"]),
          approvedAmount: z.string().optional(),
          reviewNote: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          if (ctx.user.role !== "admin")
            throw new TRPCError({ code: "FORBIDDEN" });
          const db = (await getDb())!;
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          const [row] = await db
            .update(creditApplications)
            .set({
              status: input.status,
              approvedAmount: input.approvedAmount,
              reviewNote: input.reviewNote,
              reviewedBy: String(ctx.user.id),
              reviewedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(creditApplications.id, input.id))
            .returning();
          return row;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),

  // ── Profile (alias of account.me/update for mobile clients) ───────────────
  profile: router({
    get: customerProcedure.query(async ({ ctx }) => {
      try {
        const { customer } = await resolveCustomer(ctx.user.id);
        const { passwordHash: _, refreshToken: __, ...safe } = customer;
        return safe;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
    update: customerProcedure
      .input(
        z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          email: z.string().email().optional(),
          address: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { db, customer } = await resolveCustomer(ctx.user.id);
          const [updated] = await db
            .update(customers)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(customers.id, customer.id))
            .returning();
          const { passwordHash: _, refreshToken: __, ...safe } = updated;
          return safe;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error ? error.message : "Internal server error",
          });
        }
      }),
  }),
});
