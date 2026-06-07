/**
 * Stripe Integration Router — InsurePortal InsurePortal Platform
 *
 * Full Stripe integration: checkout sessions, subscription management,
 * payment history, customer creation, and user linking.
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import Stripe from "stripe";
import { AGENT_PLANS, ONE_TIME_PRODUCTS } from "./products";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key)
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    _stripe = new Stripe(key, {
      apiVersion: "2025-04-30.basil" as any,
    });
  }
  return _stripe;
}

// ── Helper: Get or create Stripe customer for a user ──────────────────────────
async function getOrCreateStripeCustomer(
  userId: number,
  email: string,
  name: string | null
): Promise<string> {
  const db = (await getDb())!;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user?.stripeCustomerId) return user.stripeCustomerId;

  const customer = await getStripe().customers.create({
    email,
    name: name || undefined,
    metadata: { userId: userId.toString(), platform: "insureportal-pos" },
  });

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return customer.id;
}

export const stripeRouter = router({
  // ── Public: Get available plans ──────────────────────────────────────────────
  getPlans: publicProcedure.query(() => {
    return { plans: AGENT_PLANS, oneTimeProducts: ONE_TIME_PRODUCTS };
  }),

  // ── Protected: Create subscription checkout session ──────────────────────────
  createSubscriptionCheckout: protectedProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const plan = AGENT_PLANS.find(p => p.id === input.planId);
      if (!plan) throw new Error("Plan not found");

      const origin = ctx.req?.headers?.origin || "http://localhost:3000";
      const customerId = await getOrCreateStripeCustomer(
        ctx.user.id,
        ctx.user.email || "",
        ctx.user.name
      );

      const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: plan.name, description: plan.description },
              unit_amount: plan.monthlyPriceUSD,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/payments?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/payments?status=cancelled`,
        allow_promotion_codes: true,
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_email: ctx.user.email || "",
          customer_name: ctx.user.name || "",
          plan_id: plan.id,
          plan_name: plan.name,
        },
      });

      return { url: session.url, sessionId: session.id };
    }),

  // ── Protected: Create one-time payment checkout session ──────────────────────
  createOneTimeCheckout: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const product = ONE_TIME_PRODUCTS.find(p => p.id === input.productId);
      if (!product) throw new Error("Product not found");

      const origin = ctx.req?.headers?.origin || "http://localhost:3000";
      const customerId = await getOrCreateStripeCustomer(
        ctx.user.id,
        ctx.user.email || "",
        ctx.user.name
      );

      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: product.name,
                description: product.description,
              },
              unit_amount: product.priceUSD,
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/payments?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/payments?status=cancelled`,
        allow_promotion_codes: true,
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_email: ctx.user.email || "",
          product_id: product.id,
          product_name: product.name,
        },
      });

      return { url: session.url, sessionId: session.id };
    }),

  // ── Protected: Get user's payment history ────────────────────────────────────
  getPaymentHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = (await getDb())!;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (!user?.stripeCustomerId) return { payments: [] };

    try {
      const paymentIntents = await getStripe().paymentIntents.list({
        customer: user.stripeCustomerId,
        limit: 50,
      });
      return {
        payments: paymentIntents.data.map(pi => ({
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          status: pi.status,
          description: pi.description,
          createdAt: new Date(pi.created * 1000).toISOString(),
          metadata: pi.metadata,
        })),
      };
    } catch {
      return { payments: [] };
    }
  }),

  // ── Protected: Get user's subscription status ────────────────────────────────
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = (await getDb())!;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (!user?.stripeCustomerId) return { subscriptions: [], activePlan: null };

    try {
      const subscriptions = await getStripe().subscriptions.list({
        customer: user.stripeCustomerId,
        limit: 10,
      });
      const activeSub = subscriptions.data.find(s => s.status === "active");
      return {
        subscriptions: subscriptions.data.map(sub => ({
          id: sub.id,
          status: sub.status,
          planId: sub.metadata?.plan_id || user.stripePlanId || "unknown",
          currentPeriodEnd: new Date(
            ((sub as any).current_period_end || 0) * 1000
          ).toISOString(),
          cancelAtPeriodEnd: (sub as any).cancel_at_period_end || false,
        })),
        activePlan: activeSub
          ? {
              planId: activeSub.metadata?.plan_id || user.stripePlanId,
              planName: activeSub.metadata?.plan_name || "Active Plan",
              status: activeSub.status,
            }
          : null,
      };
    } catch {
      return { subscriptions: [], activePlan: null };
    }
  }),

  // ── Protected: Cancel subscription ───────────────────────────────────────────
  cancelSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      if (!user?.stripeCustomerId) throw new Error("No Stripe customer found");

      const sub = await getStripe().subscriptions.retrieve(
        input.subscriptionId
      );
      if ((sub as any).customer !== user.stripeCustomerId) {
        throw new Error("Subscription does not belong to this user");
      }

      const cancelled = await getStripe().subscriptions.update(
        input.subscriptionId,
        {
          cancel_at_period_end: true,
        }
      );
      return {
        id: cancelled.id,
        status: cancelled.status,
        cancelAtPeriodEnd: (cancelled as any).cancel_at_period_end,
      };
    }),

  // ── Protected: Get checkout session details ──────────────────────────────────
  getCheckoutSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      try {
        const session = await getStripe().checkout.sessions.retrieve(
          input.sessionId
        );
        return {
          id: session.id,
          status: session.status,
          paymentStatus: session.payment_status,
          amountTotal: session.amount_total,
          currency: session.currency,
        };
      } catch {
        return null;
      }
    }),

  // ── Protected: Create customer portal session ────────────────────────────────
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const db = (await getDb())!;
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (!user?.stripeCustomerId)
      throw new Error(
        "No Stripe customer found. Please make a purchase first."
      );

    const origin = ctx.req?.headers?.origin || "http://localhost:3000";
    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/payments`,
    });
    return { url: portalSession.url };
  }),
});
