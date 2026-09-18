import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { eq, and, sql, lte, gte, count } from "drizzle-orm";
import { z } from "zod";

import {
  promotions,
  couponRedemptions,
  loyaltyAccounts,
  loyaltyTransactions,
} from "../../drizzle/insurance-extended-schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

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
        customerId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { valid: false, reason: "Database unavailable" };

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
        customerId: z.number(),
        orderId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

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
          sql`SELECT pg_advisory_xact_lock(${promo.id}, ${input.customerId})`
        );

        // Per-customer limit, re-read UNDER the lock — no TOCTOU window.
        const perCustomerLimit = promo.perCustomerLimit ?? 1;
        const [customerUses] = await tx
          .select({ n: count() })
          .from(couponRedemptions)
          .where(
            and(
              eq(couponRedemptions.promoId, promo.id),
              eq(couponRedemptions.customerId, input.customerId)
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
          customerId: input.customerId,
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
        customerId: z.number(),
        points: z.number(),
        type: z.enum(["purchase", "referral", "review", "bonus"]),
        orderId: z.number().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Get or create account
      let [account] = await database
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.customerId, input.customerId))
        .limit(1);

      if (!account) {
        const referralCode = crypto
          .randomBytes(4)
          .toString("hex")
          .toUpperCase();
        [account] = await database
          .insert(loyaltyAccounts)
          .values({ customerId: input.customerId, referralCode })
          .returning();
      }

      // Add points
      await database
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${input.points}`,
          lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${input.points}`,
        })
        .where(eq(loyaltyAccounts.customerId, input.customerId));

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
          .where(eq(loyaltyAccounts.customerId, input.customerId));
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
        customerId: z.number(),
        referralCode: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [referrer] = await database
        .select()
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.referralCode, input.referralCode))
        .limit(1);

      if (!referrer) throw new Error("Invalid referral code");
      if (referrer.customerId === input.customerId)
        throw new Error("Cannot refer yourself");

      // Grant referral bonus to both parties
      const referralBonus = 500; // 500 points each

      await database
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${referralBonus}`,
          lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${referralBonus}`,
        })
        .where(eq(loyaltyAccounts.id, referrer.id));

      // Set referredBy on new customer
      await database
        .update(loyaltyAccounts)
        .set({ referredBy: referrer.customerId })
        .where(eq(loyaltyAccounts.customerId, input.customerId));

      return {
        success: true,
        referrerBonus: referralBonus,
        referreeBonus: referralBonus,
      };
    }),
});
