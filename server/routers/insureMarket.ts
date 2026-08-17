/**
 * InsureMarket — API Marketplace & Monetization Engine
 *
 * Commercial monetization layer for InsurePortal:
 *
 * Revenue streams:
 *   1. API Marketplace — third-party insurtech/fintech consume platform APIs
 *      - Per-call pricing: ₦5–₦50 per API call depending on tier
 *      - Subscription tiers: Starter (₦50k/mo), Growth (₦200k/mo), Enterprise (custom)
 *      - Revenue share: 70% platform / 30% data provider
 *
 *   2. White-Label SaaS — insurers/banks deploy branded portals
 *      - Setup fee: ₦500k–₦2M
 *      - Monthly SaaS fee: ₦100k–₦500k
 *      - Transaction fee: 0.1–0.3% of premium processed
 *
 *   3. Data Intelligence — anonymised actuarial datasets
 *      - Risk scoring API: ₦10–₦100 per query
 *      - Fraud intelligence feed: ₦500k/mo subscription
 *      - Claims analytics dashboard: ₦200k/mo
 *
 *   4. Embedded Insurance SDK — distribute insurance via partners
 *      - Commission: 5–15% of premium
 *      - Integration fee: ₦100k one-time
 *
 *   5. Reinsurance Marketplace — connect cedants with reinsurers
 *      - Placement fee: 0.5–1% of ceded premium
 *
 * Procedures:
 *   insureMarket.getMarketplaceApps     — list all available API products
 *   insureMarket.subscribeToApp         — subscribe to an API product
 *   insureMarket.getUsageMetrics        — API call usage and billing
 *   insureMarket.getRevenueReport       — platform revenue breakdown
 *   insureMarket.createWhiteLabelTenant — provision white-label instance
 *   insureMarket.getDataIntelligence    — purchase data intelligence product
 *   insureMarket.getEmbeddedSdkConfig   — embedded insurance SDK configuration
 *   insureMarket.getReinsurancePlacements — reinsurance marketplace listings
 *   insureMarket.getMonetizationDashboard — full revenue dashboard
 *
 * MOCKWARE FIX: the monetization dashboard previously reported random
 * callsThisMonth for top apps, hardcoded revenue-stream percentages with
 * fabricated growth trends, and hardcoded "opportunities". Top apps now come
 * from real marketplace_api_calls counts, streams from real platform_revenue
 * rows (empty when none), and opportunities is an honest empty list (no
 * pipeline store exists).
 */

import { randomUUID } from "crypto";

import { TRPCError } from "@trpc/server";
import { sql, desc, eq, and, gte, sum, count } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ─── Marketplace product catalogue ───────────────────────────────────────────

