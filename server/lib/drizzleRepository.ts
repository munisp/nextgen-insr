/**
 * server/lib/drizzleRepository.ts
 *
 * Type-Safe Repository Pattern for Drizzle ORM — Sprint 99
 *
 * Provides:
 *   1.  BaseRepository<TTable>   — generic CRUD with full type inference
 *   2.  CursorPaginator          — keyset/cursor pagination (no OFFSET)
 *   3.  QueryBuilder             — composable, type-safe filter/sort/join builder
 *   4.  TransactionManager       — nested transaction support with savepoints
 *   5.  BatchOperations          — chunked bulk insert/update/upsert
 *   6.  OptimisticLock           — version-based conflict detection
 *   7.  SoftDeleteMixin          — transparent soft-delete filtering
 *   8.  TenantScope              — automatic tenant_id injection
 *   9.  QueryInstrumentation     — slow query logging + metrics
 *  10.  PreparedStatementCache   — named prepared statement management
 */

import {
  eq, and, or, desc, asc, gt, lt, gte, lte, isNull, isNotNull,
  sql, count, inArray, notInArray, like, ilike, between,
  type SQL, type AnyColumn,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable, PgColumn, TableConfig } from "drizzle-orm/pg-core";

import {
  policies, claims, beneficiaries, endorsements, policyRenewals,
  coverageItems, riskAssessments, underwritingAssessments, actuarialReserves,
  reinsuranceTreaties, reinsuranceCessions, brokers, premiumPayments,
  naicomReports, policyWorkflowEvents, claimWorkflowEvents,
  stakeholderProfiles, ifrs17MeasurementGroups, insuranceProducts,
  claimDocuments, fluvioEventLog, tigerBeetleSyncLog,
  agents, transactions, fraudAlerts, auditLog,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { getDb } from "../db";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type DbClient = Awaited<ReturnType<typeof getDb>>;

export interface PaginationMeta {
  total: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor?: string;
  prevCursor?: string;
  pageSize: number;
}

export interface CursorPage<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface FindManyOptions<T> {
  where?: SQL;
  orderBy?: SQL | SQL[];
  limit?: number;
  offset?: number;
  columns?: Partial<Record<keyof T, boolean>>;
}

export interface CursorOptions {
  cursor?: string;
  limit?: number;
  direction?: "forward" | "backward";
  orderByColumn?: string;
  orderDirection?: "asc" | "desc";
}

export interface BatchResult {
  inserted: number;
  updated: number;
  failed: number;
  duration: number;
}

export interface QueryInstrumentationOptions {
  slowQueryThresholdMs?: number;
  logAllQueries?: boolean;
  endpoint?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query Instrumentation Wrapper
// ═══════════════════════════════════════════════════════════════════════════════

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS ?? "200");

export async function instrumentedQuery<T>(
  queryFn: () => Promise<T>,
  options: QueryInstrumentationOptions & { queryName?: string } = {}
): Promise<T> {
  const start = performance.now();
  try {
    const result = await queryFn();
    const durationMs = performance.now() - start;
    const threshold = options.slowQueryThresholdMs ?? SLOW_QUERY_THRESHOLD_MS;
    if (durationMs > threshold) {
      logger.warn(`[SlowQuery] ${options.queryName ?? "unknown"} took ${durationMs.toFixed(1)}ms (threshold: ${threshold}ms)`);
    }
    return result;
  } catch (err) {
    const durationMs = performance.now() - start;
    logger.error(`[QueryError] ${options.queryName ?? "unknown"} failed after ${durationMs.toFixed(1)}ms: ${String(err)}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cursor Encoder/Decoder
// ═══════════════════════════════════════════════════════════════════════════════

export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid cursor token");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BaseRepository<TTable>
// ═══════════════════════════════════════════════════════════════════════════════

export class BaseRepository<
  TTable extends PgTable<TableConfig>,
  TSelect = TTable["$inferSelect"],
  TInsert = TTable["$inferInsert"],
> {
  protected readonly table: any; // use any to avoid Drizzle's strict generic constraints
  protected readonly tableName: string;
  constructor(table: TTable, tableName: string) {
    this.table = table;
    this.tableName = tableName;
  }
  protected async db(): Promise<NonNullable<DbClient>> {
    const db = await getDb();
    if (!db) throw new Error(`[Repository:${this.tableName}] Database not available`);
    return db as NonNullable<DbClient>;
  }

  // ── findById ────────────────────────────────────────────────────────────────
  async findById(id: number): Promise<TSelect | undefined> {
    return instrumentedQuery(async () => {
      const db = await this.db();
            const col = (this.table as any).id as PgColumn;
      const rows = await (db as any).select().from(this.table as any).where(eq(col, id)).limit(1);
      return rows[0] as TSelect | undefined;
    }, { queryName: `${this.tableName}.findById` });
  }
  // ── findOne ─────────────────────────────────────────────────────────────────
  async findOne(where: SQL): Promise<TSelect | undefined> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const rows = await (db as any).select().from(this.table as any).where(where).limit(1);
      return rows[0] as TSelect | undefined;
    }, { queryName: `${this.tableName}.findOne` });
  }
  // ── findMany ────────────────────────────────────────────────────────────────
  async findMany(options: FindManyOptions<TSelect> = {}): Promise<TSelect[]> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      let q = (db as any).select().from(this.table as any).$dynamic();
      if (options.where) q = q.where(options.where);
      if (options.orderBy) {
        const orders = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy];
        q = q.orderBy(...orders);
      }
      if (options.limit) q = q.limit(options.limit);
      if (options.offset) q = q.offset(options.offset);
      return q as unknown as TSelect[];
    }, { queryName: `${this.tableName}.findMany` });
  }
  // ── findManyWithCount ────────────────────────────────────────────────────────
  async findManyWithCount(options: FindManyOptions<TSelect> = {}): Promise<{ items: TSelect[]; total: number }> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const [items, [countRow]] = await Promise.all([
        this.findMany(options),
        (db as any).select({ total: count() }).from(this.table as any).where(options.where),
      ]);
      return { items, total: Number(countRow?.total ?? 0) };
    }, { queryName: `${this.tableName}.findManyWithCount` });
  }

  // ── findPage (offset-based) ──────────────────────────────────────────────────
  async findPage(page: number, pageSize: number, where?: SQL, orderBy?: SQL): Promise<OffsetPage<TSelect>> {
    return instrumentedQuery(async () => {
      const offset = (page - 1) * pageSize;
      const { items, total } = await this.findManyWithCount({
        where,
        orderBy,
        limit: pageSize,
        offset,
      });
      const totalPages = Math.ceil(total / pageSize);
      return {
        items,
        total,
        page,
        pageSize,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    }, { queryName: `${this.tableName}.findPage` });
  }

  // ── findCursorPage (keyset pagination) ──────────────────────────────────────
  async findCursorPage(options: CursorOptions): Promise<CursorPage<TSelect>> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const limit = options.limit ?? 20;
      const direction = options.direction ?? "forward";
      const orderDir = options.orderDirection ?? "desc";
      const orderCol = options.orderByColumn ?? "id";
      const col = (this.table as any)[orderCol] as PgColumn;

      let whereClause: SQL | undefined;
      if (options.cursor) {
        const decoded = decodeCursor(options.cursor);
        const cursorVal = decoded[orderCol];
        if (cursorVal !== undefined) {
          whereClause = direction === "forward"
            ? (orderDir === "desc" ? lt(col, cursorVal as any) : gt(col, cursorVal as any))
            : (orderDir === "desc" ? gt(col, cursorVal as any) : lt(col, cursorVal as any));
        }
      }

      const order = orderDir === "desc" ? desc(col) : asc(col);
      const rows = await (db as any)
        .select()
        .from(this.table as any)
        .where(whereClause)
        .orderBy(order)
        .limit(limit + 1); // fetch one extra to detect hasNextPage

      const hasNextPage = rows.length > limit;
      const items = hasNextPage ? rows.slice(0, limit) : rows;

      const nextCursor = hasNextPage
        ? encodeCursor({ [orderCol]: (items[items.length - 1] as any)[orderCol] })
        : undefined;
      const prevCursor = options.cursor
        ? encodeCursor({ [orderCol]: (items[0] as any)?.[orderCol] })
        : undefined;

      return {
        items: items as TSelect[],
        meta: {
          total: -1, // not computed for cursor pagination (use separate count if needed)
          hasNextPage,
          hasPrevPage: !!options.cursor,
          nextCursor,
          prevCursor,
          pageSize: limit,
        },
      };
    }, { queryName: `${this.tableName}.findCursorPage` });
  }

  // ── insert ──────────────────────────────────────────────────────────────────
  async insert(data: TInsert): Promise<TSelect> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const rows = await (db as any).insert(this.table as any).values(data as any).returning();
      return rows[0] as TSelect;
    }, { queryName: `${this.tableName}.insert` });
  }

  // ── insertMany ───────────────────────────────────────────────────────────────
  async insertMany(data: TInsert[]): Promise<TSelect[]> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      if (data.length === 0) return [];
      const rows = await (db as any).insert(this.table as any).values(data as any).returning();
      return rows as TSelect[];
    }, { queryName: `${this.tableName}.insertMany` });
  }

  // ── upsert ──────────────────────────────────────────────────────────────────
  async upsert(data: TInsert, conflictTarget: string[]): Promise<TSelect> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const rows = await (db as any)
        .insert(this.table as any)
        .values(data as any)
        .onConflictDoUpdate({
          target: conflictTarget.map(col => (this.table as any)[col]),
          set: data as any,
        })
        .returning();
      return rows[0] as TSelect;
    }, { queryName: `${this.tableName}.upsert` });
  }

  // ── update ──────────────────────────────────────────────────────────────────
  async update(id: number, data: Partial<TInsert>): Promise<TSelect | undefined> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const col = (this.table as any).id as PgColumn;
      const rows = await (db as any)
        .update(this.table as any)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(col, id))
        .returning();
      return rows[0] as TSelect | undefined;
    }, { queryName: `${this.tableName}.update` });
  }

  // ── updateWhere ──────────────────────────────────────────────────────────────
  async updateWhere(where: SQL, data: Partial<TInsert>): Promise<TSelect[]> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const rows = await (db as any)
        .update(this.table as any)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(where)
        .returning();
      return rows as TSelect[];
    }, { queryName: `${this.tableName}.updateWhere` });
  }

  // ── softDelete ───────────────────────────────────────────────────────────────
  async softDelete(id: number): Promise<boolean> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const col = (this.table as any).id as PgColumn;
      const deletedAtCol = (this.table as any).deletedAt;
      if (!deletedAtCol) throw new Error(`Table ${this.tableName} does not support soft delete`);
      const rows = await (db as any)
        .update(this.table as any)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(col, id), isNull(deletedAtCol)))
        .returning();
      return rows.length > 0;
    }, { queryName: `${this.tableName}.softDelete` });
  }

  // ── hardDelete ───────────────────────────────────────────────────────────────
  async hardDelete(id: number): Promise<boolean> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const col = (this.table as any).id as PgColumn;
      const rows = await (db as any).delete(this.table as any).where(eq(col, id)).returning();
      return rows.length > 0;
    }, { queryName: `${this.tableName}.hardDelete` });
  }

  // ── count ────────────────────────────────────────────────────────────────────
  async count(where?: SQL): Promise<number> {
    return instrumentedQuery(async () => {
      const db = await this.db();
      const [row] = await (db as any).select({ total: count() }).from(this.table as any).where(where);
      return Number(row?.total ?? 0);
    }, { queryName: `${this.tableName}.count` });
  }

  // ── exists ────────────────────────────────────────────────────────────────────
  async exists(where: SQL): Promise<boolean> {
    const n = await this.count(where);
    return n > 0;
  }

  // ── batchInsert (chunked) ─────────────────────────────────────────────────────
  async batchInsert(data: TInsert[], chunkSize = 500): Promise<BatchResult> {
    const start = performance.now();
    let inserted = 0;
    let failed = 0;

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      try {
        const db = await this.db();
        const rows = await (db as any).insert(this.table as any).values(chunk as any).returning();
        inserted += rows.length;
      } catch (err) {
        failed += chunk.length;
        logger.error(`[BatchInsert:${this.tableName}] Chunk ${i / chunkSize} failed: ${String(err)}`);
      }
    }

    return {
      inserted,
      updated: 0,
      failed,
      duration: performance.now() - start,
    };
  }

  // ── batchUpsert ───────────────────────────────────────────────────────────────
  async batchUpsert(data: TInsert[], conflictTarget: string[], chunkSize = 500): Promise<BatchResult> {
    const start = performance.now();
    let inserted = 0;
    let failed = 0;

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      try {
        const db = await this.db();
        const rows = await (db as any)
          .insert(this.table as any)
          .values(chunk as any)
          .onConflictDoUpdate({
            target: conflictTarget.map(col => (this.table as any)[col]),
            set: chunk[0] as any,
          })
          .returning();
        inserted += (rows as any[]).length;
      } catch (err) {
        failed += chunk.length;
        logger.error(`[BatchUpsert:${this.tableName}] Chunk ${i / chunkSize} failed: ${String(err)}`);
      }
    }

    return {
      inserted,
      updated: 0,
      failed,
      duration: performance.now() - start,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TransactionManager — Nested Transactions with Savepoints
// ═══════════════════════════════════════════════════════════════════════════════

export class TransactionManager {
  private static savepointCounter = 0;

  /**
   * Run a function inside a database transaction.
   * If already inside a transaction, creates a savepoint instead.
   */
  static async run<T>(
    fn: (tx: NonNullable<DbClient>) => Promise<T>,
    existingTx?: NonNullable<DbClient>
  ): Promise<T> {
    if (existingTx) {
      // Nested: use savepoint
      const savepointName = `sp_${++this.savepointCounter}`;
      await existingTx.execute(sql`SAVEPOINT ${sql.identifier(savepointName)}`);
      try {
        const result = await fn(existingTx);
        await existingTx.execute(sql`RELEASE SAVEPOINT ${sql.identifier(savepointName)}`);
        return result;
      } catch (err) {
        await existingTx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.identifier(savepointName)}`);
        throw err;
      }
    }

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return (db as any).transaction(fn);
  }

  /**
   * Run multiple operations atomically, rolling back all on any failure.
   */
  static async atomic<T>(operations: Array<(tx: NonNullable<DbClient>) => Promise<T>>): Promise<T[]> {
    return this.run(async (tx) => {
      const results: T[] = [];
      for (const op of operations) {
        results.push(await op(tx));
      }
      return results;
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OptimisticLock — Version-Based Conflict Detection
// ═══════════════════════════════════════════════════════════════════════════════

export class OptimisticLock {
  /**
   * Update a row only if its version matches the expected version.
   * Throws ConflictError if another writer has modified the row.
   */
  static async updateWithVersion<TTable extends PgTable<TableConfig>>(
    table: TTable,
    id: number,
    expectedVersion: number,
    data: Partial<TTable["$inferInsert"]>
  ): Promise<TTable["$inferSelect"]> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const idCol = (table as any).id as PgColumn;
    const versionCol = (table as any).version as PgColumn;
    if (!versionCol) throw new Error("Table does not have a version column");

    const rows = await (db as any)
      .update(table)
      .set({ ...data, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(idCol, id), eq(versionCol, expectedVersion)))
      .returning();

    if (rows.length === 0) {
      throw new Error(`CONFLICT: Row ${id} was modified by another transaction (expected version ${expectedVersion})`);
    }

    return rows[0];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TenantScopedRepository — Automatic tenant_id injection
// ═══════════════════════════════════════════════════════════════════════════════

export class TenantScopedRepository<
  TTable extends PgTable<TableConfig>,
  TSelect = TTable["$inferSelect"],
  TInsert = TTable["$inferInsert"],
> extends BaseRepository<TTable, TSelect, TInsert> {
  private readonly tenantId: number;

  constructor(table: TTable, tableName: string, tenantId: number) {
    super(table, tableName);
    this.tenantId = tenantId;
  }

  private get tenantFilter(): SQL {
    const col = (this.table as any).tenantId as PgColumn;
    if (!col) throw new Error(`Table ${this.tableName} does not have tenantId column`);
    return eq(col, this.tenantId);
  }

  override async findById(id: number): Promise<TSelect | undefined> {
    const idCol = (this.table as any).id as PgColumn;
    return this.findOne(and(eq(idCol, id), this.tenantFilter)!);
  }

  override async findMany(options: FindManyOptions<TSelect> = {}): Promise<TSelect[]> {
    const where = options.where ? and(options.where, this.tenantFilter) : this.tenantFilter;
    return super.findMany({ ...options, where });
  }

  override async count(where?: SQL): Promise<number> {
    const combined = where ? and(where, this.tenantFilter) : this.tenantFilter;
    return super.count(combined);
  }

  override async insert(data: TInsert): Promise<TSelect> {
    return super.insert({ ...data, tenantId: this.tenantId } as TInsert);
  }

  override async insertMany(data: TInsert[]): Promise<TSelect[]> {
    return super.insertMany(data.map(d => ({ ...d, tenantId: this.tenantId } as TInsert)));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SoftDeleteRepository — Transparent soft-delete filtering
// ═══════════════════════════════════════════════════════════════════════════════

export class SoftDeleteRepository<
  TTable extends PgTable<TableConfig>,
  TSelect = TTable["$inferSelect"],
  TInsert = TTable["$inferInsert"],
> extends BaseRepository<TTable, TSelect, TInsert> {
  private get notDeletedFilter(): SQL {
    const col = (this.table as any).deletedAt as PgColumn;
    if (!col) throw new Error(`Table ${this.tableName} does not have deletedAt column`);
    return isNull(col);
  }

  override async findById(id: number): Promise<TSelect | undefined> {
    const idCol = (this.table as any).id as PgColumn;
    return this.findOne(and(eq(idCol, id), this.notDeletedFilter)!);
  }

  override async findMany(options: FindManyOptions<TSelect> = {}): Promise<TSelect[]> {
    const where = options.where ? and(options.where, this.notDeletedFilter) : this.notDeletedFilter;
    return super.findMany({ ...options, where });
  }

  override async count(where?: SQL): Promise<number> {
    const combined = where ? and(where, this.notDeletedFilter) : this.notDeletedFilter;
    return super.count(combined);
  }

  /** Find including soft-deleted rows */
  async findManyIncludingDeleted(options: FindManyOptions<TSelect> = {}): Promise<TSelect[]> {
    return super.findMany(options);
  }

  /** Restore a soft-deleted row */
  async restore(id: number): Promise<TSelect | undefined> {
    const db = await this.db();
    const idCol = (this.table as any).id as PgColumn;
    const deletedAtCol = (this.table as any).deletedAt as PgColumn;
    const rows = await (db as any)
      .update(this.table)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(idCol, id), isNotNull(deletedAtCol)))
      .returning();
    return rows[0] as TSelect | undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QueryBuilder — Composable, type-safe filter builder
// ═══════════════════════════════════════════════════════════════════════════════

export class QueryBuilder {
  private conditions: SQL[] = [];

  where(condition: SQL | undefined): this {
    if (condition) this.conditions.push(condition);
    return this;
  }

  whereEq<T>(col: PgColumn, val: T): this {
    if (val !== undefined && val !== null) this.conditions.push(eq(col, val as any));
    return this;
  }

  whereLike(col: PgColumn, pattern: string | undefined): this {
    if (pattern) this.conditions.push(ilike(col, `%${pattern}%`));
    return this;
  }

  whereGte<T>(col: PgColumn, val: T | undefined): this {
    if (val !== undefined) this.conditions.push(gte(col, val as any));
    return this;
  }

  whereLte<T>(col: PgColumn, val: T | undefined): this {
    if (val !== undefined) this.conditions.push(lte(col, val as any));
    return this;
  }

  whereBetween<T>(col: PgColumn, from: T | undefined, to: T | undefined): this {
    if (from !== undefined && to !== undefined) this.conditions.push(between(col, from as any, to as any));
    else if (from !== undefined) this.conditions.push(gte(col, from as any));
    else if (to !== undefined) this.conditions.push(lte(col, to as any));
    return this;
  }

  whereIn<T>(col: PgColumn, vals: T[] | undefined): this {
    if (vals && vals.length > 0) this.conditions.push(inArray(col, vals as any[]));
    return this;
  }

  whereNotIn<T>(col: PgColumn, vals: T[] | undefined): this {
    if (vals && vals.length > 0) this.conditions.push(notInArray(col, vals as any[]));
    return this;
  }

  whereNotNull(col: PgColumn): this {
    this.conditions.push(isNotNull(col));
    return this;
  }

  whereNull(col: PgColumn): this {
    this.conditions.push(isNull(col));
    return this;
  }

  build(): SQL | undefined {
    if (this.conditions.length === 0) return undefined;
    if (this.conditions.length === 1) return this.conditions[0];
    return and(...this.conditions);
  }

  static new(): QueryBuilder {
    return new QueryBuilder();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PreparedStatementCache — Named prepared statements
// ═══════════════════════════════════════════════════════════════════════════════

const preparedStatements = new Map<string, ReturnType<any>>();

export function getOrCreatePrepared<T>(
  name: string,
  factory: () => T
): T {
  if (!preparedStatements.has(name)) {
    preparedStatements.set(name, factory());
  }
  return preparedStatements.get(name) as T;
}

export function clearPreparedStatements(): void {
  preparedStatements.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Concrete Insurance Domain Repositories
// ═══════════════════════════════════════════════════════════════════════════════


export class PolicyRepository extends SoftDeleteRepository<typeof policies> {
  constructor() { super(policies, "policies"); }

  async findByPolicyNumber(policyNumber: string) {
    return this.findOne(eq((policies as any).policyNumber, policyNumber));
  }

  async findActiveByCustomer(customerId: number) {
    return this.findMany({
      where: QueryBuilder.new()
        .whereEq((policies as any).customerId, customerId)
        .whereEq((policies as any).status, "active")
        .build(),
      orderBy: desc((policies as any).createdAt),
    });
  }

  async findExpiringWithin(days: number) {
    const cutoff = new Date(Date.now() + days * 86400000);
    return this.findMany({
      where: QueryBuilder.new()
        .whereEq((policies as any).status, "active")
        .whereLte((policies as any).endDate, cutoff)
        .build(),
      orderBy: asc((policies as any).endDate),
    });
  }

  async findByBroker(brokerId: number, page: number, pageSize: number) {
    return this.findPage(
      page, pageSize,
      eq((policies as any).brokerId, brokerId),
      desc((policies as any).createdAt)
    );
  }
}

export class ClaimRepository extends SoftDeleteRepository<typeof claims> {
  constructor() { super(claims, "claims"); }

  async findByClaimNumber(claimNumber: string) {
    return this.findOne(eq((claims as any).claimNumber, claimNumber));
  }

  async findPendingAdjudication(limit = 50) {
    return this.findMany({
      where: QueryBuilder.new()
        .whereIn((claims as any).status, ["submitted", "under_review", "investigation"])
        .build(),
      orderBy: asc((claims as any).createdAt),
      limit,
    });
  }

  async findByPolicy(policyId: number) {
    return this.findMany({
      where: eq((claims as any).policyId, policyId),
      orderBy: desc((claims as any).createdAt),
    });
  }

  async getClaimStats() {
    const db = await this.db();
    return db.execute(sql`
      SELECT
        status,
        COUNT(*)::int                AS count,
        SUM(claimed_amount)::numeric AS total_claimed,
        SUM(approved_amount)::numeric AS total_approved,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric AS avg_days
      FROM claims
      WHERE deleted_at IS NULL
      GROUP BY status
    `);
  }
}

export class BrokerRepository extends BaseRepository<typeof brokers> {
  constructor() { super(brokers, "brokers"); }

  async findByLicense(licenseNumber: string) {
    return this.findOne(eq((brokers as any).licenseNumber, licenseNumber));
  }

  async findActive() {
    return this.findMany({
      where: eq((brokers as any).isActive, true),
      orderBy: asc((brokers as any).companyName),
    });
  }
}

export class PremiumPaymentRepository extends BaseRepository<typeof premiumPayments> {
  constructor() { super(premiumPayments, "premium_payments"); }

  async findByPolicy(policyId: number) {
    return this.findMany({
      where: eq((premiumPayments as any).policyId, policyId),
      orderBy: desc((premiumPayments as any).paymentDate),
    });
  }

  async getCollectionStats(fromDate: Date, toDate: Date) {
    const db = await this.db();
    return db.execute(sql`
      SELECT
        payment_method,
        status,
        COUNT(*)::int     AS count,
        SUM(amount)::numeric AS total
      FROM premium_payments
      WHERE payment_date BETWEEN ${fromDate} AND ${toDate}
      GROUP BY payment_method, status
    `);
  }
}

export class ReinsuranceTreatyRepository extends BaseRepository<typeof reinsuranceTreaties> {
  constructor() { super(reinsuranceTreaties, "reinsurance_treaties"); }

  async findActive() {
    return this.findMany({
      where: eq((reinsuranceTreaties as any).status, "active"),
      orderBy: asc((reinsuranceTreaties as any).reinsurerName),
    });
  }

  async findByTreatyNumber(treatyNumber: string) {
    return this.findOne(eq((reinsuranceTreaties as any).treatyNumber, treatyNumber));
  }
}

export class ActuarialReservesRepository extends BaseRepository<typeof actuarialReserves> {
  constructor() { super(actuarialReserves, "actuarial_reserves"); }

  async findByPeriod(reportingPeriod: string) {
    return this.findMany({
      where: eq((actuarialReserves as any).reportingPeriod, reportingPeriod),
      orderBy: desc((actuarialReserves as any).createdAt),
    });
  }
}

export class AgentRepository extends SoftDeleteRepository<typeof agents> {
  constructor() { super(agents, "agents"); }

  async findByAgentCode(agentCode: string) {
    return this.findOne(eq((agents as any).agentCode, agentCode));
  }

  async findByTier(tier: string) {
    return this.findMany({
      where: eq((agents as any).tier, tier),
      orderBy: desc((agents as any).loyaltyPoints),
    });
  }
}

export class TransactionRepository extends BaseRepository<typeof transactions> {
  constructor() { super(transactions, "transactions"); }

  async findByAgent(agentId: number, cursor?: string, limit = 20) {
    return this.findCursorPage({
      cursor,
      limit,
      orderByColumn: "id",
      orderDirection: "desc",
    });
  }

  async getVolumeStats(agentId: number, fromDate: Date, toDate: Date) {
    const db = await this.db();
    return db.execute(sql`
      SELECT
        type,
        status,
        COUNT(*)::int     AS count,
        SUM(amount)::numeric AS volume
      FROM transactions
      WHERE agent_id = ${agentId}
        AND created_at BETWEEN ${fromDate} AND ${toDate}
      GROUP BY type, status
    `);
  }
}

// ── Repository Factory ────────────────────────────────────────────────────────

export const repositories = {
  policies: new PolicyRepository(),
  claims: new ClaimRepository(),
  brokers: new BrokerRepository(),
  premiumPayments: new PremiumPaymentRepository(),
  reinsuranceTreaties: new ReinsuranceTreatyRepository(),
  actuarialReserves: new ActuarialReservesRepository(),
  agents: new AgentRepository(),
  transactions: new TransactionRepository(),
} as const;

export type Repositories = typeof repositories;
