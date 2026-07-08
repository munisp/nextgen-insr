// @ts-check

/**
 * E-Commerce Middleware
 * Integrates e-commerce operations with existing platform middleware:
 * - Security orchestrator (auth, DDoS, rate limiting)
 * - Settlement middleware (payment processing, merchant payouts)
 * - Commission middleware (agent commission on e-commerce sales)
 * - Offline queue (cart/order sync when connectivity resumes)
 * - Transaction pipeline (order payment as financial transaction)
 */

import { resilientFetch } from "../lib/resilientFetch";

const CATALOG_URL = process.env.CATALOG_SERVICE_URL || "http://localhost:8100";
const CART_URL = process.env.CART_SERVICE_URL || "http://localhost:8102";
const INTELLIGENCE_URL =
  process.env.INTELLIGENCE_SERVICE_URL || "http://localhost:8103";

interface HealthResponse {
  status: string;
}

interface EcommerceServiceStatus {
  catalog: "healthy" | "degraded" | "unavailable";
  cart: "healthy" | "degraded" | "unavailable";
  intelligence: "healthy" | "degraded" | "unavailable";
}

/**
 * Check health of all e-commerce microservices.
 */
export async function checkEcommerceHealth(): Promise<EcommerceServiceStatus> {
  const status: EcommerceServiceStatus = {
    catalog: "unavailable",
    cart: "unavailable",
    intelligence: "unavailable",
  };

  const checks = [
    {
      key: "catalog" as const,
      url: `${CATALOG_URL}/health`,
      svc: "ecom-catalog",
    },
    { key: "cart" as const, url: `${CART_URL}/health`, svc: "ecom-cart" },
    {
      key: "intelligence" as const,
      url: `${INTELLIGENCE_URL}/health`,
      svc: "ecom-intelligence",
    },
  ];

  await Promise.allSettled(
    checks.map(async ({ key, url, svc }) => {
      try {
        await resilientFetch<HealthResponse>(
          url,
          {},
          { serviceName: svc, timeoutMs: 3000, fallback: null }
        );
        status[key] = "healthy";
      } catch {
        status[key] = "unavailable";
      }
    })
  );

  return status;
}

/**
 * Forward product operations to Go catalog service.
 */
export async function catalogServiceProxy(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; data: unknown; fallback: boolean }> {
  try {
    const data = await resilientFetch<unknown>(
      `${CATALOG_URL}${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": process.env.INTERNAL_API_KEY || "",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      { serviceName: "ecom-catalog", timeoutMs: 5000 }
    );
    return { ok: true, data, fallback: false };
  } catch {
    return { ok: false, data: null, fallback: true };
  }
}

/**
 * Forward cart operations to Rust cart service.
 */
export async function cartServiceProxy(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; data: unknown; fallback: boolean }> {
  try {
    const data = await resilientFetch<unknown>(
      `${CART_URL}${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": process.env.INTERNAL_API_KEY || "",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      { serviceName: "ecom-cart", timeoutMs: 3000 }
    );
    return { ok: true, data, fallback: false };
  } catch {
    return { ok: false, data: null, fallback: true };
  }
}

/**
 * Get product recommendations from Python intelligence service.
 */
export async function getRecommendations(
  customerId: number,
  limit: number = 10
): Promise<unknown[]> {
  try {
    const data = await resilientFetch<{ recommendations: unknown[] }>(
      `${INTELLIGENCE_URL}/api/v1/recommendations/${customerId}?limit=${limit}`,
      {},
      {
        serviceName: "ecom-intelligence",
        timeoutMs: 5000,
        fallback: { recommendations: [] },
      }
    );
    return data.recommendations || [];
  } catch {
    return [];
  }
}

/**
 * Get dynamic price from Python intelligence service.
 */
export async function getDynamicPrice(
  productId: number,
  customerId: number = 0,
  quantity: number = 1
): Promise<{ price: number; adjustments: unknown[]; fromService: boolean }> {
  try {
    const data = await resilientFetch<{
      dynamicPrice: number;
      adjustments: unknown[];
    }>(
      `${INTELLIGENCE_URL}/api/v1/pricing/${productId}?customer_id=${customerId}&quantity=${quantity}`,
      {},
      { serviceName: "ecom-intelligence", timeoutMs: 3000 }
    );
    return {
      price: data.dynamicPrice,
      adjustments: data.adjustments || [],
      fromService: true,
    };
  } catch {
    return { price: 0, adjustments: [], fromService: false };
  }
}

/**
 * Get offline price cache for agent devices.
 */
export async function getOfflinePriceCache(
  categoryId: number = 0,
  limit: number = 500
): Promise<unknown[]> {
  try {
    const data = await resilientFetch<{ prices: unknown[] }>(
      `${INTELLIGENCE_URL}/api/v1/pricing/offline-cache?category_id=${categoryId}&limit=${limit}`,
      {},
      {
        serviceName: "ecom-intelligence",
        timeoutMs: 10000,
        fallback: { prices: [] },
      }
    );
    return data.prices || [];
  } catch {
    return [];
  }
}

/**
 * Process e-commerce order payment through the existing settlement pipeline.
 */
export async function processOrderPayment(order: {
  orderId: number;
  total: number;
  currency: string;
  merchantId: number;
  agentId?: number;
  paymentMethod: string;
  paymentRef?: string;
}): Promise<{ settled: boolean; settlementId?: string; error?: string }> {
  try {
    const data = await resilientFetch<{ settlementId: string }>(
      `${process.env.APP_URL || "http://localhost:3000"}/api/internal/ecommerce-settlement`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": process.env.INTERNAL_API_KEY || "",
        },
        body: JSON.stringify({ type: "ecommerce_order", ...order }),
      },
      { serviceName: "settlement", timeoutMs: 10000 }
    );
    return { settled: true, settlementId: data.settlementId };
  } catch (err) {
    return {
      settled: false,
      error: err instanceof Error ? err.message : "Settlement failed",
    };
  }
}

/**
 * Calculate agent commission on e-commerce sale.
 */
export async function calculateEcommerceCommission(order: {
  orderId: number;
  total: number;
  agentId: number;
  merchantId: number;
}): Promise<{ commission: number; tier: string }> {
  if (!order.agentId) {
    return { commission: 0, tier: "none" };
  }

  // E-commerce commission: 2.5% of order total for facilitating agents
  const baseRate = 0.025;
  const commission = order.total * baseRate;

  return {
    commission: Math.round(commission * 100) / 100,
    tier: commission > 1000 ? "premium" : "standard",
  };
}
