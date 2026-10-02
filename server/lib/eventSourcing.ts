// @ts-check
/**
 * Event Sourcing for Financial Transactions
 *
 * Innovation: Complete audit trail using event sourcing pattern.
 * Instead of storing just the current state, we store every state
 * change as an immutable event. This provides:
 *
 * - Full historical audit trail (who did what, when, why)
 * - Automatic reconciliation (rebuild state from events)
 * - Time-travel debugging (see state at any point in time)
 * - Compliance-ready audit logs (NDPR, GDPR, PCI-DSS)
 * - Event replay for migration/debugging
 * - Zero data loss (events are append-only)
 *
 * Architecture:
 *   Transaction → Event Stream → Aggregate State
 *   Every mutation creates events, never updates
 */
import { asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { fluvioEventLog } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { getDb } from "../db";

// 2026-10-01 (C2-lib, A3): the event store is now Postgres-backed via the
// existing fluvio_event_log table (drizzle/schema.ts — fluvioEventLog).
// Honest column mapping (no fabricated Kafka offsets/partitions):
//   topic   ← aggregateType  (varchar 128)
//   key     ← aggregateId    (varchar 256)
//   payload ← full Event serialized as JSON (id/type/version/data/metadata/…)
//   status  ← "stored" (the event was durably appended; not "processed")
//   partition/offset ← NULL (this is a PG append log, not a partitioned topic)
// Global append order is the serial `id`; per-stream version is the count of
// prior events for the same aggregate key + 1.
type EventStoreDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ── Event Types ─────────────────────────────────────────────────────────────

export const EventTypes = z.enum([
  "transaction.created",
  "transaction.completed",
  "transaction.failed",
  "transaction.reversed",
  "transaction.cancelled",
  "agent.float.deposited",
  "agent.float.withdrawn",
  "agent.commission.earned",
  "agent.commission.paid",
  "fraud.alert.created",
  "fraud.alert.resolved",
  "kyc.submitted",
  "kyc.approved",
  "kyc.rejected",
  "user.created",
  "user.updated",
  "user.suspended",
  "tenant.billed",
  "tenant.plan_changed",
]) as z.ZodType<Event["type"]>;

export interface Event {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  timestamp: Date;
  version: number; // Stream version number
  data: Record<string, unknown>;
  metadata: {
    actor: string;
    actorId?: string;
    actorRole?: string;
    ipAddress?: string;
    correlationId?: string;
    reason?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  };
  signature?: string; // Cryptographic signature for integrity
}

export interface EventStream {
  aggregateId: string;
  aggregateType: string;
  version: number;
  events: Event[];
  snapshot?: {
    version: number;
    state: Record<string, unknown>;
  };
}

// ── Event Store ─────────────────────────────────────────────────────────────

// 2026-10-01 (C2-lib, A3): in-memory eventStreams Map / globalEventLog array /
// globalVersion counter REMOVED — they silently dropped all events on restart
// (and splice-truncated history past 100k). All reads/writes now hit Postgres.

/**
 * 2026-10-01 (C2-lib, A3): createEventStream no longer mutates a process-local
 * registry. Streams are DERIVED views over fluvio_event_log rows; an empty
 * shell is returned for API compatibility and the stream materializes on the
 * first persisted appendEvent.
 */
export function createEventStream(aggregateId: string, aggregateType: string): EventStream {
  return {
    aggregateId,
    aggregateType,
    version: 0,
    events: [],
  };
}

/** Fail-closed DB resolution: a missing/unavailable DB throws, never silently no-ops. */
async function requireEventStoreDb(): Promise<EventStoreDb> {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "[EventSourcing] Database unavailable — refusing to append/read events without durable storage (fail-closed)"
    );
  }
  return db;
}

interface FluvioEventRow {
  id: number;
  topic: string;
  key: string | null;
  payload: unknown;
}

/** Serialize an event into a fluvio_event_log row payload (JSON-safe). */
function eventToPayload(event: Event): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    timestamp: event.timestamp.toISOString(),
    version: event.version,
    data: event.data,
    metadata: event.metadata,
    ...(event.signature ? { signature: event.signature } : {}),
  };
}

