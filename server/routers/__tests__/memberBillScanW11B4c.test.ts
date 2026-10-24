/**
 * memberBillScanW11B4c.test.ts — W11-B4c-1 (2026-10-25)
 *
 * Real-behavior tests for server/routers/memberBillScan.ts (OCR bill-photo
 * intake). REAL PGlite PostgreSQL; the ux_events schema under test is
 * applied by executing the REAL migration drizzle/0091_ux_events.sql.
 *
 * The ONLY double in this file is the OCR provider HTTP boundary:
 * resilientFetch (the fetch wrapper inside server/lib/ocrAdapter.ts) is
 * stubbed via vi.mock — there is no real OCR provider in CI. Everything
 * else (adapter parsing, alias resolution, rate-limit PG counting,
 * telemetry writes) runs the real production code path.
 *
 * Covers:
 *   - Unconfigured env → unavailable/manual_entry, provider never called.
 *   - Stub provider happy path: extraction with catalog biller alias match
 *     ("Ikeja Electric" → IKEDC), verbatim meter/amount passthrough.
 *   - confidence < 0.6 → low_confidence/manual_entry, no prefill.
 *   - Provider throw (timeout/error) → error/manual_entry, no prefill.
 *   - Malformed base64 rejected by zod (BAD_REQUEST).
 *   - Rate limit: 30 bill_scan rows in the window → TOO_MANY_REQUESTS;
 *     cross-member accounting (member A's scans never count against B).
 *   - NO image persistence: storagePut never called; the ONLY DB write is
 *     the privacy-minimal ux_events telemetry row (flow "bill_scan",
 *     metadata {rail, outcome}) — the extracted meter number appears in
 *     NO persisted row and NO log assertion is possible beyond the row scan.
 *   - NO funds writes: the test schema contains NO funds/payment tables at
 *     all, so any funds write would hard-error; we also assert the only
 *     table that gained rows is ux_events.
 *   - Unknown biller text → omitted from prefill (never a guess).
 *
 * Ports: PGlite probed from base 24394 (24394-24399 band only — NEVER the
 * Linux ephemeral range 32768-60999).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";

// ── Stub ONLY the OCR provider HTTP boundary ────────────────────────────────
const resilientFetchMock = vi.fn();
vi.mock("../../lib/resilientFetch", () => ({
  resilientFetch: (...args: unknown[]) => resilientFetchMock(...args),
}));

let pgliteChild: ChildProcess | null = null;

/** Ports must avoid the Linux ephemeral range (32768-60999) — 24xxx band. */
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

