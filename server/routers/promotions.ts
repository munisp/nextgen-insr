import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { eq, and, isNull, sql, lte, gte, count } from "drizzle-orm";
import { z } from "zod";

import {
  promotions,
  couponRedemptions,
  loyaltyAccounts,
  loyaltyTransactions,
} from "../../drizzle/insurance-extended-schema";
import { customers } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";

export const promotionsRouter = router({
  // ─── Coupon Management ───────────────────────────────────────────────────
  listPromotions: protectedProcedure
    .input(
      z.object({
        activeOnly: z.boolean().default(false),
        type: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { promotions: [], total: 0 };

      let query = database.select().from(promotions);
      if (input.activeOnly) {
        const now = new Date();
        query = query.where(
          and(
            eq(promotions.isActive, true),
            lte(promotions.startDate, now),
            gte(promotions.endDate, now)
          )
        ) as typeof query;
      }
      const results = await query;
      return { promotions: results, total: results.length };
    }),

  createPromotion: protectedProcedure
    .input(
      z.object({
        storeId: z.number().optional(),
        name: z.string(),
        code: z.string().optional(),
        type: z.enum([
          "percentage",
          "fixed_amount",
          "bogo",
          "free_shipping",
          "bundle",
          "flash_sale",
          "loyalty_points",
        ]),
        value: z.string(),
        minOrderAmount: z.string().optional(),
        maxDiscount: z.string().optional(),
        usageLimit: z.number().optional(),
        perCustomerLimit: z.number().default(1),
        applicableProducts: z.array(z.number()).default([]),
        applicableCategories: z.array(z.number()).default([]),
        startDate: z.string(),
        endDate: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const code =
        input.code ||
        `PROMO-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const [promo] = await database
        .insert(promotions)
        .values({
          ...input,
          code,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
        })
        .returning();
      return promo;
    }),

  validateCoupon: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        orderTotal: z.number(),
        /** DEPRECATED as a trust input (I-wave AB-14): session-derived. */
        customerId: z.number().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) return { valid: false, reason: "Database unavailable" };

      // I-wave AB-14: identity is session-derived, consistent with
      // redeemCoupon — per-customer limits are meaningless against a
      // client-chosen customerId.
      const [callerCustomer] = await database
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.keycloakSub, String(ctx.user.id)))
        .limit(1);
      const isStaff = ctx.user.role === "admin";
      let customerId: number | null;
      if (input.customerId != null && callerCustomer?.id !== input.customerId) {
        if (!isStaff) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot validate a coupon for a different customer" });
        }
        customerId = input.customerId;
      } else {
        customerId = callerCustomer?.id ?? null;
      }

      const now = new Date();
      const [promo] = await database
        .select()
        .from(promotions)
        .where(eq(promotions.code, input.code))
        .limit(1);

      if (!promo) return { valid: false, reason: "Invalid coupon code" };
      if (!promo.isActive)
        return { valid: false, reason: "Coupon is inactive" };
      if (new Date(promo.startDate) > now)
        return { valid: false, reason: "Coupon not yet active" };
      if (new Date(promo.endDate) < now)
        return { valid: false, reason: "Coupon has expired" };
      if (promo.usageLimit && promo.usedCount >= promo.usageLimit)
        return { valid: false, reason: "Usage limit reached" };

      // I-wave AB-14: enforce perCustomerLimit against the SAME redemption
      // ledger redeemCoupon locks on. Two-layer closure: this validation-time
      // count stops the obvious replay path, and redeemCoupon's
      // pg_advisory_xact_lock(promo, customer) + ledger count closes the
      // concurrent-redeem race — together the limit is enforced at both
      // validation and redemption.
      if (customerId != null) {
        const [usage] = await database
          .select({ count: sql<number>`COUNT(*)` })
          .from(couponRedemptions)
          .where(and(eq(couponRedemptions.promoId, promo.id), eq(couponRedemptions.customerId, customerId)));
        if (Number(usage?.count ?? 0) >= (promo.perCustomerLimit ?? 1)) {
          return { valid: false, reason: "Per-customer coupon limit reached" };
        }
      }
      if (
        promo.minOrderAmount &&
        input.orderTotal < parseFloat(promo.minOrderAmount)
      )
        return {
          valid: false,
          reason: `Minimum order of ₦${promo.minOrderAmount} required`,
        };

      // Calculate discount
      let discount = 0;
      const value = parseFloat(promo.value);
      if (promo.type === "percentage") {
        discount = input.orderTotal * (value / 100);
      } else if (promo.type === "fixed_amount") {
        discount = value;
      } else if (promo.type === "free_shipping") {
        discount = 500; // standard shipping fee
      }

      if (promo.maxDiscount) {
        discount = Math.min(discount, parseFloat(promo.maxDiscount));
      }

      return {
        valid: true,
        discount: Math.round(discount * 100) / 100,
        type: promo.type,
        name: promo.name,
      };
    }),

  // H-wave (2026-09): race-safe redemption. The previous implementation
  // incremented usedCount unconditionally — no global limit, no per-customer
  // limit at burn time, and any limit check was check-then-insert (TOCTOU).
  // Now a single transaction holds pg_advisory_xact_lock(promoId,
  // customerId) so concurrent redemptions by the same customer serialize,
  // the per-customer count is re-read under the lock, and the global usage
  // counter is an atomic guarded UPDATE (WHERE usedCount < usageLimit).
  redeemCoupon: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        /**
         * DEPRECATED as a trust input (H2, 2026-02): the redeeming customer
         * is ALWAYS derived from the authenticated session. Supplying a
         * customerId that differs from the caller's own customer profile is
         * FORBIDDEN — except for staff/admin on-behalf redemption (audited).
         */
        customerId: z.number().optional(),
        orderId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // H2: identity spoofing fix — never trust a client-supplied customerId.
      const [callerCustomer] = await database
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.keycloakSub, String(ctx.user.id)))
        .limit(1);
      const isStaff = ctx.user.role === "admin";
      let customerId: number;
      if (input.customerId != null && callerCustomer?.id !== input.customerId) {
        // On-behalf redemption is a STAFF capability, and it is audited.
        if (!isStaff) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot redeem a coupon for a different customer",
          });
        }
        customerId = input.customerId;
        await writeAuditLog({
          action: "COUPON_REDEEM_ON_BEHALF",
          resource: "coupon_redemptions",
          resourceId: String(input.customerId),
          metadata: { code: input.code, staffUser: String(ctx.user.id) },
        });
      } else {
        if (!callerCustomer) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No customer profile for the authenticated account",
          });
        }
        customerId = callerCustomer.id;
      }

      return await database.transaction(async tx => {
        const [promo] = await tx
          .select()
          .from(promotions)
          .where(eq(promotions.code, input.code))
          .limit(1);
        if (!promo)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invalid coupon code",
          });
        if (!promo.isActive)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Coupon is inactive",
          });

        // Serialize concurrent redemptions by this customer for this promo
        // (advisory xact lock — released automatically at commit/rollback).
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${promo.id}, ${customerId})`
        );

        // Per-customer limit, re-read UNDER the lock — no TOCTOU window.
        const perCustomerLimit = promo.perCustomerLimit ?? 1;
        const [customerUses] = await tx
          .select({ n: count() })
          .from(couponRedemptions)
          .where(
            and(
              eq(couponRedemptions.promoId, promo.id),
              eq(couponRedemptions.customerId, customerId)
            )
          );
        if ((customerUses?.n ?? 0) >= perCustomerLimit) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Per-customer coupon limit reached",
          });
        }

        // Global usage limit: atomic guarded increment — trips even under
        // cross-customer concurrency (single UPDATE with WHERE guard).
        const [burned] = await tx
          .update(promotions)
          .set({ usedCount: sql`${promotions.usedCount} + 1` })
          .where(
            and(
              eq(promotions.id, promo.id),
              sql`(${promotions.usageLimit} IS NULL OR ${promotions.usedCount} < ${promotions.usageLimit})`
            )
          )
          .returning({ id: promotions.id });
        if (!burned) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Coupon usage limit reached",
          });
        }

        await tx.insert(couponRedemptions).values({
          promoId: promo.id,
          customerId,
          orderId: input.orderId ?? null,
        });
        return { success: true };
      });
    }),

  // ─── Loyalty Program ─────────────────────────────────────────────────────
  getLoyaltyAccount: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [account] = await database
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.customerId, input.customerId))
        .limit(1);

      if (!account) {
        // Auto-create
        const referralCode = crypto
          .randomBytes(4)
          .toString("hex")
          .toUpperCase();
        const [newAccount] = await database
          .insert(loyaltyAccounts)
          .values({
            customerId: input.customerId,
            referralCode,
          })
          .returning();
        return newAccount;
      }
      return account;
    }),

  earnPoints: protectedProcedure
    .input(
      z.object({
        /**
         * DEPRECATED as a trust input (I-wave AB-12, 2026-02): the earning
         * customer is derived from the authenticated session. A customerId
         * that differs from the caller's own profile is a STAFF-ONLY grant
         * (audited). Points redeemable at 1pt = ₦1 — this input is funds.
         */
        customerId: z.number().optional(),
        points: z.number().int().positive().max(10_000),
        type: z.enum(["purchase", "referral", "review", "bonus"]),
        orderId: z.number().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // I-wave AB-12: identity + staff gating. Arbitrary grants to ANY
      // customerId (previously possible for any authed user) are closed.
      const [callerCustomer] = await database
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.keycloakSub, String(ctx.user.id)))
        .limit(1);
      const isStaff = ctx.user.role === "admin";
      let customerId: number;
      if (input.customerId != null && callerCustomer?.id !== input.customerId) {
        if (!isStaff) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot grant loyalty points to a different customer" });
        }
        customerId = input.customerId;
      } else {
        if (!callerCustomer) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No customer profile for the authenticated account" });
        }
        customerId = callerCustomer.id;
      }

      // Every grant is audited (funds-grade trail).
      await writeAuditLog({
        action: isStaff && customerId !== callerCustomer?.id ? "LOYALTY_POINTS_STAFF_GRANT" : "LOYALTY_POINTS_EARNED",
        resource: "loyalty_accounts",
        resourceId: String(customerId),
        status: "success",
        metadata: { points: input.points, type: input.type, actor: String(ctx.user.id), orderId: input.orderId },
      });

      // Get or create account
      let [account] = await database
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.customerId, customerId))
        .limit(1);

      if (!account) {
        const referralCode = crypto
          .randomBytes(4)
          .toString("hex")
          .toUpperCase();
        [account] = await database
          .insert(loyaltyAccounts)
          .values({ customerId, referralCode })
          .returning();
      }

      // Add points
      await database
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${input.points}`,
          lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${input.points}`,
        })
        .where(eq(loyaltyAccounts.customerId, customerId));

      // Record transaction
      await database.insert(loyaltyTransactions).values({
        accountId: account.id,
        points: input.points,
        type: input.type,
        description:
          input.description ||
          `Earned ${input.points} points from ${input.type}`,
        orderId: input.orderId,
      });

      // Upgrade tier if needed
      const newLifetime = (account.lifetimePoints || 0) + input.points;
      let tier = "bronze";
      if (newLifetime >= 10000) tier = "gold";
      else if (newLifetime >= 5000) tier = "silver";

      if (tier !== account.tier) {
        await database
          .update(loyaltyAccounts)
          .set({ tier })
          .where(eq(loyaltyAccounts.customerId, customerId));
      }

      return {
        points: input.points,
        newTier: tier,
        lifetimePoints: newLifetime,
      };
    }),

  redeemPoints: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        points: z.number(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [account] = await database
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.customerId, input.customerId))
        .limit(1);

      if (!account || account.points < input.points) {
        throw new Error("Insufficient loyalty points");
      }

      await database
        .update(loyaltyAccounts)
        .set({ points: sql`${loyaltyAccounts.points} - ${input.points}` })
        .where(eq(loyaltyAccounts.customerId, input.customerId));

      await database.insert(loyaltyTransactions).values({
        accountId: account.id,
        points: -input.points,
        type: "redemption",
        description: input.description || `Redeemed ${input.points} points`,
      });

      // Convert points to value: 100 points = ₦100
      const value = input.points;
      return {
        redeemed: input.points,
        value,
        remainingPoints: account.points - input.points,
      };
    }),

  applyReferral: protectedProcedure
    .input(
      z.object({
        /** DEPRECATED as a trust input (I-wave AB-13): session-derived. */
        customerId: z.number().optional(),
        referralCode: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // I-wave AB-13: the referee identity is session-derived (same
      // discipline as H2/AB-12) — never a client-supplied customerId.
      const [callerCustomer] = await database
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.keycloakSub, String(ctx.user.id)))
        .limit(1);
      const isStaff = ctx.user.role === "admin";
      let customerId: number;
      if (input.customerId != null && callerCustomer?.id !== input.customerId) {
        if (!isStaff) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot apply a referral for a different customer" });
        }
        customerId = input.customerId;
      } else {
        if (!callerCustomer) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No customer profile for the authenticated account" });
        }
        customerId = callerCustomer.id;
      }

      const [referrer] = await database
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.referralCode, input.referralCode))
        .limit(1);

      if (!referrer) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid referral code" });
      if (referrer.customerId === customerId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot refer yourself" });

      // I-wave AB-13: ONE-TIME per referee identity. The old code granted
      // +500 pts to the referrer on EVERY call (unbounded farming). The
      // guarded UPDATE (referredBy IS NULL) is the atomic claim: only the
      // first application wins; every re-call fails CLOSED.
      const claimed = await database
        .update(loyaltyAccounts)
        .set({ referredBy: referrer.customerId })
        .where(
          and(
            eq(loyaltyAccounts.customerId, customerId),
            isNull(loyaltyAccounts.referredBy)
          )
        )
        .returning({ id: loyaltyAccounts.id });
      if (!claimed[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A referral has already been applied to this customer",
        });
      }

      // Grant referral bonus to the referrer (once, after a successful claim).
      const referralBonus = 500; // 500 points each
      await database
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${referralBonus}`,
          lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${referralBonus}`,
        })
        .where(eq(loyaltyAccounts.id, referrer.id));

      await writeAuditLog({
        action: "LOYALTY_REFERRAL_APPLIED",
        resource: "loyalty_accounts",
        resourceId: String(customerId),
        status: "success",
        metadata: { referrerCustomerId: referrer.customerId, bonus: referralBonus, actor: String(ctx.user.id) },
      });

      return {
        success: true,
        referrerBonus: referralBonus,
        referreeBonus: referralBonus,
      };
    }),
});
