// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { resilientFetch } from "../lib/resilientFetch";

const MKT_URL = process.env.MARKETPLACE_URL || "http://localhost:8201";

async function mktFetch<T>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  return resilientFetch<T>(
    `${MKT_URL}${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    { serviceName: "marketplace-integrations", timeoutMs: 15000 }
  );
}

export const marketplaceRouter = router({
  // ─── Connections ─────────────────────────────────────────────────────────
  listConnections: protectedProcedure.query(async () => {
    return mktFetch<{ connections: unknown[]; total: number }>(
      "/api/v1/connections"
    );
  }),

  createConnection: protectedProcedure
    .input(
      z.object({
        storeId: z.number(),
        platform: z.enum(["jumia", "konga", "amazon", "ebay"]),
      })
    )
    .mutation(async ({ input }) => {
      return mktFetch("/api/v1/connections", "POST", input);
    }),

  // ─── Product Sync ────────────────────────────────────────────────────────
  syncProducts: protectedProcedure
    .input(
      z.object({
        connectionId: z.number(),
        products: z.array(
          z.object({
            id: z.number(),
            sku: z.string(),
            name: z.string(),
            description: z.string().optional(),
            price: z.number(),
            currency: z.string().default("NGN"),
            imageUrls: z.array(z.string()).default([]),
            categories: z.array(z.string()).default([]),
            quantity: z.number().default(0),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      return mktFetch(
        `/api/v1/connections/${input.connectionId}/sync-products`,
        "POST",
        { products: input.products }
      );
    }),

  // ─── Order Sync ──────────────────────────────────────────────────────────
  syncOrders: protectedProcedure
    .input(z.object({ connectionId: z.number() }))
    .mutation(async ({ input }) => {
      return mktFetch(
        `/api/v1/connections/${input.connectionId}/sync-orders`,
        "POST"
      );
    }),

  // ─── Inventory Sync ──────────────────────────────────────────────────────
  syncInventory: protectedProcedure
    .input(
      z.object({
        connectionId: z.number(),
        items: z.array(z.object({ sku: z.string(), quantity: z.number() })),
      })
    )
    .mutation(async ({ input }) => {
      return mktFetch(
        `/api/v1/connections/${input.connectionId}/sync-inventory`,
        "POST",
        { items: input.items }
      );
    }),

  // ─── Listings ────────────────────────────────────────────────────────────
  getListings: protectedProcedure
    .input(z.object({ connectionId: z.number() }))
    .query(async ({ input }) => {
      return mktFetch(`/api/v1/connections/${input.connectionId}/listings`);
    }),
});
