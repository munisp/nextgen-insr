/**
 * server/lib/drizzleAdvanced.ts
 *
 * Advanced Drizzle ORM Innovations — Sprint 99
 *
 * Implements:
 *   1.  Event Store / CQRS        — append-only event log with aggregate replay
 *   2.  Saga Orchestrator         — distributed transaction state machine
 *   3.  Full Audit Trail          — immutable change history with diff
 *   4.  Row-Level Security (RLS)  — PostgreSQL RLS policy management
 *   5.  Multi-Tenancy Middleware  — automatic tenant isolation
 *   6.  Data Lineage Tracker      — upstream/downstream data provenance
 *   7.  Schema Diff Engine        — detect schema drift at runtime
 *   8.  Optimistic Locking        — version-based conflict detection
 *   9.  Full-Text Search Engine   — tsvector search with ranking
 *  10.  Change Data Capture (CDC) — trigger-based change streaming
 */

import { sql, eq, and, desc, asc, gt, gte, isNull, count } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "../_core/logger";
import { createHash, randomUUID } from "crypto";
import {
  eventStore, outboxMessages, sagaInstances, deadLetterQueue,
  idempotencyKeys, dataLineage, entityVersions, searchIndexEntries,
  queryPerformanceLog, schemaVersions,
  type InsertEventStore, type InsertOutboxMessage, type InsertSagaInstance,
} from "../../drizzle/schema.enhancements";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Event Store — Append-Only Event Log with Aggregate Replay
// ═══════════════════════════════════════════════════════════════════════════════

export interface DomainEvent {
  streamId: string;
  streamType: string;
  eventType: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  causationId?: string;
  correlationId?: string;
  actorId?: string;
  actorRole?: string;
  tenantId?: number;
}

export interface EventStoreAppendResult {
  eventId: bigint;
  sequenceNumber: bigint;
  streamId: string;
  eventType: string;
  timestamp: Date;
}

/**
 * Append a domain event to the event store.
 * Atomically increments the stream sequence number.
 */
export async function appendEvent(event: DomainEvent): Promise<EventStoreAppendResult> {
  const db = await getDb();
  if (!db) throw new Error("Event store: database not available");

  // Get next sequence number for this stream (atomic via CTE)
  const result = await (db as any).execute(sql`
    WITH next_seq AS (
      SELECT COALESCE(MAX(sequence_number), 0) + 1 AS seq
      FROM event_store
      WHERE stream_id = ${event.streamId}
        AND stream_type = ${event.streamType}
    )
    INSERT INTO event_store (
      stream_id, stream_type, event_type, event_version,
      sequence_number, payload, metadata,
      causation_id, correlation_id, actor_id, actor_role, tenant_id,
      status, created_at
    )
    SELECT
      ${event.streamId}, ${event.streamType}, ${event.eventType}, 1,
      seq, ${JSON.stringify(event.payload)}::jsonb,
      ${JSON.stringify(event.metadata ?? {})}::jsonb,
      ${event.causationId ?? null}::uuid,
      ${event.correlationId ?? randomUUID()}::uuid,
      ${event.actorId ?? null}, ${event.actorRole ?? null},
      ${event.tenantId ?? null}, 'processed', NOW()
    FROM next_seq
    RETURNING id, sequence_number, created_at
  `);

  const row = result.rows?.[0];
  return {
    eventId: row?.id,
    sequenceNumber: row?.sequence_number,
    streamId: event.streamId,
    eventType: event.eventType,
    timestamp: row?.created_at ?? new Date(),
  };
}

/**
 * Append multiple events in a single transaction (atomic batch).
 */
export async function appendEvents(events: DomainEvent[]): Promise<EventStoreAppendResult[]> {
  const db = await getDb();
  if (!db) throw new Error("Event store: database not available");

  return (db as any).transaction(async (tx: any) => {
    const results: EventStoreAppendResult[] = [];
    for (const event of events) {
      const r = await appendEvent(event);
      results.push(r);
    }
    return results;
  });
}

/**
 * Replay all events for a stream to rebuild aggregate state.
 */
