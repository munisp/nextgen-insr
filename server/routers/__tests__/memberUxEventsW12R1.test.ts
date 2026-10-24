/**
 * memberUxEventsW12R1.test.ts — W12-R1 UX_EVENT_KINDS extension (2026-10-25)
 *
 * Acceptance tests for the three bill-scan lifecycle kinds —
 * "scan_started", "scan_succeeded", "scan_failed" — already emitted by
 * merged client code (W11-B4c-2/-3) and previously fail-silent rejected by
 * the zod enum. After the extension they must be ACCEPTED and STORED.
 * bill_scan flow rows already exist server-side from memberBillScan
 * telemetry. Unknown kinds must still be rejected.
 *
 * REAL PGlite PostgreSQL; schema applied via the REAL migration
 * drizzle/0091_ux_events.sql. No doubles on the production path.
 *
 * Ports: PGlite probed from base 24396 (24xxx band only — NEVER the Linux
 * ephemeral range 32768-60999).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeAuthenticatedCtx } from "../../lib/__tests__/testHelpers";

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
  const port = await probeFreePort(24396);
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

const A_USER = 22;
const A_CUSTOMER = 6212;

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
      (${A_CUSTOMER}, 'Bola', 'Ahmed', 'bola@example.io', '09200000022', '22', 3)
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

const SESSION = "44444444-4444-4444-8444-444444444444";
let seq = 0;
function uuid(): string {
  seq += 1;
  const hex = seq.toString(16).padStart(12, "0");
  return `55555555-5555-4555-8${hex.slice(0, 3)}-${hex}`;
}

function ev(overrides: Record<string, unknown> = {}) {
  return {
    clientEventId: uuid(),
    sessionId: SESSION,
    flow: "bill_scan",
    event: "scan_started",
    ...overrides,
  };
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberUxEventsRouter } = await import("../memberUxEvents");
  uxA = memberUxEventsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: A_USER, username: "member-22", role: "user", email: "m22@example.io" } as never,
    })
  );
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
});

describe("W12-R1 UX_EVENT_KINDS scan-kind extension", () => {
  it("all three scan kinds are ACCEPTED and stored (previously fail-silent rejected)", async () => {
    const r = await uxA.track({
      events: [
        ev({ event: "scan_started" }),
        ev({
          event: "scan_succeeded",
          metadataJson: { biller: "ekedc", durationMs: 1800 },
        }),
        ev({
          event: "scan_failed",
          metadataJson: { reason: "blur", durationMs: 950 },
        }),
      ],
    });
    expect(r).toEqual({ accepted: 3, duplicates: 0 });
    const rows = await rawRows(A_CUSTOMER);
    expect(rows).toHaveLength(3);
    expect(rows.map(x => x.event).sort()).toEqual([
      "scan_failed",
      "scan_started",
      "scan_succeeded",
    ]);
    expect(rows.every(x => x.flow === "bill_scan")).toBe(true);
  });

  it("unknown kinds are STILL rejected", async () => {
    await expect(
      uxA.track({ events: [ev({ event: "scan_abandoned" })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      uxA.track({ events: [ev({ event: "image_captured" })] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await rawRows(A_CUSTOMER)).toHaveLength(3);
  });
});
