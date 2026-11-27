import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, writeAuditLog } from "../db";
import {
  promotions,
  loyaltyAccounts,
  loyaltyTransactions,
  couponRedemptions,
  customers,
  transactions,
} from "../../drizzle/insurance-extended-schema";
import { eq, and, sql, lte, gte, count, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
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
            lte(promotions.startsAt, now),
            gte(promotions.endsAt, now)
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
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const code =
        input.code ||
        `PROMO-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      // AB-14: map to real schema columns (the previous spread wrote
      // non-existent fields). perCustomerLimit persists for enforcement.
      const [promo] = await database
        .insert(promotions)
        .values({
          tenantId: (ctx.user as any)?.tenantId ?? 0,
          code,
          description: input.name,
          discountType: input.type,
          discountValue: input.value,
          minPurchaseAmount: input.minOrderAmount,
          maxUsageCount: input.usageLimit,
          perCustomerLimit: input.perCustomerLimit,
          startsAt: new Date(input.startDate),
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
      if (promo.startsAt && new Date(promo.startsAt) > now)
        return { valid: false, reason: "Coupon not yet active" };
      const expiry = promo.endsAt ?? promo.endDate;
      if (expiry && new Date(expiry) < now)
        return { valid: false, reason: "Coupon has expired" };
      // AB-14: global usage limit checked against the SAME column the
      // redeem path increments (usageCount) — the previous usedCount /
      // usageCount mismatch meant the limit never tripped.
      if (promo.maxUsageCount && (promo.usageCount ?? 0) >= promo.maxUsageCount)
        return { valid: false, reason: "Usage limit reached" };

      // AB-14: per-customer limit enforcement (multi-account coupon farming).
      const perCustomerLimit = promo.perCustomerLimit ?? 1;
      const [customerUses] = await database
        .select({ n: count() })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.promoId, promo.id),
            eq(couponRedemptions.customerId, input.customerId)
          )
        );
      if (customerUses && customerUses.n >= perCustomerLimit)
        return { valid: false, reason: "Per-customer coupon limit reached" };

      if (
        promo.minPurchaseAmount &&
        input.orderTotal < parseFloat(promo.minPurchaseAmount)
      )
        return {
          valid: false,
          reason: `Minimum order of ₦${promo.minPurchaseAmount} required`,
        };

      // Calculate discount
      let discount = 0;
      const value = parseFloat(promo.discountValue ?? "0");
      if (promo.discountType === "percentage") {
        discount = input.orderTotal * (value / 100);
      } else if (promo.discountType === "fixed_amount") {
        discount = value;
      } else if (promo.discountType === "free_shipping") {
        discount = 500; // standard shipping fee
      }

      return {
        valid: true,
        discount: Math.round(discount * 100) / 100,
        type: promo.discountType,
        name: promo.description ?? promo.code,
      };
    }),

  redeemCoupon: protectedProcedure
    .input(z.object({ code: z.string(), customerId: z.number(), orderId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [promo] = await database
        .select()
        .from(promotions)
        .where(eq(promotions.code, input.code))
        .limit(1);
      if (!promo) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid coupon code" });
      if (!promo.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "Coupon is inactive" });

      // AB-14: per-customer limit, enforced at burn time (not just validate).
      const perCustomerLimit = promo.perCustomerLimit ?? 1;
      const [customerUses] = await database
        .select({ n: count() })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.promoId, promo.id),
            eq(couponRedemptions.customerId, input.customerId)
          )
        );
      if (customerUses && customerUses.n >= perCustomerLimit) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Per-customer coupon limit reached" });
      }

      // AB-14: atomic guarded increment — the global usage limit trips even
      // under concurrent redemptions (single UPDATE with WHERE guard).
      const [burned] = await database
        .update(promotions)
        .set({ usageCount: sql`${promotions.usageCount} + 1` })
        .where(
          and(
            eq(promotions.id, promo.id),
            sql`(${promotions.maxUsageCount} IS NULL OR ${promotions.usageCount} < ${promotions.maxUsageCount})`
          )
        )
        .returning();
      if (!burned) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Coupon usage limit reached" });
      }

      await database.insert(couponRedemptions).values({
        promoId: promo.id,
        customerId: input.customerId,
        orderId: input.orderId,
      });
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

  // AB-12: earnPoints is SERVER-COMPUTED. Clients never supply the points
  // amount. Purchase points derive from a verified successful transaction;
  // other types use fixed server-side constants; "bonus" is staff-only.
  earnPoints: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        type: z.enum(["purchase", "referral", "review", "bonus"]),
        orderId: z.number().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Compute points server-side.
      let points: number;
      if (input.type === "purchase") {
        if (!input.orderId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "orderId is required for purchase points" });
        }
        const [tx] = await database
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.orderId))
          .limit(1);
        if (!tx || tx.status !== "success") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Qualifying transaction not found" });
        }
        // One award per transaction — no double-farming on retry.
        const [existing] = await database
          .select({ id: loyaltyTransactions.id })
          .from(loyaltyTransactions)
          .where(
            and(
              eq(loyaltyTransactions.referenceId, input.orderId),
              eq(loyaltyTransactions.type, "purchase")
            )
          )
          .limit(1);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Points already awarded for this transaction" });
        }
        points = Math.floor(parseFloat(tx.amount) / 100); // ₦100 = 1 point
      } else if (input.type === "referral") {
        points = 500;
      } else if (input.type === "review") {
        points = 50;
      } else {
        // bonus — arbitrary grants are staff-only and capped.
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only staff can grant bonus points" });
        }
        points = 100;
      }
      if (!(points > 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No points earned" });
      }

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
          .values({ customerId: input.customerId, userId: ctx.user!.id, tenantId: 0, referralCode })
          .returning();
      }

      // Add points
      await database
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${points}`,
          lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${points}`,
        })
        .where(eq(loyaltyAccounts.customerId, input.customerId));

      // Record transaction
      await database.insert(loyaltyTransactions).values({
        accountId: account.id,
        points,
        type: input.type,
        tenantId: account.tenantId ?? 0,
        description:
          input.description ||
          `Earned ${points} points from ${input.type}`,
        referenceId: input.orderId,
      });

      // Upgrade tier if needed
      const newLifetime = (account.lifetimePoints || 0) + points;
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
        points,
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

  // 2026-11-27 (W32-B): ported byte-exact from main
  // server/routers/promotions.ts applyReferral (I-wave AB-13 session
  // binding + I2-wave 2026-02 transaction wrapping). The pre-port portal
  // variant trusted a client-supplied customerId (any authenticated caller
  // could apply a referral to an arbitrary customer account) and ran the
  // one-time claim + both bonus credits + both ledger inserts OUTSIDE any
  // transaction — a crash after the claim permanently locked the referral
  // unpaid (referredBy set, guard blocks retry, bonuses never granted).
  // Documented portal deltas from main's version:
  //   1. Portal KEEPS the two referral loyalty_transactions ledger rows
  //      (main's variant writes none). The portal ledger is the audit
  //      trail the W31-D contract pins, and the portal
  //      loyalty_transactions schema requires tenantId NOT NULL (main's
  //      table shape differs). The rows are moved INSIDE the transaction
  //      so they commit or roll back with the claim/credits; the guarded
  //      claim therefore also returns tenantId.
  //   2. writeAuditLog is the portal db.ts variant (status is a required
  //      field of its parameter type; main's is optional). Same call
  //      shape otherwise.
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
      // I2-wave 2026-02: the response advertises a REFEREE bonus — credit it
      // for real. Claim + both credits happen in ONE transaction so a partial
      // grant can never persist; the one-time guarded claim still gates it.
      const referralBonus = 500; // 500 points each
      await database.transaction(async (tx) => {
        const claimed = await tx
          .update(loyaltyAccounts)
          .set({ referredBy: referrer.customerId })
          .where(
            and(
              eq(loyaltyAccounts.customerId, customerId),
              isNull(loyaltyAccounts.referredBy)
            )
          )
          // Portal delta 1 (2026-11-27, W32-B): also return tenantId for
          // the portal-retained referral ledger rows below.
          .returning({ id: loyaltyAccounts.id, tenantId: loyaltyAccounts.tenantId });
        if (!claimed[0]) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A referral has already been applied to this customer",
          });
        }

        // Referrer bonus (once, after a successful claim)…
        await tx
          .update(loyaltyAccounts)
          .set({
            points: sql`${loyaltyAccounts.points} + ${referralBonus}`,
            lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${referralBonus}`,
          })
          .where(eq(loyaltyAccounts.id, referrer.id));

        // …and the referee bonus the API contract advertises.
        await tx
          .update(loyaltyAccounts)
          .set({
            points: sql`${loyaltyAccounts.points} + ${referralBonus}`,
            lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${referralBonus}`,
          })
          .where(eq(loyaltyAccounts.id, claimed[0].id));

        // Portal delta 1 (2026-11-27, W32-B): portal-retained referral
        // ledger rows (audit trail pinned by the W31-D contract), now
        // written INSIDE the same transaction so they can never persist
        // without the credits they describe.
        await tx.insert(loyaltyTransactions).values({
          accountId: referrer.id,
          points: referralBonus,
          type: "referral",
          tenantId: referrer.tenantId ?? 0,
          description: `Referral bonus for customer ${customerId}`,
        });
        await tx.insert(loyaltyTransactions).values({
          accountId: claimed[0].id,
          points: referralBonus,
          type: "referral",
          tenantId: claimed[0].tenantId ?? 0,
          description: "Welcome referral bonus",
        });
      });

      await writeAuditLog({
        action: "LOYALTY_REFERRAL_APPLIED",
        resource: "loyalty_accounts",
        resourceId: String(customerId),
        status: "success",
        metadata: { referrerCustomerId: referrer.customerId, bonus: referralBonus, refereeCredited: true, actor: String(ctx.user.id) },
      });

      return {
        success: true,
        referrerBonus: referralBonus,
        referreeBonus: referralBonus,
      };
    }),
});
