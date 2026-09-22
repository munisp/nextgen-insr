/**
 * perfInfraPWave.integration.test.ts — P-wave infra/DB performance fixes.
 *
 * Covers (all dated 2026-09-19):
 *  1. Migration 0085 indexes exist after `drizzle-kit push` (the integration
 *     harness pushes drizzle/schema.ts): audit_log(resourceId,createdAt),
 *     audit_log(action,createdAt), policies(customerId,status),
 *     claims(status,policyId), claims(status,createdAt),
 *     transactions((metadata->>'category')). agents(phone) is deliberately
 *     skipped — migration 0079 (G3) already created agents_phone_unique.
 *  2. Fluvio produce is enqueue-and-return: resolves immediately with Fluvio
 *     down (FLUVIO endpoint unreachable in the test env) and never throws.
 *  3. Kafka publishEvent is enqueue-and-return by default; requireAck keeps
 *     the awaited path (returns false fast with no broker/proxy).
 *  4. keycloakAuth roleResyncCache is a bounded LRU (10k max, TTL intact).
 *  5. documentManagement.requestUploadUrl: auth-gated presigned PUT issuance,
 *     mime/size constraints enforced.
 *  6. tbClient committed-registry cache + ensured-account cache semantics.
 */
import { describe, it, beforeAll, expect } from "vitest";
import { sql } from "drizzle-orm";

import { getDb } from "../../server/db";
import {
  callerFor,
  regularUser,
  resetAssertionCount,
} from "./helpers/trpc";

beforeAll(() => {
  resetAssertionCount();
});