/** Deserialize a fluvio_event_log row back into an Event. Throws (fail-closed) on malformed payloads. */
function rowToEvent(row: FluvioEventRow): Event {
  const p = row.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") {
    throw new Error(`[EventSourcing] fluvio_event_log row ${row.id} has no JSON payload — cannot rebuild event honestly`);
  }
  const metadata = (p.metadata ?? {}) as Event["metadata"];
  return {
    id: String(p.id),
    type: String(p.type),
    aggregateId: String(p.aggregateId),
    aggregateType: String(p.aggregateType),
    timestamp: new Date(String(p.timestamp)),
    version: Number(p.version),
    data: (p.data ?? {}) as Record<string, unknown>,
    metadata,
    ...(typeof p.signature === "string" ? { signature: p.signature } : {}),
  };
}

/**
 * Core append against an explicit db handle (dependency-injected so tests can
 * use a real PGlite database instead of mocks).
 */
export async function appendEventToDb(
  db: EventStoreDb,
  streamId: string,
  type: string,
  data: Record<string, unknown>,
  metadata: Event["metadata"],
  aggregateType?: string
): Promise<Event> {
  if (streamId.length > 256) {
    throw new Error(`[EventSourcing] aggregateId exceeds fluvio_event_log.key (varchar 256): ${streamId.length} chars`);
  }
  const aggType = aggregateType ?? metadata.actorId ?? "unknown";
  if (aggType.length > 128) {
    throw new Error(`[EventSourcing] aggregateType exceeds fluvio_event_log.topic (varchar 128): ${aggType.length} chars`);
  }

  // Stream version = number of prior events for this aggregate + 1.
  // NOTE: concurrent appends to the SAME aggregate can compute the same version
  // (read-then-write); a unique constraint on (key, version) would require a
  // schema change (out of scope — drizzle/schema.ts is owned elsewhere).
  const prior = await db
    .select({ n: count() })
    .from(fluvioEventLog)
    .where(eq(fluvioEventLog.key, streamId));
  const version = Number(prior[0]?.n ?? 0) + 1;

  const event: Event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    type,
    aggregateId: streamId,
    aggregateType: aggType,
    timestamp: new Date(),
    version,
    data,
    metadata,
  };

  await db.insert(fluvioEventLog).values({
    topic: aggType,
    key: streamId,
    payload: eventToPayload(event),
    status: "stored",
  });

  // Log critical events
  if (type.includes("transaction") || type.includes("fraud")) {
    logger.info(
      {
        eventId: event.id,
        type: event.type,
        streamId,
        version: event.version,
        actor: metadata.actor,
      },
      `[EventSourcing] Event: ${type}`
    );
  }

  return event;
}

/**
 * Append an event durably to Postgres.
 * 2026-10-01 (C2-lib, A3): ASYNC now — previously synchronous and purely
 * in-memory. Fail-closed: throws when the DB is unavailable; the event is
 * NEVER considered appended unless the INSERT succeeds.
 */
export async function appendEvent(
  streamId: string,
  type: string,
  data: Record<string, unknown>,
  metadata: Event["metadata"],
  aggregateType?: string
): Promise<Event> {
  const db = await requireEventStoreDb();
  return appendEventToDb(db, streamId, type, data, metadata, aggregateType);
}

/** Load all events for a stream in append order. */
export async function loadStreamEventsFromDb(db: EventStoreDb, streamId: string): Promise<Event[]> {
  const rows = await db
    .select({ id: fluvioEventLog.id, topic: fluvioEventLog.topic, key: fluvioEventLog.key, payload: fluvioEventLog.payload })
    .from(fluvioEventLog)
    .where(eq(fluvioEventLog.key, streamId))
    .orderBy(asc(fluvioEventLog.id));
  return rows.map(rowToEvent);
}

/** Load the most recent `countLimit` events globally, in append order. */
export async function loadRecentEventsFromDb(db: EventStoreDb, countLimit: number): Promise<Event[]> {
  const rows = await db
    .select({ id: fluvioEventLog.id, topic: fluvioEventLog.topic, key: fluvioEventLog.key, payload: fluvioEventLog.payload })
    .from(fluvioEventLog)
    .orderBy(desc(fluvioEventLog.id))
    .limit(countLimit);
  return rows.map(rowToEvent).reverse();
}

/** Total number of events ever appended (replaces the in-memory globalVersion counter). */
export async function countEventsInDb(db: EventStoreDb): Promise<number> {
  const rows = await db.select({ n: count() }).from(fluvioEventLog);
  return Number(rows[0]?.n ?? 0);
}

// ── State Reconstruction ────────────────────────────────────────────────────

