/**
 * Class-B security-state persistence tests (2026-10-01, C2-mw) — audit rows
 * B1-B7, B13 from persistence-audit.md.
 *
 * PG-backed stores (B2 device_liveness_attempts, B3 geo_ip_correlations,
 * B5 known_devices) are tested against a REAL PGlite Postgres — no mocks.
 * Restart simulation: after writing, a fresh drizzle handle over the same
 * PGlite database is injected (a module-level state wipe is implicit — the
 * modules hold no state anymore); the data MUST survive.
 *
 * Redis-backed stores (B1, B4, B6, B7, B13) run here without REDIS_URL, so
 * they exercise the real in-memory fallback path of distributedState (the
 * same code path used when Redis is down). The Redis branch is the same
 * secState/csrf code with a different backend; durability across restart
 * with Redis is provided by Redis itself (AOF/RDB), not by these modules.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Request, Response } from "express";

import {
  recordDeviceLivenessAttempt,
  getDeviceLivenessHistory,
  getProblematicDevices,
  correlateGeoIp,
  getAllGeoCorrelations,
  getHighRiskCorrelations,
  clearGeoIpData,
  isLockedOut,
  recordLivenessFailure,
  recordLivenessSuccess,
  clearCooldown,
  getCooldownStatus,
  createDeviceFingerprint,
  __setLivenessPersistenceDbForTesting,
  type GeoLocation,
} from "../../middleware/livenessSecurityEnhancements";
import {
  validateDevice,
  getDeviceCount,
  __setKnownDevicesDbForTesting,
} from "../../middleware/securityPosture";
import {
  generateCsrfToken,
  validateCsrfToken,
  checkRateLimit,
} from "../inputSanitizer";
import { trackChatAbuse } from "../chatSecurityAudit";
import {
  accountTakeoverPrevention,
  cardTestingDetection,
} from "../../middleware/financialAttackPrevention";

let pglite: PGlite;

const GEO_NG: GeoLocation = {
  ip: "105.112.10.1",
  country: "Nigeria",
  region: "Lagos",
  city: "Lagos",
  lat: 6.45,
  lon: 3.4,
  isp: "MTN Nigeria",
  isVpn: false,
  isProxy: false,
  isTor: false,
  isDatacenter: false,
};

function makeFingerprint(tag: string) {
  return createDeviceFingerprint({
    userAgent: `Mozilla/5.0 (Linux; Android 12; ${tag} Build/SP1A) AppleWebKit/537.36`,
    cameraWidth: 1280,
    cameraHeight: 720,
    screenWidth: 720,
    screenHeight: 1600,
    pixelRatio: 2,
  });
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(`
    CREATE TABLE device_liveness_attempts (
      id SERIAL PRIMARY KEY,
      "fingerprintHash" VARCHAR(64) NOT NULL,
      "deviceModel" VARCHAR(256) NOT NULL,
      attempts JSONB NOT NULL,
      "successRate" NUMERIC(7,4) NOT NULL,
      "avgScore" NUMERIC(7,4) NOT NULL,
      "lastSeen" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
      "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE UNIQUE INDEX dla_fingerprint_unique ON device_liveness_attempts ("fingerprintHash");
    CREATE TABLE geo_ip_correlations (
      id SERIAL PRIMARY KEY,
      "userId" VARCHAR(128) NOT NULL,
      "deviceFingerprint" VARCHAR(256) NOT NULL,
      locations JSONB NOT NULL,
      "riskScore" INTEGER NOT NULL,
      flags JSONB NOT NULL,
      "lastChecked" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
      "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE UNIQUE INDEX gic_user_device_unique ON geo_ip_correlations ("userId", "deviceFingerprint");
    CREATE TABLE known_devices (
      id SERIAL PRIMARY KEY,
      "userId" VARCHAR(128) NOT NULL,
      fingerprint VARCHAR(256) NOT NULL,
      "firstSeenAt" TIMESTAMP DEFAULT NOW() NOT NULL,
      "lastSeenAt" TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE UNIQUE INDEX kd_user_device_unique ON known_devices ("userId", fingerprint);
  `);
  const db = drizzle(pglite);
  __setLivenessPersistenceDbForTesting(db);
  __setKnownDevicesDbForTesting(db);
});

afterAll(async () => {
  __setLivenessPersistenceDbForTesting(null);
  __setKnownDevicesDbForTesting(null);
  await pglite.close();
});

/** Simulate a process restart for PG-backed stores: inject a brand-new
 * drizzle handle over the SAME database. The modules keep no state, so any
 * data still readable afterwards is genuinely durable. */
