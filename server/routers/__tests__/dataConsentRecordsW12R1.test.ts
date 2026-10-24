/**
 * dataConsentRecordsW12R1.test.ts — W12-R1 consent CRUD repair (2026-10-25)
 *
 * Acceptance tests for the dataConsentRecordsCrud repair: 4 of 6
 * procedures previously 500'd (list/getComplianceStatus filtered
 * userAgent text = integer userId; grantConsent inserted non-existent
 * userId/status/expiresAt columns and omitted notNull granted/
 * entityType/entityId; withdrawConsent SET a non-existent
 * withdrawalReason column). After the repair:
 *   - grant writes a fully-typed row (entityType "customer",
 *     entityId=userId, granted=true) and supersedes prior active rows for
 *     the same (entityType, entityId, consentType), matching the
 *     gdprDashboard writer pattern.
 *   - withdraw sets granted=false + revokedAt + withdrawalReason.
 *   - list is scoped by (entityType, entityId) — cross-member isolation.
 *   - getComplianceStatus derives active = granted AND revokedAt IS NULL
 *     AND (expiresAt IS NULL OR expiresAt > now()).
 *   - gdprDashboard-written rows (expiresAt NULL) classify ACTIVE.
 *
 * REAL PGlite PostgreSQL. Base table from the REAL migration
 * drizzle/0032_outstanding_gamora.sql (data_consent_records segment) plus
 * the REAL W12-R1 migration drizzle/0092_consent_expiry_withdrawal.sql
 * for the two new columns. No doubles on the production path.
 *
 * Ports: PGlite probed from base 24395 (24xxx band only — NEVER the Linux
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
  const port = await probeFreePort(24395);
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

const USER_A = 9101;
const USER_B = 9102;

async function createTables() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  // Base table — verbatim from the REAL migration
  // drizzle/0032_outstanding_gamora.sql (data_consent_records segment).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "data_consent_records" (
      "id" serial PRIMARY KEY NOT NULL,
      "entity_type" text NOT NULL,
      "entity_id" integer NOT NULL,
      "consent_type" text NOT NULL,
      "granted" boolean NOT NULL,
      "granted_at" timestamp,
      "revoked_at" timestamp,
      "ip_address" text,
      "user_agent" text,
      "version" integer DEFAULT 1,
      "created_at" timestamp DEFAULT now()
    )`);
  // REAL W12-R1 migration for the two new columns.
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, "../../../drizzle/0092_consent_expiry_withdrawal.sql"),
    "utf8"
  );
  await db.execute(sql.raw(migrationSql));
}

async function rawRows(entityId?: number) {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) throw new Error("DB unavailable in test");
  const rows =
    entityId === undefined
      ? await d.execute(sql`SELECT * FROM data_consent_records ORDER BY id`)
      : await d.execute(
          sql`SELECT * FROM data_consent_records WHERE entity_id = ${entityId} ORDER BY id`
        );
  return ((rows as any).rows ?? (rows as any)) as Array<Record<string, any>>;
}

type ConsentRouter =
  (typeof import("../dataConsentRecordsCrud"))["dataConsentRecordsRouter"];
let caller: ReturnType<ConsentRouter["createCaller"]>; // admin (act-as path)
let memberA: ReturnType<ConsentRouter["createCaller"]>; // member USER_A
let memberB: ReturnType<ConsentRouter["createCaller"]>; // member USER_B

beforeAll(async () => {
  await startPglite();
  await createTables();
  const { dataConsentRecordsRouter } = await import(
    "../dataConsentRecordsCrud"
  );
  caller = dataConsentRecordsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: 1, username: "admin-1", role: "admin", email: "a@example.io" } as never,
    })
  );
  memberA = dataConsentRecordsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: USER_A, username: "member-a", role: "user", email: "ma@example.io" } as never,
    })
  );
  memberB = dataConsentRecordsRouter.createCaller(
    makeAuthenticatedCtx({
      user: { id: USER_B, username: "member-b", role: "user", email: "mb@example.io" } as never,
    })
  );
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
});

describe("W12-R1 dataConsentRecordsCrud repair", () => {
  it("grantConsent writes a fully-typed active row (was 23502 500)", async () => {
    const r = await caller.grantConsent({
      userId: USER_A,
      consentType: "data_processing",
      ipAddress: "127.0.0.1",
    });
    expect(r.granted).toBe(true);
    expect(r.entityType).toBe("customer");
    expect(r.entityId).toBe(USER_A);
    expect(r.consentType).toBe("data_processing");
    expect(r.grantedAt).toBeTruthy();
    expect(r.revokedAt).toBeNull();
    expect(r.expiresAt).toBeNull();
    expect(r.message).toContain("data_processing");
  });

  it("grantConsent accepts an explicit expiresAt", async () => {
    const future = new Date(Date.now() + 30 * 86400000);
    const r = await caller.grantConsent({
      userId: USER_A,
      consentType: "marketing",
      expiresAt: future,
    });
    expect(new Date(r.expiresAt!).getTime()).toBeCloseTo(future.getTime(), -3);
  });

  it("duplicate grant supersedes the prior active row (old revokedAt set)", async () => {
    const first = await caller.grantConsent({
      userId: USER_A,
      consentType: "analytics",
    });
    const second = await caller.grantConsent({
      userId: USER_A,
      consentType: "analytics",
    });
    expect(second.id).not.toBe(first.id);
    const rows = (await rawRows(USER_A)).filter(
      r => r.consent_type === "analytics"
    );
    expect(rows).toHaveLength(2);
    const old = rows.find(r => r.id === first.id)!;
    const fresh = rows.find(r => r.id === second.id)!;
    expect(old.revoked_at).not.toBeNull();
    expect(fresh.revoked_at).toBeNull();
    expect(fresh.granted).toBe(true);
  });

  it("withdrawConsent sets granted=false + revokedAt + reason (was SET-empty 500)", async () => {
    const granted = await caller.grantConsent({
      userId: USER_A,
      consentType: "biometric",
    });
    const r = await caller.withdrawConsent({
      id: granted.id,
      reason: "user requested erasure",
    });
    expect(r.success).toBe(true);
    const [row] = (await rawRows(USER_A)).filter(x => x.id === granted.id);
    expect(row.granted).toBe(false);
    expect(row.revoked_at).not.toBeNull();
    expect(row.withdrawal_reason).toBe("user requested erasure");
  });

  it("withdrawConsent without reason stores NULL withdrawal_reason", async () => {
    const granted = await caller.grantConsent({
      userId: USER_A,
      consentType: "third_party_sharing",
    });
    await caller.withdrawConsent({ id: granted.id });
    const [row] = (await rawRows(USER_A)).filter(x => x.id === granted.id);
    expect(row.granted).toBe(false);
    expect(row.withdrawal_reason).toBeNull();
  });

  it("withdrawConsent on a missing id is NOT_FOUND", async () => {
    await expect(
      caller.withdrawConsent({ id: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("list is scoped by userId — cross-member isolation (was text=integer 500)", async () => {
    await caller.grantConsent({ userId: USER_B, consentType: "marketing" });
    const listA = await caller.list({ userId: USER_A });
    const listB = await caller.list({ userId: USER_B });
    expect(listA.items.length).toBeGreaterThan(0);
    expect(listA.items.every(r => r.entityId === USER_A)).toBe(true);
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0].entityId).toBe(USER_B);
    expect(listB.total).toBe(1);
    // consentType filter still composes.
    const filtered = await caller.list({
      userId: USER_A,
      consentType: "data_processing",
    });
    expect(
      filtered.items.every(r => r.consentType === "data_processing")
    ).toBe(true);
  });

  it("list isExpired flag is computed from the real expiresAt column", async () => {
    const past = await caller.grantConsent({
      userId: USER_B,
      consentType: "analytics",
      expiresAt: new Date(Date.now() - 86400000),
    });
    const list = await caller.list({ userId: USER_B, consentType: "analytics" });
    const item = list.items.find(r => r.id === past.id)!;
    expect(item.isExpired).toBe(true);
    const noExpiry = list.items.find(r => !r.expiresAt);
    if (noExpiry) expect(noExpiry.isExpired).toBe(false);
  });

  it("getComplianceStatus: active / expired / revoked matrix (was text=integer 500)", async () => {
    const USER_C = 9103;
    // active (no expiry)
    await caller.grantConsent({ userId: USER_C, consentType: "data_processing" });
    // expired (expiresAt in the past)
    await caller.grantConsent({
      userId: USER_C,
      consentType: "marketing",
      expiresAt: new Date(Date.now() - 86400000),
    });
    // revoked
    const revoked = await caller.grantConsent({
      userId: USER_C,
      consentType: "analytics",
    });
    await caller.withdrawConsent({ id: revoked.id, reason: "x" });
    // future expiry → still active
    await caller.grantConsent({
      userId: USER_C,
      consentType: "biometric",
      expiresAt: new Date(Date.now() + 86400000),
    });
    const status = await caller.getComplianceStatus({ userId: USER_C });
    expect(status.activeConsents).toBe(2); // data_processing + biometric
    expect(status.missingConsents).toContain("marketing"); // expired
    expect(status.missingConsents).toContain("analytics"); // revoked
    expect(status.missingConsents).not.toContain("data_processing");
    expect(status.missingConsents).not.toContain("biometric");
    expect(status.isCompliant).toBe(true); // data_processing active
  });

  it("getComplianceStatus: missing data_processing → not compliant", async () => {
    const USER_D = 9104;
    await caller.grantConsent({ userId: USER_D, consentType: "marketing" });
    const status = await caller.getComplianceStatus({ userId: USER_D });
    expect(status.isCompliant).toBe(false);
    expect(status.missingConsents).toContain("data_processing");
  });

  it("regression: gdprDashboard-written rows (no expiresAt) classify ACTIVE", async () => {
    const USER_E = 9105;
    const { getDb } = await import("../../db");
    const { dataConsentRecords } = await import("../../../drizzle/schema");
    const db = (await getDb())!;
    // Verbatim gdprDashboard writer shape (gdprDashboard.ts:452-461).
    await db.insert(dataConsentRecords).values({
      entityType: "customer",
      entityId: USER_E,
      consentType: "data_processing",
      granted: true,
      grantedAt: new Date(),
      ipAddress: "127.0.0.1",
    });
    const status = await caller.getComplianceStatus({ userId: USER_E });
    expect(status.activeConsents).toBe(1);
    expect(status.isCompliant).toBe(true);
    const list = await caller.list({ userId: USER_E });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].isExpired).toBe(false);
  });

  it("getById returns a row; delete removes it (unchanged behavior)", async () => {
    const granted = await caller.grantConsent({
      userId: USER_B,
      consentType: "data_processing",
    });
    const fetched = await caller.getById({ id: granted.id });
    expect(fetched.id).toBe(granted.id);
    await expect(caller.getById({ id: 999999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const del = await caller.delete({ id: granted.id });
    expect(del.success).toBe(true);
    await expect(caller.getById({ id: granted.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("router source contains no `as any` escapes", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../dataConsentRecordsCrud.ts"),
      "utf8"
    );
    const codeOnly = src
      .split("\n")
      .filter(l => !l.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toContain("as any");
  });
});

describe("W12-R1 F1: fail-closed caller-identity authz", () => {
  it("member identity comes from ctx — own grant/list/status work without act-as", async () => {
    const g = await memberA.grantConsent({
      userId: USER_A,
      consentType: "data_processing",
    });
    expect(g.entityId).toBe(USER_A);
    const list = await memberA.list({});
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every(r => r.entityId === USER_A)).toBe(true);
    const status = await memberA.getComplianceStatus({ userId: USER_A });
    expect(status.userId).toBe(USER_A);
  });

  it("member passing a FOREIGN userId is FORBIDDEN (list/grant/status)", async () => {
    await expect(
      memberA.list({ userId: USER_B })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      memberA.grantConsent({ userId: USER_B, consentType: "marketing" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      memberA.getComplianceStatus({ userId: USER_B })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("member cannot withdraw/getById/delete ANOTHER member's row (non-enumerating NOT_FOUND)", async () => {
    const foreign = await memberB.grantConsent({
      userId: USER_B,
      consentType: "analytics",
    });
    await expect(
      memberA.withdrawConsent({ id: foreign.id, reason: "hostile" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(memberA.getById({ id: foreign.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(memberA.delete({ id: foreign.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Row untouched.
    const [row] = (await rawRows(USER_B)).filter(x => x.id === foreign.id);
    expect(row.granted).toBe(true);
    expect(row.revoked_at).toBeNull();
  });

  it("member delete on a MISSING row is NOT_FOUND (no silent success oracle)", async () => {
    await expect(memberA.delete({ id: 999998 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("member CAN withdraw/getById/delete their OWN row", async () => {
    const own = await memberA.grantConsent({
      userId: USER_A,
      consentType: "marketing",
    });
    const fetched = await memberA.getById({ id: own.id });
    expect(fetched.id).toBe(own.id);
    const w = await memberA.withdrawConsent({ id: own.id, reason: "mine" });
    expect(w.success).toBe(true);
    const d = await memberA.delete({ id: own.id });
    expect(d.success).toBe(true);
    await expect(memberA.getById({ id: own.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("admin act-as path still works (list/grant/status/withdraw/delete for any member)", async () => {
    const g = await caller.grantConsent({
      userId: USER_B,
      consentType: "biometric",
    });
    expect(g.entityId).toBe(USER_B);
    const list = await caller.list({ userId: USER_B });
    expect(list.items.every(r => r.entityId === USER_B)).toBe(true);
    const status = await caller.getComplianceStatus({ userId: USER_B });
    expect(status.userId).toBe(USER_B);
    const w = await caller.withdrawConsent({ id: g.id, reason: "admin" });
    expect(w.success).toBe(true);
    const d = await caller.delete({ id: g.id });
    expect(d.success).toBe(true);
  });

  it("F3 probe (verifier M1): granted=false + revokedAt NULL classifies INACTIVE", async () => {
    // Mutant guard: dropping `!r.revokedAt` from the active predicate must
    // turn this test RED (granted=false alone must suffice for INACTIVE,
    // and granted=true alone must NOT).
    const USER_F = 9106;
    const { getDb } = await import("../../db");
    const { dataConsentRecords } = await import("../../../drizzle/schema");
    const db = (await getDb())!;
    await db.insert(dataConsentRecords).values([
      {
        entityType: "customer",
        entityId: USER_F,
        consentType: "marketing",
        granted: false,
        grantedAt: new Date(),
        // revokedAt deliberately NULL
      },
      {
        entityType: "customer",
        entityId: USER_F,
        consentType: "analytics",
        granted: true,
        grantedAt: new Date(),
        revokedAt: new Date(), // granted=true but revoked
      },
    ]);
    const status = await caller.getComplianceStatus({ userId: USER_F });
    expect(status.activeConsents).toBe(0);
    expect(status.missingConsents).toContain("marketing");
    expect(status.missingConsents).toContain("analytics");
    expect(status.isCompliant).toBe(false);
  });
});
