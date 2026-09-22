/**
 * perfPlatformWave.integration.test.ts — 2026-09-19 (P-wave) integration
 * coverage for the platform performance fixes, run against real PGlite +
 * mini-Redis (globalSetup):
 *
 *   1. Permify decision cache (server/_core/permify.ts):
 *      - repeat identical decision hits Permify exactly once (cache HIT)
 *      - invalidatePermifyDecisionsForSubject busts the cache (miss-on-invalidation)
 *      - deny verdicts are cached (repeat deny served from cache)
 *      - Redis down → every call goes to Permify (no stale cache) and the
 *        answer is still correct — fail-closed preserved
 *      - Permify down → denied (fail-closed), and the outage answer is NOT
 *        cached (a subsequent healthy call re-checks Permify)
 *   2. Cached user record (server/db.ts getUserByKeycloakSub):
 *      - cached read survives a direct DB UPDATE until invalidated
 *      - invalidateUserBySubCache forces a fresh read
 *   3. N+1 batching (insuranceWorkflows.fileClaim AB-7 document hashes):
 *      - multi-document claim inserts ALL hash rows (batched multi-row insert)
 *      - document reuse across claims is still rejected (batched dedup query)
 *   4. Pagination bounds (customerOnboardingPipeline.list):
 *      - limit > 500 is rejected by input validation; limit 500 accepted
 *      - page size ≤ limit is honored
 *
 * The Permify HTTP boundary is stubbed at globalThis.fetch so call counts are
 * observable; Redis is the REAL mini-Redis from globalSetup (REDIS_URL).
 */
import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";

import {
  permifyCheckCached,
  invalidatePermifyDecisionsForSubject,
  __setPermifyFailOpenForTests,
} from "../../server/_core/permify";
import { getRedisClient } from "../../server/lib/redisClient";
import {
  getDb,
  getUserByKeycloakSub,
  invalidateUserBySubCache,
  upsertUser,
} from "../../server/db";
// 2026-09-22 (platform-fix): Permify-native write path under test — its
// success must bust the decision cache for the written subject.
import { writePermifyRelationship } from "../../server/journey-activities-extended";
import {
  policies,
  users,
  claimDocumentHashes,
} from "../../drizzle/schema";
import { customerOnboardingPipelineRouter } from "../../server/routers/customerOnboardingPipeline";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "perfPlatformWave";
const NOW = Date.now();
const DAY = 86_400_000;

// ── Permify fetch stub ────────────────────────────────────────────────────────
type FetchImpl = typeof fetch;
let realFetch: FetchImpl;
let permifyCalls = 0;
let permifyWrites = 0;
let permifyBehavior: "allow" | "deny" | "down" = "allow";

