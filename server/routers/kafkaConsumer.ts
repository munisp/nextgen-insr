/**
 * Kafka Consumer Status tRPC Router
 *
 * Exposes Kafka/Fluvio consumer group status:
 *   - Consumer group list with lag per topic
 *   - Topic partition offsets
 *   - DLQ (dead-letter queue) message count and drain
 *   - Consumer group reset (admin only)
 *
 * Uses the Fluvio client when available; falls back to static metadata.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { dlqMessages } from "../../drizzle/schema";
import { desc, eq, count, sql, and, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const KAFKA_BROKER = process.env.KAFKA_BROKER ?? "kafka:9092";
const FLUVIO_URL = process.env.FLUVIO_ENDPOINT ?? "http://fluvio-sc:9003";

/** Fetch Fluvio/Kafka stats from the SC API */
async function fetchFluvioStats(): Promise<{
  topics: Array<{
    name: string;
    partitions: number;
    replicationFactor: number;
    messageCount: number;
    lag: number;
  }>;
  consumers: Array<{
    groupId: string;
    topic: string;
    partition: number;
    currentOffset: number;
    logEndOffset: number;
    lag: number;
    memberId: string;
    status: "active" | "idle" | "error";
  }>;
} | null> {
  try {
    const res = await fetch(`${FLUVIO_URL}/api/stats`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Well-known InsurePortal Kafka topics
const KNOWN_TOPICS = [
  { name: "pos.transactions.created", description: "POS transaction events" },
  {
    name: "pos.transactions.settled",
    description: "Settlement completion events",
  },
  { name: "pos.fraud.alerts", description: "Fraud detection alerts" },
  { name: "pos.float.alerts", description: "Float low-balance alerts" },
  { name: "pos.kyc.events", description: "KYC status change events" },
  { name: "pos.disputes.created", description: "Dispute raised events" },
  { name: "pos.agents.status", description: "Agent status change events" },
  { name: "pos.erp.sync", description: "ERP sync events" },
  { name: "pos.audit.log", description: "Audit log stream" },
  { name: "pos.push.notifications", description: "Push notification queue" },
  { name: "pos.sms.receipts", description: "SMS receipt queue" },
  {
    name: "pos.webhooks.outbound",
    description: "Outbound webhook delivery queue",
  },
];

// Well-known consumer groups
const KNOWN_GROUPS = [
  { groupId: "settlement-worker", topics: ["pos.transactions.created"] },
  { groupId: "fraud-detector", topics: ["pos.transactions.created"] },
  { groupId: "float-monitor", topics: ["pos.transactions.settled"] },
  { groupId: "kyc-processor", topics: ["pos.kyc.events"] },
  { groupId: "erp-sync-worker", topics: ["pos.erp.sync"] },
  { groupId: "audit-logger", topics: ["pos.audit.log"] },
  { groupId: "webhook-dispatcher", topics: ["pos.webhooks.outbound"] },
  { groupId: "sms-sender", topics: ["pos.sms.receipts"] },
  { groupId: "push-sender", topics: ["pos.push.notifications"] },
];

export const kafkaConsumerRouter = router({
  /** Get all consumer groups with lag */
  consumerGroups: protectedProcedure.query(async () => {
    const stats = await fetchFluvioStats();
    if (stats) {
      return {
        groups: stats.consumers,
        source: "live" as const,
        broker: KAFKA_BROKER,
      };
    }
    // Return static metadata when Kafka/Fluvio is offline
    const groups = KNOWN_GROUPS.flatMap(g =>
      g.topics.map(topic => ({
        groupId: g.groupId,
        topic,
        partition: 0,
        currentOffset: 0,
        logEndOffset: 0,
        lag: 0,
        memberId: "",
        status: "idle" as const,
      }))
    );
    return { groups, source: "static" as const, broker: KAFKA_BROKER };
  }),

  /** Get all topics with message counts */
  topics: protectedProcedure.query(async () => {
    const stats = await fetchFluvioStats();
    if (stats) {
      return { topics: stats.topics, source: "live" as const };
    }
    const topics = KNOWN_TOPICS.map(t => ({
      ...t,
      partitions: 3,
      replicationFactor: 2,
      messageCount: 0,
      lag: 0,
    }));
    return { topics, source: "static" as const };
  }),

  /** Get DLQ (dead-letter queue) messages from PostgreSQL */
  dlqMessages: protectedProcedure
    .input(
      z.object({
        topic: z.string().optional(),
        status: z
          .enum(["pending", "retrying", "failed", "resolved"])
          .optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { messages: [], total: 0 };
        const conditions = [];
        if (input.topic) conditions.push(eq(dlqMessages.topic, input.topic));
        if (input.status) conditions.push(eq(dlqMessages.status, input.status));
        const where =
          conditions.length > 0
            ? conditions.length === 1
              ? conditions[0]
              : and(...conditions)
            : undefined;
        const [messages, [{ total }]] = await Promise.all([
          db
            .select()
            .from(dlqMessages)
            .where(where)
            .orderBy(desc(dlqMessages.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(dlqMessages).where(where),
        ]);
        return { messages, total: Number(total) };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Drain DLQ — requeue pending/failed messages */
  drainDlq: protectedProcedure
    .input(
      z.object({
        topic: z.string().optional(),
        limit: z.number().min(1).max(100).default(10),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { requeued: 0 };
        const conditions = [eq(dlqMessages.status, "pending")];
        if (input.topic) conditions.push(eq(dlqMessages.topic, input.topic));
        const pending = await db
          .select({ id: dlqMessages.id })
          .from(dlqMessages)
          .where(and(...conditions))
          .limit(input.limit);
        // Mark as retrying
        for (const msg of pending) {
          await db
            .update(dlqMessages)
            .set({ status: "retrying" })
            .where(eq(dlqMessages.id, msg.id));
        }
        return { requeued: pending.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Purge resolved DLQ messages older than N days */
  purgeDlq: protectedProcedure
    .input(z.object({ olderThanDays: z.number().min(1).max(365).default(30) }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { purged: 0 };
        const cutoff = new Date(Date.now() - input.olderThanDays * 86400_000);
        const toDelete = await db
          .select({ id: dlqMessages.id })
          .from(dlqMessages)
          .where(
            and(
              eq(dlqMessages.status, "resolved"),
              lt(dlqMessages.createdAt, cutoff)
            )
          )
          .limit(500);
        for (const msg of toDelete) {
          await db.delete(dlqMessages).where(eq(dlqMessages.id, msg.id));
        }
        return { purged: toDelete.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /** Summary: total lag, DLQ count, broker health */
  summary: protectedProcedure.query(async () => {
    const [stats, db] = await Promise.all([fetchFluvioStats(), getDb()]);
    let dlqCount = 0;
    if (db) {
      const [row] = await db
        .select({ total: count() })
        .from(dlqMessages)
        .where(eq(dlqMessages.status, "pending"));
      dlqCount = Number(row?.total ?? 0);
    }
    const totalLag =
      stats?.consumers.reduce((acc: any, c: any) => acc + c.lag, 0) ?? 0;
    const activeConsumers =
      stats?.consumers.filter(c => c.status === "active").length ?? 0;
    return {
      brokerOnline: stats !== null,
      broker: KAFKA_BROKER,
      totalTopics: stats?.topics.length ?? KNOWN_TOPICS.length,
      totalConsumerGroups: stats?.consumers.length ?? KNOWN_GROUPS.length,
      totalLag,
      activeConsumers,
      dlqPending: dlqCount,
      timestamp: new Date().toISOString(),
    };
  }),
});