/** Member A: users.id 11 ↔ customers.id 5211. Member B: 12 ↔ 5212. */
const A_USER = 11;
const A_CUSTOMER = 5211;
const B_USER = 12;
const B_CUSTOMER = 5212;

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
  // The REAL W11-B2 migration — ux_events is the scan telemetry ledger.
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0091_ux_events.sql"),
    "utf8"
  );
  await db.execute(sql.raw(migrationSql));
  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", email, phone, "keycloakSub", "kycLevel") VALUES
      (${A_CUSTOMER}, 'Ada', 'Okafor', 'ada2@example.io', '09100000011', '11', 3),
      (${B_CUSTOMER}, 'Bala', 'Yusuf', 'bala2@example.io', '09100000012', '12', 3)
    ON CONFLICT DO NOTHING`);
}

type Db = NonNullable<Awaited<ReturnType<(typeof import("../../db"))["getDb"]>>>;
async function db(): Promise<Db> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("DB unavailable in test");
  return d;
}

async function scanRows(customerId: number) {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  const rows = await d.execute(
    sql`SELECT * FROM ux_events WHERE "customerId" = ${customerId} AND flow = 'bill_scan' ORDER BY id`
  );
  return ((rows as any).rows ?? (rows as any)) as Array<Record<string, unknown>>;
}

type ScanRouter = (typeof import("../memberBillScan"))["memberBillScanRouter"];
let scanA: ReturnType<ScanRouter["createCaller"]>;
let scanB: typeof scanA;
let scanAnon: typeof scanA;

function ctxFor(userId: number) {
  return makeAuthenticatedCtx({
    user: { id: userId, username: `member-${userId}`, role: "user", email: `m${userId}@example.io` } as never,
  });
}

/** Valid base64 payload >= 100 chars (deterministic, in-memory only). */
const IMAGE = Buffer.from("fake-bill-image-bytes".repeat(20)).toString("base64");

const HAPPY_FIELDS = {
  biller: "Ikeja Electric",
  customerNumber: "12345678901",
  amountKobo: 500_000,
  confidence: 0.92,
};

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberBillScanRouter } = await import("../memberBillScan");
  scanA = memberBillScanRouter.createCaller(ctxFor(A_USER));
  scanB = memberBillScanRouter.createCaller(ctxFor(B_USER));
  scanAnon = memberBillScanRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
});

beforeEach(() => {
  resilientFetchMock.mockReset();
  delete process.env.OCR_PROVIDER_URL;
  delete process.env.OCR_API_KEY;
});

function configureOcr() {
  process.env.OCR_PROVIDER_URL = "https://ocr.example.test/scan";
  process.env.OCR_API_KEY = "test-key";
}

describe("W11-B4c-1 memberBillScan.parse", () => {
  it("unconfigured env → unavailable/manual_entry; provider never called; telemetry row records the honest outcome", async () => {
    const r = await scanA.parse({ imageBase64: IMAGE, rail: "bill" });
    expect(r.status).toBe("unavailable");
    expect(r.mode).toBe("manual_entry");
    expect(r.prefill).toBeUndefined();
    expect(r.message).toMatch(/not configured/i);
    expect(resilientFetchMock).not.toHaveBeenCalled();
    const rows = await scanRows(A_CUSTOMER);
    expect(rows).toHaveLength(1);
    expect(rows[0].flow).toBe("bill_scan");
    expect((rows[0].metadataJson as any).outcome).toBe("unavailable");
    expect((rows[0].metadataJson as any).rail).toBe("bill");
  });

  it("happy path: catalog biller alias match + verbatim meter/amount; mode=prefill", async () => {
    configureOcr();
    resilientFetchMock.mockResolvedValue({ fields: HAPPY_FIELDS });
    const r = await scanA.parse({ imageBase64: IMAGE, rail: "bill" });
    expect(r.status).toBe("ok");
    expect(r.mode).toBe("prefill");
    expect(r.confidence).toBe(0.92);
    expect(r.prefill).toEqual({
      billerCode: "IKEDC", // alias match, same table as the omnibox parser
      customerNumber: "12345678901",
      amountKobo: 500_000,
    });
    // The provider received the image and the rail-scoped extraction schema.
    expect(resilientFetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((resilientFetchMock.mock.calls[0][1] as any).body);
    expect(body.imageBase64).toBe(IMAGE);
    expect(body.rail).toBe("bill");
    // The scan telemetry rows carry NO PII: no meter number, no image.
    // (ux_events.id is a uuid — not insertion-ordered — so match by outcome.)
    const rows = await scanRows(A_CUSTOMER);
    const okRows = rows.filter(
      x => (x.metadataJson as any).outcome === "ok"
    );
    expect(okRows).toHaveLength(1);
    for (const x of rows) {
      expect(JSON.stringify(x)).not.toContain("12345678901");
      expect(JSON.stringify(x)).not.toContain(IMAGE.slice(0, 64));
    }
  });

  it("low confidence (< 0.6) → low_confidence/manual_entry with NO prefill", async () => {
    configureOcr();
    resilientFetchMock.mockResolvedValue({
      fields: { ...HAPPY_FIELDS, confidence: 0.4 },
    });
    const r = await scanA.parse({ imageBase64: IMAGE, rail: "bill" });
    expect(r.status).toBe("low_confidence");
    expect(r.mode).toBe("manual_entry");
    expect(r.confidence).toBe(0.4);
    expect(r.prefill).toBeUndefined();
  });

  it("provider throw (timeout/error) → error/manual_entry, fail-closed, nothing fabricated", async () => {
    configureOcr();
    resilientFetchMock.mockRejectedValue(new Error("ETIMEDOUT after 8000ms"));
    const r = await scanA.parse({ imageBase64: IMAGE, rail: "airtime" });
    expect(r.status).toBe("error");
    expect(r.mode).toBe("manual_entry");
    expect(r.prefill).toBeUndefined();
    expect(r.message).toMatch(/ETIMEDOUT/);
  });

  it("malformed base64 rejected by zod; unknown biller never guessed", async () => {
    configureOcr();
    await expect(
      scanA.parse({ imageBase64: "!!!not-base64!!!".repeat(20), rail: "bill" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      scanA.parse({ imageBase64: "short", rail: "bill" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Unrecognised biller → omitted from prefill (never a nearest-guess).
    resilientFetchMock.mockResolvedValue({
      fields: { ...HAPPY_FIELDS, biller: "Totally Unknown Disco Plc" },
    });
    const r = await scanA.parse({ imageBase64: IMAGE, rail: "bill" });
    expect(r.status).toBe("ok");
    expect(r.prefill?.billerCode).toBeUndefined();
    expect(r.prefill?.customerNumber).toBe("12345678901");
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    await expect(
      scanAnon.parse({ imageBase64: IMAGE, rail: "bill" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("NO image persistence (storagePut never called) and NO funds writes (only ux_events gained rows)", async () => {
    const storage = await import("../../storage");
    const putSpy = vi.spyOn(storage, "storagePut");
    const { sql } = await import("drizzle-orm");
    const d = await db();
    const tableCount = async (t: string) => {
      const r = await d.execute(sql.raw(`SELECT count(*)::int AS n FROM ${t}`));
      return Number(((r as any).rows ?? r)[0].n);
    };
    // The test schema deliberately contains ONLY customers + ux_events —
    // any funds/payment insert would hard-error (no such table).
    const tables = await d.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const names = (((tables as any).rows ?? tables) as any[]).map(r => r.tablename);
    expect(names.sort()).toEqual(["customers", "ux_events"]);

    const customersBefore = await tableCount("customers");
    configureOcr();
    resilientFetchMock.mockResolvedValue({ fields: HAPPY_FIELDS });
    await scanA.parse({ imageBase64: IMAGE, rail: "bill" });
    expect(putSpy).not.toHaveBeenCalled();
    expect(await tableCount("customers")).toBe(customersBefore);
    putSpy.mockRestore();
  });

  it("rate limit: 30/hour per member, cross-member accounting is isolated", async () => {
    // Seed B at exactly 30 bill_scan rows in the window (direct SQL — bulk
    // setup, not the production path under test).
    const { sql } = await import("drizzle-orm");
    const d = await db();
    const values = Array.from(
      { length: 30 },
      (_, i) =>
        `(${B_CUSTOMER}, '00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}', 'bill_scan', 'completed', NULL, NULL, '{"rail":"bill","outcome":"ok"}', '10000000-0000-4000-8000-${String(i).padStart(12, "0")}', now())`
    );
    await d.execute(
      sql.raw(
        `INSERT INTO ux_events ("customerId", "sessionId", "flow", "event", "fieldName", "step", "metadataJson", "clientEventId", "createdAt") VALUES ${values.join(",")}`
      )
    );
    // B's 31st scan → TOO_MANY_REQUESTS, and it consumes no budget/row.
    await expect(
      scanB.parse({ imageBase64: IMAGE, rail: "bill" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect((await scanRows(B_CUSTOMER)).length).toBe(30);
    // Cross-member accounting: B's rows never count against A.
    configureOcr();
    resilientFetchMock.mockResolvedValue({ fields: HAPPY_FIELDS });
    const r = await scanA.parse({ imageBase64: IMAGE, rail: "bill" });
    expect(r.status).toBe("ok");
  });
});