function installFetchStub() {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/relationships/write")) {
      // 2026-09-22 (platform-fix): Permify-native write path stub.
      permifyWrites++;
      return new Response(JSON.stringify({ snapToken: "snap-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/permissions/check")) {
      permifyCalls++;
      if (permifyBehavior === "down") {
        throw new Error("permify unreachable (test stub)");
      }
      return new Response(
        JSON.stringify({
          can:
            permifyBehavior === "allow"
              ? "CHECK_RESULT_ALLOWED"
              : "CHECK_RESULT_DENIED",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return realFetch(input, init);
  }) as FetchImpl;
}

function uninstallFetchStub() {
  globalThis.fetch = realFetch;
}

let savedFailOpen: string | undefined;

beforeAll(async () => {
  resetAssertionCount();
  // The integration config sets PERMIFY_FAIL_OPEN=true (Permify is stubbed
  // unreachable for the rest of the suite). permifyCheckDetailed reads the
  // flag at CALL time, so scoping it false here exercises the real
  // fail-closed posture this cache must preserve.
  savedFailOpen = process.env.PERMIFY_FAIL_OPEN;
  process.env.PERMIFY_FAIL_OPEN = "false";
  // The module-level fail-open flag was captured at import (suite boots with
  // "true"); the test-only hook switches it so the cache path is exercised.
  __setPermifyFailOpenForTests(false);
  // Redis must be reachable for cache tests (mini-Redis via globalSetup).
  const pong = await getRedisClient().ping();
  expect(String(pong)).toMatch(/PONG|1/);
});

afterAll(() => {
  if (savedFailOpen === undefined) delete process.env.PERMIFY_FAIL_OPEN;
  else process.env.PERMIFY_FAIL_OPEN = savedFailOpen;
  __setPermifyFailOpenForTests(true); // restore the suite-wide boot posture
  console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
});

beforeEach(() => {
  installFetchStub();
  permifyCalls = 0;
  permifyWrites = 0;
  permifyBehavior = "allow";
});

afterEach(() => {
  uninstallFetchStub();
});

let seq = 0;
function uniqueSubject() {
  return `perf-test-subject-${process.pid}-${Date.now()}-${++seq}`;
}

describe("Permify decision cache (P-wave perf #1)", () => {
  it("serves a repeat identical decision from cache (Permify called once)", async () => {
    const subjectId = uniqueSubject();
    const params = {
      subjectType: "user",
      subjectId,
      entityType: "system",
      entityId: "insurance-portal",
      permission: "access",
    };
    expect(await permifyCheckCached(params)).toBe(true);
    expect(await permifyCheckCached(params)).toBe(true);
    expect(permifyCalls).toBe(1);
  });

  it("miss-on-invalidation: role-write hook forces a fresh Permify check", async () => {
    const subjectId = uniqueSubject();
    const params = {
      subjectType: "user",
      subjectId,
      entityType: "system",
      entityId: "insurance-portal",
      permission: "access",
    };
    expect(await permifyCheckCached(params)).toBe(true);
    expect(permifyCalls).toBe(1);
    await invalidatePermifyDecisionsForSubject("user", subjectId);
    expect(await permifyCheckCached(params)).toBe(true);
    expect(permifyCalls).toBe(2);
  });

  it("caches deny verdicts (repeat deny does not re-call Permify)", async () => {
    permifyBehavior = "deny";
    const subjectId = uniqueSubject();
    const params = {
      subjectType: "user",
      subjectId,
      entityType: "system",
      entityId: "insurance-portal",
      permission: "admin_access",
    };
    expect(await permifyCheckCached(params)).toBe(false);
    expect(await permifyCheckCached(params)).toBe(false);
    expect(permifyCalls).toBe(1);
  });

  it("Redis down → real Permify call every time, answer still correct (fail-closed preserved)", async () => {
    const subjectId = uniqueSubject();
    const params = {
      subjectType: "user",
      subjectId,
      entityType: "system",
      entityId: "insurance-portal",
      permission: "access",
    };
    const client = getRedisClient();
    const realGet = client.get.bind(client);
    const realSet = client.set.bind(client);
    // Simulate Redis outage for cache reads/writes only.
    (client as any).get = async () => {
      throw new Error("redis down (test stub)");
    };
    (client as any).set = async () => {
      throw new Error("redis down (test stub)");
    };
    try {
      expect(await permifyCheckCached(params)).toBe(true);
      expect(await permifyCheckCached(params)).toBe(true);
      // No caching possible → two REAL Permify calls.
      expect(permifyCalls).toBe(2);
    } finally {
      (client as any).get = realGet;
      (client as any).set = realSet;
    }
  });

  it("Permify down → denied (fail-closed) and the outage answer is NOT cached", async () => {
    const subjectId = uniqueSubject();
    const params = {
      subjectType: "user",
      subjectId,
      entityType: "system",
      entityId: "insurance-portal",
      permission: "access",
    };
    permifyBehavior = "down";
    expect(await permifyCheckCached(params)).toBe(false); // fail-closed
    permifyBehavior = "allow";
    // A healthy Permify is consulted again — the outage "deny" was not cached.
    expect(await permifyCheckCached(params)).toBe(true);
    expect(permifyCalls).toBe(2);
  });
});

// 2026-09-22 (platform-fix, authz staleness WARNING): Permify-native
// relationship writes bypassed the decision-cache invalidation hooks, so a
// permission revoked via those paths kept serving a cached ALLOW for up to
// the 45s allow-TTL. Invalidation is now structural (inside the write
// functions). This pins the contract: cache busted IMMEDIATELY after
// writePermifyRelationship — a revoked permission is denied on the next call.
describe("Permify-native write paths bust the decision cache (2026-09-22 platform-fix)", () => {
  it("writePermifyRelationship → revoked permission denied on the NEXT check (no TTL wait)", async () => {
    const subjectId = uniqueSubject();
    const params = {
      subjectType: "user",
      subjectId,
      entityType: "policy",
      entityId: `pol-fix-${process.pid}-${Date.now()}`,
      permission: "view_policy",
    };
    // Prime a cached ALLOW.
    expect(await permifyCheckCached(params)).toBe(true);
    expect(permifyCalls).toBe(1);

    // The permission is now revoked server-side and a Permify-native
    // relationship write lands (e.g. journey assignment path).
    permifyBehavior = "deny";
    const wr = await writePermifyRelationship({
      entityType: "policy",
      entityId: params.entityId,
      relation: "viewer",
      subjectType: "user",
      subjectId,
    });
    expect(wr.success).toBe(true);
    expect(permifyWrites).toBe(1);

    // Without the structural bust this assertion would fail: the cached
    // ALLOW would be served for up to the 45s allow-TTL.
    expect(await permifyCheckCached(params)).toBe(false);
    expect(permifyCalls).toBe(2);
  });
});

// 2026-09-22 (platform-fix, authz staleness WARNING): upsertUser (login path,
// _core/oauth.ts / _core/sdk.ts) writes users.role on conflict but never
// invalidated the 30s cached user record (getUserByKeycloakSub) or the 45s
// Permify decision cache. Both are now busted on the write.
describe("upsertUser cache invalidation (2026-09-22 platform-fix)", () => {
  it("login-path role change busts the user cache AND the Permify decision cache", async () => {
    const db = (await getDb())!;
    const sub = `kc-upsert-fix-${process.pid}-${Date.now()}`;
    await upsertUser({
      keycloakSub: sub,
      name: "Upsert Fix",
      email: "upsert-fix@integration.local",
      role: "user",
    });

    // Prime both caches: the user record and an ALLOW decision for the id.
    const first = await getUserByKeycloakSub(sub);
    expect(first?.role).toBe("user");
    const params = {
      subjectType: "user",
      subjectId: String(first!.id),
      entityType: "system",
      entityId: "insurance-portal",
      permission: "access",
    };
    expect(await permifyCheckCached(params)).toBe(true);
    expect(permifyCalls).toBe(1);

    // Login sync writes a new role (e.g. Keycloak-side change propagated).
    permifyBehavior = "deny";
    await upsertUser({
      keycloakSub: sub,
      name: "Upsert Fix",
      email: "upsert-fix@integration.local",
      role: "admin",
    });

    // User-record cache was busted: fresh role served immediately.
    const fresh = await getUserByKeycloakSub(sub);
    expect(fresh?.role).toBe("admin");
    // Decision cache was busted: the next check re-consults Permify (deny).
    expect(await permifyCheckCached(params)).toBe(false);
    expect(permifyCalls).toBe(2);

    // Cleanup (plus cache hygiene).
    await db.delete(users).where(eq(users.id, first!.id));
    await invalidateUserBySubCache(sub);
  });
});

describe("Cached user record (P-wave perf #6)", () => {
  it("caches getUserByKeycloakSub and invalidateUserBySubCache busts it", async () => {
    const db = (await getDb())!;
    const sub = `kc-perf-cache-${process.pid}-${Date.now()}`;
    const [u] = await db
      .insert(users)
      .values({
        keycloakSub: sub,
        name: "Cache Test",
        email: "cache-test@integration.local",
        role: "user",
      })
      .returning();

    // Prime the cache.
    const first = await getUserByKeycloakSub(sub);
    expect(first?.id).toBe(u.id);
    expect(first?.role).toBe("user");

    // Direct DB write (bypasses the invalidation hooks): cached read still
    // serves the old role — proves the cache is actually being used.
    await db.update(users).set({ role: "admin" }).where(eq(users.id, u.id));
    const stale = await getUserByKeycloakSub(sub);
    expect(stale?.role).toBe("user");

    // Invalidation (what the role-write paths call) forces a fresh read.
    await invalidateUserBySubCache(sub);
    const fresh = await getUserByKeycloakSub(sub);
    expect(fresh?.role).toBe("admin");

    // Cleanup (also clears the cache entry via invalidation).
    await db.delete(users).where(eq(users.id, u.id));
    await invalidateUserBySubCache(sub);
  });
});

describe("N+1 batching — fileClaim document hashes (P-wave perf #9)", () => {
  const CUST = 980101;

  async function seedActivePolicy(policyNumber: string) {
    const db = (await getDb())!;
    const [p] = await db
      .insert(policies)
      .values({
        policyNumber,
        productId: 1,
        customerId: CUST,
        coverageType: "life",
        status: "active",
        sumInsured: "100000.00",
        annualPremium: "10000.00",
        startDate: new Date(NOW - 100 * DAY),
        endDate: new Date(NOW + 265 * DAY),
      } as typeof policies.$inferInsert)
      .returning();
    return p;
  }

  it("batched insert records ALL document hashes; batched dedup still rejects reuse", async () => {
    const db = (await getDb())!;
    const runId = `${process.pid}-${Date.now()}`;
    const p = await seedActivePolicy(`PERF-N1-${runId}`);
    const caller = callerFor(adminUser);
    const docs = [`doc-alpha-${runId}`, `doc-beta-${runId}`, `doc-gamma-${runId}`];
    const { claim } = await caller.insuranceWorkflows.fileClaim({
      policyId: p.id,
      claimType: "death",
      incidentDate: new Date(NOW - 10 * DAY).toISOString(),
      claimedAmount: 5000,
      incidentDescription: "N+1 batch coverage claim",
      documents: docs,
    });
    // One multi-row insert persisted every hash (was a per-hash INSERT loop).
    const rows = await db
      .select()
      .from(claimDocumentHashes)
      .where(eq(claimDocumentHashes.claimId, claim.id));
    expect(rows.length).toBe(3);

    // Dedup still fail-closed: reusing ANY of the batched hashes conflicts.
    const p2 = await seedActivePolicy(`PERF-N1B-${runId}`);
    await expectTrpcError(
      callerFor(adminUser).insuranceWorkflows.fileClaim({
        policyId: p2.id,
        claimType: "death",
        incidentDate: new Date(NOW - 10 * DAY).toISOString(),
        claimedAmount: 5000,
        incidentDescription: "reuses a document",
        documents: [`doc-fresh-${runId}`, `doc-beta-${runId}`],
      }),
      "CONFLICT"
    );
  });
});

describe("Pagination bounds (P-wave perf #13)", () => {
  const pipelineCaller = () =>
    customerOnboardingPipelineRouter.createCaller({
      user: adminUser as any,
      req: { headers: {} } as any,
      res: { cookie: () => undefined, clearCookie: () => undefined } as any,
      requestId: "perf-pagination-test",
    });

  it("rejects limit > 500 (bounded), accepts limit 500", async () => {
    await expectTrpcError(
      pipelineCaller().list({
        page: 1,
        limit: 501,
      }),
      "BAD_REQUEST"
    );
    const res = await pipelineCaller().list({ page: 1, limit: 500 });
    expect(res.page).toBe(1);
    expect(Array.isArray(res.items)).toBe(true);
  });

  it("honors the requested page size", async () => {
    const res = await pipelineCaller().list({ page: 1, limit: 20 });
    expect(res.items.length).toBeLessThanOrEqual(20);
  });
});
