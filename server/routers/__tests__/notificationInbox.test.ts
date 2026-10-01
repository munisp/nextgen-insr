/**
 * notificationInbox.test.ts — R3 batch 6 IDOR regression (2026-10-01, R3-b6-fix)
 *
 * Real-behavior PGlite regression suite for the pre-existing IDOR found by
 * the batch-6 adversarial verifier: notificationInbox.markRead /
 * notificationInbox.delete filtered by notification id ONLY — any caller
 * could mark-read or delete ANY user's notification. Both now scope
 * recipient_id = String(ctx.user.id) and NOT_FOUND (non-enumerating) on
 * zero caller-owned rows. Harness copied from memberPhone.test.ts (real
 * embedded PostgreSQL via pgliteServer.mjs, ephemeral probeFreePort,
 * faithful notification_logs projection from drizzle/schema.ts:3901).
 *   - caller marks own notification read → success, row updated
 *   - caller marks FOREIGN notification read → NOT_FOUND, row unchanged
 *     (status stays 'pending' — zero-row-change assertion)
 *   - caller deletes FOREIGN notification → NOT_FOUND, row still exists
 *   - caller deletes own notification → success, row gone
 *   - anonymous caller → UNAUTHORIZED
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

let PG_PORT = 0;
let PG_URL = "";

async function probeFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar; the authz under test is the router's
// own recipient scoping (same pattern as memberIdentity).
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../notificationInbox"))["notificationInboxRouter"]["createCaller"]
>;
let caller1: Caller; // session user id 1 → recipient_id '1'
let anonCaller: Caller;

let ownId = 0;
let foreignId = 0;

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
}

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  // Faithful notification_logs projection (drizzle/schema.ts:3901).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id serial PRIMARY KEY,
      channel_id integer,
      recipient_id text NOT NULL,
      recipient_type text NOT NULL,
      subject text,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      sent_at timestamp,
      delivered_at timestamp,
      failure_reason text,
      retry_count integer DEFAULT 0,
      created_at timestamp DEFAULT now()
    )`);

  const rows = await db.execute(sql`
    INSERT INTO notification_logs (recipient_id, recipient_type, body, status)
    VALUES
      ('1', 'customer', 'own notification', 'pending'),
      ('2', 'customer', 'foreign notification', 'pending')
    RETURNING id`);
  const ids = (rows.rows as { id: number }[]).map(r => Number(r.id));
  ownId = ids[0];
  foreignId = ids[1];
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { notificationInboxRouter } = await import("../notificationInbox");
  caller1 = notificationInboxRouter.createCaller(makeAuthenticatedCtx(1) as never);
  anonCaller = notificationInboxRouter.createCaller(
    makeUnauthenticatedCtx() as never
  );
}, 90_000);

afterAll(async () => {
  if (pgliteChild) pgliteChild.kill("SIGKILL");
});

describe("notificationInbox markRead/delete caller scoping (R3-b6-fix)", () => {
  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(anonCaller.markRead({ notificationId: ownId })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("caller marks own notification read → success, row updated", async () => {
    const res = await caller1.markRead({ notificationId: ownId });
    expect(res.success).toBe(true);
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const r = await db!.execute(
      sql`SELECT status FROM notification_logs WHERE id = ${ownId}`
    );
    expect((r.rows[0] as { status: string }).status).toBe("read");
  });

  it("caller marks FOREIGN notification read → NOT_FOUND, row unchanged", async () => {
    await expect(
      caller1.markRead({ notificationId: foreignId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const r = await db!.execute(
      sql`SELECT status FROM notification_logs WHERE id = ${foreignId}`
    );
    // zero-row-change: foreign row still pending
    expect((r.rows[0] as { status: string }).status).toBe("pending");
  });

  it("caller deletes FOREIGN notification → NOT_FOUND, row still exists", async () => {
    await expect(
      caller1.delete({ notificationId: foreignId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const r = await db!.execute(
      sql`SELECT COUNT(*)::int AS n FROM notification_logs WHERE id = ${foreignId}`
    );
    expect((r.rows[0] as { n: number }).n).toBe(1);
  });

  it("caller deletes own notification → success, row gone", async () => {
    const res = await caller1.delete({ notificationId: ownId });
    expect(res.success).toBe(true);
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const r = await db!.execute(
      sql`SELECT COUNT(*)::int AS n FROM notification_logs WHERE id = ${ownId}`
    );
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
});
