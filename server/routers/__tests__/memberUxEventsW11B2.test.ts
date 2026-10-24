/**
 * memberUxEventsW11B2.test.ts — W11-B2 (2026-10-24)
 *
 * Real-behavior tests for the UX instrumentation backbone
 * (server/routers/memberUxEvents.ts, drizzle/0091_ux_events.sql).
 *
 * REAL PGlite PostgreSQL; the schema under test is applied by executing the
 * REAL migration file drizzle/0091_ux_events.sql (so the migration is
 * verified to apply cleanly here). NO doubles anywhere — nothing on the
 * production path is mocked.
 *
 * Covers:
 *   - Batch insert + clientEventId idempotent replay (same ids → no dupes,
 *     honest accepted/duplicates counts).
 *   - Zod rejects: batch > 20, oversized metadata (> 20 keys), long string
 *     values (> 64 chars — the PII-smuggling guard), nested objects, invalid
 *     event kinds, non-uuid clientEventId, unknown envelope keys (.strict).
 *   - Anonymous → UNAUTHORIZED on track/mySummary/adminFunnel.
 *   - Cross-member isolation on mySummary (member B never sees A's rows) —
 *     NON-VACUOUS mutant probe: verified red by deleting the
 *     eq(uxEvents.customerId, customer.id) predicate from mySummary in
 *     memberUxEvents.ts (cross-member isolation test then fails because B's
 *     summary contains A's buckets) and reverting. 2026-10-24.
 *   - Rate limit: PG-count guard trips at the 500/hour boundary
 *     (TOO_MANY_REQUESTS), and the boundary-minus case passes.
 *   - Admin funnel: member (role=user) → FORBIDDEN; admin gets correct
 *     aggregate buckets on seeded rows; never row-level data (shape check).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";

let pgliteChild: ChildProcess | null = null;

/** Ports must avoid the Linux ephemeral range (32768-60999) — use 24xxx. */
async function probeFreePort(base: number): Promise<number> {
  const net = await import("node:net");
  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(port)));
    });
  for (let p = base; p < base + 100; p++) {
    try {
      return await tryPort(p);
    } catch {
      /* busy — try next */
    }
  }
  throw new Error("no free port in 24xxx band");
}

async function startPglite(): Promise<void> {
  const port = await probeFreePort(24300);
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(port) },
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
  process.env.POSTGRES_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

/** Member A: users.id 1 ↔ customers.id 4242. Member B: users.id 2 ↔ 9999. */
const A_USER = 1;
const A_CUSTOMER = 4242;
const B_USER = 2;
const B_CUSTOMER = 9999;

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL DEFAULT 'M',
      "lastName" varchar(64) NOT NULL DEFAULT 'T',
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      "keycloakSub" varchar(128) UNIQUE,
      "kycLevel" integer NOT NULL DEFAULT 0
    )`);
  // The REAL W11-B2 migration — verifies it applies cleanly on PGlite.
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0091_ux_events.sql"),
    "utf8"
  );
  await db.execute(sql.raw(migrationSql));
  // Idempotency of the migration itself: applying it a second time must not
  // error (IF NOT EXISTS guards).
  await db.execute(sql.raw(migrationSql));
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", email, phone, "keycloakSub", "kycLevel") VALUES
      (${A_CUSTOMER}, 'Ada', 'Okafor', 'ada@example.io', '09000000001', '1', 3),
      (${B_CUSTOMER}, 'Bala', 'Yusuf', 'bala@example.io', '09000000002', '2', 3)
    ON CONFLICT DO NOTHING`);
}

type Db = NonNullable<Awaited<ReturnType<(typeof import("../../db"))["getDb"]>>>;
async function db(): Promise<Db> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("DB unavailable in test");
  return d;
}

async function rawRows(customerId: number) {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  const rows = await d.execute(
    sql`SELECT * FROM ux_events WHERE "customerId" = ${customerId} ORDER BY "createdAt", id`
  );
  return ((rows as any).rows ?? (rows as any)) as Array<Record<string, unknown>>;
}

type UxRouter = (typeof import("../memberUxEvents"))["memberUxEventsRouter"];
let uxA: ReturnType<UxRouter["createCaller"]>;
let uxB: typeof uxA;
let uxAnon: typeof uxA;
let uxAdmin: typeof uxA;

