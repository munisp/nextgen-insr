// @ts-check
/**
 * Database connection and query helpers
 * Uses Drizzle ORM with PostgreSQL connection pooling.
 * Production mode requires a valid database URL. Test mode allows noop fallback.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase, NodePgQueryResultHKT, NodePgTransaction } from "drizzle-orm/node-postgres";
import { eq, desc, and, isNull, lt, gt, sql, type ExtractTablesWithRelations, type ColumnBaseConfig, type ColumnDataType } from "drizzle-orm";
import { AUDIT_CHAIN_LOCK_KEY, computeEntryHash } from "./lib/auditChain";
import type { PgTable, PgTransaction, TableConfig, PgColumn } from "drizzle-orm/pg-core";
import { logger } from "./_core/logger";
import {
  agents,
  users,
  transactions,
  fraudAlerts,
  loyaltyHistory,
  chatSessions,
  chatMessages,
  auditLog,
  premiumTopUpRequests,
  type Agent,
  type InsertAgent,
  type InsertTransaction,
  type InsertFraudAlert,
  type InsertUser,
} from "../drizzle/schema";

// ─── DB singleton ─────────────────────────────────────────────────────────────
let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;
let _dbError: Error | null = null;
let _dbVerified = false;
let _poolReady = false;

/**
 * DatabaseError is thrown when a required database operation fails in production.
 */