function simulateRestart(): void {
  __setLivenessPersistenceDbForTesting(drizzle(pglite));
  __setKnownDevicesDbForTesting(drizzle(pglite));
}

describe("B2 — device_liveness_attempts (fraud evidence, PG)", () => {
  it("persists attempts across a simulated restart", async () => {
    const fp = makeFingerprint("B2 Device");
    await recordDeviceLivenessAttempt(fp, true, "active_blink", 0.9);
    await recordDeviceLivenessAttempt(fp, false, "active_blink", 0.3);

    // Evidence row exists in the real database
    const rows = await pglite.query(
      `SELECT * FROM device_liveness_attempts WHERE "fingerprintHash" = $1`,
      [fp.fingerprintHash]
    );
    expect(rows.rows.length).toBe(1);

    simulateRestart();
    const history = await getDeviceLivenessHistory(fp.fingerprintHash);
    expect(history).not.toBeNull();
    expect(history!.attempts.length).toBe(2);
    expect(history!.successRate).toBeCloseTo(0.5, 2);
    expect(history!.deviceModel).toContain("B2 Device");
  });

  it("keeps a rolling 50-attempt window and flags problematic devices", async () => {
    const fp = makeFingerprint("B2 Flaky");
    for (let i = 0; i < 55; i++) {
      await recordDeviceLivenessAttempt(fp, i % 10 === 0, "passive", 0.3);
    }
    const history = await getDeviceLivenessHistory(fp.fingerprintHash);
    expect(history!.attempts.length).toBe(50);
    const problematic = await getProblematicDevices(5, 0.5);
    expect(problematic.some(d => d.fingerprint === fp.fingerprintHash)).toBe(
      true
    );
  });
});

describe("B3 — geo_ip_correlations (compliance signal, PG)", () => {
  it("persists correlations across a simulated restart and scores risk", async () => {
    await correlateGeoIp("b3-user", "b3-device", GEO_NG);
    const tor: GeoLocation = {
      ...GEO_NG,
      ip: "185.1.1.1",
      isp: "Tor Exit Node",
      isTor: true,
    };
    const result = await correlateGeoIp("b3-user", "b3-device", tor);
    expect(result.riskScore).toBeGreaterThanOrEqual(50);
    expect(result.flags).toContain("tor_exit_node");

    simulateRestart();
    const all = await getAllGeoCorrelations();
    const found = all.find(
      c => c.userId === "b3-user" && c.deviceFingerprint === "b3-device"
    );
    expect(found).toBeDefined();
    expect(found!.locations.length).toBe(2);

    const highRisk = await getHighRiskCorrelations(50);
    expect(highRisk.some(c => c.userId === "b3-user")).toBe(true);
  });

  it("clearGeoIpData deletes only the target user's rows (GDPR)", async () => {
    await correlateGeoIp("b3-clear", "dev-1", GEO_NG);
    await correlateGeoIp("b3-clear", "dev-2", GEO_NG);
    const cleared = await clearGeoIpData("b3-clear");
    expect(cleared).toBe(2);
    const remaining = await getAllGeoCorrelations();
    expect(remaining.some(c => c.userId === "b3-clear")).toBe(false);
  });
});

describe("B5 — known_devices (trust registry, PG)", () => {
  it("remembers trusted devices across a simulated restart", async () => {
    const first = await validateDevice("b5-user", "fp-alpha");
    expect(first.known).toBe(false);
    expect(first.totalDevices).toBe(1);

    simulateRestart();
    const second = await validateDevice("b5-user", "fp-alpha");
    expect(second.known).toBe(true);
    expect(await getDeviceCount("b5-user")).toBe(1);

    const third = await validateDevice("b5-user", "fp-beta");
    expect(third.known).toBe(false);
    expect(third.totalDevices).toBe(2);
  });
});

describe("B1 — liveness lockout (Redis w/ in-memory fallback)", () => {
  it("locks out after 3 failures, lists status, clears on success/admin", async () => {
    const userId = `b1-user-${Date.now()}`;
    await recordLivenessFailure(userId);
    await recordLivenessFailure(userId);
    const third = await recordLivenessFailure(userId);
    expect(third.locked).toBe(true);

    const status = await isLockedOut(userId);
    expect(status.locked).toBe(true);
    expect(status.remainingMs).toBeGreaterThan(0);

    const all = await getCooldownStatus();
    expect(all.some(s => s.userId === userId && s.failures === 3)).toBe(true);

    expect(await clearCooldown(userId)).toBe(true);
    expect((await isLockedOut(userId)).locked).toBe(false);

    await recordLivenessFailure(userId);
    await recordLivenessFailure(userId);
    await recordLivenessSuccess(userId);
    expect((await isLockedOut(userId)).failures).toBe(0);
  });
});

