/**
 * memberIdentityW10B3.test.ts — W10-B3 (2026-10-04)
 *
 * Real-behavior tests for the W10-B3 member identity mutations in
 * server/routers/memberIdentity.ts (submitKyc / startFaceEnrollment /
 * submitFaceEnrollmentFrame / myKycSession + the verificationBasis labeling
 * extension):
 *   REAL embedded PostgreSQL (PGlite wire protocol, memberIdentity.test.ts
 *   harness pattern) + REAL Redis (127.0.0.1:6399, attempt-lockout store via
 *   server/lib/distributedState) + REAL local HTTP wire servers speaking the
 *   enhanced-kyc-kyb, video-kyc liveness and DeepFace response shapes
 *   (ENHANCED_KYC_URL / KYC_SERVICE_URL / DEEPFACE_SERVICE_URL overrides).
 *   The ONLY doubles are the three external HTTP boundaries — nothing on
 *   the production path is mocked.
 *
 * Covers: anonymous → UNAUTHORIZED; no-profile → PRECONDITION_FAILED;
 * service-unconfigured fail-closed with ZERO rows written; duplicate
 * guards (one open KYC submission / one open liveness challenge →
 * CONFLICT); happy path submitKyc → verified ONLY from the service's real
 * adjudication; adjudicated-fail → honest rejected; service down → honest
 * pending; encrypted doc number at rest (never plaintext); authz (member B
 * cannot read/act on A's sessions → NOT_FOUND); zod-strict rejection of
 * client-supplied verified flags/embeddings; liveness single-use
 * challenges; challenge TTL expiry; attempt lockout after 3 failures
 * (Redis-backed); server-computed embedding ONLY (DeepFace unset →
 * enrolled:false, no credential); supersede of self-attested credentials;
 * verificationBasis "server-verified" labeling.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

process.env.PERMIFY_FAIL_OPEN = "true";
// Real Redis attempt-lockout store (no-auth dev instance on 6399).
process.env.REDIS_URL = "redis://127.0.0.1:6399";

let PG_PORT = 0;
let pgliteChild: ChildProcess | null = null;

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

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PGLITE_PORT: String(PG_PORT),
      POSTGRES_URL: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
    },
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
  process.env.POSTGRES_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
}

// ─── Wire servers (ONLY the external HTTP boundaries) ───────────────────────

type WireHandler = (
  body: any,
  path: string
) => { status: number; json: unknown };

let kycWireHandler: WireHandler = () => {
  throw new Error("kyc wire handler not set");
};
let livenessWireHandler: WireHandler = () => {
  throw new Error("liveness wire handler not set");
};
let deepfaceWireHandler: WireHandler = () => {
  throw new Error("deepface wire handler not set");
};

const kycWireRequests: { path: string; body: any }[] = [];
const livenessWireRequests: { path: string; body: any }[] = [];

function startWireServer(handler: () => WireHandler): Promise<{
  server: Server;
  port: number;
}> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      let out: { status: number; json: unknown };
      try {
        out = handler()(raw ? JSON.parse(raw) : {}, req.url ?? "");
      } catch (e) {
        out = { status: 500, json: { error: String(e) } };
      }
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

let kycWire: Server;
let livenessWire: Server;
let deepfaceWire: Server;

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL UNIQUE,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "kycLevel" integer NOT NULL DEFAULT 0,
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
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
      (9999, 'Member', 'B', '09000000002', '2', 0, 'pending_kyc'),
      (5555, 'Member', 'C', '09000000003', '3', 0, 'pending_kyc')
    ON CONFLICT DO NOTHING`);

  // A pre-existing SELF-ATTESTED active kyc credential for user 1 — the
  // server-verified enrollment must supersede it.
  await db.execute(sql`
    INSERT INTO face_enrollments
      ("userId", "enrollmentType", "embeddingVector", "sourceImageHash", "isActive")
    VALUES (1, 'kyc', '[0.1,0.2]', 'hash-self-attested', true)`);
}

async function q(sqlText: ReturnType<typeof sqlTag>) {
  const { getDb } = await import("../../db");
  const db = (await getDb())!;
  const r = await db.execute(sqlText as any);
  return ((r as any).rows ?? r) as any[];
}
import { sql as sqlTag } from "drizzle-orm";

// ─── Callers ────────────────────────────────────────────────────────────────

type Caller = ReturnType<
  (typeof import("../memberIdentity"))["memberIdentityRouter"]["createCaller"]
>;
let callerA: Caller; // user 1 → customer 4242 (face enrollment suite)
let callerB: Caller; // user 2 → customer 9999 (submitKyc suite)
let callerC: Caller; // user 3 → customer 5555 (lockout suite)
let noProfileCaller: Caller; // user 777 → no customer row
let anonCaller: Caller;

const FRAME = `data:image/jpeg;base64,${"QUJD".repeat(100)}`;
const EMBEDDING_512 = Array.from({ length: 512 }, (_, i) => i / 512);

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();

  const k = await startWireServer(() => kycWireHandler);
  kycWire = k.server;
  const l = await startWireServer(() => livenessWireHandler);
  livenessWire = l.server;
  const df = await startWireServer(() => deepfaceWireHandler);
  deepfaceWire = df.server;

  process.env.ENHANCED_KYC_URL = `http://127.0.0.1:${k.port}`;
  process.env.ENHANCED_KYC_API_KEY = "test-api-key-0123456789";
  process.env.KYC_SERVICE_URL = `http://127.0.0.1:${l.port}`;
  // DEEPFACE_SERVICE_URL intentionally left UNSET at boot — the
  // fail-closed embedding test runs first; the happy-path test sets it.
  delete process.env.DEEPFACE_SERVICE_URL;
  process.env.__DEEPFACE_PORT = String(df.port);

  // Redis (6399) persists attempt-lockout state across runs — reset the
  // cooldown keys for the test users so each run starts from a clean slate.
  const { clearCooldown } = await import(
    "../../middleware/livenessSecurityEnhancements"
  );
  await clearCooldown("member-1");
  await clearCooldown("member-2");
  await clearCooldown("member-3");

  const { memberIdentityRouter } = await import("../memberIdentity");
  callerA = memberIdentityRouter.createCaller(makeAuthenticatedCtx());
  callerB = memberIdentityRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 2 } as any })
  );
  callerC = memberIdentityRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 3 } as any })
  );
  noProfileCaller = memberIdentityRouter.createCaller(
    makeAuthenticatedCtx({ user: { id: 777 } as any })
  );
  anonCaller = memberIdentityRouter.createCaller(makeUnauthenticatedCtx());
}, 90_000);

afterAll(async () => {
  pgliteChild?.kill();
  kycWire?.close();
  livenessWire?.close();
  deepfaceWire?.close();
  const { redisClient } = (await import("../../lib/redisClient").catch(
    () => ({}) as any
  )) as any;
  redisClient?.disconnect?.();
});

describe("memberIdentity W10-B3 mutations (2026-10-04)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on every new proc", async () => {
    await expect(
      anonCaller.submitKyc({ docType: "nin", docNumber: "12345678901" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.startFaceEnrollment({ method: "active_blink" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.submitFaceEnrollmentFrame({
        sessionId: 1,
        challengeId: "x",
        frameBase64: FRAME,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.myKycSession({ sessionId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects client-supplied verified flags / embeddings (zod strict)", async () => {
    await expect(
      callerB.submitKyc({
        docType: "nin",
        docNumber: "12345678901",
        verified: true,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerA.submitFaceEnrollmentFrame({
        sessionId: 1,
        challengeId: "x",
        frameBase64: FRAME,
        embeddingVector: EMBEDDING_512,
        livenessScore: 0.99,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("no customer profile → PRECONDITION_FAILED on all mutations", async () => {
    await expect(
      noProfileCaller.submitKyc({ docType: "nin", docNumber: "12345678901" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      noProfileCaller.startFaceEnrollment({ method: "active_blink" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      noProfileCaller.submitFaceEnrollmentFrame({
        sessionId: 1,
        challengeId: "x",
        frameBase64: FRAME,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // ── submitKyc ────────────────────────────────────────────────────────────

  it("submitKyc fails CLOSED with zero rows when the service is unconfigured", async () => {
    const savedUrl = process.env.ENHANCED_KYC_URL;
    const savedKey = process.env.ENHANCED_KYC_API_KEY;
    delete process.env.ENHANCED_KYC_URL;
    delete process.env.ENHANCED_KYC_API_KEY;
    try {
      await expect(
        callerB.submitKyc({ docType: "nin", docNumber: "12345678901" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const rows = await q(
        sqlTag`SELECT COUNT(*)::int AS n FROM kyc_sessions WHERE "customerId" = 9999`
      );
      expect(rows[0].n).toBe(0);
    } finally {
      process.env.ENHANCED_KYC_URL = savedUrl;
      process.env.ENHANCED_KYC_API_KEY = savedKey;
    }
  });

  it("submitKyc happy path: verified ONLY from the service's real adjudication, doc number encrypted at rest", async () => {
    kycWireHandler = body => {
      kycWireRequests.push({ path: "/api/v1/kyc/verify-nin", body });
      expect(body.nin).toBe("12345678901");
      expect(body.full_name).toBe("Member B");
      return {
        status: 200,
        json: { nin: body.nin, verified: true, status: "verified" },
      };
    };
    const res = await callerB.submitKyc({
      docType: "nin",
      docNumber: "12345678901",
    });
    expect(res.verified).toBe(true);
    expect(res.status).toBe("verified");
    expect(res.serviceOutcome).toBe("adjudicated");

    const rows = await q(
      sqlTag`SELECT status, nin, "docType" FROM kyc_sessions WHERE id = ${res.sessionId}`
    );
    expect(rows[0].status).toBe("verified");
    // AES-256-GCM envelope at rest — never the plaintext 11-digit number.
    expect(rows[0].nin).toMatch(/^pii:v1:/);
    expect(rows[0].nin).not.toContain("12345678901");
  });

  it("submitKyc adjudicated-fail → honest rejected with the real service status", async () => {
    kycWireHandler = () => ({
      status: 200,
      json: { nin: "10987654321", verified: false, status: "failed" },
    });
    const res = await callerB.submitKyc({
      docType: "nin",
      docNumber: "10987654321",
    });
    expect(res.verified).toBe(false);
    expect(res.status).toBe("rejected");
    const rows = await q(
      sqlTag`SELECT status, "rejectionReason" FROM kyc_sessions WHERE id = ${res.sessionId}`
    );
    expect(rows[0].status).toBe("rejected");
    expect(rows[0].rejectionReason).toContain('"failed"');
  });

  it("submitKyc service down → honest PENDING (never fabricated), then duplicate guard → CONFLICT", async () => {
    const saved = process.env.ENHANCED_KYC_URL;
    // Point at a closed port — configured but unreachable.
    process.env.ENHANCED_KYC_URL = "http://127.0.0.1:1";
    try {
      const res = await callerB.submitKyc({
        docType: "bvn",
        docNumber: "11111111111",
      });
      expect(res.status).toBe("pending");
      expect(res.verified).toBe(false);
      expect(res.serviceOutcome).toBe("unavailable");
      const rows = await q(
        sqlTag`SELECT status FROM kyc_sessions WHERE id = ${res.sessionId}`
      );
      expect(rows[0].status).toBe("pending");

      // One open session per member — second submit while pending.
      await expect(
        callerB.submitKyc({ docType: "bvn", docNumber: "11111111111" })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // Member A cannot read member B's session (NOT_FOUND, non-enumerating).
      await expect(
        callerA.myKycSession({ sessionId: res.sessionId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Owner can read it, PII-safe projection only.
      const own = await callerB.myKycSession({ sessionId: res.sessionId });
      expect(own.status).toBe("pending");
      expect(JSON.stringify(own)).not.toContain("11111111111");
    } finally {
      process.env.ENHANCED_KYC_URL = saved;
    }
  });

  // ── face enrollment ──────────────────────────────────────────────────────

  it("startFaceEnrollment fails CLOSED with zero rows when the liveness service is unconfigured", async () => {
    const saved = process.env.KYC_SERVICE_URL;
    delete process.env.KYC_SERVICE_URL;
    try {
      await expect(
        callerA.startFaceEnrollment({ method: "active_blink" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const rows = await q(
        sqlTag`SELECT COUNT(*)::int AS n FROM kyc_sessions WHERE "customerId" = 4242 AND type = 'customer_face_enrollment'`
      );
      expect(rows[0].n).toBe(0);
    } finally {
      process.env.KYC_SERVICE_URL = saved;
    }
  });

  let faceSession1: { sessionId: number; challengeId: string };

  it("startFaceEnrollment issues a REAL challenge; duplicate open challenge → CONFLICT", async () => {
    livenessWireHandler = body => {
      livenessWireRequests.push({ path: "/create_challenge", body });
      return {
        status: 200,
        json: {
          challenge_id: "chal-real-1",
          method: body.method,
          instruction: "Blink twice",
        },
      };
    };
    const res = await callerA.startFaceEnrollment({ method: "active_blink" });
    expect(res.challengeId).toBe("chal-real-1");
    expect(res.instruction).toBe("Blink twice");
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
    faceSession1 = res;

    await expect(
      callerA.startFaceEnrollment({ method: "active_blink" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("submitFaceEnrollmentFrame: foreign session → NOT_FOUND; wrong challenge → CONFLICT", async () => {
    await expect(
      callerB.submitFaceEnrollmentFrame({
        sessionId: faceSession1.sessionId,
        challengeId: faceSession1.challengeId,
        frameBase64: FRAME,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerA.submitFaceEnrollmentFrame({
        sessionId: faceSession1.sessionId,
        challengeId: "not-the-challenge",
        frameBase64: FRAME,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("provider FAIL → honest liveness_failed + audit row; replay → CONFLICT (single-use)", async () => {
    livenessWireHandler = () => ({
      status: 200,
      json: { passed: false, score: 0.12, spoofing_detected: true },
    });
    const res = await callerA.submitFaceEnrollmentFrame({
      sessionId: faceSession1.sessionId,
      challengeId: faceSession1.challengeId,
      frameBase64: FRAME,
    });
    expect(res.passed).toBe(false);
    expect(res.enrolled).toBe(false);
    expect(res.status).toBe("liveness_failed");
    expect(res.spoofingDetected).toBe(true);

    const rows = await q(
      sqlTag`SELECT status, "livenessPassed" FROM kyc_sessions WHERE id = ${faceSession1.sessionId}`
    );
    expect(rows[0].status).toBe("liveness_failed");
    const audit = await q(
      sqlTag`SELECT outcome, "eventType" FROM biometric_audit_events WHERE "sessionId" LIKE ${"liveness_member_" + faceSession1.sessionId + "_%"}`
    );
    expect(audit[0].outcome).toBe("fail");

    // Single-use: a decided challenge can never be replayed.
    await expect(
      callerA.submitFaceEnrollmentFrame({
        sessionId: faceSession1.sessionId,
        challengeId: faceSession1.challengeId,
        frameBase64: FRAME,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("provider PASS but DeepFace unconfigured → enrolled:false, NO credential written (fail-closed)", async () => {
    livenessWireHandler = body => {
      if (body.method) {
        return {
          status: 200,
          json: {
            challenge_id: "chal-real-2",
            method: body.method,
            instruction: "Smile",
          },
        };
      }
      return { status: 200, json: { passed: true, score: 0.93 } };
    };
    const started = await callerA.startFaceEnrollment({
      method: "active_smile",
    });
    const res = await callerA.submitFaceEnrollmentFrame({
      sessionId: started.sessionId,
      challengeId: started.challengeId,
      frameBase64: FRAME,
    });
    expect(res.passed).toBe(true);
    expect(res.enrolled).toBe(false);
    expect(res.status).toBe("liveness_passed");
    // Only the seeded self-attested credential exists; nothing new written.
    const creds = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "userId" = 1`
    );
    expect(creds[0].n).toBe(1);
    const active = await callerA.myActiveFaceEnrollment({
      enrollmentType: "kyc",
    });
    expect(active!.verificationBasis).toBe("self-enrolled");
  });

  it("provider PASS + server-computed embedding → REAL credential; self-attested credential superseded; basis server-verified", async () => {
    process.env.DEEPFACE_SERVICE_URL = `http://127.0.0.1:${process.env.__DEEPFACE_PORT}`;
    deepfaceWireHandler = body => {
      expect(body.image_base64).toBe(FRAME);
      return {
        status: 200,
        json: {
          embedding: EMBEDDING_512,
          embedding_dim: 512,
          model: "ArcFace",
        },
      };
    };
    livenessWireHandler = body => {
      if (body.method) {
        return {
          status: 200,
          json: {
            challenge_id: "chal-real-3",
            method: body.method,
            instruction: "Turn left",
          },
        };
      }
      return { status: 200, json: { passed: true, score: 0.91 } };
    };
    const started = await callerA.startFaceEnrollment({
      method: "active_head_movement",
    });
    const res = await callerA.submitFaceEnrollmentFrame({
      sessionId: started.sessionId,
      challengeId: started.challengeId,
      frameBase64: FRAME,
    });
    expect(res.enrolled).toBe(true);
    expect(res.status).toBe("enrolled");
    expect(res.embeddingVersion).toBe("ArcFace");

    // Persisted credential: server-computed embedding, provenance marker.
    const creds = await q(
      sqlTag`SELECT id, "isActive", "sourceImageHash", "embeddingVector", "embeddingVersion"
             FROM face_enrollments WHERE "userId" = 1 ORDER BY id`
    );
    expect(creds).toHaveLength(2);
    expect(creds[0].isActive).toBe(false); // self-attested superseded
    expect(creds[1].isActive).toBe(true);
    expect(creds[1].sourceImageHash).toBe(`liveness-session:${started.sessionId}`);
    expect(JSON.parse(creds[1].embeddingVector)).toHaveLength(512);

    const active = await callerA.myActiveFaceEnrollment({
      enrollmentType: "kyc",
    });
    expect(active!.verificationBasis).toBe("server-verified");
    // The provenance hash itself is never exposed.
    expect(JSON.stringify(active)).not.toContain("liveness-session:");

    // Liveness session honestly recorded.
    const session = await callerA.myKycSession({ sessionId: started.sessionId });
    expect(session.status).toBe("liveness_passed");
    expect(session.livenessPassed).toBe(true);
  });

  it("challenge TTL: an expired challenge fails honestly (challenge_expired)", async () => {
    const { getDb } = await import("../../db");
    const db = (await getDb())!;
    const { sql } = await import("drizzle-orm");
    const ins = await db.execute(sql`
      INSERT INTO kyc_sessions
        ("customerId", type, status, "livenessMethod", "livenessChallenge", "createdAt", "updatedAt")
      VALUES
        (4242, 'customer_face_enrollment', 'pending', 'active_blink', 'chal-expired',
         now() - interval '120 seconds', now() - interval '120 seconds')
      RETURNING id`);
    const expiredId = Number((ins as any).rows?.[0]?.id ?? (ins as any)[0]?.id);
    const res = await callerA.submitFaceEnrollmentFrame({
      sessionId: expiredId,
      challengeId: "chal-expired",
      frameBase64: FRAME,
    });
    expect(res.passed).toBe(false);
    expect(res.status).toBe("liveness_failed");
    // Provider was never consulted for an expired challenge.
    const rows = await q(
      sqlTag`SELECT status, "rejectionReason" FROM kyc_sessions WHERE id = ${expiredId}`
    );
    expect(rows[0].status).toBe("liveness_failed");
    expect(rows[0].rejectionReason).toContain("expired");
  });

  it("attempt lockout: 3 failures → startFaceEnrollment TOO_MANY_REQUESTS (Redis-backed)", async () => {
    let n = 0;
    livenessWireHandler = body => {
      if (body.method) {
        n += 1;
        return {
          status: 200,
          json: {
            challenge_id: `chal-lock-${n}`,
            method: body.method,
            instruction: "Blink",
          },
        };
      }
      return { status: 200, json: { passed: false, score: 0.05 } };
    };
    for (let i = 0; i < 3; i++) {
      const started = await callerC.startFaceEnrollment({
        method: "active_blink",
      });
      const res = await callerC.submitFaceEnrollmentFrame({
        sessionId: started.sessionId,
        challengeId: started.challengeId,
        frameBase64: FRAME,
      });
      expect(res.passed).toBe(false);
    }
    // 4th attempt: locked out (lockout state lives in Redis, 6399).
    await expect(
      callerC.startFaceEnrollment({ method: "active_blink" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    const cooldown = await callerC.checkLivenessCooldown();
    expect(cooldown.locked).toBe(true);
  });
});

// ─── W10-B3-r2 (2026-10-04) ─────────────────────────────────────────────────
// FINDING-C5 regression: `Boolean(d.passed ?? d.is_live)` treated the wire
// string "false" as PASS and minted a real face_enrollments credential.
// decideMemberLivenessFrame now adjudicates strictly (`=== true` only).
describe("memberIdentity W10-B3-r2: strict liveness adjudication + TOCTOU (2026-10-04)", () => {
  async function freshChallenge(tag: string) {
    livenessWireHandler = body => {
      if (body.method) {
        return {
          status: 200,
          json: {
            challenge_id: `chal-r2-${tag}`,
            method: body.method,
            instruction: "Blink",
          },
        };
      }
      // Overwritten by each probe before submit.
      return { status: 500, json: { error: "respond handler not set" } };
    };
    return callerA.startFaceEnrollment({ method: "active_blink" });
  }

  const COERCIVE_PAYLOADS: { tag: string; payload: Record<string, unknown> }[] =
    [
      { tag: "str-false", payload: { passed: "false", score: 0.05 } },
      { tag: "num-1", payload: { passed: 1, score: 0.9 } },
      { tag: "str-true", payload: { passed: "true", score: 0.9 } },
      { tag: "is-live-yes", payload: { is_live: "yes", score: 0.9 } },
    ];

  it("coercive provider pass values ({passed:'false'},{passed:1},{passed:'true'},{is_live:'yes'}) are NOT a pass: honest liveness_failed, failure recorded, NO credential", async () => {
    const { clearCooldown } = await import(
      "../../middleware/livenessSecurityEnhancements"
    );
    const credsBefore = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "userId" = 1`
    );
    const failsBefore = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM biometric_audit_events WHERE "userId" = 1 AND "eventType" = 'liveness' AND outcome = 'fail'`
    );

    for (const { tag, payload } of COERCIVE_PAYLOADS) {
      // Each probe records an honest failure — reset the Redis cooldown so
      // the probes never trip the 3-strike lockout mid-suite.
      await clearCooldown("member-1");
      const started = await freshChallenge(tag);
      livenessWireHandler = body => {
        if (body.method) {
          return {
            status: 200,
            json: {
              challenge_id: `chal-r2-${tag}`,
              method: body.method,
              instruction: "Blink",
            },
          };
        }
        return { status: 200, json: payload };
      };
      const res = await callerA.submitFaceEnrollmentFrame({
        sessionId: started.sessionId,
        challengeId: started.challengeId,
        frameBase64: FRAME,
      });
      expect(res.passed).toBe(false);
      expect(res.enrolled).toBe(false);
      expect(res.status).toBe("liveness_failed");
      const rows = await q(
        sqlTag`SELECT status, "livenessPassed" FROM kyc_sessions WHERE id = ${started.sessionId}`
      );
      expect(rows[0].status).toBe("liveness_failed");
      expect(rows[0].livenessPassed).toBe(false);
    }
    await clearCooldown("member-1");

    // Every coercive probe recorded an HONEST failure…
    const failsAfter = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM biometric_audit_events WHERE "userId" = 1 AND "eventType" = 'liveness' AND outcome = 'fail'`
    );
    expect(failsAfter[0].n).toBe(failsBefore[0].n + COERCIVE_PAYLOADS.length);
    // …and NOT ONE minted a credential.
    const credsAfter = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "userId" = 1`
    );
    expect(credsAfter[0].n).toBe(credsBefore[0].n);
  });

  it("genuine {passed:true} still passes and enrolls (pass path intact)", async () => {
    const { clearCooldown } = await import(
      "../../middleware/livenessSecurityEnhancements"
    );
    await clearCooldown("member-1");
    deepfaceWireHandler = () => ({
      status: 200,
      json: { embedding: EMBEDDING_512, embedding_dim: 512, model: "ArcFace" },
    });
    livenessWireHandler = body => {
      if (body.method) {
        return {
          status: 200,
          json: {
            challenge_id: "chal-r2-genuine",
            method: body.method,
            instruction: "Blink",
          },
        };
      }
      return { status: 200, json: { passed: true, score: 0.95 } };
    };
    const started = await callerA.startFaceEnrollment({
      method: "active_blink",
    });
    const res = await callerA.submitFaceEnrollmentFrame({
      sessionId: started.sessionId,
      challengeId: started.challengeId,
      frameBase64: FRAME,
    });
    expect(res.passed).toBe(true);
    expect(res.enrolled).toBe(true);
    expect(res.status).toBe("enrolled");
  });

  it("TOCTOU: two concurrent frames for one session → exactly ONE credential, loser gets honest CONFLICT", async () => {
    const { clearCooldown } = await import(
      "../../middleware/livenessSecurityEnhancements"
    );
    await clearCooldown("member-1");
    deepfaceWireHandler = () => ({
      status: 200,
      json: { embedding: EMBEDDING_512, embedding_dim: 512, model: "ArcFace" },
    });
    livenessWireHandler = body => {
      if (body.method) {
        return {
          status: 200,
          json: {
            challenge_id: "chal-r2-race",
            method: body.method,
            instruction: "Blink",
          },
        };
      }
      return { status: 200, json: { passed: true, score: 0.9 } };
    };
    const started = await callerA.startFaceEnrollment({
      method: "active_blink",
    });
    const credsBefore = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "userId" = 1`
    );

    const [r1, r2] = await Promise.allSettled([
      callerA.submitFaceEnrollmentFrame({
        sessionId: started.sessionId,
        challengeId: started.challengeId,
        frameBase64: FRAME,
      }),
      callerA.submitFaceEnrollmentFrame({
        sessionId: started.sessionId,
        challengeId: started.challengeId,
        frameBase64: FRAME,
      }),
    ]);

    const enrolled = [r1, r2].filter(
      r => r.status === "fulfilled" && r.value.enrolled === true
    );
    const conflicts = [r1, r2].filter(
      r =>
        r.status === "rejected" &&
        (r.reason as { code?: string })?.code === "CONFLICT"
    );
    expect(enrolled).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    // Exactly ONE new credential, and exactly ONE active kyc credential.
    const credsAfter = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "userId" = 1`
    );
    expect(credsAfter[0].n).toBe(credsBefore[0].n + 1);
    const active = await q(
      sqlTag`SELECT COUNT(*)::int AS n FROM face_enrollments WHERE "userId" = 1 AND "enrollmentType" = 'kyc' AND "isActive" = true`
    );
    expect(active[0].n).toBe(1);
  });
});