/**
 * Rebuild aggregate state from its persisted events (Postgres is the source of truth).
 * 2026-10-01 (C2-lib, A3): async now; snapshot fast-path removed because
 * snapshots were never persisted anywhere (dead in-memory-only code).
 */
export async function rebuildState(streamId: string): Promise<Record<string, unknown>> {
  const db = await requireEventStoreDb();
  return rebuildStateFromEvents(await loadStreamEventsFromDb(db, streamId));
}

/** Pure reducer over an event list (exposed for tests / replay). */
export function rebuildStateFromEvents(events: Event[]): Record<string, unknown> {
  let state: Record<string, unknown> = {};
  for (const event of events) {
    state = applyEvent(state, event);
  }
  return state;
}

function applyEvent(state: Record<string, unknown>, event: Event): Record<string, unknown> {
  const newState = { ...state };

  switch (event.type) {
    case "transaction.created":
      return { ...newState, ...event.data, status: "created" };
    case "transaction.completed":
      return { ...newState, ...event.data, status: "completed" };
    case "transaction.failed":
      return { ...newState, ...event.data, status: "failed" };
    case "transaction.reversed":
      return { ...newState, ...event.data, status: "reversed" };
    case "transaction.cancelled":
      return { ...newState, ...event.data, status: "cancelled" };
    case "agent.float.deposited":
      newState.premiumReserve = (Number(newState.premiumReserve) || 0) + Number(event.data.amount);
      return newState;
    case "agent.float.withdrawn":
      newState.premiumReserve = (Number(newState.premiumReserve) || 0) - Number(event.data.amount);
      return newState;
    case "agent.commission.earned":
      newState.commissionBalance = (Number(newState.commissionBalance) || 0) + Number(event.data.amount);
      return newState;
    case "agent.commission.paid":
      newState.commissionBalance = (Number(newState.commissionBalance) || 0) - Number(event.data.amount);
      return newState;
    case "kyc.submitted":
      return { ...newState, kycStatus: "submitted" };
    case "kyc.approved":
      return { ...newState, kycStatus: "approved", kycApprovedAt: event.timestamp };
    case "kyc.rejected":
      return { ...newState, kycStatus: "rejected", kycRejectedReason: event.data.reason };
    case "user.suspended":
      return { ...newState, suspended: true, suspendedAt: event.timestamp };
    case "user.created":
      return { ...newState, ...event.data };
    default:
      return newState;
  }
}

// ── Time-Travel Queries ─────────────────────────────────────────────────────

export interface TimeTravelResult {
  streamId: string;
  version: number;
  timestamp: Date;
  state: Record<string, unknown>;
  event: Event | null;
}

export async function getStateAtVersion(streamId: string, version: number): Promise<TimeTravelResult> {
  const db = await requireEventStoreDb();
  const streamEvents = await loadStreamEventsFromDb(db, streamId);
  if (streamEvents.length === 0) {
    throw new Error(`Stream ${streamId} not found`);
  }

  const streamVersion = streamEvents[streamEvents.length - 1].version;
  const targetVersion = Math.min(version, streamVersion);
  const eventsUpToVersion = streamEvents.filter(e => e.version <= targetVersion);

  let state: Record<string, unknown> = {};
  let lastEvent: Event | null = null;

  for (const event of eventsUpToVersion) {
    state = applyEvent(state, event);
    lastEvent = event;
  }

  return {
    streamId,
    version: targetVersion,
    timestamp: lastEvent?.timestamp || new Date(),
    state,
    event: lastEvent,
  };
}

export async function getEventsBetweenVersions(streamId: string, fromVersion: number, toVersion: number): Promise<Event[]> {
  const db = await requireEventStoreDb();
  const streamEvents = await loadStreamEventsFromDb(db, streamId);
  return streamEvents.filter(
    e => e.version >= fromVersion && e.version <= toVersion
  );
}

// ── Event Replay ────────────────────────────────────────────────────────────

export interface ReplayResult {
  streamId: string;
  eventsReplayed: number;
  errors: string[];
  finalState: Record<string, unknown>;
}

