/**
 * Analytics Query Router — 54Link POS Shell (Sprint 89)
 *
 * tRPC router for querying transaction analytics from OpenSearch.
 * Provides aggregated metrics, time-series data, and search capabilities
 * for the TransactionAnalytics dashboard.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { platformBillingLedger, billingAuditLog } from "../../drizzle/schema";
import { desc, count, sql, gte, and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from '../_core/logger';

// OpenSearch adapter (connects to opensearch-indexer Python service)
async function queryOpenSearch(
  index: string,
  body: Record<string, any>
): Promise<any> {
  const osEndpoint = process.env.OPENSEARCH_ENDPOINT || "http://localhost:9200";
  try {
    const res = await fetch(`${osEndpoint}/${index}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
    logger.warn(`[OpenSearch] Query failed: ${res.status}`);
    return null;
  } catch {
    // OpenSearch not available — fall back to DB
    return null;
  }
}

export const analyticsQueryRouter = router({
  // ── Transaction Volume Metrics ────────────────────────────────────────────────
  getTransactionMetrics: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const since = new Date(Date.now() - input.days * 86400000);

        // Try OpenSearch first
        const osResult = await queryOpenSearch("transactions", {
          size: 0,
          query: { range: { timestamp: { gte: since.toISOString() } } },
          aggs: {
            total_volume: { sum: { field: "amount" } },
            avg_amount: { avg: { field: "amount" } },
            by_status: { terms: { field: "status.keyword" } },
            by_day: {
              date_histogram: { field: "timestamp", calendar_interval: "day" },
              aggs: { daily_volume: { sum: { field: "amount" } } },
            },
          },
        });

        if (osResult?.aggregations) {
          return {
            source: "opensearch" as const,
            totalVolume: osResult.aggregations.total_volume.value,
            avgAmount: osResult.aggregations.avg_amount.value,
            byStatus: osResult.aggregations.by_status.buckets,
            timeSeries: osResult.aggregations.by_day.buckets.map((b: any) => ({
              date: b.key_as_string,
              volume: b.daily_volume.value,
              count: b.doc_count,
            })),
          };
        }

        // Fallback to DB
        const [ledgerCount] = await db
          .select({ count: count() })
          .from(platformBillingLedger)
          .where(gte(platformBillingLedger.createdAt, since));

        const recentLedger = await db
          .select()
          .from(platformBillingLedger)
          .where(gte(platformBillingLedger.createdAt, since))
          .orderBy(desc(platformBillingLedger.createdAt))
          .limit(100);

        const totalVolume = recentLedger.reduce(
          (sum: any, e: any) => sum + parseFloat(e.grossAmount || "0"),
          0
        );

        return {
          source: "database" as const,
          totalVolume,
          avgAmount:
            ledgerCount.count > 0 ? totalVolume / ledgerCount.count : 0,
          byStatus: [] as Array<Record<string, unknown>>,
          timeSeries: [] as Array<Record<string, unknown>>,
          totalCount: ledgerCount.count,
          recentEntries: recentLedger.slice(0, 20),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Search Transactions ───────────────────────────────────────────────────────
  searchTransactions: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        // Try OpenSearch
        const osResult = await queryOpenSearch("transactions", {
          size: input.limit,
          query: {
            multi_match: {
              query: input.query,
              fields: [
                "transactionId",
                "tenantId",
                "currency",
                "status",
                "invoiceId",
              ],
            },
          },
        });

        if (osResult?.hits?.hits) {
          return {
            source: "opensearch" as const,
            results: osResult.hits.hits.map((h: any) => h._source),
            total: osResult.hits.total.value,
          };
        }

        // Fallback: search billing ledger by invoice ID
        const db = (await getDb())!;
        const results = await db
          .select()
          .from(platformBillingLedger)
          .where(
            sql`${platformBillingLedger.transactionRef} LIKE ${"%" + input.query + "%"}`
          )
          .limit(input.limit);

        return {
          source: "database" as const,
          results,
          total: results.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Pipeline Health (admin only) ──────────────────────────────────────────────
  getPipelineHealth: adminProcedure.query(async () => {
    const fluvioEndpoint = process.env.FLUVIO_ENDPOINT || "localhost:9003";
    const osEndpoint =
      process.env.OPENSEARCH_ENDPOINT || "http://localhost:9200";

    let fluvioStatus = "unknown";
    let opensearchStatus = "unknown";

    try {
      const osRes = await fetch(`${osEndpoint}/_cluster/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (osRes.ok) {
        const health = await osRes.json();
        opensearchStatus = health.status || "unknown";
      }
    } catch {
      opensearchStatus = "unavailable";
    }

    return {
      fluvio: { endpoint: fluvioEndpoint, status: fluvioStatus },
      opensearch: { endpoint: osEndpoint, status: opensearchStatus },
      timestamp: new Date().toISOString(),
    };
  }),
});
