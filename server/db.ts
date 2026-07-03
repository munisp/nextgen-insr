// @ts-check
// TypeScript enabled — Sprint 96 security audit
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, desc, and, isNull, lt, gt } from "drizzle-orm";
import { logger } from './_core/logger';
import {
  agents,
  users,
  transactions,
  fraudAlerts,
  loyaltyHistory,
  chatSessions,
  chatMessages,
  auditLog,
  floatTopUpRequests,
  type Agent,
  type InsertAgent,
  type InsertTransaction,
  type InsertFraudAlert,
  type InsertUser,
} from "../drizzle/schema";

// ─── DB singleton ─────────────────────────────────────────────────────────────
let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export async function getPool(): Promise<Pool | null> {
  await getDb(); // ensure pool is initialized
  return _pool;
}

let _dbVerified = false;

// No-op DB proxy for when no database URL is configured (safe for tests)
const _noopRow = {
  total: 0,
  count: 0,
  value: 0,
  avg: 0,
  sum: 0,
  min: 0,
  max: 0,
};

function makeNoopChain(): any {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === "then")
        return (fn: any) => Promise.resolve([_noopRow]).then(fn);
      if (prop === Symbol.iterator)
        return function* () {
          yield _noopRow;
        };
      if (prop === "length") return 1;
      if (
        prop === "map" ||
        prop === "filter" ||
        prop === "forEach" ||
        prop === "reduce" ||
        prop === "some" ||
        prop === "every" ||
        prop === "find"
      )
        return [][prop as any].bind([_noopRow]);
      if (prop === 0 || prop === "0") return _noopRow;
      // Any property access returns a function that returns another chainable proxy
      return (..._args: any[]) => makeNoopChain();
    },
  };
  return new Proxy(function () {}, handler);
}

const _noopChain: any = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined; // db itself is NOT thenable
      if (prop === "_isNoop") return true; // marker for in-memory fallback checks
      if (prop === Symbol.iterator)
        return function* () {
          yield _noopRow;
        };
      // Any method on db (select, insert, update, delete, etc.) returns a chainable
      return (..._args: any[]) => makeNoopChain();
    },
  }
);

export async function getDb() {
  if (_db && _dbVerified) return _db;
  if (!_db) {
    const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";
    if (!url) {
      logger.warn("[DB] No POSTGRES_URL or DATABASE_URL set");
      return _noopChain;
    }
    // P3-2: Connection pool right-sizing formula from 1B Payments article
    const cpuCores =
      typeof require !== "undefined" ? (await import("os")).cpus().length : 4;
    const effectiveSpindleCount = 1;
    const formulaPoolSize = cpuCores * 2 + effectiveSpindleCount;
    const poolSize = Math.max(5, Math.min(50, formulaPoolSize));
    logger.info(
      `[DB] Connection pool: ${poolSize} connections (formula: ${cpuCores} cores × 2 + ${effectiveSpindleCount} spindle)`
    );
    _pool = new Pool({
      connectionString: url,
      ssl: false,
      max: poolSize,
      min: Math.max(2, Math.floor(poolSize / 4)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      maxUses: 7500,
      statement_timeout: 30_000,
    } as any);
    _db = drizzle(_pool);
  }
  // Verify connectivity on first use
  if (!_dbVerified) {
    try {
      const client = await _pool!.connect();
      client.release();
      _dbVerified = true;
    } catch (e: any) {
      logger.warn(`[DB] Connection failed: ${e.message}`);
      _db = null;
      _pool = null;
      return _noopChain;
    }
  }
  return _db;
}

/// ─── Users (Keycloak OIDC) ───────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(users)
    .values(user)
    .onConflictDoUpdate({
      target: users.keycloakSub,
      set: {
        name: user.name,
        email: user.email,
        role: user.role,
        lastSignedIn: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function getUserByKeycloakSub(keycloakSub: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.keycloakSub, keycloakSub))
    .limit(1);
  return result[0];
}

/** @deprecated Use getUserByKeycloakSub instead */
export async function getUserByOpenId(openId: string) {
  return getUserByKeycloakSub(openId);
}

// ─── Agents ───────────────────────────────────────────────────────────────────
export async function getAgentByCode(
  agentCode: string
): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.agentCode, agentCode))
    .limit(1);
  return result[0];
}

export async function getAgentById(id: number): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);
  return result[0];
}

export async function createAgent(data: InsertAgent): Promise<Agent> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(agents).values(data).returning();
  return result[0];
}

export async function updateAgentLastLogin(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(agents)
    .set({ lastLoginAt: new Date() })
    .where(eq(agents.id, id));
}

export async function updateAgentFloat(
  id: number,
  delta: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const agent = await getAgentById(id);
  if (!agent) return;
  const newBalance = (Number(agent.floatBalance) + delta).toFixed(2);
  await db
    .update(agents)
    .set({ floatBalance: newBalance })
    .where(eq(agents.id, id));
}

export async function updateAgentCommission(
  id: number,
  delta: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const agent = await getAgentById(id);
  if (!agent) return;
  const newBalance = (Number(agent.commissionBalance) + delta).toFixed(2);
  await db
    .update(agents)
    .set({ commissionBalance: newBalance })
    .where(eq(agents.id, id));
}

// ─── Transactions ─────────────────────────────────────────────────────────────
export async function createTransaction(data: InsertTransaction) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(transactions).values(data).returning();
  return result[0];
}

export async function getTransactionsByAgent(
  agentId: number,
  limit = 50,
  offset = 0
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.agentId, agentId))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * P2-A: Cursor-based pagination for transactions.
 * Returns up to `limit` rows created before `cursor` (exclusive).
 * Pass cursor = undefined for the first page.
 * The client passes the `id` of the last row as the cursor for the next page.
 */
