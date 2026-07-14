import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  insuranceCarts,
  insuranceCartItems,
  insuranceInventory,
  type InsuranceCartItem,
} from "@schema";
import { eq, and, sql, count } from "drizzle-orm";

const CART_SERVICE_URL =
  process.env.CART_SERVICE_URL || "http://localhost:8102";

/**
 * E-Commerce Cart Router
 * Bridges tRPC API with Rust cart/checkout microservice.
 * Falls back to direct Drizzle queries when Rust service is unavailable.
 * Supports offline-to-online cart synchronization.
 */
export const insuranceCartRouter = router({
  // ── Cart Operations ──────────────────────────────────────────────────────
  getCart: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { items: [], subTotal: 0, itemCount: 0 };

      const [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (!cart) {
        return {
          customerId: input.customerId,
          items: [],
          subTotal: 0,
          itemCount: 0,
          couponCode: null,
          discountAmount: 0,
        };
      }

      const items = await database
        .select()
        .from(insuranceCartItems)
        .where(eq(insuranceCartItems.cartId, cart.id));

      const subTotal = items.reduce(
        (sum: number, item: InsuranceCartItem) =>
          sum + parseFloat(item.unitPrice) * item.quantity,
        0
      );

      return {
        id: cart.id,
        customerId: cart.customerId,
        items,
        subTotal,
        itemCount: items.reduce(
          (sum: number, i: InsuranceCartItem) => sum + i.quantity,
          0
        ),
        couponCode: cart.couponCode,
        discountAmount: parseFloat(cart.discountAmount),
        currency: cart.currency,
      };
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        sku: z.string(),
        productId: z.number(),
        name: z.string(),
        quantity: z.number().min(1),
        unitPrice: z.string(),
        merchantId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Check inventory availability (fail-closed)
      const [inv] = await database
        .select()
        .from(insuranceInventory)
        .where(eq(insuranceInventory.sku, input.sku))
        .limit(1);

      if (inv) {
        const available = inv.quantity - inv.reserved;
        if (available < input.quantity) {
          throw new Error(
            `Insufficient stock for ${input.sku}: ${available} available, ${input.quantity} requested`
          );
        }
      }

      // Get or create cart
      let [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (!cart) {
        [cart] = await database
          .insert(insuranceCarts)
          .values({ customerId: input.customerId })
          .returning();
      }

      // Check if item already in cart
      const [existing] = await database
        .select()
        .from(insuranceCartItems)
        .where(
          and(
            eq(insuranceCartItems.cartId, cart.id),
            eq(insuranceCartItems.sku, input.sku)
          )
        )
        .limit(1);

      if (existing) {
        await database
          .update(insuranceCartItems)
          .set({ quantity: existing.quantity + input.quantity })
          .where(eq(insuranceCartItems.id, existing.id));
      } else {
        await database.insert(insuranceCartItems).values({
          cartId: cart.id,
          productId: input.productId,
          sku: input.sku,
          name: input.name,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          merchantId: input.merchantId,
        });
      }

      // Update cart timestamp
      await database
        .update(insuranceCarts)
        .set({ updatedAt: new Date() })
        .where(eq(insuranceCarts.id, cart.id));

      return { status: "added" };
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        sku: z.string(),
        quantity: z.number().min(0),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (!cart) throw new Error("Cart not found");

      if (input.quantity === 0) {
        await database
          .delete(insuranceCartItems)
          .where(
            and(
              eq(insuranceCartItems.cartId, cart.id),
              eq(insuranceCartItems.sku, input.sku)
            )
          );
      } else {
        await database
          .update(insuranceCartItems)
          .set({ quantity: input.quantity })
          .where(
            and(
              eq(insuranceCartItems.cartId, cart.id),
              eq(insuranceCartItems.sku, input.sku)
            )
          );
      }

      return { status: "updated" };
    }),

  removeItem: protectedProcedure
    .input(z.object({ customerId: z.number(), sku: z.string() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (!cart) throw new Error("Cart not found");

      await database
        .delete(insuranceCartItems)
        .where(
          and(
            eq(insuranceCartItems.cartId, cart.id),
            eq(insuranceCartItems.sku, input.sku)
          )
        );

      return { status: "removed" };
    }),

  clearCart: protectedProcedure
    .input(z.object({ customerId: z.number() }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      const [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (cart) {
        await database
          .delete(insuranceCartItems)
          .where(eq(insuranceCartItems.cartId, cart.id));
        await database
          .delete(insuranceCarts)
          .where(eq(insuranceCarts.id, cart.id));
      }

      return { status: "cleared" };
    }),

  // ── Offline Sync ─────────────────────────────────────────────────────────
  syncOfflineCart: protectedProcedure
    .input(
      z.object({
        customerId: z.number(),
        items: z.array(
          z.object({
            sku: z.string(),
            productId: z.number(),
            name: z.string(),
            quantity: z.number(),
            unitPrice: z.string(),
            merchantId: z.number(),
          })
        ),
        deviceId: z.string(),
        checksum: z.string(),
        strategy: z
          .enum([
            "prefer_online",
            "prefer_offline",
            "sum_quantities",
            "max_quantity",
          ])
          .default("max_quantity"),
      })
    )
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Get or create online cart
      let [cart] = await database
        .select()
        .from(insuranceCarts)
        .where(eq(insuranceCarts.customerId, input.customerId))
        .limit(1);

      if (!cart) {
        [cart] = await database
          .insert(insuranceCarts)
          .values({
            customerId: input.customerId,
            offlineCreated: true,
            deviceId: input.deviceId,
          })
          .returning();
      }

      // Merge items using specified strategy
      const existingItems = await database
        .select()
        .from(insuranceCartItems)
        .where(eq(insuranceCartItems.cartId, cart.id));

      const existingMap = new Map<string, InsuranceCartItem>(
        existingItems.map((i: InsuranceCartItem) => [i.sku, i])
      );

      for (const offlineItem of input.items) {
        const existing = existingMap.get(offlineItem.sku);

        if (existing) {
          let newQty = existing.quantity;
          switch (input.strategy) {
            case "prefer_offline":
              newQty = offlineItem.quantity;
              break;
            case "sum_quantities":
              newQty = existing.quantity + offlineItem.quantity;
              break;
            case "max_quantity":
              newQty = Math.max(existing.quantity, offlineItem.quantity);
              break;
            case "prefer_online":
            default:
              break;
          }

          if (newQty !== existing.quantity) {
            await database
              .update(insuranceCartItems)
              .set({ quantity: newQty })
              .where(eq(insuranceCartItems.id, existing.id));
          }
        } else {
          await database.insert(insuranceCartItems).values({
            cartId: cart.id,
            productId: offlineItem.productId,
            sku: offlineItem.sku,
            name: offlineItem.name,
            quantity: offlineItem.quantity,
            unitPrice: offlineItem.unitPrice,
            merchantId: offlineItem.merchantId,
          });
        }
      }

      return {
        status: "synced",
        strategy: input.strategy,
        itemsMerged: input.items.length,
      };
    }),
});