describe("B6 — CSRF tokens (consolidated on distributedState csrf store)", () => {
  it("issues and validates session-long tokens", async () => {
    const sessionId = `b6-session-${Date.now()}`;
    const token = await generateCsrfToken(sessionId);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await validateCsrfToken(sessionId, token)).toBe(true);
    // Session-long semantics: token is NOT consumed by validation
    expect(await validateCsrfToken(sessionId, token)).toBe(true);
    expect(await validateCsrfToken(sessionId, "0".repeat(64))).toBe(false);
    expect(await validateCsrfToken("other-session", token)).toBe(false);
  });
});

describe("B7 — sanitizer rate limit (Redis w/ in-memory fallback)", () => {
  it("blocks after the limit within the window", async () => {
    const key = `b7-ip-${Date.now()}`;
    const r1 = await checkRateLimit(key, 3, 60_000);
    expect(r1.allowed).toBe(true);
    await checkRateLimit(key, 3, 60_000);
    const r3 = await checkRateLimit(key, 3, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
    const r4 = await checkRateLimit(key, 3, 60_000);
    expect(r4.allowed).toBe(false);
  });
});

describe("B13 — chat abuse tracker (Redis w/ in-memory fallback)", () => {
  it("blocks an IP after 100 messages in 5 minutes", async () => {
    const ip = `10.9.8.7`;
    for (let i = 0; i < 100; i++) {
      const r = await trackChatAbuse(ip);
      expect(r.blocked).toBe(false);
    }
    const blocked = await trackChatAbuse(ip);
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBeTruthy();
    // Still blocked on the next call (block persisted)
    const still = await trackChatAbuse(ip);
    expect(still.blocked).toBe(true);
  });
});

// ── Minimal express harness (test doubles for req/res only — the security
// stores under test are the REAL distributedState stores, never mocked). ──
interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function makeReqRes(url: string, body: unknown): { req: Request; res: Response } {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  const req = {
    url,
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9" },
    socket: { remoteAddress: "203.0.113.9" },
    body,
  } as unknown as Request;
  return { req, res: res as unknown as Response };
}

function nextNoop(): void {
  /* request passed through */
}

describe("B4 — account takeover lockout (Redis w/ in-memory fallback)", () => {
  it("locks the account after 5 failed logins and rejects with 429", async () => {
    const identifier = `b4-agent-${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      const { req, res } = makeReqRes("/trpc/auth.login", {
        agentId: identifier,
      });
      await accountTakeoverPrevention(req, res, nextNoop);
      // Simulate the auth route rejecting the login
      res.status(401);
      (res as unknown as { json: (b: unknown) => unknown }).json({
        error: "bad credentials",
      });
      // res.json override persists fire-and-forget; let it flush
      await new Promise(r => setTimeout(r, 25));
    }

    // 6th attempt: account is locked — middleware short-circuits with 429
    const { req, res } = makeReqRes("/trpc/auth.login", {
      agentId: identifier,
    });
    let passedThrough = false;
    await accountTakeoverPrevention(req, res, () => {
      passedThrough = true;
    });
    expect(passedThrough).toBe(false);
    expect(res.statusCode).toBe(429);
    const body = (res as unknown as { body: { code?: string; retryAfter?: number } })
      .body;
    expect(body.code).toBe("ACCOUNT_LOCKED");
    expect(body.retryAfter).toBeGreaterThan(0);
  });
});

describe("B4 — card testing detection (Redis w/ in-memory fallback)", () => {
  it("blocks after >20 attempts with amounts from one IP", async () => {
    let lastRes: Response | null = null;
    for (let i = 0; i < 21; i++) {
      const { req, res } = makeReqRes("/trpc/payments.charge", {
        amount: 100,
        cardLast4: "4242",
      });
      let passed = false;
      await cardTestingDetection(req, res, () => {
        passed = true;
      });
      lastRes = res;
      if (!passed) break;
    }
    expect(lastRes!.statusCode).toBe(429);
    const body = (lastRes! as unknown as { body: { code?: string } }).body;
    expect(body.code).toBe("CARD_TEST_DETECTED");
  });
});