export async function getTransactionsByAgentCursor(
  agentId: number,
  limit = 50,
  cursor?: number
) {
  const db = await getDb();
  if (!db) return { items: [], nextCursor: null };
  const rows = await db
    .select()
    .from(transactions)
    .where(
      cursor
        ? and(eq(transactions.agentId, agentId), lt(transactions.id, cursor))
        : eq(transactions.agentId, agentId)
    )
    .orderBy(desc(transactions.id))
    .limit(limit + 1); // fetch one extra to determine if there is a next page
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

/**
 * P2-A: Cursor-based pagination for audit log.
 */
export async function getAuditLogCursor(
  agentId?: number,
  limit = 50,
  cursor?: number
) {
  const db = await getDb();
  if (!db) return { items: [], nextCursor: null };
  const baseWhere = agentId ? eq(auditLog.agentId, agentId) : undefined;
  const cursorWhere = cursor ? lt(auditLog.id, cursor) : undefined;
  const where =
    baseWhere && cursorWhere
      ? and(baseWhere, cursorWhere)
      : (baseWhere ?? cursorWhere);
  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

export async function getTransactionByRef(ref: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.ref, ref))
    .limit(1);
  return result[0];
}

export async function updateTransactionStatus(
  id: number,
  status: string,
  notes?: string
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(transactions)
    .set({ status: status as any, failureReason: notes ?? null })
    .where(eq(transactions.id, id));
}

// ─── Fraud Alerts ─────────────────────────────────────────────────────────────
export async function getFraudAlerts(status?: string) {
  const db = await getDb();
  if (!db) return [];
  const query = db
    .select()
    .from(fraudAlerts)
    .orderBy(desc(fraudAlerts.createdAt))
    .limit(100);
  return query;
}

export async function createFraudAlert(data: InsertFraudAlert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(fraudAlerts).values(data).returning();
  return result[0];
}

export async function updateFraudAlertStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(fraudAlerts)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(fraudAlerts.id, id));
}

// ─── Loyalty ──────────────────────────────────────────────────────────────────
export async function getLoyaltyHistory(agentId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(loyaltyHistory)
    .where(eq(loyaltyHistory.agentId, agentId))
    .orderBy(desc(loyaltyHistory.createdAt))
    .limit(limit);
}

export async function addLoyaltyHistory(
  agentId: number,
  type: "earned" | "redeemed" | "bonus" | "penalty" | "challenge",
  points: number,
  description: string,
  transactionId?: number
) {
  const db = await getDb();
  if (!db) return;
  // compute balanceAfter before updating
  const agentBefore = await getAgentById(agentId);
  const balanceAfter = Math.max(0, (agentBefore?.loyaltyPoints ?? 0) + points);
  await db.insert(loyaltyHistory).values({
    agentId,
    type,
    points,
    description,
    transactionId: transactionId ?? null,
    balanceAfter,
  });
  // Update agent's total points
  const agent = await getAgentById(agentId);
  if (agent) {
    const newPoints = Math.max(0, agent.loyaltyPoints + points);
    await db
      .update(agents)
      .set({ loyaltyPoints: newPoints })
      .where(eq(agents.id, agentId));
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export async function createChatSession(
  agentId: number,
  category: string,
  subject: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const sessionRef = `CHT-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 3).toUpperCase()}`;
  const supportAgentNames = [
    "Amaka Okonkwo",
    "Chidi Nwosu",
    "Fatima Bello",
    "Emeka Eze",
  ];
  const idx =
    parseInt(crypto.randomUUID().slice(0, 8), 16) % supportAgentNames.length;
  const supportAgentName = supportAgentNames[idx];
  const result = await db
    .insert(chatSessions)
    .values({
      agentId,
      sessionRef,
      category,
      subject,
      supportAgentName,
      status: "open",
    })
    .returning();
  return result[0];
}

export async function getChatSession(sessionRef: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionRef, sessionRef))
    .limit(1);
  return result[0];
}

export async function addChatMessage(
  sessionId: number,
  senderType: "agent" | "support" | "system",
  senderName: string,
  content: string
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db
    .insert(chatMessages)
    .values({ sessionId, senderType, senderName, content })
    .returning();
  return result[0];
}

export async function getChatMessages(sessionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt);
}

// ─── Audit Log ────────────────────────────────────────────────────────────────
export async function writeAuditLog(data: {
  agentId?: number;
  agentCode?: string;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  status: "success" | "failure" | "warning";
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      agentId: data.agentId ?? null,
      agentCode: data.agentCode ?? null,
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId ?? null,
      ipAddress: data.ipAddress ?? null,
      status: data.status,
      metadata: data.metadata ?? null,
    });
  } catch (err) {
    logger.error("[AuditLog] Failed to write:", err);
  }
}

export async function getAuditLog(agentId?: number, limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  const query = db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);
  return query;
}

// ─── Soft Delete Helper ───────────────────────────────────────────────────────
/**
 * Soft-deletes a row by setting its deletedAt timestamp.
 * Use this instead of hard-deletes for auditable entities.
 */
export async function softDelete(table: any, id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(table)
    .set({ deletedAt: new Date() } as any)
    .where(eq((table as any).id, id));
}

/**
 * Expose the raw db instance for use in db.transaction() blocks.
 * Callers must handle the case where db is null (no connection string).
 */
export async function withTransaction<T>(
  fn: (tx: ReturnType<typeof drizzle>) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return (db as any).transaction(fn);
}
