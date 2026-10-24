/**
 * memberUxEventsW11B4b.test.ts — W11-B4b fix-forward (2026-10-25)
 *
 * Acceptance tests for the UX_EVENT_KINDS enum extension
 * (server/routers/memberUxEvents.ts): the four omnibox/intent-flow kinds —
 * "omnibox_opened", "intent_parsed", "prefill_applied", "clarify_shown" —
 * are already emitted by merged client code and were previously fail-silent
 * rejected by the zod enum. After the extension they must be ACCEPTED and
 * STORED. Unknown kinds must still be rejected, and the metadata scrub
 * rules (<= 20 keys, <= 64-char strings, no nesting) still apply to them.
 *
 * REAL PGlite PostgreSQL; schema applied via the REAL migration
 * drizzle/0091_ux_events.sql. No doubles on the production path.
 *
 * Ports: PGlite probed from base 24394 (24xxx band only — NEVER the Linux
 * ephemeral range 32768-60999).
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
  const port = await probeFreePort(24394);
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

const A_USER = 21;
const A_CUSTOMER = 6211;

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
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0091_ux_events.sql"),
    "utf8"
  );
  await db.execute(sql.raw(migrationSql));
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", email, phone, "keycloakSub", "kycLevel") VALUES
      (${A_CUSTOMER}, 'Ada', 'Okafor', 'ada3@example.io', '09200000021', '21', 3)
    ON CONFLICT DO NOTHING`);
}

async function rawRows(customerId: number) {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) throw new Error("DB unavailable in test");
  const rows = await d.execute(
    sql`SELECT * FROM ux_events WHERE "customerId" = ${customerId} ORDER BY "createdAt", id`
  );
  return ((rows as any).rows ?? (rows as any)) as Array<Record<string, unknown>>;
}

type UxRouter = (typeof import("../memberUxEvents"))["memberUxEventsRouter"];
let uxA: ReturnType<UxRouter["createCaller"]>;
let uxAnon: typeof uxA;

const SESSION = "22222222-2222-4222-8222-222222222222";
let seq = 0;
function uuid(): string {
  seq += 1;
  const hex = seq.toString(16).padStart(12, "0");
  return `33333333-3333-4333-8${hex.slice(0, 3)}-${hex}`;
}

function ev(overrides: Record<string, unknown> = {}) {
  return {
    clientEventId: uuid(),
    sessionId: SESSION,
    flow: "omnibox",
    event: "omnibox_opened",
    ...overrides,
  };
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberUxEventsRouter } = await import("../memberUxEvents");
  uxA = memberUxEventsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: A_USER, username: "member-21", role: "user", email: "m21@example.io" } as never,
    })
  );
  uxAnon = memberUxEventsRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
});

describe("W11-B4b UX_EVENT_KINDS enum extension", () => {
  it("all four new kinds are ACCEPTED and stored (previously fail-silent rejected)", async () => {
    const r = await uxA.track({
      events: [
        ev({ event: "omnibox_opened" }),
        ev({
          event: "intent_parsed",
          metadataJson: { intent: "bill_pay", rail: "bill" },
        }),
        ev({
          event: "prefill_applied",
          metadataJson: { intent: "bill_pay", source: "scan" },
        }),
        ev({
          event: "clarify_shown",
          metadataJson: { intent: "bill_pay", missing: "amount" },
        }),
      ],
    });
    expect(r).toEqual({ accepted: 4, duplicates: 0 });
    const rows = await rawRows(A_CUSTOMER);
    expect(rows).toHaveLength(4);
    expect(rows.map(x => x.event).sort()).toEqual([
      "clarify_shown",
      "intent_parsed",
      "omnibox_opened",
      "prefill_applied",
    ]);
    // Caller-scoped transparency view sees them too.
    const summary = await uxA.mySummary();
    expect(summary.total).toBe(4);
    expect(summary.byFlowEvent).toContainEqual({
      flow: "omnibox",
      event: "intent_parsed",
      count: 1,
    });
  });

  it("unknown kind is STILL rejected", async () => {
    await expect(
      uxA.track({ events: [ev({ event: "image_captured" })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      uxA.track({ events: [ev({ event: "password_captured" })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await rawRows(A_CUSTOMER)).toHaveLength(4);
  });

  it("metadata scrub still applies to the new kinds (PII-smuggling guards)", async () => {
    // > 64-char string value on a new kind → rejected.
    await expect(
      uxA.track({
        events: [ev({ event: "intent_parsed", metadataJson: { raw: "x".repeat(65) } })],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Nested object on a new kind → rejected.
    await expect(
      uxA.track({
        events: [ev({ event: "prefill_applied", metadataJson: { deep: { pii: 1 } } })],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // > 20 keys on a new kind → rejected.
    await expect(
      uxA.track({
        events: [
          ev({
            event: "clarify_shown",
            metadataJson: Object.fromEntries(
              Array.from({ length: 21 }, (_, i) => [`k${i}`, i])
            ),
          }),
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await rawRows(A_CUSTOMER)).toHaveLength(4);
  });

  it("anonymous caller still UNAUTHORIZED for the new kinds", async () => {
    await expect(
      uxAnon.track({ events: [ev({ event: "omnibox_opened" })] })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
