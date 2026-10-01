/**
 * memberIdentity.test.ts — R3 batch 4 (2026-10-01, R3-b4)
 *
 * Real-behavior PGlite tests for server/routers/memberIdentity.ts (harness
 * copied from memberReferrals.test.ts — real embedded PostgreSQL, ephemeral
 * probeFreePort, minimal table projections matching exactly the columns the
 * router touches):
 *   - anonymous caller → UNAUTHORIZED on every proc (protectedProcedure)
 *   - session user with no customer profile → myKycStatus honest "unstarted"
 *     empty state (never fabricated, never enumerating)
 *   - scope isolation: face enrollments keyed by ctx.user.id, never by input
 *   - revoke ownership: foreign enrollmentId → NOT_FOUND, ZERO rows changed;
 *     own id → real row update + biometric_audit_events insert
 *   - PII absence: seeded AES-256-GCM bvn/nin envelopes, raw OCR/liveness
 *     JSON and embeddingVector NEVER appear in any payload (keys or values)
 *   - kycTierRequirements fail-closed: no gateway in the test env →
 *     INTERNAL_SERVER_ERROR (never fabricated tier copy)
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

// Unit-test env: no Permify sidecar (same pattern as memberPolicies /
// memberReferrals); the member authz under test is the router's own scoping.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberIdentity"))["memberIdentityRouter"]["createCaller"]
>;
let memberCaller: Caller; // session user id 1 → customer 4242 (kycLevel 2)
let noProfileCaller: Caller; // session user id 777 → no customers row
let anonCaller: Caller;

// Seeded markers that must NEVER leak into a member payload.
const PII_BVN_ENVELOPE = "pii:v1:SECRETBVNENVELOPE";
const PII_NIN_ENVELOPE = "pii:v1:SECRETNINENVELOPE";
const PII_DOC_ID = "SECRETDOCIDNUMBER";
const PII_EMBEDDING = "SECRETEMBEDDINGVECTOR";

let ownEnrollmentId = 0;
let foreignEnrollmentId = 0;

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

  // Full customers projection (memberReferrals harness shape — the router
  // selects id + kycLevel via customers.keycloakSub).
  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "externalId" varchar(128) UNIQUE,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      email varchar(320),
      phone varchar(20) NOT NULL UNIQUE,
      bvn text,
      nin text,
      bvn_hash varchar(64),
      nin_hash varchar(64),
      "dateOfBirth" text,
      address text,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "kycLevel" integer NOT NULL DEFAULT 0,
      "walletBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "dailyLimit" numeric(15,2) NOT NULL DEFAULT '50000.00',
      "monthlyLimit" numeric(15,2) NOT NULL DEFAULT '300000.00',
      "preferredAgentId" integer,
      "keycloakSub" varchar(128) UNIQUE,
      "passwordHash" varchar(256),
      "refreshToken" text,
      "lastLoginAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // kyc_sessions — full drizzle/schema.ts:1104 column set (the router
  // selects a PII-safe subset; the PII columns exist so the leak test is
  // against a REAL populated row).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kyc_sessions (
      id serial PRIMARY KEY,
      "agentId" integer,
      "customerId" integer,
      "sessionRef" varchar(64) NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      type varchar(32) NOT NULL DEFAULT 'agent_onboarding',
      status varchar(32) NOT NULL DEFAULT 'pending',
      bvn text,
      nin text,
      "selfieUrl" text,
      "idDocUrl" text,
      "idDocType" varchar(32),
      "idDocNumber" varchar(64),
      "livenessScore" numeric(5,2),
      "livenessPassed" boolean,
      "matchScore" numeric(5,2),
      "livenessMethod" varchar(64),
      "livenessChallenge" varchar(128),
      "livenessRaw" json,
      "ocrRaw" json,
      "docType" varchar(32),
      "docExtractedName" varchar(256),
      "docExtractedDob" varchar(32),
      "docExtractedIdNumber" varchar(64),
      "docConfidence" numeric(5,4),
      "docFraudIndicators" json,
      "complianceRecordId" varchar(64),
      "rejectionReason" text,
      "reviewedBy" varchar(64),
      "reviewNote" text,
      "reviewedAt" timestamp,
      "expiresAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // face_enrollments + biometric_audit_events — full schema.ts:4663/4699
  // column sets (revoke inserts an audit row for real).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS face_enrollments (
      id serial PRIMARY KEY,
      "userId" integer NOT NULL,
      "enrollmentType" varchar(32) NOT NULL DEFAULT 'kyc',
      "embeddingVector" text NOT NULL,
      "embeddingVersion" varchar(32) NOT NULL DEFAULT 'arcface_w600k_r50',
      "qualityScore" numeric(5,4),
      "livenessScore" numeric(5,4),
      "antiSpoofScore" numeric(5,4),
      "sourceImageHash" varchar(128),
      "deviceFingerprint" varchar(256),
      "ipAddress" varchar(64),
      "isActive" boolean NOT NULL DEFAULT true,
      "revokedAt" timestamp,
      "revokedReason" text,
      "expiresAt" timestamp,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS biometric_audit_events (
      id serial PRIMARY KEY,
      "sessionId" varchar(128) NOT NULL,
      "userId" integer,
      "eventType" varchar(64) NOT NULL,
      outcome varchar(32) NOT NULL,
      "confidenceScore" numeric(5,4),
      "spoofType" varchar(64),
      "spoofScore" numeric(5,4),
      "livenessMethod" varchar(32),
      "matchScore" numeric(5,4),
      "processingTimeMs" integer,
      "deviceInfo" json,
      "ipAddress" varchar(64),
      "geoLocation" json,
      "errorDetails" text,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, "keycloakSub", "kycLevel", status)
    VALUES
      (4242, 'Member', 'A', '09000000001', '1', 2, 'active'),
      (9999, 'Member', 'B', '09000000002', '2', 0, 'pending_kyc')
    ON CONFLICT DO NOTHING`);

  // Caller 4242's KYC session — populated with REAL encrypted-PII envelopes
  // and raw biometric columns so the payload assertions prove exclusion.
  await db.execute(sql`
    INSERT INTO kyc_sessions
      ("customerId", type, status, bvn, nin, "selfieUrl", "idDocUrl",
       "livenessScore", "livenessPassed", "livenessRaw", "ocrRaw",
       "docType", "docExtractedIdNumber", "docConfidence", "rejectionReason",
       "createdAt", "updatedAt")
    VALUES
      (4242, 'customer_kyc', 'liveness_passed', ${PII_BVN_ENVELOPE},
       ${PII_NIN_ENVELOPE}, 'https://x/selfie', 'https://x/iddoc',
       0.91, true, '{"raw":"liveness"}', '{"raw":"ocr"}',
       'nin_slip', ${PII_DOC_ID}, 0.8831, NULL,
       '2026-09-20', '2026-09-21'),
      (9999, 'customer_kyc', 'rejected', ${PII_BVN_ENVELOPE},
       ${PII_NIN_ENVELOPE}, NULL, NULL,
       NULL, false, NULL, NULL,
       'bvn', ${PII_DOC_ID}, NULL, 'Foreign rejection reason',
       '2026-09-22', '2026-09-23')`);

  // Face enrollments: user 1 (the caller) kyc-active + login-active;
  // user 9999 foreign kyc-active (revoke target for the IDOR test).
  const own = await db.execute(sql`
    INSERT INTO face_enrollments
      ("userId", "enrollmentType", "embeddingVector", "qualityScore",
       "livenessScore", "antiSpoofScore", "sourceImageHash", "isActive")
    VALUES
      (1, 'kyc', ${JSON.stringify([PII_EMBEDDING])}, 0.9, 0.8, 0.7,
       'hash-own', true),
      (1, 'login', ${JSON.stringify([PII_EMBEDDING])}, 0.8, 0.7, 0.6,
       'hash-own2', true)
    RETURNING id`);
  ownEnrollmentId = Number(
    (own as any).rows?.[0]?.id ?? (own as any)[0]?.id
  );
  const foreign = await db.execute(sql`
    INSERT INTO face_enrollments
      ("userId", "enrollmentType", "embeddingVector", "sourceImageHash",
       "isActive")
    VALUES (9999, 'kyc', ${JSON.stringify([PII_EMBEDDING])}, 'hash-foreign', true)
    RETURNING id`);
  foreignEnrollmentId = Number(
    (foreign as any).rows?.[0]?.id ?? (foreign as any)[0]?.id
  );
}

async function activeEnrollmentCount(): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "isActive" = true`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberIdentityRouter } = await import("../memberIdentity");
  memberCaller = memberIdentityRouter.createCaller(makeAuthenticatedCtx());
  noProfileCaller = memberIdentityRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberIdentityRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberIdentity router (2026-10-01, R3-b4)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
    await expect(anonCaller.myKycStatus()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.myMfaStatus()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.kycTierRequirements()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonCaller.myFaceEnrollments()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      anonCaller.myActiveFaceEnrollment({ enrollmentType: "kyc" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.revokeMyFaceEnrollment({
        enrollmentId: ownEnrollmentId,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.checkLivenessCooldown()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("myKycStatus returns the caller's latest session with a PII-safe projection", async () => {
    const result = await memberCaller.myKycStatus();
    expect(result.hasProfile).toBe(true);
    expect(result.hasSession).toBe(true);
    expect(result.status).toBe("liveness_passed");
    expect(result.kycLevel).toBe(2);
    expect(result.session).not.toBeNull();
    expect(result.session!.livenessPassed).toBe(true);
    expect(Number(result.session!.livenessScore)).toBeCloseTo(0.91);
    expect(result.session!.docType).toBe("nin_slip");

    // PII absence: neither the KEYS nor the seeded encrypted-PII VALUES may
    // appear anywhere in the payload.
    const payload = JSON.stringify(result);
    for (const key of [
      "bvn",
      "nin",
      "docExtractedIdNumber",
      "ocrRaw",
      "livenessRaw",
      "selfieUrl",
      "idDocUrl",
      "embeddingVector",
    ]) {
      expect(payload).not.toContain(`"${key}"`);
    }
    for (const value of [
      PII_BVN_ENVELOPE,
      PII_NIN_ENVELOPE,
      PII_DOC_ID,
      PII_EMBEDDING,
    ]) {
      expect(payload).not.toContain(value);
    }
  });

  it("myKycStatus returns an honest 'unstarted' empty state when there is no customer profile", async () => {
    const result = await noProfileCaller.myKycStatus();
    expect(result).toEqual({
      hasProfile: false,
      hasSession: false,
      status: "unstarted",
      kycLevel: 0,
      session: null,
    });
  });

  it("myKycStatus never leaks a foreign customer's session", async () => {
    // Customer 9999 has a seeded 'rejected' session with a distinct reason;
    // the caller (customer 4242) must never see it.
    const result = await memberCaller.myKycStatus();
    expect(JSON.stringify(result)).not.toContain("Foreign rejection reason");
  });

  it("myMfaStatus reports the honest unavailable state (no MFA capability)", async () => {
    const result = await memberCaller.myMfaStatus();
    expect(result.available).toBe(false);
    expect(result.mfaEnabled).toBe(false);
    expect(result.reason).toContain("MFA enrollment is not implemented");
  });

  it("kycTierRequirements fails closed when the enforcement gateway is down", async () => {
    await expect(memberCaller.kycTierRequirements()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("myFaceEnrollments returns only the caller's rows, labelled self-enrolled, no embedding", async () => {
    const rows = await memberCaller.myFaceEnrollments();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.verificationBasis).toBe("self-enrolled");
      expect(row.isActive).toBe(true);
    }
    const types = rows.map(r => r.enrollmentType).sort();
    expect(types).toEqual(["kyc", "login"]);
    const payload = JSON.stringify(rows);
    expect(payload).not.toContain("embeddingVector");
    expect(payload).not.toContain(PII_EMBEDDING);
    expect(payload).not.toContain("hash-foreign");
  });

  it("myActiveFaceEnrollment returns the caller's active row for the requested type only", async () => {
    const kycRow = await memberCaller.myActiveFaceEnrollment({
      enrollmentType: "kyc",
    });
    expect(kycRow).not.toBeNull();
    expect(kycRow!.enrollmentType).toBe("kyc");
    expect(kycRow!.verificationBasis).toBe("self-enrolled");
    const paymentRow = await memberCaller.myActiveFaceEnrollment({
      enrollmentType: "payment",
    });
    expect(paymentRow).toBeNull();
  });

  it("revokeMyFaceEnrollment on a FOREIGN enrollmentId → NOT_FOUND, zero rows changed", async () => {
    const before = await activeEnrollmentCount();
    await expect(
      memberCaller.revokeMyFaceEnrollment({
        enrollmentId: foreignEnrollmentId,
        reason: "not mine",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await activeEnrollmentCount()).toBe(before);
  });

  it("revokeMyFaceEnrollment on the caller's own enrollment updates the real row and writes an audit event", async () => {
    const before = await activeEnrollmentCount();
    const result = await memberCaller.revokeMyFaceEnrollment({
      enrollmentId: ownEnrollmentId,
      reason: "Device replaced",
    });
    expect(result).toEqual({ success: true, id: ownEnrollmentId });
    expect(await activeEnrollmentCount()).toBe(before - 1);

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const row = await db.execute(sql`
      SELECT "isActive", "revokedReason" FROM face_enrollments
      WHERE id = ${ownEnrollmentId}`);
    const r = (row as any).rows?.[0] ?? (row as any)[0];
    expect(r.isActive).toBe(false);
    expect(r.revokedReason).toBe("Device replaced");

    const audit = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM biometric_audit_events
      WHERE "userId" = 1 AND "eventType" = 'enrollment'`);
    expect(Number((audit as any).rows?.[0]?.n ?? (audit as any)[0]?.n)).toBe(1);

    // The revoked row no longer surfaces as active.
    await expect(
      memberCaller.myActiveFaceEnrollment({ enrollmentType: "kyc" })
    ).resolves.toBeNull();
  });

  it("checkLivenessCooldown returns the caller-scoped unlocked state", async () => {
    const result = await memberCaller.checkLivenessCooldown();
    expect(result).toEqual({ locked: false, remainingMs: 0, failures: 0 });
  });
});
