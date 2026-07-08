// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  promotions,
  loyaltyAccounts,
  loyaltyTransactions,
} from "../../drizzle/ecommerce-extended-schema";
import { eq, and, sql, lte, gte } from "drizzle-orm";
import crypto from "crypto";

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

  redeemCoupon: protectedProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      await database
        .update(promotions)
        .set({ usedCount: sql`${promotions.usedCount} + 1` })
        .where(eq(promotions.code, input.code));
      return { success: true };
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