const MARKETPLACE_APPS = [
  {
    id:          "risk-scoring-api",
    name:        "Risk Scoring API",
    category:    "underwriting",
    description: "Real-time risk scoring for motor, health, life, and property insurance using ML models trained on 10M+ Nigerian policies.",
    pricingModel: "per-call",
    priceTiers: [
      { name: "Starter",    callsPerMonth: 10_000,  priceNGN: 50_000,  perCallNGN: 5   },
      { name: "Growth",     callsPerMonth: 100_000, priceNGN: 200_000, perCallNGN: 2   },
      { name: "Enterprise", callsPerMonth: -1,      priceNGN: 0,       perCallNGN: 1   },
    ],
    endpoints:   ["/api/v1/risk/score", "/api/v1/risk/factors", "/api/v1/risk/compare"],
    sla:         "99.9% uptime, <100ms p99",
    dataPoints:  ["age", "location", "vehicle_type", "claims_history", "credit_score"],
  },
  {
    id:          "fraud-intelligence-api",
    name:        "Fraud Intelligence API",
    category:    "fraud",
    description: "Real-time fraud detection for insurance claims using graph neural networks, velocity checks, and AML screening.",
    pricingModel: "subscription",
    priceTiers: [
      { name: "Basic",      callsPerMonth: 50_000,  priceNGN: 150_000, perCallNGN: 3   },
      { name: "Pro",        callsPerMonth: 500_000, priceNGN: 500_000, perCallNGN: 1   },
      { name: "Enterprise", callsPerMonth: -1,      priceNGN: 0,       perCallNGN: 0.5 },
    ],
    endpoints:   ["/api/v1/fraud/check", "/api/v1/fraud/score", "/api/v1/fraud/network"],
    sla:         "99.95% uptime, <50ms p99",
    dataPoints:  ["transaction_pattern", "device_fingerprint", "network_graph", "velocity"],
  },
  {
    id:          "kyc-verification-api",
    name:        "KYC/KYB Verification API",
    category:    "compliance",
    description: "Instant KYC/KYB verification using NIN, BVN, CAC, and liveness detection. NDPR-compliant data handling.",
    pricingModel: "per-call",
    priceTiers: [
      { name: "Pay-as-you-go", callsPerMonth: -1, priceNGN: 0, perCallNGN: 50 },
      { name: "Volume",        callsPerMonth: 10_000, priceNGN: 300_000, perCallNGN: 30 },
    ],
    endpoints:   ["/api/v1/kyc/verify", "/api/v1/kyc/liveness", "/api/v1/kyb/company"],
    sla:         "99.9% uptime, <2s p99",
    dataPoints:  ["nin", "bvn", "cac_number", "selfie", "document_scan"],
  },
  {
    id:          "claims-analytics-api",
    name:        "Claims Analytics API",
    category:    "analytics",
    description: "Aggregated claims analytics: loss ratios, claim frequency, severity trends, and geographic heatmaps.",
    pricingModel: "subscription",
    priceTiers: [
      { name: "Basic",      callsPerMonth: 1_000,  priceNGN: 200_000, perCallNGN: 200 },
      { name: "Pro",        callsPerMonth: 10_000, priceNGN: 500_000, perCallNGN: 50  },
    ],
    endpoints:   ["/api/v1/analytics/claims", "/api/v1/analytics/loss-ratio", "/api/v1/analytics/heatmap"],
    sla:         "99.5% uptime, <500ms p99",
    dataPoints:  ["anonymised_claims", "loss_ratios", "geographic_data", "trend_analysis"],
  },
  {
    id:          "embedded-insurance-sdk",
    name:        "Embedded Insurance SDK",
    category:    "distribution",
    description: "White-label insurance widgets for fintechs, banks, and e-commerce. Motor, health, travel, and device insurance.",
    pricingModel: "revenue-share",
    priceTiers: [
      { name: "Standard",   commissionPct: 10, setupFeeNGN: 100_000, monthlyFeeNGN: 0       },
      { name: "Premium",    commissionPct: 8,  setupFeeNGN: 500_000, monthlyFeeNGN: 100_000 },
    ],
    endpoints:   ["/sdk/v1/quote", "/sdk/v1/bind", "/sdk/v1/claim"],
    sla:         "99.9% uptime",
    dataPoints:  ["product_type", "customer_data", "premium", "policy_id"],
  },
  {
    id:          "reinsurance-marketplace",
    name:        "Reinsurance Marketplace",
    category:    "reinsurance",
    description: "Connect Nigerian cedants with local and international reinsurers. Automated treaty placement and claims recovery.",
    pricingModel: "placement-fee",
    priceTiers: [
      { name: "Proportional", placementFeePct: 0.5, minPremiumNGN: 10_000_000 },
      { name: "Non-Proportional", placementFeePct: 1.0, minPremiumNGN: 50_000_000 },
    ],
    endpoints:   ["/api/v1/reinsurance/quote", "/api/v1/reinsurance/place", "/api/v1/reinsurance/recover"],
    sla:         "99.5% uptime",
    dataPoints:  ["treaty_type", "cedant_data", "risk_profile", "premium_volume"],
  },
];

// ─── Router ───────────────────────────────────────────────────────────────────