export class DatabaseError extends Error {
  constructor(message: string, public code: string = "DATABASE_UNAVAILABLE") {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Returns true if the database is available and connected.
 * In test mode (POSTGRES_URL not set), returns false without throwing.
 * In production mode, throws DatabaseError if unavailable.
 */
export async function getDb(): Promise<ReturnType<typeof drizzle> | null> {
  if (_db && _dbVerified) return _db;

  // Check if already failed (fail-fast without re-attempting)
  if (_dbError) {
    if (process.env.NODE_ENV === "test") return null;
    throw _dbError;
  }

  if (!_db) {
    const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";
    if (!url) {
      // Test mode: return null without throwing
      if (process.env.NODE_ENV === "test") {
        logger.debug("[DB] Test mode: no database configured");
        return null;
      }
      const err = new DatabaseError("POSTGRES_URL or DATABASE_URL is required but not set");
      logger.error(`[DB] ${err.message}`);
      _dbError = err;
      throw err;
    }

    // P3-2: Connection pool right-sizing formula from 1B Payments article
    const cpuCores =
      typeof require !== "undefined" ? (await import("os")).cpus().length : 4;
    const effectiveSpindleCount = 1;
    const formulaPoolSize = cpuCores * 2 + effectiveSpindleCount;
    // Env-overridable pool size (DB_POOL_MAX / DB_POOL_MIN). Defaults are
    // unchanged from the formula above; overrides are needed for constrained
    // environments (e.g. single-connection embedded Postgres in tests).
    const envPoolMax = Number.parseInt(process.env.DB_POOL_MAX ?? "", 10);
    const envPoolMin = Number.parseInt(process.env.DB_POOL_MIN ?? "", 10);
    const poolSize =
      Number.isFinite(envPoolMax) && envPoolMax > 0
        ? envPoolMax
        : Math.max(5, Math.min(50, formulaPoolSize));
    const poolMin =
      Number.isFinite(envPoolMin) && envPoolMin >= 0
        ? envPoolMin
        : Math.max(2, Math.floor(poolSize / 4));
    logger.info(
      `[DB] Initializing connection pool: max=${poolSize} min=${poolMin} connections (formula: ${cpuCores} cores × 2 + ${effectiveSpindleCount} spindle)`
    );

    _pool = new Pool({
      connectionString: url,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
      max: poolSize,
      min: poolMin,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      maxUses: 7500,
      statement_timeout: 30_000,
      maxLifetimeSeconds: 3600, // Rotate connections every hour
    });

    _pool.on("error", (err) => {
      logger.error(`[DB] Pool error: ${err.message}`);
      _dbError = new DatabaseError(`Pool error: ${err.message}`, "POOL_ERROR");
    });

    _pool.on("connect", () => {
      logger.debug("[DB] New connection acquired");
    });

    _pool.on("remove", () => {
      logger.debug("[DB] Connection released back to pool");
    });

    _db = drizzle(_pool);
  }

  // Verify connectivity on first use
  if (!_dbVerified) {
    try {
      const client = await _pool!.connect();
      // Verify PostgreSQL is actually responsive
      await client.query("SELECT 1");
      client.release();
      _dbVerified = true;
      _poolReady = true;
      logger.info("[DB] Database connection verified");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[DB] Connection failed: ${message}`);
      const dbErr = new DatabaseError(`Database connection failed: ${message}`, "CONNECTION_FAILED");
      _dbError = dbErr;
      _db = null;
      _pool = null;
      _poolReady = false;
      if (process.env.NODE_ENV === "test") return null;
      throw dbErr;
    }
  }

  return _db;
}

/**
 * Returns the connection pool. Must be called after getDb() has succeeded.
 */
export async function getPool(): Promise<Pool | null> {
  await getDb(); // ensure pool is initialized
  return _pool;
}

/**
 * Checks if the database pool is ready and healthy.
 */
export async function isDbHealthy(): Promise<boolean> {
  try {
    const pool = await getPool();
    if (!pool) return false;

    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets database status for health checks.
 */
/**
 * Legacy raw-SQL adapter exposing parameterized `$1..$n` queries against the
 * underlying pg Pool. Used by kafka-event-consumer (raw INSERT/UPDATE with
 * positional placeholders). New code should prefer drizzle query builders.
 */
export const db = {
  async execute(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    const pool = await getPool();
    if (!pool) return { rows: [], rowCount: 0 };
    const res = await pool.query(text, params);
    return { rows: res.rows, rowCount: res.rowCount };
  },
};

export async function getDbStatus(): Promise<{
  connected: boolean;
  poolSize: number;
  poolIdle: number;
  verified: boolean;
  error: string | null;
}> {
  return {
    connected: _dbVerified,
    poolSize: _pool ? _pool.options.max : 0,
    poolIdle: _pool ? _pool.idleCount : 0,
    verified: _dbVerified,
    error: _dbError ? _dbError.message : null,
  };
}

/**
 * Gracefully closes the database connection pool.
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    logger.info("[DB] Closing connection pool...");
    await _pool.end();
    _pool = null;
    _db = null;
    _dbVerified = false;
    _poolReady = false;
    logger.info("[DB] Connection pool closed");
  }
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
  agentId: string
): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.agentId, agentId))
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
  const newBalance = (Number(agent.premiumReserve) + delta).toFixed(2);
  await db
    .update(agents)
    .set({ premiumReserve: newBalance })
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
    .set({ status: status as "pending" | "success" | "failed" | "reversed" | "pending_reversal_approval", failureReason: notes ?? null })
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
/**
 * Append an entry to the tamper-evident audit chain (F-08).
 *
 * Signature and fire-and-forget error behavior are unchanged for callers;
 * the hash-chain columns (prevHash/entryHash) are maintained transparently.
 * Each insert runs in a transaction holding pg_advisory_xact_lock so
 * concurrent writers cannot fork the chain. createdAt is set by the app so
 * the entryHash input is fully known at write time.
 *
 * See server/lib/auditChain.ts for the hash format and honest limits.
 */
export async function writeAuditLog(data: {
  agentId?: number;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  status?: "success" | "failure" | "warning";
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.transaction(async tx => {
      // Serialize chain writers for the duration of this transaction.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`
      );
      const [last] = await tx
        .select({ entryHash: auditLog.entryHash })
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(1);
      const prevHash = last?.entryHash ?? null;
      const createdAt = new Date();
      const fields = {
        agentId: data.agentId ?? null,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: null,
        status: data.status ?? ("success" as const),
        metadata: data.metadata ?? null,
        tenantId: null,
        createdAt,
      };
      const entryHash = computeEntryHash(prevHash, fields);
      await tx.insert(auditLog).values({
        agentId: fields.agentId,
        action: fields.action,
        resource: fields.resource,
        resourceId: fields.resourceId,
        ipAddress: fields.ipAddress,
        status: fields.status,
        metadata: data.metadata ?? null,
        prevHash,
        entryHash,
        createdAt,
      });
    });
  } catch (err) {
    logger.error("[AuditLog] Failed to write:: " + String(err));
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
export async function softDelete(
  table: PgTable<TableConfig> & {
    id: PgColumn<ColumnBaseConfig<ColumnDataType, "number">>;
    deletedAt: PgColumn<ColumnBaseConfig<ColumnDataType, "date">>;
  },
  id: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(table)
    .set({ deletedAt: new Date() })
    .where(eq(table.id, id));
}

/**
 * Expose the raw db instance for use in db.transaction() blocks.
 * Callers must handle the case where db is null (no connection string).
 */
export async function withTransaction<T>(
  fn: (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >
  ) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // NodePgDatabase.transaction expects an unknown-schema tx callback; the
  // public signature above intentionally uses the narrower never-schema form.
  return db.transaction(fn as unknown as (tx: PgTransaction<NodePgQueryResultHKT, Record<string, unknown>, ExtractTablesWithRelations<Record<string, unknown>>>) => Promise<T>);
}