describe("P-wave perf (2026-09-19): migration 0085 indexes exist after push", () => {
  const EXPECTED_INDEXES: Array<[string, string]> = [
    ["audit_log", "audit_resourceId_createdAt_idx"],
    ["audit_log", "audit_action_createdAt_idx"],
    ["policies", "pol_customer_status_idx"],
    ["claims", "cl_status_policy_idx"],
    ["claims", "cl_status_createdAt_idx"],
    ["transactions", "tx_metadata_category_idx"],
  ];

  it("all six composite/expression indexes are present", async () => {
    const db = (await getDb())!;
    for (const [table, indexName] of EXPECTED_INDEXES) {
      const rows = await db.execute(sql`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${table}
          AND indexname = ${indexName}
      `);
      expect(
        rows.rows.length,
        `missing index ${indexName} on ${table}`
      ).toBe(1);
    }
  });

  it("expression index on transactions metadata category is usable", async () => {
    const db = (await getDb())!;
    // The expression index definition must reference the metadata extraction.
    const rows = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'transactions'
        AND indexname = 'tx_metadata_category_idx'
    `);
    expect(rows.rows.length).toBe(1);
    expect(String((rows.rows[0] as { indexdef: string }).indexdef)).toContain(
      "metadata"
    );
  });
});

describe("P-wave perf (2026-09-19): fluvio produce is non-blocking", () => {
  it("fluvioProduce resolves immediately with Fluvio unreachable", async () => {
    const { fluvioProduce, getFluvioStatus } = await import(
      "../../server/lib/fluvioClient"
    );
    const before = getFluvioStatus().bufferedEvents;
    const start = Date.now();
    // FLUVIO endpoints point at dead addresses in the integration env; the
    // enqueue-and-return path must not await any HTTP I/O.
    await fluvioProduce({
      topic: "pos.transactions.created",
      key: "perf-test-1",
      payload: { event: "transaction.created", ref: "perf-test-1" },
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    // The event was accepted into the in-process buffer (a racing background
    // flush may already have failed-and-rebuffered it; either way it must
    // NOT be silently dropped before a publish attempt).
    expect(getFluvioStatus().bufferedEvents).toBeGreaterThanOrEqual(before);
  });
});

describe("P-wave perf (2026-09-19): kafka publishEvent queueing", () => {
  it("default path enqueues and returns true without a broker", async () => {
    const { publishEvent } = await import("../../server/kafkaClient");
    const start = Date.now();
    const ok = await publishEvent(
      "54link.transactions.created",
      "perf-test",
      { perf: true }
    );
    expect(ok).toBe(true);
    // No broker (KAFKA_BROKERS=127.0.0.1:9) and no proxy reachable — the
    // enqueue path must not block on either.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("requireAck keeps the awaited fail-open path (false without broker)", async () => {
    const { publishEvent } = await import("../../server/kafkaClient");
    const ok = await publishEvent(
      "54link.transactions.created",
      "perf-test-ack",
      { perf: true },
      undefined,
      { requireAck: true }
    );
    // Producer connect fails fast (connection refused on 127.0.0.1:9) and the
    // proxy publish to the dead gateway also fails → fail-open false.
    expect(ok).toBe(false);
  });
});

describe("P-wave perf (2026-09-19): keycloak role-resync cache is bounded", () => {
  it("LRU evicts oldest beyond 10k and honors TTL", async () => {
    const { __roleResyncCacheForTests } = await import(
      "../../server/_core/keycloakAuth"
    );
    const { cache, set, MAX } = __roleResyncCacheForTests;
    cache.clear();
    for (let i = 0; i < MAX + 100; i++) {
      set(`token-${i}`, { role: "user", expiresAt: Date.now() + 60_000 });
    }
    expect(cache.size).toBeLessThanOrEqual(MAX);
    // Oldest entries evicted, newest retained.
    expect(cache.has("token-0")).toBe(false);
    expect(cache.has(`token-${MAX + 99}`)).toBe(true);
    // Expired entries are swept on write.
    cache.clear();
    set("expired-1", { role: "user", expiresAt: Date.now() - 1 });
    for (let i = 0; i < MAX + 1; i++) {
      set(`live-${i}`, { role: "user", expiresAt: Date.now() + 60_000 });
    }
    expect(cache.has("expired-1")).toBe(false);
    expect(cache.size).toBeLessThanOrEqual(MAX);
    cache.clear();
  });
});

describe("P-wave perf (2026-09-19): presigned PUT upload flow", () => {
  it("issues a presigned URL for an authenticated user", async () => {
    const caller = callerFor(regularUser);
    const out = await caller.documentManagement.requestUploadUrl({
      fileName: "claim-evidence.pdf",
      mimeType: "application/pdf",
      fileSize: 1024 * 1024,
      purpose: "claim_document",
    });
    // Signing is offline crypto — no MinIO needed to issue the URL.
    expect(out.uploadUrl).toContain(out.fileKey);
    expect(out.uploadUrl).toMatch(/X-Amz-Signature=/);
    expect(out.fileKey).toContain(`claim_document/${regularUser.id}/`);
    expect(out.expiresIn).toBeGreaterThan(0);
  });

  it("rejects anonymous callers (auth-gated)", async () => {
    const caller = callerFor(null);
    await expect(
      caller.documentManagement.requestUploadUrl({
        fileName: "x.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects oversize declarations and disallowed mime types", async () => {
    const caller = callerFor(regularUser);
    await expect(
      caller.documentManagement.requestUploadUrl({
        fileName: "huge.bin",
        mimeType: "application/pdf",
        fileSize: 11 * 1024 * 1024,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.documentManagement.requestUploadUrl({
        fileName: "evil.exe",
        // @ts-expect-error — intentionally disallowed mime type
        mimeType: "application/x-msdownload",
        fileSize: 100,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("P-wave perf (2026-09-19): tbClient caches", () => {
  it("committed-registry cache serves immutable rows and expires", async () => {
    const { __tbRegistryCacheForTests } = await import("../../server/tbClient");
    const { cache, get, put, TTL_MS } = __tbRegistryCacheForTests;
    cache.clear();
    put("ref-1", {
      ref: "ref-1",
      payloadHash: "h",
      transferId: "tb-1",
      status: "committed",
      response: "{}",
    });
    expect(get("ref-1")?.transferId).toBe("tb-1");
    // Expired entries are not served.
    cache.set("ref-old", {
      row: {
        ref: "ref-old",
        payloadHash: "h",
        transferId: "tb-0",
        status: "committed",
        response: "{}",
      },
      expiresAt: Date.now() - 1,
    });
    expect(get("ref-old")).toBeNull();
    expect(TTL_MS).toBe(60_000);
    cache.clear();
  });

  it("ensured-account cache is bounded and TTL-bound", async () => {
    const { __tbEnsuredAccountsForTests } = await import(
      "../../server/tbClient"
    );
    const { cache, TTL_MS, MAX } = __tbEnsuredAccountsForTests;
    expect(TTL_MS).toBe(300_000);
    expect(MAX).toBe(10_000);
    expect(cache.size).toBeLessThanOrEqual(MAX);
  });
});