export async function replayEvents(
  streamId: string,
  options: { fromVersion?: number; toVersion?: number; dryRun?: boolean } = {}
): Promise<ReplayResult> {
  const { fromVersion, toVersion, dryRun = false } = options;
  const db = await requireEventStoreDb();
  const streamEvents = await loadStreamEventsFromDb(db, streamId);

  if (streamEvents.length === 0) {
    return {
      streamId,
      eventsReplayed: 0,
      errors: ["Stream not found"],
      finalState: {},
    };
  }

  const events = streamEvents.filter(e => {
    if (fromVersion && e.version < fromVersion) return false;
    if (toVersion && e.version > toVersion) return false;
    return true;
  });

  let state: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const event of events) {
    if (!dryRun) {
      try {
        state = applyEvent(state, event);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to apply event ${event.id}: ${message}`);
        logger.error(
          { eventId: event.id, error: message },
          "[EventSourcing] Event replay error"
        );
      }
    }
  }

  return {
    streamId,
    eventsReplayed: events.length,
    errors,
    finalState: state,
  };
}

// ── Event Stream Viewer ─────────────────────────────────────────────────────

export async function getStream(streamId: string): Promise<EventStream | null> {
  const db = await requireEventStoreDb();
  const events = await loadStreamEventsFromDb(db, streamId);
  if (events.length === 0) return null;
  return {
    aggregateId: streamId,
    aggregateType: events[0].aggregateType,
    version: events[events.length - 1].version,
    events,
  };
}

export async function getGlobalEventLog(countLimit: number = 100): Promise<Event[]> {
  const db = await requireEventStoreDb();
  return loadRecentEventsFromDb(db, countLimit);
}

export async function getEventCount(): Promise<number> {
  const db = await requireEventStoreDb();
  return countEventsInDb(db);
}

// ── Event Sourcing Middleware ───────────────────────────────────────────────

export function createEventSourcingMiddleware(streamFactory: (context: unknown) => { streamId: string; aggregateType: string }) {
  // 2026-10-01 (C2-lib, A3): handler is async because appends are durable PG writes.
  return async function handleEvent(
    context: unknown,
    eventType: string,
    data: Record<string, unknown>,
    metadata: Partial<Event["metadata"]> = {}
  ): Promise<Event> {
    const { streamId, aggregateType } = streamFactory(context);

    return appendEvent(streamId, eventType, data, {
      actor: metadata.actor || "system",
      actorId: metadata.actorId,
      actorRole: metadata.actorRole,
      ipAddress: metadata.ipAddress,
      correlationId: metadata.correlationId,
      reason: metadata.reason,
      previousState: metadata.previousState,
      newState: metadata.newState,
    }, aggregateType);
  };
}

// ── Audit Trail Export ──────────────────────────────────────────────────────

// 2026-10-01 (C2-lib, A3): async now — audit exports read from Postgres, not a
// process-local buffer that reset on every restart.
export async function exportAuditTrail(options: {
  startDate?: Date;
  endDate?: Date;
  actor?: string;
  eventType?: string;
  format?: "json" | "csv";
} = {}): Promise<string> {
  const { startDate, endDate, actor, eventType, format = "json" } = options;

  const db = await requireEventStoreDb();
  // Full-history export: load all events (append order) then filter honestly.
  let events = await loadRecentEventsFromDb(db, await countEventsInDb(db));

  if (startDate) {
    events = events.filter(e => e.timestamp >= startDate);
  }
  if (endDate) {
    events = events.filter(e => e.timestamp <= endDate);
  }
  if (actor) {
    events = events.filter(e => e.metadata.actor === actor);
  }
  if (eventType) {
    events = events.filter(e => e.type === eventType);
  }

  if (format === "csv") {
    return exportAsCSV(events);
  }

  return JSON.stringify(events, null, 2);
}

function exportAsCSV(events: Event[]): string {
  const headers = ["eventId", "type", "streamId", "timestamp", "actor", "version", "data"];
  const rows = events.map(e => [
    e.id,
    e.type,
    e.aggregateId,
    e.timestamp.toISOString(),
    e.metadata.actor,
    e.version,
    JSON.stringify(e.data),
  ]);

  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

// ── Initialization ──────────────────────────────────────────────────────────

export function initializeEventSourcing(): void {
  logger.info("[EventSourcing] Event sourcing initialized");
}

export default {
  createEventStream,
  appendEvent,
  rebuildState,
  getStateAtVersion,
  getEventsBetweenVersions,
  replayEvents,
  getStream,
  getGlobalEventLog,
  getEventCount,
  createEventSourcingMiddleware,
  exportAuditTrail,
  initializeEventSourcing,
  EventTypes,
};
