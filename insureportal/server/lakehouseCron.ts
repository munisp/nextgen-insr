// @ts-check
// TypeScript enabled — Sprint 96 security audit
/**
 * lakehouseCron.ts — Daily lakehouse snapshot jobs
 *
 * Schedule (WAT = UTC+1):
 *   02:00 WAT daily — transaction snapshot for previous day
 *   02:05 WAT daily — fraud events snapshot for previous day
 *   02:10 WAT daily — agent metrics snapshot for previous day
 *   02:15 WAT daily — settlement summary snapshot for previous day
 *
 * All uploads go to MinIO buckets (insureportal-transactions, insureportal-fraud-events,
 * insureportal-agent-metrics, insureportal-settlements) as JSON/Parquet files organized
 * by YYYY/MM/DD partition keys.
 *
 * Failures are logged but do not crash the server — the lakehouse is a
 * secondary analytics store, not the system of record.
 */

import cron from "node-cron";
import {
  uploadTransactionSnapshot,
  uploadFraudEvents,
  uploadSettlementSummary,
  BUCKETS,
} from "./lakehouse";
import { getDb } from "./db";
import { transactions, agents, fraudAlerts } from "@schema";
import { gte, lte, and, eq, desc, sql } from "drizzle-orm";
import logger from "./_core/logger";

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function snapshotTransactions(date: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.warn(
      "[LakehouseCron] DB unavailable, skipping transaction snapshot"
    );
    return;
  }

  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(gte(transactions.createdAt, start), lte(transactions.createdAt, end))
    )
    .orderBy(desc(transactions.createdAt))
    .limit(100_000);

  const key = await uploadTransactionSnapshot(date, rows);
  logger.info(
    { key, count: rows.length, date },
    "[LakehouseCron] Transaction snapshot uploaded"
  );
}

async function snapshotFraudEvents(date: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.warn("[LakehouseCron] DB unavailable, skipping fraud snapshot");
    return;
  }

  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const rows = await db
    .select()
    .from(fraudAlerts)
    .where(
      and(gte(fraudAlerts.createdAt, start), lte(fraudAlerts.createdAt, end))
    )
    .limit(50_000);

  const key = await uploadFraudEvents(date, rows);
  logger.info(
    { key, count: rows.length, date },
    "[LakehouseCron] Fraud events snapshot uploaded"
  );
}

async function snapshotAgentMetrics(date: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.warn(
      "[LakehouseCron] DB unavailable, skipping agent metrics snapshot"
    );
    return;
  }

  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  // Aggregate per-agent metrics for the day
  const rows = await db
    .select({
      agentNumericId: transactions.agentId,
      agentCode: agents.agentId,
      tier: agents.tier,
      txCount: sql<number>`count(*)::int`,
      txVolume: sql<number>`sum(${transactions.amount})::float`,
      txFees: sql<number>`sum(${transactions.fee})::float`,
      txCommission: sql<number>`sum(${transactions.commission})::float`,
      successCount: sql<number>`sum(case when ${transactions.status} = 'success' then 1 else 0 end)::int`,
      failedCount: sql<number>`sum(case when ${transactions.status} = 'failed' then 1 else 0 end)::int`,
      fraudCount: sql<number>`sum(case when ${transactions.fraudScore} >= 0.7 then 1 else 0 end)::int`,
      avgFraudScore: sql<number>`avg(${transactions.fraudScore})::float`,
    })
    .from(transactions)
    .innerJoin(agents, eq(transactions.agentId, agents.id))
    .where(
      and(gte(transactions.createdAt, start), lte(transactions.createdAt, end))
    )
    .groupBy(transactions.agentId, agents.agentId, agents.tier);

  const metrics = rows.map(r => ({
    date,
    agentId: r.agentNumericId,
    agentCode: r.agentCode,
    tier: r.tier,
    txCount: r.txCount ?? 0,
    txVolume: r.txVolume ?? 0,
    txFees: r.txFees ?? 0,
    txCommission: r.txCommission ?? 0,
    successRate: r.txCount ? (r.successCount ?? 0) / r.txCount : 0,
    failedCount: r.failedCount ?? 0,
    fraudCount: r.fraudCount ?? 0,
    avgFraudScore: r.avgFraudScore ?? 0,
  }));

  // Upload to agent_metrics bucket
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
  const s3 = new S3Client({
    endpoint: MINIO_ENDPOINT,
    region: process.env.MINIO_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
    },
    forcePathStyle: true,
  });

  const [y, m, d] = date.split("-");
  const key = `${y}/${m}/${d}/agent-metrics-${date}.json`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKETS.AGENT_METRICS,
        Key: key,
        Body: JSON.stringify(metrics, null, 2),
        ContentType: "application/json",
        Metadata: {
          "record-count": String(metrics.length),
          "snapshot-date": date,
        },
      })
    );
    logger.info(
      { key, count: metrics.length, date },
      "[LakehouseCron] Agent metrics snapshot uploaded"
    );
  } catch (err) {
    logger.warn(
      { err },
      "[LakehouseCron] Agent metrics upload failed (MinIO may be unavailable)"
    );
  }
}

