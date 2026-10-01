/**
 * actuarialRatesAdmin.test.ts — Actuarial Wave stage A1 (2026-10-01, A1)
 *
 * Real-behavior PGlite tests for server/routers/actuarialRatesAdmin.ts
 * (harness copied from memberIdentity.test.ts — real embedded PostgreSQL,
 * ephemeral probeFreePort, minimal faithful projections of rating_tables /
 * rating_factors / audit_log):
 *   - non-admin caller → FORBIDDEN; anonymous → UNAUTHORIZED
 *   - lifecycle: createTable (draft, auto-version) → addFactor → fileTable
 *     (records filedBy) → approveTable (records approvedBy, atomically
 *     retires the previous active table for the same scope) → retireTable
 *   - filed/active immutability: addFactor on a filed table →
 *     PRECONDITION_FAILED; rate change = new version row
 *   - illegal scope (both/neither productCode+coverageClass) → BAD_REQUEST
 *   - lifecycle gates: approve a draft → PRECONDITION_FAILED
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

// Unit-test env: no Permify sidecar (same pattern as memberIdentity); the
// authz under test is the router's own role gate.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../actuarialRatesAdmin"))["actuarialRatesAdminRouter"]["createCaller"]
>;
let adminCaller: Caller; // user id 1, role admin
let memberCaller: Caller; // user id 2, role user
let anonCaller: Caller;

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

async function db() {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("PGlite DB not reachable");
  return d;
}

async function createTables() {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_tables (
      id serial PRIMARY KEY,
      "productCode" text,
      "coverageClass" text,
      "effectiveFrom" timestamp NOT NULL,
      "effectiveTo" timestamp,
      status varchar(16) NOT NULL DEFAULT 'draft',
      version integer NOT NULL,
      "filedBy" integer,
      "approvedBy" integer,
      "naicomFilingRef" text,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_factors (
      id serial PRIMARY KEY,
      "tableId" integer NOT NULL,
      "factorType" varchar(32) NOT NULL,
      "factorKey" text NOT NULL,
      value numeric(18,6) NOT NULL,
      "minClamp" numeric(18,6),
      "maxClamp" numeric(18,6),
      "sortOrder" integer NOT NULL,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  // writeAuditLog target (server/db.ts) — hash-chained columns included.
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status varchar(32) DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
}

async function auditCount(action: string): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const d = await db();
  const r = await d.execute(
    sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = ${action}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTables();
  const { actuarialRatesAdminRouter } = await import("../actuarialRatesAdmin");
  adminCaller = actuarialRatesAdminRouter.createCaller(makeAuthenticatedCtx());
  memberCaller = actuarialRatesAdminRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 2, role: "user", name: "Member" } as any,
    })
  );
  anonCaller = actuarialRatesAdminRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("actuarialRatesAdmin router (2026-10-01, A1)", () => {
  it("rejects anonymous callers with UNAUTHORIZED and non-admin with FORBIDDEN", async () => {
    await expect(anonCaller.listTables()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.createTable({
        productCode: "X",
        effectiveFrom: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(memberCaller.listTables()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      memberCaller.createTable({
        productCode: "X",
        effectiveFrom: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      memberCaller.approveTable({ tableId: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces exactly-one scope key (fail-closed BAD_REQUEST)", async () => {
    await expect(
      adminCaller.createTable({ effectiveFrom: "2026-01-01" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      adminCaller.createTable({
        productCode: "A",
        coverageClass: "B",
        effectiveFrom: "2026-01-01",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("runs the full lifecycle with auto-versioning, provenance, and atomic auto-retire", async () => {
    // v1: create → add factor → file → approve.
    const v1 = await adminCaller.createTable({
      productCode: "MOTOR-COMP",
      effectiveFrom: "2026-01-01",
      naicomFilingRef: "NAICOM/2026/001",
    });
    expect(v1.status).toBe("draft");
    expect(v1.version).toBe(1);
    const f1 = await adminCaller.addFactor({
      tableId: v1.id,
      factorType: "base",
      factorKey: "rate",
      value: 0.03,
      sortOrder: 0,
    });
    expect(f1.factorKey).toBe("rate");

    await expect(
      adminCaller.approveTable({ tableId: v1.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); // draft ≠ filed

    const filed = await adminCaller.fileTable({ tableId: v1.id });
    expect(filed.status).toBe("filed");
    expect(filed.filedBy).toBe(1);

    // Filed tables are immutable — no in-place factor mutation.
    await expect(
      adminCaller.addFactor({
        tableId: v1.id,
        factorType: "ncd",
        factorKey: "default",
        value: 0.8,
        sortOrder: 10,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const approved = await adminCaller.approveTable({ tableId: v1.id });
    expect(approved.approved.status).toBe("active");
    expect(approved.approved.approvedBy).toBe(1);
    expect(approved.retiredIds).toEqual([]);

    // Rate change = NEW version row, never in-place mutation.
    const v2 = await adminCaller.createTable({
      productCode: "MOTOR-COMP",
      effectiveFrom: "2026-07-01",
    });
    expect(v2.version).toBe(2);
    await adminCaller.addFactor({
      tableId: v2.id,
      factorType: "base",
      factorKey: "rate",
      value: 0.025,
      sortOrder: 0,
    });
    await adminCaller.fileTable({ tableId: v2.id });
    const approved2 = await adminCaller.approveTable({ tableId: v2.id });
    // The previously active v1 was retired in the SAME transaction.
    expect(approved2.retiredIds).toEqual([v1.id]);

    const list = await adminCaller.listTables({ productCode: "MOTOR-COMP" });
    const byId = new Map(list.map(t => [t.id, t]));
    expect(byId.get(v1.id)!.status).toBe("retired");
    expect(byId.get(v1.id)!.effectiveTo).not.toBeNull();
    expect(byId.get(v2.id)!.status).toBe("active");

    // Only ONE active table remains for the scope.
    const active = await adminCaller.listTables({
      status: "active",
      productCode: "MOTOR-COMP",
    });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(v2.id);

    // Retire v2; retiring again fails closed.
    const retired = await adminCaller.retireTable({ tableId: v2.id });
    expect(retired.status).toBe("retired");
    await expect(
      adminCaller.retireTable({ tableId: v2.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Audit trail: real hash-chained rows for every mutation.
    expect(await auditCount("RATING_TABLE_CREATE")).toBe(2);
    expect(await auditCount("RATING_FACTOR_ADD")).toBe(2);
    expect(await auditCount("RATING_TABLE_FILE")).toBe(2);
    expect(await auditCount("RATING_TABLE_APPROVE")).toBe(2);
    expect(await auditCount("RATING_TABLE_RETIRE")).toBe(1);
  });

  it("getTable returns the table with its factors; unknown id → NOT_FOUND", async () => {
    const t = await adminCaller.createTable({
      coverageClass: "health",
      effectiveFrom: "2026-01-01",
    });
    await adminCaller.addFactor({
      tableId: t.id,
      factorType: "base",
      factorKey: "rate",
      value: 0.04,
      sortOrder: 0,
    });
    await adminCaller.addFactor({
      tableId: t.id,
      factorType: "age_band",
      factorKey: "18-30",
      value: 1.05,
      minClamp: 1.0,
      maxClamp: 1.2,
      sortOrder: 10,
    });
    const full = await adminCaller.getTable({ tableId: t.id });
    expect(full.coverageClass).toBe("health");
    expect(full.factors).toHaveLength(2);
    expect(Number(full.factors[0].value)).toBeCloseTo(0.04);
    await expect(adminCaller.getTable({ tableId: 999999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
