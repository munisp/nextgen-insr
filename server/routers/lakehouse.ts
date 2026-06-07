/**
 * lakehouse.ts — tRPC router for the InsurePortal Data Lakehouse
 *
 * Exposes:
 *  - snapshot management  (upload, list, presigned download URL, stats)
 *  - spatial analytics    (agent density grid, transaction heatmap,
 *                          nearest-agent radius search — Sedona-style
 *                          using PostGIS haversine fallback)
 *  - DataFusion proxy     (ad-hoc query forwarded to Python lakehouse service)
 *  - Gold-layer metrics   (daily agent summary, hourly tx metrics from
 *                          lakehouse Gold tables via Python proxy)
 *
 * Architecture:
 *   Node.js tRPC ──► server/lakehouse.ts (MinIO S3 client)
 *                ──► Python lakehouse-service :8156 (DataFusion / Iceberg)
 *                ──► PostgreSQL (spatial fallback via haversine)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  uploadTransactionSnapshot,
  uploadFraudEvents,
  uploadSettlementSummary,
  listSnapshots,
  getSnapshotDownloadUrl,
  BUCKETS,
} from "../lakehouse";
import { getDb } from "../db";
import {
  transactions,
  agents,
  fraudAlerts,
  deviceLocations,
  auditLog,
} from "../../drizzle/schema";
import { writeAuditLog } from "../db";
import { sql, gte, lte, and, eq, desc } from "drizzle-orm";
import logger from "../_core/logger";

// ── Python lakehouse-service proxy ────────────────────────────────────────────
const LAKEHOUSE_SERVICE_URL =
  process.env.LAKEHOUSE_SERVICE_URL ?? "http://localhost:8156";
const LAKEHOUSE_TOKEN = process.env.LAKEHOUSE_SERVICE_TOKEN ?? "dev-token";

async function lakehouseFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = `${LAKEHOUSE_SERVICE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LAKEHOUSE_TOKEN}`,
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lakehouse service error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Haversine distance (metres) ───────────────────────────────────────────────
function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Grid cell key ─────────────────────────────────────────────────────────────
function gridCell(lat: number, lon: number, cellDeg: number): string {
  return `${Math.floor(lat / cellDeg) * cellDeg}_${Math.floor(lon / cellDeg) * cellDeg}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export const lakehouseRouter = router({
  // ── 1. Snapshot: trigger manual transaction snapshot upload ────────────────
  triggerTransactionSnapshot: adminProcedure
    .input(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const date = input.date ?? new Date().toISOString().slice(0, 10);
        const start = new Date(`${date}T00:00:00Z`);
        const end = new Date(`${date}T23:59:59Z`);

        const rows = await db
          .select()
          .from(transactions)
          .where(
            and(
              gte(transactions.createdAt, start),
              lte(transactions.createdAt, end)
            )
          )
          .orderBy(desc(transactions.createdAt))
          .limit(10_000);

        const key = await uploadTransactionSnapshot(date, rows);
        logger.info(
          { key, count: rows.length },
          "[Lakehouse] Transaction snapshot uploaded"
        );

        return { date, recordCount: rows.length, key };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── 2. Snapshot: trigger fraud events snapshot ────────────────────────────
  triggerFraudSnapshot: adminProcedure
    .input(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const date = input.date ?? new Date().toISOString().slice(0, 10);
        const start = new Date(`${date}T00:00:00Z`);
        const end = new Date(`${date}T23:59:59Z`);

        const rows = await db
          .select()
          .from(fraudAlerts)
          .where(
            and(
              gte(fraudAlerts.createdAt, start),
              lte(fraudAlerts.createdAt, end)
            )
          )
          .limit(5_000);

        const key = await uploadFraudEvents(date, rows);
        return { date, recordCount: rows.length, key };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── 3. Snapshot: list available snapshots for a bucket + date prefix ───────
  listSnapshots: adminProcedure
    .input(
      z.object({
        bucket: z.enum([
          "transactions",
          "settlements",
          "fraud_events",
          "agent_metrics",
        ]),
        datePrefix: z
          .string()
          .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
          .default(new Date().toISOString().slice(0, 7)),
      })
    )
    .query(async ({ input }) => {
      try {
        const bucketMap: Record<string, string> = {
          transactions: BUCKETS.TRANSACTIONS,
          settlements: BUCKETS.SETTLEMENTS,
          fraud_events: BUCKETS.FRAUD_EVENTS,
          agent_metrics: BUCKETS.AGENT_METRICS,
        };
        const keys = await listSnapshots(
          bucketMap[input.bucket],
          input.datePrefix
        );
        return { bucket: input.bucket, datePrefix: input.datePrefix, keys };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── 4. Snapshot: get presigned download URL ────────────────────────────────
  getDownloadUrl: adminProcedure
    .input(
      z.object({
        bucket: z.enum([
          "transactions",
          "settlements",
          "fraud_events",
          "agent_metrics",
        ]),
        key: z.string().min(1),
        expiresInSeconds: z.number().int().min(60).max(86400).default(3600),
      })
    )
    .query(async ({ input }) => {
      try {
        const bucketMap: Record<string, string> = {
          transactions: BUCKETS.TRANSACTIONS,
          settlements: BUCKETS.SETTLEMENTS,
          fraud_events: BUCKETS.FRAUD_EVENTS,
          agent_metrics: BUCKETS.AGENT_METRICS,
        };
        const url = await getSnapshotDownloadUrl(
          bucketMap[input.bucket],
          input.key,
          input.expiresInSeconds
        );
        if (!url)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Snapshot not found or MinIO unavailable",
          });
        return {
          url,
          expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
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

  // ── 5. Snapshot: stats (counts per bucket from PostgreSQL) ─────────────────
  snapshotStats: adminProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [txTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions);
    const [txToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(gte(transactions.createdAt, today));
    const [fraudTotal] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fraudAlerts);

    return {
      transactions: { total: txTotal?.count ?? 0, today: txToday?.count ?? 0 },
      fraudAlerts: { total: fraudTotal?.count ?? 0 },
      layers: {
        bronze: "Kafka → Parquet (Iceberg) via Spark Structured Streaming",
        silver: "Cleaned + enriched via etl_bronze_to_silver.py",
        gold: "Daily agent summary + hourly metrics via etl_silver_to_gold.py",
      },
    };
  }),

  // ── 6. Spatial: agent density grid (Sedona ST_H3 equivalent) ──────────────
  agentDensityGrid: protectedProcedure
    .input(
      z.object({
        swLat: z.number().min(-90).max(90),
        swLon: z.number().min(-180).max(180),
        neLat: z.number().min(-90).max(90),
        neLon: z.number().min(-180).max(180),
        /** Cell size in degrees (0.1° ≈ 11 km, 0.01° ≈ 1.1 km) */
        cellDeg: z.number().min(0.001).max(5).default(0.1),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Try Python lakehouse-service first (has PostGIS / Sedona)
        try {
          const result = (await lakehouseFetch(
            `/api/v1/spatial/agent-density?sw_lat=${input.swLat}&sw_lon=${input.swLon}` +
              `&ne_lat=${input.neLat}&ne_lon=${input.neLon}&cell_deg=${input.cellDeg}`
          )) as { cells: Array<{ lat: number; lon: number; count: number }> };
          return result;
        } catch (err) {
          logger.warn(
            { err },
            "[Lakehouse] Spatial agent-density service unavailable, using PostgreSQL fallback"
          );
        }

        // PostgreSQL fallback: aggregate agents by grid cell
        // Use deviceLocations table which has actual lat/lon coordinates
        const agentRows = await db
          .select({
            lat: deviceLocations.latitude,
            lon: deviceLocations.longitude,
            agentId: deviceLocations.agentId,
          })
          .from(deviceLocations)
          .innerJoin(agents, eq(deviceLocations.agentId, agents.id))
          .where(
            and(
              eq(agents.isActive, true),
              sql`${deviceLocations.latitude} between ${input.swLat} and ${input.neLat}`,
              sql`${deviceLocations.longitude} between ${input.swLon} and ${input.neLon}`
            )
          )
          .limit(5_000);

        const grid: Record<
          string,
          { lat: number; lon: number; count: number }
        > = {};
        for (const row of agentRows) {
          if (!row.lat || !row.lon) continue;
          const lat = parseFloat(String(row.lat));
          const lon = parseFloat(String(row.lon));
          const key = gridCell(lat, lon, input.cellDeg);
          if (!grid[key]) {
            grid[key] = {
              lat:
                Math.floor(lat / input.cellDeg) * input.cellDeg +
                input.cellDeg / 2,
              lon:
                Math.floor(lon / input.cellDeg) * input.cellDeg +
                input.cellDeg / 2,
              count: 0,
            };
          }
          grid[key].count++;
        }

        return {
          cells: Object.values(grid as any),
          source: "postgresql-fallback",
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

  // ── 7. Spatial: transaction heatmap (last N hours) ─────────────────────────
  transactionHeatmap: protectedProcedure
    .input(
      z.object({
        hours: z.number().int().min(1).max(168).default(24),
        cellDeg: z.number().min(0.001).max(5).default(0.1),
        minAmount: z.number().optional(),
        txType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Try Python lakehouse-service first
        try {
          const params = new URLSearchParams({
            hours: String(input.hours),
            cell_deg: String(input.cellDeg),
            ...(input.minAmount ? { min_amount: String(input.minAmount) } : {}),
            ...(input.txType ? { tx_type: input.txType } : {}),
          });
          const result = (await lakehouseFetch(
            `/api/v1/spatial/transaction-heatmap?${params}`
          )) as {
            cells: Array<{
              lat: number;
              lon: number;
              count: number;
              volume: number;
            }>;
          };
          return result;
        } catch (err) {
          logger.warn(
            { err },
            "[Lakehouse] Spatial transaction-heatmap service unavailable, using PostgreSQL fallback"
          );
        }

        // PostgreSQL fallback: join transactions → agents for lat/lon
        const since = new Date(Date.now() - input.hours * 3_600_000);
        const rows = await db
          .select({
            lat: deviceLocations.latitude,
            lon: deviceLocations.longitude,
            amount: transactions.amount,
            type: transactions.type,
          })
          .from(transactions)
          .innerJoin(
            deviceLocations,
            eq(transactions.agentId, deviceLocations.agentId)
          )
          .where(
            and(
              gte(transactions.createdAt, since),
              eq(transactions.status, "success"),
              ...(input.txType
                ? [eq(transactions.type, input.txType as any)]
                : [])
            )
          )
          .limit(50_000);

        const grid: Record<
          string,
          { lat: number; lon: number; count: number; volume: number }
        > = {};
        for (const row of rows) {
          if (!row.lat || !row.lon) continue;
          const lat = parseFloat(String(row.lat));
          const lon = parseFloat(String(row.lon));
          const amount = parseFloat(String(row.amount ?? 0));
          if (input.minAmount && amount < input.minAmount) continue;
          const key = gridCell(lat, lon, input.cellDeg);
          if (!grid[key]) {
            grid[key] = {
              lat:
                Math.floor(lat / input.cellDeg) * input.cellDeg +
                input.cellDeg / 2,
              lon:
                Math.floor(lon / input.cellDeg) * input.cellDeg +
                input.cellDeg / 2,
              count: 0,
              volume: 0,
            };
          }
          grid[key].count++;
          grid[key].volume += amount;
        }

        return {
          cells: Object.values(grid as any),
          source: "postgresql-fallback",
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

  // ── 8. Spatial: nearest active agents within radius ────────────────────────
  nearestAgents: protectedProcedure
    .input(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMetres: z.number().min(100).max(100_000).default(5_000),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Try Python lakehouse-service (PostGIS ST_DWithin)
        try {
          const params = new URLSearchParams({
            lat: String(input.latitude),
            lon: String(input.longitude),
            radius_m: String(input.radiusMetres),
            limit: String(input.limit),
          });
          const result = (await lakehouseFetch(
            `/api/v1/spatial/nearest-agents?${params}`
          )) as {
            agents: Array<{
              id: number;
              name: string;
              agentCode: string;
              distanceMetres: number;
              tier: string;
            }>;
          };
          return result;
        } catch (err) {
          logger.warn(
            { err },
            "[Lakehouse] Nearest-agents service unavailable, using haversine fallback"
          );
        }

        // Haversine fallback
        const allAgents = await db
          .select({
            id: agents.id,
            name: agents.name,
            agentCode: agents.agentCode,
            tier: agents.tier,
            floatBalance: agents.floatBalance,
            lat: deviceLocations.latitude,
            lon: deviceLocations.longitude,
          })
          .from(agents)
          .innerJoin(deviceLocations, eq(agents.id, deviceLocations.agentId))
          .where(eq(agents.isActive, true))
          .limit(2_000);

        const nearby = allAgents
          .filter((a: any) => a.lat != null && a.lon != null)
          .map((a: any) => ({
            id: a.id,
            name: a.name,
            agentCode: a.agentCode,
            tier: a.tier,
            floatBalance: a.floatBalance,
            distanceMetres: Math.round(
              haversineMetres(
                input.latitude,
                input.longitude,
                Number(a.lat),
                Number(a.lon)
              )
            ),
          }))
          .filter((a: any) => a.distanceMetres <= input.radiusMetres)
          .sort((a: any, b: any) => a.distanceMetres - b.distanceMetres)
          .slice(0, input.limit);

        return { agents: nearby, source: "haversine-fallback" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── 9. DataFusion: ad-hoc Parquet/Iceberg query via Python proxy ───────────
  lakehouseQuery: adminProcedure
    .input(
      z.object({
        /** SQL query against Iceberg tables (insureportal.silver.* / insureportal.gold.*) */
        sql: z.string().min(10).max(2_000),
        /** Max rows to return */
        limit: z.number().int().min(1).max(10_000).default(1_000),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = (await lakehouseFetch("/api/v1/query", {
          method: "POST",
          body: JSON.stringify({ sql: input.sql, limit: input.limit }),
        })) as {
          columns: string[];
          rows: unknown[][];
          rowCount: number;
          durationMs: number;
        };
        return result;
      } catch (err) {
        logger.warn({ err }, "[Lakehouse] DataFusion query failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Lakehouse query failed: ${(err as Error).message}`,
        });
      }
    }),

  // ── 10. Gold-layer: daily agent summary from lakehouse ─────────────────────
  goldDailyAgentSummary: adminProcedure
    .input(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        agentId: z.number().int().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        const date = input.date ?? new Date().toISOString().slice(0, 10);

        // Try Python lakehouse-service Gold layer
        try {
          const params = new URLSearchParams({
            summary_date: date,
            limit: String(input.limit),
            ...(input.agentId ? { agent_id: String(input.agentId) } : {}),
          });
          const result = (await lakehouseFetch(
            `/api/v1/gold/daily-agent-summary?${params}`
          )) as {
            rows: Array<{
              summaryDate: string;
              agentId: number;
              agentCode: string;
              agentTier: string;
              txCount: number;
              txVolume: number;
              txFees: number;
              txCommission: number;
              fraudCount: number;
              successRate: number;
              avgTxAmount: number;
              uniqueCustomers: number;
            }>;
            total: number;
          };
          return { ...result, source: "lakehouse-gold" };
        } catch (err) {
          logger.warn(
            { err },
            "[Lakehouse] Gold daily-agent-summary unavailable, using PostgreSQL fallback"
          );
        }

        // PostgreSQL fallback
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const start = new Date(`${date}T00:00:00Z`);
        const end = new Date(`${date}T23:59:59Z`);

        const rows = await db
          .select({
            agentId: transactions.agentId,
            agentCode: agents.agentCode,
            agentTier: agents.tier,
            txCount: sql<number>`count(*)::int`,
            txVolume: sql<number>`sum(${transactions.amount})::float`,
            txFees: sql<number>`sum(${transactions.fee})::float`,
            txCommission: sql<number>`sum(${transactions.commission})::float`,
            fraudCount: sql<number>`sum(case when ${transactions.fraudScore} >= 0.7 then 1 else 0 end)::int`,
            successCount: sql<number>`sum(case when ${transactions.status} = 'success' then 1 else 0 end)::int`,
            avgTxAmount: sql<number>`avg(${transactions.amount})::float`,
          })
          .from(transactions)
          .innerJoin(agents, eq(transactions.agentId, agents.id))
          .where(
            and(
              gte(transactions.createdAt, start),
              lte(transactions.createdAt, end),
              ...(input.agentId
                ? [eq(transactions.agentId, input.agentId)]
                : [])
            )
          )
          .groupBy(transactions.agentId, agents.agentCode, agents.tier)
          .orderBy(desc(sql`sum(${transactions.amount})`))
          .limit(input.limit);

        return {
          rows: rows.map((r: any) => ({
            summaryDate: date,
            agentId: r.agentId ?? 0,
            agentCode: r.agentCode,
            agentTier: r.agentTier ?? "bronze",
            txCount: r.txCount ?? 0,
            txVolume: r.txVolume ?? 0,
            txFees: r.txFees ?? 0,
            txCommission: r.txCommission ?? 0,
            fraudCount: r.fraudCount ?? 0,
            successRate: r.txCount ? (r.successCount ?? 0) / r.txCount : 0,
            avgTxAmount: r.avgTxAmount ?? 0,
            uniqueCustomers: 0, // not tracked in current schema
          })),
          total: rows.length,
          source: "postgresql-fallback",
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

  // ── 11. Gold-layer: hourly transaction metrics ─────────────────────────────
  goldHourlyMetrics: adminProcedure
    .input(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const date = input.date ?? new Date().toISOString().slice(0, 10);

        // Try Python lakehouse-service Gold layer
        try {
          const result = (await lakehouseFetch(
            `/api/v1/gold/hourly-metrics?date=${date}`
          )) as {
            hours: Array<{
              hour: number;
              txCount: number;
              txVolume: number;
              errorRate: number;
              fraudRate: number;
            }>;
          };
          return { ...result, source: "lakehouse-gold" };
        } catch (err) {
          logger.warn(
            { err },
            "[Lakehouse] Gold hourly-metrics unavailable, using PostgreSQL fallback"
          );
        }

        // PostgreSQL fallback
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const start = new Date(`${date}T00:00:00Z`);
        const end = new Date(`${date}T23:59:59Z`);

        const rows = await db
          .select({
            hour: sql<number>`extract(hour from ${transactions.createdAt})::int`,
            txCount: sql<number>`count(*)::int`,
            txVolume: sql<number>`sum(${transactions.amount})::float`,
            failedCount: sql<number>`sum(case when ${transactions.status} = 'failed' then 1 else 0 end)::int`,
            fraudCount: sql<number>`sum(case when ${transactions.fraudScore} >= 0.7 then 1 else 0 end)::int`,
          })
          .from(transactions)
          .where(
            and(
              gte(transactions.createdAt, start),
              lte(transactions.createdAt, end)
            )
          )
          .groupBy(sql`extract(hour from ${transactions.createdAt})`)
          .orderBy(sql`extract(hour from ${transactions.createdAt})`);

        return {
          hours: rows.map((r: any) => ({
            hour: r.hour ?? 0,
            txCount: r.txCount ?? 0,
            txVolume: r.txVolume ?? 0,
            errorRate: r.txCount ? (r.failedCount ?? 0) / r.txCount : 0,
            fraudRate: r.txCount ? (r.fraudCount ?? 0) / r.txCount : 0,
          })),
          source: "postgresql-fallback",
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

  // ── Spark ETL trigger ──────────────────────────────────────────────────────
  triggerEtl: adminProcedure
    .input(
      z.object({
        pipeline: z.enum(["bronze_to_silver", "silver_to_gold", "full"]),
        date: z.string().optional(),
        force: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const targetDate = input.date ?? new Date().toISOString().slice(0, 10);
        const jobId = `etl-${input.pipeline}-${targetDate}-${Date.now()}`;
        try {
          const body = (await lakehouseFetch("/api/v1/etl/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pipeline: input.pipeline,
              date: targetDate,
              force: input.force,
              jobId,
            }),
          })) as { jobId?: string; status?: string };
          await writeAuditLog({
            action: "ETL_TRIGGER",
            resource: "lakehouse",
            resourceId: jobId,
            status: "success",
            metadata: {
              pipeline: input.pipeline,
              date: targetDate,
              force: input.force,
              userId: ctx.user.id,
            },
          });
          return {
            jobId: body.jobId ?? jobId,
            status: body.status ?? "queued",
            source: "lakehouse-service",
          };
        } catch {
          await writeAuditLog({
            action: "ETL_TRIGGER",
            resource: "lakehouse",
            resourceId: jobId,
            status: "warning",
            metadata: {
              pipeline: input.pipeline,
              date: targetDate,
              force: input.force,
              note: "lakehouse-service-unavailable",
              userId: ctx.user.id,
            },
          });
          return {
            jobId,
            status: "pending",
            source: "audit-only",
            note: "Lakehouse service unavailable; job recorded for manual execution",
          };
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  pipelineStatus: adminProcedure
    .input(z.object({ jobId: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        try {
          const url = input.jobId
            ? `/api/v1/etl/status?jobId=${encodeURIComponent(input.jobId)}`
            : "/api/v1/etl/status";
          const result = (await lakehouseFetch(url)) as {
            jobs?: Array<{
              jobId: string;
              pipeline: string;
              status: string;
              startedAt: string;
              completedAt?: string;
              error?: string;
            }>;
          };
          return { jobs: result.jobs ?? [], source: "lakehouse-service" };
        } catch {
          const rows = await db
            .select()
            .from(auditLog)
            .where(eq(auditLog.action, "ETL_TRIGGER"))
            .orderBy(desc(auditLog.createdAt))
            .limit(10);
          return {
            jobs: rows.map((r: any) => ({
              jobId: r.resourceId ?? "",
              pipeline:
                ((r.metadata as Record<string, unknown>)?.pipeline as string) ??
                "unknown",
              status: r.status ?? "unknown",
              startedAt: r.createdAt?.toISOString() ?? "",
            })),
            source: "audit-log-fallback",
          };
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