async function snapshotSettlementSummary(date: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.warn("[LakehouseCron] DB unavailable, skipping settlement snapshot");
    return;
  }

  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const [totals] = await db
    .select({
      txCount: sql<number>`count(*)::int`,
      totalVolume: sql<number>`sum(${transactions.amount})::float`,
      totalFees: sql<number>`sum(${transactions.fee})::float`,
      totalCommission: sql<number>`sum(${transactions.commission})::float`,
      successCount: sql<number>`sum(case when ${transactions.status} = 'success' then 1 else 0 end)::int`,
      failedCount: sql<number>`sum(case when ${transactions.status} = 'failed' then 1 else 0 end)::int`,
      fraudCount: sql<number>`sum(case when ${transactions.fraudScore} >= 0.7 then 1 else 0 end)::int`,
      activeAgents: sql<number>`count(distinct ${transactions.agentId})::int`,
    })
    .from(transactions)
    .where(
      and(gte(transactions.createdAt, start), lte(transactions.createdAt, end))
    );

  const summary = {
    date,
    generatedAt: new Date().toISOString(),
    txCount: totals?.txCount ?? 0,
    totalVolume: totals?.totalVolume ?? 0,
    totalFees: totals?.totalFees ?? 0,
    totalCommission: totals?.totalCommission ?? 0,
    successRate: totals?.txCount
      ? (totals.successCount ?? 0) / totals.txCount
      : 0,
    failedCount: totals?.failedCount ?? 0,
    fraudCount: totals?.fraudCount ?? 0,
    activeAgents: totals?.activeAgents ?? 0,
  };

  const key = await uploadSettlementSummary(date, summary);
  logger.info(
    { key, date },
    "[LakehouseCron] Settlement summary snapshot uploaded"
  );
}

/**
 * Register all lakehouse snapshot cron jobs.
 * Called once from server/_core/index.ts after the HTTP server starts.
 */
export function registerLakehouseCron(): void {
  // 02:00 WAT = 01:00 UTC (UTC+1 = WAT)
  cron.schedule("0 1 * * *", async () => {
    const date = yesterday();
    logger.info(
      { date },
      "[LakehouseCron] Starting daily transaction snapshot"
    );
    await snapshotTransactions(date).catch(err =>
      logger.error({ err }, "[LakehouseCron] Transaction snapshot failed")
    );
  });

  // 02:05 WAT = 01:05 UTC
  cron.schedule("5 1 * * *", async () => {
    const date = yesterday();
    logger.info(
      { date },
      "[LakehouseCron] Starting daily fraud events snapshot"
    );
    await snapshotFraudEvents(date).catch(err =>
      logger.error({ err }, "[LakehouseCron] Fraud events snapshot failed")
    );
  });

  // 02:10 WAT = 01:10 UTC
  cron.schedule("10 1 * * *", async () => {
    const date = yesterday();
    logger.info(
      { date },
      "[LakehouseCron] Starting daily agent metrics snapshot"
    );
    await snapshotAgentMetrics(date).catch(err =>
      logger.error({ err }, "[LakehouseCron] Agent metrics snapshot failed")
    );
  });

  // 02:15 WAT = 01:15 UTC
  cron.schedule("15 1 * * *", async () => {
    const date = yesterday();
    logger.info(
      { date },
      "[LakehouseCron] Starting daily settlement summary snapshot"
    );
    await snapshotSettlementSummary(date).catch(err =>
      logger.error(
        { err },
        "[LakehouseCron] Settlement summary snapshot failed"
      )
    );
  });

  logger.info(
    "[LakehouseCron] Registered 4 daily snapshot jobs (02:00–02:15 WAT)"
  );
}

// Export individual functions for use in tRPC mutations (manual triggers)
export {
  snapshotTransactions,
  snapshotFraudEvents,
  snapshotAgentMetrics,
  snapshotSettlementSummary,
};
