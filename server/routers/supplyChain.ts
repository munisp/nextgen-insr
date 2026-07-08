// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { resilientFetch } from "../lib/resilientFetch";

const SC_URL = process.env.SUPPLY_CHAIN_URL || "http://localhost:8200";

async function scFetch<T>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  return resilientFetch<T>(
    `${SC_URL}${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    { serviceName: "supply-chain", timeoutMs: 10000 }
  );
}

export const supplyChainRouter = router({
  // ─── Warehouses ──────────────────────────────────────────────────────────
  listWarehouses: protectedProcedure.query(async () => {
    return scFetch<{ warehouses: unknown[]; total: number }>(
      "/api/v1/warehouses"
    );
  }),

  createWarehouse: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        name: z.string(),
        type: z.string().default("standard"),
        capacity: z.number().default(10000),
        address: z
          .object({
            street: z.string(),
            city: z.string(),
            state: z.string(),
            country: z.string(),
            zipCode: z.string(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/warehouses", "POST", input);
    }),

  getWarehouse: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/warehouses/${input.id}`);
    }),

  getOccupancy: protectedProcedure
    .input(z.object({ warehouseId: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/warehouses/${input.warehouseId}/occupancy`);
    }),

  // ─── Zones & Locations ───────────────────────────────────────────────────
  listZones: protectedProcedure
    .input(z.object({ warehouseId: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/warehouses/${input.warehouseId}/zones`);
    }),

  createZone: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number(),
        name: z.string(),
        type: z.enum([
          "receiving",
          "storage",
          "picking",
          "packing",
          "shipping",
          "returns",
          "quarantine",
        ]),
        capacity: z.number().default(1000),
      })
    )
    .mutation(async ({ input }) => {
      const { warehouseId, ...body } = input;
      return scFetch(`/api/v1/warehouses/${warehouseId}/zones`, "POST", body);
    }),

  listLocations: protectedProcedure
    .input(z.object({ warehouseId: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/warehouses/${input.warehouseId}/locations`);
    }),

  createLocation: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number(),
        zoneId: z.number(),
        aisle: z.string(),
        rack: z.string(),
        shelf: z.string(),
        bin: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { warehouseId, ...body } = input;
      return scFetch(
        `/api/v1/warehouses/${warehouseId}/locations`,
        "POST",
        body
      );
    }),

  // ─── Stock Movements ─────────────────────────────────────────────────────
  receiveStock: protectedProcedure
    .input(
      z.object({
        sku: z.string(),
        quantity: z.number(),
        warehouseId: z.number(),
        locationId: z.number().optional(),
        performedBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/stock/receive", "POST", input);
    }),

  transferStock: protectedProcedure
    .input(
      z.object({
        sku: z.string(),
        quantity: z.number(),
        fromWarehouseId: z.number(),
        toWarehouseId: z.number(),
        performedBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/stock/transfer", "POST", input);
    }),

  adjustStock: protectedProcedure
    .input(
      z.object({
        sku: z.string(),
        quantity: z.number(),
        warehouseId: z.number(),
        reason: z.string(),
        performedBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/stock/adjust", "POST", input);
    }),

  reserveStock: protectedProcedure
    .input(
      z.object({
        sku: z.string(),
        quantity: z.number(),
        warehouseId: z.number(),
        orderId: z.number(),
        performedBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/stock/reserve", "POST", input);
    }),

  getStockLevels: protectedProcedure
    .input(z.object({ sku: z.string().optional() }))
    .query(async ({ input }) => {
      const q = input.sku ? `?sku=${input.sku}` : "";
      return scFetch(`/api/v1/stock/levels${q}`);
    }),

  getStockAlerts: protectedProcedure
    .input(z.object({ reorderPoint: z.number().default(10) }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/stock/alerts?reorderPoint=${input.reorderPoint}`);
    }),

  listMovements: protectedProcedure
    .input(
      z.object({
        sku: z.string().optional(),
        type: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.sku) params.set("sku", input.sku);
      if (input.type) params.set("type", input.type);
      return scFetch(`/api/v1/stock/movements?${params}`);
    }),

  // ─── Valuation ───────────────────────────────────────────────────────────
  getValuation: protectedProcedure
    .input(
      z.object({
        sku: z.string(),
        method: z.string().default("weighted_average"),
      })
    )
    .query(async ({ input }) => {
      return scFetch(`/api/v1/valuation/${input.sku}?method=${input.method}`);
    }),

  valuationReport: protectedProcedure.query(async () => {
    return scFetch("/api/v1/valuation/report");
  }),

  // ─── Suppliers ───────────────────────────────────────────────────────────
  listSuppliers: protectedProcedure.query(async () => {
    return scFetch("/api/v1/suppliers");
  }),

  createSupplier: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        name: z.string(),
        contactName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        paymentTerms: z.string().default("net30"),
        leadTimeDays: z.number().default(7),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/suppliers", "POST", input);
    }),

  getSupplierPerformance: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/suppliers/${input.id}/performance`);
    }),

  // ─── Purchase Orders ─────────────────────────────────────────────────────
  listPurchaseOrders: protectedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      const q = input.status ? `?status=${input.status}` : "";
      return scFetch(`/api/v1/purchase-orders${q}`);
    }),

  createPurchaseOrder: protectedProcedure
    .input(
      z.object({
        supplierId: z.number(),
        warehouseId: z.number(),
        items: z.array(
          z.object({
            sku: z.string(),
            productName: z.string(),
            quantityOrdered: z.number(),
            unitCost: z.number(),
          })
        ),
        createdBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/purchase-orders", "POST", input);
    }),

  updatePOStatus: protectedProcedure
    .input(z.object({ id: z.number(), status: z.string() }))
    .mutation(async ({ input }) => {
      return scFetch(`/api/v1/purchase-orders/${input.id}/status`, "PUT", {
        status: input.status,
      });
    }),

  receivePO: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        items: z.array(
          z.object({ sku: z.string(), quantityReceived: z.number() })
        ),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch(`/api/v1/purchase-orders/${input.id}/receive`, "POST", {
        items: input.items,
      });
    }),

  // ─── Logistics ───────────────────────────────────────────────────────────
  listCarriers: protectedProcedure.query(async () => {
    return scFetch("/api/v1/carriers");
  }),

  createShipment: protectedProcedure
    .input(
      z.object({
        orderId: z.number(),
        carrierId: z.number(),
        weight: z.number().optional(),
        toAddress: z
          .object({
            street: z.string(),
            city: z.string(),
            state: z.string(),
            country: z.string(),
            zipCode: z.string(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/shipments", "POST", input);
    }),

  getShipment: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/shipments/${input.id}`);
    }),

  trackShipment: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return scFetch(`/api/v1/shipments/${input.id}/tracking`);
    }),

  generateLabel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return scFetch(`/api/v1/shipments/${input.id}/label`, "POST");
    }),

  submitProofOfDelivery: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        imageUrl: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch(`/api/v1/shipments/${input.id}/pod`, "POST", input);
    }),

  calculateShippingRates: protectedProcedure
    .input(
      z.object({
        weight: z.number(),
        country: z.string().default("NG"),
      })
    )
    .query(async ({ input }) => {
      return scFetch(
        `/api/v1/shipping/rates?weight=${input.weight}&country=${input.country}`
      );
    }),

  optimizeRoute: protectedProcedure
    .input(
      z.object({
        origin: z.object({ lat: z.number(), lng: z.number() }),
        destinations: z.array(z.object({ lat: z.number(), lng: z.number() })),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/shipping/optimize-route", "POST", input);
    }),

  // ─── Cycle Counting ────────────────────────────────────────────────────
  startCycleCount: protectedProcedure
    .input(
      z.object({
        warehouseId: z.number(),
        zoneId: z.number().optional(),
        skus: z.array(z.string()),
        performedBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/cycle-count/start", "POST", input);
    }),

  recordCycleCount: protectedProcedure
    .input(
      z.object({
        countId: z.string(),
        sku: z.string(),
        locationId: z.number(),
        counted: z.number(),
        expected: z.number(),
        performedBy: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return scFetch("/api/v1/cycle-count/record", "POST", input);
    }),
});
