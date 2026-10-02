/**
 * 2026-10-01 (C2-lib, A3): real-DB restart-simulation tests for the
 * Postgres-backed event store (fluvio_event_log). No mocks: a real PGlite
 * database persisted to a temp data dir is closed and REOPENED to simulate a
 * process restart; events must survive with ordering intact.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendEventToDb,
  countEventsInDb,
  loadRecentEventsFromDb,
  loadStreamEventsFromDb,
  rebuildStateFromEvents,
} from "../eventSourcing";
import type { getDb } from "../../db";

type EventStoreDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const CREATE_SQL = `
  CREATE TABLE fluvio_event_log (
    id SERIAL PRIMARY KEY,
    topic VARCHAR(128) NOT NULL,
    partition INTEGER,
    "offset" INTEGER,
    key VARCHAR(256),
    payload JSON,
    "processedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    status VARCHAR(32) DEFAULT 'processed' NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
  );
`;

function asStoreDb(pglite: PGlite): EventStoreDb {
  // PGlite's drizzle driver is structurally compatible with the node-postgres
  // query surface used by the store; cast through unknown (no `any`).
  return drizzle(pglite) as unknown as EventStoreDb;
}

describe("eventSourcing — Postgres-backed store (A3, PGlite restart simulation)", () => {
  let dataDir: string;
  let pglite: PGlite;
  let db: EventStoreDb;

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "a3-eventstore-"));
    pglite = new PGlite(dataDir);
    await pglite.exec(CREATE_SQL);
    db = asStoreDb(pglite);
  });

  afterAll(async () => {
    await pglite.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("appends events durably with per-stream versions and honest column mapping", async () => {
    const e1 = await appendEventToDb(db, "txn-1", "transaction.created", { amount: 5000 }, { actor: "agent-7" }, "transaction");
    const e2 = await appendEventToDb(db, "txn-1", "transaction.completed", { amount: 5000 }, { actor: "agent-7" }, "transaction");
    const e3 = await appendEventToDb(db, "agent-9", "agent.float.deposited", { amount: 1200 }, { actor: "system" }, "agent");

    expect(e1.version).toBe(1);
    expect(e2.version).toBe(2);
    expect(e3.version).toBe(1);

    // Verify the honest fluvio_event_log mapping at the SQL level.
    const raw = await pglite.query<{
      topic: string; key: string; payload: Record<string, unknown>;
      status: string; partition: number | null; offset: number | null;
    }>(`SELECT topic, key, payload, status, partition, "offset" FROM fluvio_event_log ORDER BY id`);
    expect(raw.rows).toHaveLength(3);
    expect(raw.rows[0].topic).toBe("transaction");
    expect(raw.rows[0].key).toBe("txn-1");
    expect(raw.rows[0].status).toBe("stored");
    expect(raw.rows[0].partition).toBeNull();
    expect(raw.rows[0].offset).toBeNull();
    expect(raw.rows[0].payload.type).toBe("transaction.created");
    expect(raw.rows[0].payload.version).toBe(1);
    expect((raw.rows[0].payload.metadata as { actor: string }).actor).toBe("agent-7");
  });

  it("rejects over-long aggregate ids/types instead of truncating (fail-closed)", async () => {
    await expect(
      appendEventToDb(db, "x".repeat(257), "user.created", {}, { actor: "t" })
    ).rejects.toThrow(/varchar 256/);
    await expect(
      appendEventToDb(db, "ok", "user.created", {}, { actor: "t" }, "y".repeat(129))
    ).rejects.toThrow(/varchar 128/);
  });

  it("survives a restart: events re-read from a NEW PGlite instance on the same data dir, ordering preserved", async () => {
    // Simulate process restart: close the db, open a new instance on the same dir.
    await pglite.close();
    pglite = new PGlite(dataDir);
    db = asStoreDb(pglite);

    const streamEvents = await loadStreamEventsFromDb(db, "txn-1");
    expect(streamEvents).toHaveLength(2);
    expect(streamEvents.map(e => e.version)).toEqual([1, 2]);
    expect(streamEvents.map(e => e.type)).toEqual(["transaction.created", "transaction.completed"]);
    expect(streamEvents[0].timestamp).toBeInstanceOf(Date);
    expect(streamEvents[0].metadata.actor).toBe("agent-7");

    expect(await countEventsInDb(db)).toBe(3);

    const recent = await loadRecentEventsFromDb(db, 2);
    expect(recent).toHaveLength(2);
    expect(recent.map(e => e.type)).toEqual(["transaction.completed", "agent.float.deposited"]);
  });

  it("rebuilds aggregate state from persisted events after restart", async () => {
    const streamEvents = await loadStreamEventsFromDb(db, "txn-1");
    const state = rebuildStateFromEvents(streamEvents);
    expect(state.status).toBe("completed");
    expect(state.amount).toBe(5000);

    const agentEvents = await loadStreamEventsFromDb(db, "agent-9");
    const agentState = rebuildStateFromEvents(agentEvents);
    expect(agentState.premiumReserve).toBe(1200);
  });

  it("appends after restart continue the correct version sequence", async () => {
    const e = await appendEventToDb(db, "txn-1", "transaction.reversed", { amount: 5000 }, { actor: "admin" }, "transaction");
    expect(e.version).toBe(3);
    const state = rebuildStateFromEvents(await loadStreamEventsFromDb(db, "txn-1"));
    expect(state.status).toBe("reversed");
    expect(await countEventsInDb(db)).toBe(4);
  });
});