export const insureMarketRouter = router({

  // ── getMarketplaceApps: list all API products ─────────────────────────────
  getMarketplaceApps: protectedProcedure
    .input(z.object({
      category: z.enum(["underwriting", "fraud", "compliance", "analytics", "distribution", "reinsurance", "all"]).default("all"),
    }))
    .query(({ input }) => {
      const apps = input.category === "all"
        ? MARKETPLACE_APPS
        : MARKETPLACE_APPS.filter(a => a.category === input.category);
      return {
        apps,
        total:      apps.length,
        categories: [...new Set(MARKETPLACE_APPS.map(a => a.category))],
      };
    }),

  // ── subscribeToApp: subscribe to an API product ───────────────────────────
  subscribeToApp: protectedProcedure
    .input(z.object({
      appId:     z.string(),
      tierId:    z.string(),
      tenantId:  z.string(),
      contactEmail: z.string().email(),
    }))
    .mutation(async ({ input, ctx }) => {
      const app = MARKETPLACE_APPS.find(a => a.id === input.appId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: `App ${input.appId} not found` });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Record subscription in DB
      const subscriptionId = `SUB-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const apiKey = `ipa_${Buffer.from(`${input.tenantId}:${subscriptionId}`).toString("base64").slice(0, 32)}`;

      await db.execute(sql`
        INSERT INTO marketplace_subscriptions (
          id, tenant_id, app_id, tier_id, api_key, status,
          contact_email, created_by, created_at
        ) VALUES (
          ${subscriptionId}, ${input.tenantId}, ${input.appId}, ${input.tierId},
          ${apiKey}, 'active', ${input.contactEmail}, ${ctx.user?.id ?? "system"}, NOW()
        )
        ON CONFLICT (tenant_id, app_id) DO UPDATE SET
          tier_id = EXCLUDED.tier_id,
          api_key = EXCLUDED.api_key,
          status  = 'active',
          updated_at = NOW()
      `);

      return {
        subscriptionId,
        apiKey,
        appId:   input.appId,
        tierId:  input.tierId,
        status:  "active",
        message: `Successfully subscribed to ${app.name}. Your API key is ready.`,
        docsUrl: `https://docs.insureportal.ng/api/${input.appId}`,
      };
    }),

  // ── getUsageMetrics: API call usage and billing ───────────────────────────
  getUsageMetrics: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      appId:    z.string().optional(),
      days:     z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { metrics: [], totalCalls: 0, totalCostNGN: 0, billingPeriod: `${input.days}d` };

      const rows = await db.execute(sql`
        SELECT
          app_id,
          DATE_TRUNC('day', called_at) AS day,
          COUNT(*) AS call_count,
          SUM(cost_ngn) AS total_cost,
          AVG(response_ms) AS avg_response_ms,
          COUNT(*) FILTER (WHERE status_code >= 400) AS error_count
        FROM marketplace_api_calls
        WHERE tenant_id = ${input.tenantId}
          ${input.appId ? sql`AND app_id = ${input.appId}` : sql``}
          AND called_at >= NOW() - INTERVAL '${sql.raw(String(input.days))} days'
        GROUP BY app_id, day
        ORDER BY day DESC
        LIMIT 500
      `);

      const totalCalls = (rows.rows as Array<{ call_count: number }>).reduce((s, r) => s + Number(r.call_count), 0);
      const totalCostNGN = (rows.rows as Array<{ total_cost: number }>).reduce((s, r) => s + Number(r.total_cost), 0);

      return {
        metrics:       rows.rows,
        totalCalls,
        totalCostNGN:  Math.round(totalCostNGN),
        billingPeriod: `${input.days}d`,
      };
    }),

  // ── getRevenueReport: platform revenue breakdown ──────────────────────────
  getRevenueReport: protectedProcedure
    .input(z.object({
      year:  z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { streams: [], totalRevenueNGN: 0, period: "current" };

      const year  = input.year  ?? new Date().getFullYear();
      const month = input.month ?? new Date().getMonth() + 1;

      // Revenue by stream
      const rows = await db.execute(sql`
        SELECT
          revenue_stream,
          SUM(amount_ngn) AS total_ngn,
          COUNT(*) AS transaction_count,
          AVG(amount_ngn) AS avg_ngn
        FROM platform_revenue
        WHERE EXTRACT(YEAR FROM recorded_at)  = ${year}
          AND EXTRACT(MONTH FROM recorded_at) = ${month}
        GROUP BY revenue_stream
        ORDER BY total_ngn DESC
      `);

      const totalRevenueNGN = (rows.rows as Array<{ total_ngn: number }>).reduce((s, r) => s + Number(r.total_ngn), 0);

      // Projected annual revenue
      const monthlyAvg = totalRevenueNGN;
      const projectedAnnualNGN = monthlyAvg * 12;

      return {
        streams:           rows.rows,
        totalRevenueNGN:   Math.round(totalRevenueNGN),
        projectedAnnualNGN: Math.round(projectedAnnualNGN),
        period:            `${year}-${String(month).padStart(2, "0")}`,
      };
    }),

  // ── createWhiteLabelTenant: provision white-label instance ────────────────
  createWhiteLabelTenant: protectedProcedure
    .input(z.object({
      companyName:   z.string().min(2),
      subdomain:     z.string().min(3).regex(/^[a-z0-9-]+$/),
      primaryColor:  z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#1e40af"),
      logoUrl:       z.string().url().optional(),
      contactEmail:  z.string().email(),
      tier:          z.enum(["starter", "growth", "enterprise"]).default("starter"),
      modules:       z.array(z.string()).default(["policies", "claims", "agents"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const tenantId = `WL-${input.subdomain.toUpperCase()}-${Date.now()}`;

      await db.execute(sql`
        INSERT INTO white_label_tenants (
          id, company_name, subdomain, primary_color, logo_url,
          contact_email, tier, modules, status, created_by, created_at
        ) VALUES (
          ${tenantId}, ${input.companyName}, ${input.subdomain},
          ${input.primaryColor}, ${input.logoUrl ?? null},
          ${input.contactEmail}, ${input.tier},
          ${JSON.stringify(input.modules)}, 'provisioning',
          ${ctx.user?.id ?? "system"}, NOW()
        )
        ON CONFLICT (subdomain) DO NOTHING
      `);

      const tierPricing = {
        starter:    { setupFeeNGN: 500_000,   monthlyFeeNGN: 100_000 },
        growth:     { setupFeeNGN: 1_000_000, monthlyFeeNGN: 300_000 },
        enterprise: { setupFeeNGN: 2_000_000, monthlyFeeNGN: 500_000 },
      };

      return {
        tenantId,
        subdomain:    input.subdomain,
        portalUrl:    `https://${input.subdomain}.insureportal.ng`,
        status:       "provisioning",
        estimatedReadyMins: 15,
        pricing:      tierPricing[input.tier],
        modules:      input.modules,
        message:      `White-label portal for ${input.companyName} is being provisioned.`,
      };
    }),

  // ── getDataIntelligence: purchase data intelligence product ──────────────
  getDataIntelligence: protectedProcedure
    .input(z.object({
      productId: z.enum(["risk-dataset", "fraud-feed", "claims-benchmark", "market-share"]),
      format:    z.enum(["json", "csv", "parquet"]).default("json"),
    }))
    .query(async ({ input }) => {
      const products = {
        "risk-dataset": {
          name:         "Nigerian Risk Dataset",
          description:  "Anonymised risk factors for 2M+ policies across all 36 states",
          records:      2_100_000,
          lastUpdated:  "2026-07-01",
          priceNGN:     500_000,
          fields:       ["age_band", "state", "product_type", "risk_score", "claims_count"],
        },
        "fraud-feed":   {
          name:         "Fraud Intelligence Feed",
          description:  "Daily feed of fraud patterns, blacklisted entities, and risk signals",
          records:      50_000,
          lastUpdated:  new Date().toISOString().slice(0, 10),
          priceNGN:     200_000,
          fields:       ["pattern_type", "risk_signal", "frequency", "state", "product"],
        },
        "claims-benchmark": {
          name:         "Industry Claims Benchmark",
          description:  "Aggregated claims benchmarks by product, LGA, and insurer tier",
          records:      774,  // one per LGA
          lastUpdated:  "2026-06-30",
          priceNGN:     300_000,
          fields:       ["lga", "product_type", "avg_claim", "frequency", "severity"],
        },
        "market-share": {
          name:         "Market Share Intelligence",
          description:  "Premium market share by insurer, product, and region (NAICOM data)",
          records:      36,   // one per state
          lastUpdated:  "2026-06-30",
          priceNGN:     400_000,
          fields:       ["state", "insurer", "product", "market_share_pct", "premium_ngn"],
        },
      };

      const product = products[input.productId];
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      return {
        ...product,
        format:     input.format,
        downloadUrl: `https://data.insureportal.ng/intelligence/${input.productId}.${input.format}`,
        sampleUrl:   `https://data.insureportal.ng/intelligence/${input.productId}-sample.${input.format}`,
        license:     "InsurePortal Data License v1.0 — anonymised, no PII",
      };
    }),

  // ── getMonetizationDashboard: full revenue dashboard ─────────────────────
  getMonetizationDashboard: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return {
        kpis: { mrr: 0, arr: 0, apiCalls: 0, activeSubscriptions: 0, whiteLabelTenants: 0 },
        streams: [],
        topApps: [],
      };

      // KPIs
      const [subscriptions, apiCalls, wlTenants] = await Promise.all([
        db.execute(sql`SELECT COUNT(*) AS cnt FROM marketplace_subscriptions WHERE status = 'active'`),
        db.execute(sql`SELECT COUNT(*) AS cnt, SUM(cost_ngn) AS revenue FROM marketplace_api_calls WHERE called_at >= NOW() - INTERVAL '30 days'`),
        db.execute(sql`SELECT COUNT(*) AS cnt FROM white_label_tenants WHERE status = 'active'`),
      ]);

      const activeSubscriptions = Number((subscriptions.rows[0] as { cnt: number })?.cnt ?? 0);
      const apiCallCount = Number((apiCalls.rows[0] as { cnt: number })?.cnt ?? 0);
      const apiRevenue = Number((apiCalls.rows[0] as { revenue: number })?.revenue ?? 0);
      const wlCount = Number((wlTenants.rows[0] as { cnt: number })?.cnt ?? 0);

      // Estimated MRR (API revenue + WL fees + data products)
      const wlMRR = wlCount * 200_000; // avg ₦200k/mo per WL tenant
      const mrr = Math.round(apiRevenue + wlMRR);
      const arr = mrr * 12;

      // Real top apps by actual call volume in the last 30 days.
      const topAppRows = await db.execute(sql`
        SELECT app_id, COUNT(*) AS call_count
        FROM marketplace_api_calls
        WHERE called_at >= NOW() - INTERVAL '30 days'
        GROUP BY app_id
        ORDER BY call_count DESC
        LIMIT 3
      `);
      const topApps = (topAppRows.rows as Array<{ app_id: string; call_count: number }>).map(r => {
        const app = MARKETPLACE_APPS.find(a => a.id === r.app_id);
        return {
          id: r.app_id,
          name: app?.name ?? r.app_id,
          category: app?.category ?? "unknown",
          callsThisMonth: Number(r.call_count),
        };
      });

      // Real revenue streams from platform_revenue (last 30 days).
      const streamRows = await db.execute(sql`
        SELECT revenue_stream, SUM(amount_ngn) AS total_ngn
        FROM platform_revenue
        WHERE recorded_at >= NOW() - INTERVAL '30 days'
        GROUP BY revenue_stream
        ORDER BY total_ngn DESC
      `);
      const streamTotal = (streamRows.rows as Array<{ total_ngn: number }>)
        .reduce((s, r) => s + Number(r.total_ngn), 0);
      const streams = (streamRows.rows as Array<{ revenue_stream: string; total_ngn: number }>).map(r => ({
        name: r.revenue_stream,
        revenuePct: streamTotal > 0 ? Math.round((Number(r.total_ngn) / streamTotal) * 100) : 0,
        mrrNGN: Math.round(Number(r.total_ngn)),
        trend: null, // no trend baseline is tracked — not fabricated
      }));

      return {
        kpis: {
          mrr,
          arr,
          apiCalls:           apiCallCount,
          activeSubscriptions,
          whiteLabelTenants:  wlCount,
        },
        streams,
        topApps,
        // No opportunity pipeline store exists — honest empty list.
        opportunities: [] as Array<{
          title: string;
          potentialMRR: number;
          effort: string;
          priority: string;
        }>,
      };
    }),
});
