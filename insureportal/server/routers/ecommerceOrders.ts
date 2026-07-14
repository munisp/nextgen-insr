import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  policyOrders,
  insuranceOrderItems,
  insuranceInventory,
  insuranceCartItems,
  insuranceCarts,
  type InsuranceCartItem,
} from "@schema";
import { desc, eq, and, sql, count } from "drizzle-orm";
import crypto from "crypto";

/**
 * E-Commerce Orders Router
 * Full order lifecycle: create → confirm → process → ship → deliver
 * Integrates with inventory (fail-closed), settlement middleware, and commission engine.
 * Supports offline order creation and sync.
 */
export const policyOrdersRouter = router({
  // ── Create Order (from cart) ─────────────────────────────────────────────
  createFromCart: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        merchantId: z.number(),
        agentId: z.number().optional(),
        paymentMethod: z.string(),
        paymentRef: z.string().optional(),
        shippingAddress: z.object({
          street: z.string(),
          city: z.string(),
          state: z.string(),
          country: z.string().default("Nigeria"),
          zipCode: z.string(),
          phone: z.string(),
        }),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database)
        throw new Error(
          "Database unavailable — cannot create order (fail-closed)"
        );

      // Get cart items
      const [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (!cart) throw new Error("Cart is empty");

      const cartItems = await database
        .select()
        .from(insuranceCartItems)
        .where(eq(insuranceCartItems.cartId, cart.id));

      if (cartItems.length === 0) throw new Error("Cart is empty");

      // Reserve inventory for all items (fail-closed)
      for (const item of cartItems) {
        const [inv] = await database
          .select()
          .from(insuranceInventory)
          .where(eq(insuranceInventory.sku, item.sku))
          .limit(1);

        if (!inv) {
          throw new Error(`Product ${item.sku} not found in inventory`);
        }

        const available = inv.quantity - inv.reserved;
        if (available < item.quantity) {
          throw new Error(
            `Insufficient stock for ${item.sku}: ${available} available, ${item.quantity} requested`
          );
        }

        // Reserve stock
        await database
          .update(insuranceInventory)
          .set({
            reserved: inv.reserved + item.quantity,
            updatedAt: new Date(),
          })
          .where(eq(insuranceInventory.id, inv.id));
      }

      // Calculate totals
      const subTotal = cartItems.reduce(
        (sum: number, item: InsuranceCartItem) =>
          sum + parseFloat(item.unitPrice) * item.quantity,
        0
      );
      const tax = subTotal * 0.075; // 7.5% Nigerian VAT
      const shippingFee =
        subTotal >= 50000 ? 0 : 500 + (cartItems.length - 1) * 100;
      const discount = cart.discountAmount
        ? parseFloat(cart.discountAmount)
        : 0;
      const total = subTotal + tax + shippingFee - discount;

      // Generate order number
      const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      // Create order
      const [order] = await database
        .insert(policyOrders)
        .values({
          orderNumber,
          customerId: input.customerId,
          merchantId: input.merchantId,
          agentId: input.agentId ?? null,
          status: "pending",
          subTotal: subTotal.toFixed(2),
          tax: tax.toFixed(2),
          shippingFee: shippingFee.toFixed(2),
          discount: discount.toFixed(2),
          total: total.toFixed(2),
          currency: cart.currency,
          paymentMethod: input.paymentMethod,
          paymentRef: input.paymentRef ?? null,
          shippingAddress: input.shippingAddress,
          notes: input.notes ?? null,
        })
        .returning();

      // Insert order items
      for (const item of cartItems) {
        const lineTotal = parseFloat(item.unitPrice) * item.quantity;
        await database.insert(insuranceOrderItems).values({
          orderId: order.id,
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: lineTotal.toFixed(2),
        });
      }

      // Clear cart after order creation
      await database
        .delete(insuranceCartItems)
        .where(eq(insuranceCartItems.cartId, cart.id));
      await database
        .delete(insuranceCarts)
        .where(eq(insuranceCarts.id, cart.id));

      return order;
    }),

  // ── Get Order ────────────────────────────────────────────────────────────
  getOrder: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return null;

      const [order] = await database
        .select()
        .from(policyOrders)
        .where(eq(policyOrders.id, input.id))
        .limit(1);

      if (!order) return null;

      const items = await database
        .select()
        .from(insuranceOrderItems)
        .where(eq(insuranceOrderItems.orderId, order.id));

      return { ...order, items };
    }),

  // ── List Orders ──────────────────────────────────────────────────────────
  listOrders: protectedProcedure
    .input(
      z.object({
        customerId: z.number().optional(),
        merchantId: z.number().optional(),
        status: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { orders: [], total: 0 };

      const conditions = [];
      if (input.customerId)
        conditions.push(eq(policyOrders.customerId, input.customerId));
      if (input.merchantId)
        conditions.push(eq(policyOrders.merchantId, input.merchantId));
      if (input.status)
        conditions.push(eq(policyOrders.status, input.status as any));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [orders, totalResult] = await Promise.all([
        database
          .select()
          .from(policyOrders)
          .where(where)
          .orderBy(desc(policyOrders.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        database.select({ total: count() }).from(policyOrders).where(where),
      ]);

      return { orders, total: totalResult[0]?.total ?? 0 };
    }),

  // ── Update Order Status ──────────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum([
          "confirmed",
          "processing",
          "shipped",
          "delivered",
          "cancelled",
          "refunded",
        ]),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };

      if (input.status === "delivered") {
        updates.fulfilledAt = new Date();
      } else if (input.status === "cancelled") {
        updates.cancelledAt = new Date();
      }

      const [updated] = await database
        .update(policyOrders)
        .set(updates)
        .where(eq(policyOrders.id, input.id))
        .returning();

      // On cancellation, release inventory
      if (input.status === "cancelled") {
        const items = await database
          .select()
          .from(insuranceOrderItems)
          .where(eq(insuranceOrderItems.orderId, input.id));

        for (const item of items) {
          await database
            .update(insuranceInventory)
            .set({
              reserved: sql`GREATEST(${insuranceInventory.reserved} - ${item.quantity}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(insuranceInventory.sku, item.sku));
        }
      }

      // On delivery, deduct inventory permanently
      if (input.status === "delivered") {
        const items = await database
          .select()
          .from(insuranceOrderItems)
          .where(eq(insuranceOrderItems.orderId, input.id));

        for (const item of items) {
          await database
            .update(insuranceInventory)
            .set({
              quantity: sql`${insuranceInventory.quantity} - ${item.quantity}`,
              reserved: sql`GREATEST(${insuranceInventory.reserved} - ${item.quantity}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(insuranceInventory.sku, item.sku));
        }
      }

      return updated;
    }),

  // ── Fulfill Order ────────────────────────────────────────────────────────
  fulfillOrder: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [order] = await database
        .update(policyOrders)
        .set({
          status: "delivered",
          fulfilledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(policyOrders.id, input.id))
        .returning();

      // Deduct inventory
      const items = await database
        .select()
        .from(insuranceOrderItems)
        .where(eq(insuranceOrderItems.orderId, input.id));

      for (const item of items) {
        await database
          .update(insuranceInventory)
          .set({
            quantity: sql`${insuranceInventory.quantity} - ${item.quantity}`,
            reserved: sql`GREATEST(${insuranceInventory.reserved} - ${item.quantity}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(insuranceInventory.sku, item.sku));
      }

      return order;
    }),

  // ── Sync Offline Orders ──────────────────────────────────────────────────
  syncOfflineOrders: protectedProcedure
    .input(
      z.array(
        z.object({
          clientId: z.string(),
          customerId: z.number(),
          merchantId: z.number(),
          agentId: z.number().optional(),
          items: z.array(
            z.object({
              productId: z.number(),
              sku: z.string(),
              name: z.string(),
              quantity: z.number(),
              unitPrice: z.string(),
            })
          ),
          paymentMethod: z.string(),
          shippingAddress: z.object({
            street: z.string(),
            city: z.string(),
            state: z.string(),
            country: z.string(),
            zipCode: z.string(),
            phone: z.string(),
          }),
          deviceId: z.string(),
          createdAt: z.string(),
        })
      )
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database)
        throw new Error(
          "Database unavailable — offline sync requires connectivity"
        );

      const results: Array<{
        clientId: string;
        serverId?: number;
        status: string;
        error?: string;
      }> = [];

      for (const offlineOrder of input) {
        try {
          const subTotal = offlineOrder.items.reduce(
            (sum, item) => sum + parseFloat(item.unitPrice) * item.quantity,
            0
          );
          const tax = subTotal * 0.075;
          const total = subTotal + tax;

          const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

          const [order] = await database
            .insert(policyOrders)
            .values({
              orderNumber,
              customerId: offlineOrder.customerId,
              merchantId: offlineOrder.merchantId,
              agentId: offlineOrder.agentId ?? null,
              status: "pending",
              subTotal: subTotal.toFixed(2),
              tax: tax.toFixed(2),
              shippingFee: "0",
              discount: "0",
              total: total.toFixed(2),
              currency: "NGN",
              paymentMethod: offlineOrder.paymentMethod,
              shippingAddress: offlineOrder.shippingAddress,
              offlineCreated: true,
              syncedAt: new Date(),
            })
            .returning();

          for (const item of offlineOrder.items) {
            const lineTotal = parseFloat(item.unitPrice) * item.quantity;
            await database.insert(insuranceOrderItems).values({
              orderId: order.id,
              productId: item.productId,
              sku: item.sku,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: lineTotal.toFixed(2),
            });
          }

          results.push({
            clientId: offlineOrder.clientId,
            serverId: order.id,
            status: "synced",
          });
        } catch (err) {
          results.push({
            clientId: offlineOrder.clientId,
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return {
        results,
        synced: results.filter(r => r.status === "synced").length,
        errors: results.filter(r => r.status === "error").length,
        total: input.length,
      };
    }),
});
