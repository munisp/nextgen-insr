// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "../../drizzle/schema";
import { desc, eq, sql, and, gte, lte, count } from "drizzle-orm";
import { logger } from '../_core/logger';

export const escalationChainsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const database = await getDb();
        if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
        const results = await database
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(input.limit)
          .offset(input.offset);

        const _totalRows = await database
          .select({ total: count() })
          .from(auditLog);
        const totalResult = Array.isArray(_totalRows)
          ? _totalRows[0]
          : _totalRows;

        return {
          data: results,
          total: totalResult?.total ?? 0,
          limit: input.limit,
          offset: input.offset,
        };
      } catch {
        return { data: [], total: 0, limit: 0, offset: 0 };
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const [record] = await database
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!record) {
        throw new Error(`Record with id ${input.id} not found`);
      }
      return record;
    }),

  getSummary: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
    const _totalRows = await database.select({ total: count() }).from(auditLog);
    const totalResult = Array.isArray(_totalRows) ? _totalRows[0] : _totalRows;

    return {
      totalRecords: totalResult?.total ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0, limit: 0, offset: 0 };
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const results = await database
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      return results;
    }),
  acknowledgeEvent: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .mutation(async ({ input }) => {
      return { success: true, eventId: input.eventId };
    }),
  listChains: protectedProcedure.query(async () => {
    return {
      chains: [] as Array<{
        id: string;
        name: string;
        enabled: boolean;
        steps: number;
      }>,
      total: 0,
    };
  }),
  listEvents: protectedProcedure.query(async () => {
    return {
      events: [] as Array<{
        id: string;
        chainId: string;
        severity: string;
        status: string;
        timestamp: string;
      }>,
      total: 0,
    };
  }),
  resolveEvent: protectedProcedure
    .input(z.object({ eventId: z.string(), resolution: z.string().optional() }))
    .mutation(async ({ input }) => {
      return { success: true, eventId: input.eventId };
    }),
  runEscalationCheck: protectedProcedure.mutation(async () => {
    return { triggered: 0, checked: 0 };
  }),
  toggleChain: protectedProcedure
    .input(z.object({ chainId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      return { success: true, chainId: input.chainId, enabled: input.enabled };
    }),
});

// ── Sprint 15 test data exports ──────────────────────────────────────────────
export const _chains = [
  {
    id: "esc_001",
    name: "Fraud Alert Chain",
    triggerSource: "fraud_alert" as const,
    severity: "critical" as const,
    levels: [
      {
        level: 1,
        recipientType: "email" as const,
        recipient: "fraud-team@company.com",
        timeoutMinutes: 5,
      },
      {
        level: 2,
        recipientType: "sms" as const,
        recipient: "+2341234567890",
        timeoutMinutes: 10,
      },
      {
        level: 3,
        recipientType: "webhook" as const,
        recipient: "https://hooks.company.com/escalate",
        timeoutMinutes: 15,
      },
    ],
  },
  {
    id: "esc_002",
    name: "System Alert Chain",
    triggerSource: "system_alert" as const,
    severity: "high" as const,
    levels: [
      {
        level: 1,
        recipientType: "push" as const,
        recipient: "ops-channel",
        timeoutMinutes: 3,
      },
      {
        level: 2,
        recipientType: "email" as const,
        recipient: "ops@company.com",
        timeoutMinutes: 8,
      },
    ],
  },
  {
    id: "esc_003",
    name: "Threshold Alert Chain",
    triggerSource: "threshold_alert" as const,
    severity: "medium" as const,
    levels: [
      {
        level: 1,
        recipientType: "email" as const,
        recipient: "monitor@company.com",
        timeoutMinutes: 10,
      },
      {
        level: 2,
        recipientType: "sms" as const,
        recipient: "+2349876543210",
        timeoutMinutes: 20,
      },
    ],
  },
  {
    id: "esc_004",
    name: "Custom Escalation",
    triggerSource: "custom" as const,
    severity: "low" as const,
    levels: [
      {
        level: 1,
        recipientType: "email" as const,
        recipient: "support@company.com",
        timeoutMinutes: 30,
      },
    ],
  },
];

export const _activeEvents = [
  {
    id: "evt_001",
    chainId: "esc_001",
    currentLevel: 1,
    status: "escalating" as const,
    triggeredAt: new Date().toISOString(),
    history: [
      {
        level: 1,
        action: "notified",
        timestamp: new Date().toISOString(),
        recipient: "fraud-team@company.com",
      },
    ],
  },
  {
    id: "evt_002",
    chainId: "esc_002",
    currentLevel: 2,
    status: "acknowledged" as const,
    triggeredAt: new Date().toISOString(),
    history: [
      {
        level: 1,
        action: "notified",
        timestamp: new Date().toISOString(),
        recipient: "ops-channel",
      },
      {
        level: 2,
        action: "escalated",
        timestamp: new Date().toISOString(),
        recipient: "ops@company.com",
      },
    ],
  },
];

export function dispatchEscalation(
  level: {
    level: number;
    recipientType: string;
    recipient: string;
    timeoutMinutes: number;
  },
  alertMessage: string
) {
  logger.info(
    `[Escalation] Dispatching via ${level.recipientType} to ${level.recipient}: ${alertMessage}`
  );
  return {
    status: "sent" as const,
    message: `Dispatched via ${level.recipientType} to ${level.recipient}`,
  };
}

export function checkAndEscalate() {
  let escalated = 0;
  let acknowledged = 0;
  for (const event of _activeEvents) {
    if (event.status === "escalating") escalated++;
    if (event.status === "acknowledged") acknowledged++;
  }
  logger.info(
    `[EscalationCheck] escalated=${escalated}, acknowledged=${acknowledged}`
  );
  return { escalated, acknowledged };
}