function ctxFor(userId: number) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `member-${userId}`, role: "user", email: `m${userId}@example.io` } as never,
  });
}

const UUID_A = "11111111-1111-4111-8111-111111111111";
const SESSION_A = "22222222-2222-4222-8222-222222222222";

let seq = 0;
function uuid(): string {
  seq += 1;
  const hex = seq.toString(16).padStart(12, "0");
  return `33333333-3333-4333-8${hex.slice(0, 3)}-${hex}`;
}

function ev(overrides: Record<string, unknown> = {}) {
  return {
    clientEventId: uuid(),
    sessionId: SESSION_A,
    flow: "bill_pay",
    event: "form_started" as const,
    ...overrides,
  };
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberUxEventsRouter } = await import("../memberUxEvents");
  uxA = memberUxEventsRouter.createCaller(ctxFor(A_USER));
  uxB = memberUxEventsRouter.createCaller(ctxFor(B_USER));
  uxAnon = memberUxEventsRouter.createCaller(makeUnauthenticatedCtx());
  uxAdmin = memberUxEventsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 900, username: "admin-1", role: "admin", email: "a@example.io" } as never,
    })
  );
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
});

describe("W11-B2 ux_events instrumentation", () => {
  it("batch insert persists rows; clientEventId replay is idempotent (no dupes, honest counts)", async () => {
    const batch = [
      ev({ clientEventId: UUID_A, event: "form_started", step: "amount" }),
      ev({
        event: "field_edited",
        fieldName: "meterNumber",
        step: "amount",
        metadataJson: { durationMs: 1200, editCount: 2, corrected: true },
      }),
      ev({ event: "completed", step: "confirm", metadataJson: { totalMs: 9500 } }),
    ];
    const r1 = await uxA.track({ events: batch });
    expect(r1).toEqual({ accepted: 3, duplicates: 0 });
    expect(await rawRows(A_CUSTOMER)).toHaveLength(3);

    // Exact replay of the same batch → nothing double-counted.
    const r2 = await uxA.track({ events: batch });
    expect(r2).toEqual({ accepted: 0, duplicates: 3 });
    expect(await rawRows(A_CUSTOMER)).toHaveLength(3);

    // Mixed replay (1 old + 1 new) → only the new one lands.
    const r3 = await uxA.track({ events: [batch[0], ev()] });
    expect(r3).toEqual({ accepted: 1, duplicates: 1 });
    expect(await rawRows(A_CUSTOMER)).toHaveLength(4);
  });

  it("zod rejects oversized batches, PII-smuggling metadata, bad event kinds, non-uuid ids, unknown keys", async () => {
    // Batch > 20 rejected wholesale.
    await expect(
      uxA.track({ events: Array.from({ length: 21 }, () => ev()) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Long string value (> 64 chars) — classic PII-smuggling vector.
    await expect(
      uxA.track({
        events: [ev({ metadataJson: { note: "x".repeat(65) } })],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Nested object metadata rejected.
    await expect(
      uxA.track({
        events: [ev({ metadataJson: { nested: { deep: 1 } } })],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // > 20 metadata keys rejected.
    await expect(
      uxA.track({
        events: [
          ev({
            metadataJson: Object.fromEntries(
              Array.from({ length: 21 }, (_, i) => [`k${i}`, i])
            ),
          }),
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Invalid event kind.
    await expect(
      uxA.track({ events: [ev({ event: "password_captured" })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Non-uuid clientEventId.
    await expect(
      uxA.track({ events: [ev({ clientEventId: "not-a-uuid" })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Unknown envelope key (.strict).
    await expect(
      uxA.track({ events: [ev()], sneaky: true } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // fieldName still bounded at 64 (names only, never values).
    await expect(
      uxA.track({ events: [ev({ fieldName: "f".repeat(65) })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Nothing from the rejected batches was persisted.
    expect(await rawRows(A_CUSTOMER)).toHaveLength(4);
  });

  it("anonymous callers are UNAUTHORIZED on all procs", async () => {
    await expect(uxAnon.track({ events: [ev()] })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(uxAnon.mySummary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      uxAnon.adminFunnel({
        from: new Date(Date.now() - 86400_000),
        to: new Date(),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("mySummary is caller-scoped: B never sees A's events (mutant probe: removing the ownership predicate turns this red)", async () => {
    await uxB.track({
      events: [ev({ event: "form_started", flow: "kyc_submit" })],
    });
    const summaryB = await uxB.mySummary();
    expect(summaryB.days).toBe(30);
    // B has exactly one flow bucket of their own; A's bill_pay rows must
    // never appear in B's summary.
    expect(summaryB.total).toBe(1);
    expect(summaryB.byFlowEvent).toEqual([
      { flow: "kyc_submit", event: "form_started", count: 1 },
    ]);
    const summaryA = await uxA.mySummary();
    expect(summaryA.total).toBe(4);
    expect(summaryA.byFlowEvent).toContainEqual({
      flow: "bill_pay",
      event: "completed",
      count: 1,
    });
  });

  it("rate limit: PG-count guard trips at the 500/hour boundary", async () => {
    const { sql } = await import("drizzle-orm");
    const d = await db();
    // Seed B to 497 events in the current hour (direct SQL — bulk setup,
    // not the production path under test). With B's 1 earlier kyc_submit
    // event, B is at 498 in the window.
    const values = Array.from({ length: 497 }, () => {
      const id = uuid();
      return `(${B_CUSTOMER}, '${SESSION_A}', 'bill_pay', 'field_edited', NULL, NULL, NULL, '${id}', now())`;
    });
    for (let i = 0; i < values.length; i += 100) {
      await d.execute(
        sql.raw(
          `INSERT INTO ux_events ("customerId", "sessionId", "flow", "event", "fieldName", "step", "metadataJson", "clientEventId", "createdAt") VALUES ${values
            .slice(i, i + 100)
            .join(",")}`
        )
      );
    }
    // Boundary-minus: 498 + 2 = 500 → allowed.
    const ok = await uxB.track({ events: [ev(), ev()] });
    expect(ok).toEqual({ accepted: 2, duplicates: 0 });
    // Boundary-plus: 500 + 1 > 500 → TOO_MANY_REQUESTS, nothing persisted.
    await expect(uxB.track({ events: [ev()] })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(await rawRows(B_CUSTOMER)).toHaveLength(500); // 1 earlier + 497 + 2
  });

  it("adminFunnel: member → FORBIDDEN; admin gets correct aggregate buckets (no row-level data)", async () => {
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 60_000);
    await expect(uxA.adminFunnel({ from, to })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const funnel = await uxAdmin.adminFunnel({ from, to });
    // Exact expected bucket set (A: 4 events; B: 501 events):
    //   bill_pay/amount/form_started   1 (A)
    //   bill_pay/null/form_started     3 (A mixed-replay 1 + B boundary 2)
    //   bill_pay/amount/field_edited   1 (A)
    //   bill_pay/null/field_edited   498 (B seeded)
    //   bill_pay/confirm/completed     1 (A)
    //   kyc_submit/null/form_started   1 (B)
    expect(funnel.buckets).toHaveLength(6);
    expect(funnel.buckets).toContainEqual({
      flow: "bill_pay", step: "amount", event: "form_started", count: 1,
    });
    expect(funnel.buckets).toContainEqual({
      flow: "bill_pay", step: null, event: "form_started", count: 3,
    });
    expect(funnel.buckets).toContainEqual({
      flow: "bill_pay", step: "amount", event: "field_edited", count: 1,
    });
    expect(funnel.buckets).toContainEqual({
      flow: "bill_pay", step: null, event: "field_edited", count: 497,
    });
    expect(funnel.buckets).toContainEqual({
      flow: "bill_pay", step: "confirm", event: "completed", count: 1,
    });
    expect(funnel.buckets).toContainEqual({
      flow: "kyc_submit", step: null, event: "form_started", count: 1,
    });
    // Shape is aggregate-only: no customerId / sessionId / metadata leaks.
    for (const b of funnel.buckets) {
      expect(Object.keys(b).sort()).toEqual(["count", "event", "flow", "step"]);
    }
    // Flow filter narrows the aggregate.
    const kycOnly = await uxAdmin.adminFunnel({ from, to, flow: "kyc_submit" });
    expect(kycOnly.buckets).toHaveLength(1);
    expect(kycOnly.buckets[0].flow).toBe("kyc_submit");
    // Inverted range rejected.
    await expect(
      uxAdmin.adminFunnel({ from: to, to: from })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