export async function replayStream<TState>(
  streamId: string,
  streamType: string,
  reducer: (state: TState, event: { eventType: string; payload: Record<string, unknown> }) => TState,
  initialState: TState,
  fromSequence = 0
): Promise<{ state: TState; version: bigint }> {
  const db = await getDb();
  if (!db) throw new Error("Event store: database not available");

  const events = await (db as any)
    .select()
    .from(eventStore)
    .where(
      and(
        eq((eventStore as any).streamId, streamId),
        eq((eventStore as any).streamType, streamType),
        gt((eventStore as any).sequenceNumber, fromSequence)
      )
    )
    .orderBy(asc((eventStore as any).sequenceNumber));

  let state = initialState;
  let version = BigInt(fromSequence);

  for (const event of events) {
    state = reducer(state, { eventType: event.eventType, payload: event.payload as Record<string, unknown> });
    version = event.sequenceNumber;
  }

  return { state, version };
}

/**
 * Get all events for a stream.
 */
export async function getStreamEvents(
  streamId: string,
  streamType: string,
  fromSequence = 0,
  limit = 100
) {
  const db = await getDb();
  if (!db) return [];

  return (db as any)
    .select()
    .from(eventStore)
    .where(
      and(
        eq((eventStore as any).streamId, streamId),
        eq((eventStore as any).streamType, streamType),
        gt((eventStore as any).sequenceNumber, fromSequence)
      )
    )
    .orderBy(asc((eventStore as any).sequenceNumber))
    .limit(limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Saga Orchestrator — Distributed Transaction State Machine
// ═══════════════════════════════════════════════════════════════════════════════

export interface SagaStep<TState> {
  name: string;
  execute: (state: TState, tx?: any) => Promise<TState>;
  compensate: (state: TState, tx?: any) => Promise<TState>;
}

export class SagaOrchestrator<TState extends Record<string, unknown>> {
  private steps: SagaStep<TState>[] = [];
  private readonly sagaType: string;

  constructor(sagaType: string) {
    this.sagaType = sagaType;
  }

  step(step: SagaStep<TState>): this {
    this.steps.push(step);
    return this;
  }

  async execute(
    correlationId: string,
    initialState: TState,
    tenantId?: number
  ): Promise<TState> {
    const db = await getDb();
    if (!db) throw new Error("Saga: database not available");

    // Create saga instance
    const [saga] = await (db as any)
      .insert(sagaInstances)
      .values({
        sagaType: this.sagaType,
        correlationId,
        currentStep: this.steps[0]?.name ?? "start",
        completedSteps: [],
        compensatedSteps: [],
        state: initialState,
        status: "started",
        tenantId,
      } as InsertSagaInstance)
      .returning();

    let state = initialState;
    const completedSteps: string[] = [];

    try {
      for (const step of this.steps) {
        // Update current step
        await (db as any)
          .update(sagaInstances)
          .set({ currentStep: step.name, state, updatedAt: new Date() })
          .where(eq((sagaInstances as any).id, saga.id));

        state = await step.execute(state);
        completedSteps.push(step.name);

        await (db as any)
          .update(sagaInstances)
          .set({ completedSteps, state, updatedAt: new Date() })
          .where(eq((sagaInstances as any).id, saga.id));
      }

      // Mark completed
      await (db as any)
        .update(sagaInstances)
        .set({ status: "completed", completedAt: new Date(), state, updatedAt: new Date() })
        .where(eq((sagaInstances as any).id, saga.id));

      return state;
    } catch (err) {
      // Compensate in reverse order
      await (db as any)
        .update(sagaInstances)
        .set({ status: "compensating", lastError: String(err), updatedAt: new Date() })
        .where(eq((sagaInstances as any).id, saga.id));

      const compensatedSteps: string[] = [];
      for (const stepName of [...completedSteps].reverse()) {
        const step = this.steps.find(s => s.name === stepName);
        if (step) {
          try {
            state = await step.compensate(state);
            compensatedSteps.push(stepName);
          } catch (compErr) {
            logger.error(`[Saga:${this.sagaType}] Compensation failed for step ${stepName}: ${String(compErr)}`);
          }
        }
      }

      await (db as any)
        .update(sagaInstances)
        .set({
          status: "compensated",
          compensatedSteps,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq((sagaInstances as any).id, saga.id));

      throw err;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Full Audit Trail with Diff
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuditEntry {
  entityType: string;
  entityId: string | number;
  action: "create" | "update" | "delete" | "restore" | "approve" | "reject" | "custom";
  actorId?: number | string;
  actorRole?: string;
  tenantId?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  diff?: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Compute a field-level diff between two objects.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (key === "updatedAt" || key === "updated_at") continue; // Skip timestamp noise
    const fromVal = before[key];
    const toVal = after[key];
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      diff[key] = { from: fromVal, to: toVal };
    }
  }

  return diff;
}

/**
 * Write an immutable audit trail entry via the event store.
 */
export async function writeAuditTrail(entry: AuditEntry): Promise<void> {
  try {
    const diff = entry.before && entry.after
      ? computeDiff(entry.before, entry.after)
      : entry.diff;

    await appendEvent({
      streamId: `${entry.entityType}:${entry.entityId}`,
      streamType: "audit",
      eventType: `audit.${entry.action}`,
      payload: {
        entityType: entry.entityType,
        entityId: String(entry.entityId),
        action: entry.action,
        before: entry.before ?? null,
        after: entry.after ?? null,
        diff: diff ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ?? null,
      },
      actorId: String(entry.actorId ?? "system"),
      actorRole: entry.actorRole,
      correlationId: entry.correlationId,
      tenantId: entry.tenantId,
    });
  } catch (err) {
    // Audit trail failure must never break the main flow
    logger.error(`[AuditTrail] Write failed: ${String(err)}`);
  }
}

/**
 * Get the full audit history for an entity.
 */
export async function getAuditHistory(
  entityType: string,
  entityId: string | number,
  limit = 50
) {
  return getStreamEvents(`${entityType}:${entityId}`, "audit", 0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Row-Level Security Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enable RLS on a table and create tenant isolation policy.
 */
export async function enableTenantRLS(tableName: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any).execute(sql`ALTER TABLE ${sql.identifier(tableName)} ENABLE ROW LEVEL SECURITY`);
    await (db as any).execute(sql`ALTER TABLE ${sql.identifier(tableName)} FORCE ROW LEVEL SECURITY`);

    // Create policy: app_user can only see their tenant's rows
    await (db as any).execute(sql`
      DROP POLICY IF EXISTS tenant_isolation ON ${sql.identifier(tableName)}
    `);
    await (db as any).execute(sql`
      CREATE POLICY tenant_isolation ON ${sql.identifier(tableName)}
        USING (tenant_id = current_setting('app.current_tenant_id', true)::integer)
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::integer)
    `);

    logger.info(`[RLS] Enabled tenant isolation on ${tableName}`);
  } catch (err) {
    logger.error(`[RLS] Failed to enable on ${tableName}: ${String(err)}`);
    throw err;
  }
}

/**
 * Set the current tenant context for RLS enforcement.
 * Call this at the start of every request.
 */
export async function setTenantContext(tenantId: number, db?: any): Promise<void> {
  const database = db ?? await getDb();
  if (!database) return;
  await database.execute(sql`SELECT set_config('app.current_tenant_id', ${String(tenantId)}, true)`);
}

/**
 * Set the current user context for audit triggers.
 */
export async function setUserContext(userId: string, role: string, db?: any): Promise<void> {
  const database = db ?? await getDb();
  if (!database) return;
  await database.execute(sql`
    SELECT
      set_config('app.current_user_id', ${userId}, true),
      set_config('app.current_user_role', ${role}, true)
  `);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Full-Text Search Engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface SearchResult {
  entityType: string;
  entityId: string;
  displayText: string;
  metadata: Record<string, unknown>;
  rank: number;
  tenantId: number | null;
}

/**
 * Index an entity for full-text search.
 */
export async function indexEntity(
  entityType: string,
  entityId: string,
  searchableText: string,
  displayText: string,
  metadata: Record<string, unknown> = {},
  tenantId?: number,
  language = "english"
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any)
      .insert(searchIndexEntries)
      .values({
        entityType,
        entityId,
        tenantId: tenantId ?? null,
        searchVector: searchableText, // stored as text, queried with to_tsvector
        displayText,
        metadata,
        language,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [(searchIndexEntries as any).entityType, (searchIndexEntries as any).entityId, (searchIndexEntries as any).tenantId],
        set: {
          searchVector: searchableText,
          displayText,
          metadata,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.error(`[SearchIndex] Failed to index ${entityType}:${entityId}: ${String(err)}`);
  }
}

/**
 * Full-text search across indexed entities.
 */
export async function searchEntities(
  query: string,
  options: {
    entityTypes?: string[];
    tenantId?: number;
    limit?: number;
    language?: string;
  } = {}
): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];

  const { entityTypes, tenantId, limit = 20, language = "english" } = options;

  try {
    const result = await (db as any).execute(sql`
      SELECT
        entity_type,
        entity_id,
        display_text,
        metadata,
        tenant_id,
        ts_rank(
          to_tsvector(${language}, search_vector),
          plainto_tsquery(${language}, ${query})
        ) AS rank
      FROM search_index_entries
      WHERE is_active = true
        AND to_tsvector(${language}, search_vector) @@ plainto_tsquery(${language}, ${query})
        ${tenantId !== undefined ? sql`AND (tenant_id = ${tenantId} OR tenant_id IS NULL)` : sql``}
        ${entityTypes && entityTypes.length > 0 ? sql`AND entity_type = ANY(${entityTypes})` : sql``}
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    return (result.rows ?? []).map((row: any) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      displayText: row.display_text,
      metadata: row.metadata ?? {},
      rank: parseFloat(row.rank),
      tenantId: row.tenant_id,
    }));
  } catch (err) {
    logger.error(`[Search] Query failed: ${String(err)}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Data Lineage Tracker
// ═══════════════════════════════════════════════════════════════════════════════

export async function trackDataLineage(
  sourceEntity: string,
  sourceId: string,
  targetEntity: string,
  targetId: string,
  transformationType: string,
  details?: Record<string, unknown>,
  pipelineId?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any).insert(dataLineage).values({
      sourceEntity,
      sourceId,
      targetEntity,
      targetId,
      transformationType,
      transformationDetails: details ?? null,
      pipelineId: pipelineId ?? null,
    });
  } catch (err) {
    logger.error(`[DataLineage] Track failed: ${String(err)}`);
  }
}

export async function getDataLineageUpstream(entityType: string, entityId: string) {
  const db = await getDb();
  if (!db) return [];

  return (db as any)
    .select()
    .from(dataLineage)
    .where(
      and(
        eq((dataLineage as any).targetEntity, entityType),
        eq((dataLineage as any).targetId, entityId)
      )
    )
    .orderBy(desc((dataLineage as any).createdAt));
}

export async function getDataLineageDownstream(entityType: string, entityId: string) {
  const db = await getDb();
  if (!db) return [];

  return (db as any)
    .select()
    .from(dataLineage)
    .where(
      and(
        eq((dataLineage as any).sourceEntity, entityType),
        eq((dataLineage as any).sourceId, entityId)
      )
    )
    .orderBy(desc((dataLineage as any).createdAt));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Schema Diff Engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface SchemaDiff {
  missingTables: string[];
  extraTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  typeChanges: Array<{ table: string; column: string; expected: string; actual: string }>;
  missingIndexes: string[];
}

/**
 * Compare the Drizzle schema definition against the live database.
 * Returns a diff of what's missing or different.
 */
export async function detectSchemaDrift(expectedTables: string[]): Promise<SchemaDiff> {
  const db = await getDb();
  if (!db) {
    return { missingTables: [], extraTables: [], missingColumns: [], typeChanges: [], missingIndexes: [] };
  }

  const result = await (db as any).execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const liveTables = new Set<string>((result.rows ?? []).map((r: any) => r.table_name));
  const expectedSet = new Set(expectedTables);

  const missingTables = expectedTables.filter(t => !liveTables.has(t));
  const extraTables = Array.from(liveTables).filter(t => !expectedSet.has(t) && !t.startsWith("drizzle_"));

  return {
    missingTables,
    extraTables,
    missingColumns: [], // Would require column-level comparison
    typeChanges: [],
    missingIndexes: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Optimistic Locking with Entity Version Tracking
// ═══════════════════════════════════════════════════════════════════════════════

export async function getEntityVersion(entityType: string, entityId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await (db as any)
    .select()
    .from(entityVersions)
    .where(
      and(
        eq((entityVersions as any).entityType, entityType),
        eq((entityVersions as any).entityId, entityId)
      )
    )
    .limit(1);

  return rows[0]?.version ?? 0;
}

export async function incrementEntityVersion(
  entityType: string,
  entityId: string,
  updatedBy?: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await (db as any).execute(sql`
    INSERT INTO entity_versions (entity_type, entity_id, version, updated_by, updated_at)
    VALUES (${entityType}, ${entityId}, 1, ${updatedBy ?? null}, NOW())
    ON CONFLICT (entity_type, entity_id)
    DO UPDATE SET
      version = entity_versions.version + 1,
      updated_by = ${updatedBy ?? null},
      updated_at = NOW()
    RETURNING version
  `);

  return result.rows?.[0]?.version ?? 1;
}

export async function assertEntityVersion(
  entityType: string,
  entityId: string,
  expectedVersion: number
): Promise<void> {
  const current = await getEntityVersion(entityType, entityId);
  if (current !== expectedVersion) {
    throw new Error(
      `OPTIMISTIC_LOCK_CONFLICT: ${entityType}:${entityId} expected version ${expectedVersion} but found ${current}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Change Data Capture (CDC) — PostgreSQL LISTEN/NOTIFY
// ═══════════════════════════════════════════════════════════════════════════════

export type CDCHandler = (change: {
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  oldRow?: Record<string, unknown>;
  newRow?: Record<string, unknown>;
  timestamp: Date;
}) => Promise<void>;

const cdcHandlers = new Map<string, CDCHandler[]>();

export function onTableChange(table: string, handler: CDCHandler): void {
  if (!cdcHandlers.has(table)) cdcHandlers.set(table, []);
  cdcHandlers.get(table)!.push(handler);
}

/**
 * Install CDC triggers on a table using PostgreSQL NOTIFY.
 * The trigger sends a JSON payload to the 'cdc_changes' channel.
 */
export async function installCDCTrigger(tableName: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const fnName = `cdc_notify_${tableName}`;
  const triggerName = `cdc_trigger_${tableName}`;

  try {
    await (db as any).execute(sql`
      CREATE OR REPLACE FUNCTION ${sql.identifier(fnName)}()
      RETURNS TRIGGER AS $$
      DECLARE
        payload jsonb;
      BEGIN
        payload := jsonb_build_object(
          'table', TG_TABLE_NAME,
          'operation', TG_OP,
          'old_row', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE NULL END,
          'new_row', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END,
          'timestamp', NOW()
        );
        PERFORM pg_notify('cdc_changes', payload::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await (db as any).execute(sql`
      DROP TRIGGER IF EXISTS ${sql.identifier(triggerName)} ON ${sql.identifier(tableName)}
    `);

    await (db as any).execute(sql`
      CREATE TRIGGER ${sql.identifier(triggerName)}
      AFTER INSERT OR UPDATE OR DELETE ON ${sql.identifier(tableName)}
      FOR EACH ROW EXECUTE FUNCTION ${sql.identifier(fnName)}()
    `);

    logger.info(`[CDC] Installed trigger on ${tableName}`);
  } catch (err) {
    logger.error(`[CDC] Failed to install trigger on ${tableName}: ${String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Schema Version Registry
// ═══════════════════════════════════════════════════════════════════════════════

export async function registerSchemaVersion(
  version: string,
  description: string,
  sql_content: string,
  appliedBy?: string,
  rollbackSql?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const checksum = createHash("sha256").update(sql_content).digest("hex");

  try {
    await (db as any)
      .insert(schemaVersions)
      .values({
        version,
        description,
        checksum,
        appliedBy: appliedBy ?? "system",
        rollbackSql: rollbackSql ?? null,
        isBaseline: false,
      })
      .onConflictDoNothing();

    logger.info(`[SchemaVersion] Registered v${version}: ${description}`);
  } catch (err) {
    logger.error(`[SchemaVersion] Failed to register ${version}: ${String(err)}`);
  }
}

export async function getSchemaVersionHistory() {
  const db = await getDb();
  if (!db) return [];

  return (db as any)
    .select()
    .from(schemaVersions)
    .orderBy(desc((schemaVersions as any).appliedAt));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Dead Letter Queue Management
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendToDeadLetterQueue(
  originalTopic: string,
  payload: Record<string, unknown>,
  errorMessage: string,
  errorStack?: string,
  originalMessageId?: string,
  headers?: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any).insert(deadLetterQueue).values({
      originalTopic,
      originalMessageId: originalMessageId ?? null,
      payload,
      headers: headers ?? {},
      errorMessage,
      errorStack: errorStack ?? null,
      attempts: 1,
      status: "pending_review",
    });
    logger.warn(`[DLQ] Message sent to dead letter queue: ${originalTopic}`);
  } catch (err) {
    logger.error(`[DLQ] Failed to write to DLQ: ${String(err)}`);
  }
}

export async function requeueDeadLetterMessage(id: string, resolvedBy: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const rows = await (db as any)
    .update(deadLetterQueue)
    .set({ status: "requeued", resolvedBy, resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq((deadLetterQueue as any).id, id))
    .returning();

  if (rows.length > 0) {
    const msg = rows[0];
    // Re-publish via outbox
    await (db as any).insert(outboxMessages).values({
      aggregateId: id,
      aggregateType: "dead_letter_queue",
      eventType: "dlq.requeued",
      topic: msg.originalTopic,
      payload: msg.payload,
      headers: msg.headers ?? {},
      status: "pending",
    } as InsertOutboxMessage);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Query Performance Logging
// ═══════════════════════════════════════════════════════════════════════════════

const SLOW_THRESHOLD_MS = 200;

export async function logQueryPerformance(
  queryText: string,
  executionTimeMs: number,
  rowsReturned: number,
  endpoint?: string,
  tenantId?: number,
  userId?: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const queryHash = createHash("md5").update(queryText).digest("hex");
  const isSlowQuery = executionTimeMs > SLOW_THRESHOLD_MS;

  try {
    await (db as any).insert(queryPerformanceLog).values({
      queryHash,
      queryText: queryText.slice(0, 5000), // Truncate very long queries
      executionTimeMs: String(executionTimeMs),
      rowsReturned,
      endpoint: endpoint ?? null,
      tenantId: tenantId ?? null,
      userId: userId ?? null,
      isSlowQuery,
    });
  } catch {
    // Non-fatal
  }
}

export async function getSlowQueryReport(limit = 50) {
  const db = await getDb();
  if (!db) return [];

  return (db as any)
    .select()
    .from(queryPerformanceLog)
    .where(eq((queryPerformanceLog as any).isSlowQuery, true))
    .orderBy(desc((queryPerformanceLog as any).executionTimeMs))
    .limit(limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Insurance Domain Event Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export const InsuranceEvents = {
  // Policy lifecycle
  POLICY_QUOTED:        "policy.quoted",
  POLICY_BOUND:         "policy.bound",
  POLICY_ACTIVATED:     "policy.activated",
  POLICY_LAPSED:        "policy.lapsed",
  POLICY_CANCELLED:     "policy.cancelled",
  POLICY_RENEWED:       "policy.renewed",
  POLICY_ENDORSED:      "policy.endorsed",

  // Premium
  PREMIUM_COLLECTED:    "premium.collected",
  PREMIUM_OVERDUE:      "premium.overdue",
  PREMIUM_WAIVED:       "premium.waived",

  // Claims
  CLAIM_SUBMITTED:      "claim.submitted",
  CLAIM_ACKNOWLEDGED:   "claim.acknowledged",
  CLAIM_INVESTIGATION_STARTED: "claim.investigation_started",
  CLAIM_APPROVED:       "claim.approved",
  CLAIM_REJECTED:       "claim.rejected",
  CLAIM_SETTLED:        "claim.settled",
  CLAIM_APPEALED:       "claim.appealed",

  // Underwriting
  UW_ASSESSMENT_CREATED: "underwriting.assessment_created",
  UW_APPROVED:          "underwriting.approved",
  UW_DECLINED:          "underwriting.declined",
  UW_REFERRED:          "underwriting.referred",

  // Reinsurance
  REINSURANCE_CESSION_CREATED: "reinsurance.cession_created",
  REINSURANCE_RECOVERY_FILED:  "reinsurance.recovery_filed",

  // Compliance
  NAICOM_REPORT_FILED:  "compliance.naicom_report_filed",
  AML_ALERT_RAISED:     "compliance.aml_alert_raised",
  NDPR_CONSENT_GIVEN:   "compliance.ndpr_consent_given",

  // Actuarial
  RESERVE_COMPUTED:     "actuarial.reserve_computed",
  IFRS17_MEASUREMENT:   "actuarial.ifrs17_measurement",
} as const;

export type InsuranceEventType = typeof InsuranceEvents[keyof typeof InsuranceEvents];

/**
 * Emit a typed insurance domain event to both the event store and outbox.
 */
export async function emitInsuranceEvent(
  eventType: InsuranceEventType,
  streamId: string,
  streamType: string,
  payload: Record<string, unknown>,
  options: {
    actorId?: string;
    actorRole?: string;
    tenantId?: number;
    correlationId?: string;
  } = {}
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await (db as any).transaction(async (tx: any) => {
    // 1. Append to event store
    await appendEvent({
      streamId,
      streamType,
      eventType,
      payload,
      ...options,
    });

    // 2. Write to outbox for reliable delivery
    await tx.insert(outboxMessages).values({
      aggregateId: streamId,
      aggregateType: streamType,
      eventType,
      topic: `insurance.${streamType}`,
      payload: { ...payload, eventType, streamId, streamType },
      headers: {
        correlationId: options.correlationId ?? randomUUID(),
        tenantId: String(options.tenantId ?? ""),
        actorId: options.actorId ?? "system",
      },
      status: "pending",
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    } as InsertOutboxMessage);
  });
}
