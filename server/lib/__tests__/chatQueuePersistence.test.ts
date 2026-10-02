/**
 * 2026-10-01 (C2-lib, A6): chat waiting-queue durability tests.
 *
 * Coverage honesty note: no Redis server is available in the unit-test
 * environment (no redis binary, no ioredis-mock dependency, and the repo's
 * miniRedis harness in tests/e2e/setup/ implements no ZSET commands and is
 * outside this task's editable scope). These tests therefore exercise:
 *   1. the distributedState sorted-set queue primitives directly (memory
 *      fallback mode — the exact same code path and ordering semantics the
 *      Redis branch implements via ZADD/ZRANGE WITHSCORES/ZREM/ZCARD), and
 *   2. the agentOperations write-through + hydrateChatQueue() restart-recovery
 *      flow, using a FRESH module instance (query-suffixed dynamic import) to
 *      simulate a process restart while the durable store survives.
 * Real-Redis ZSET coverage should run in the e2e job (redis:7 service).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  sortedSetAdd,
  sortedSetRange,
  sortedSetRemove,
  sortedSetSize,
} from "../distributedState";
import * as agentOps from "../agentOperations";

// 2026-10-02 (C2-lint): QueueEntry referenced through the namespace import —
// a separate `import type` from the same module tripped the
// import/no-duplicates ratchet (baseline is never regenerated).
type QueueEntry = agentOps.QueueEntry;

type AgentOpsModule = typeof agentOps;
type DistributedStateModule = typeof import("../distributedState");

/**
 * Simulate a process restart: wipe the module registry so agentOperations
 * reloads with an EMPTY in-memory queue, then re-seed the fresh
 * distributedState sorted set from the previously persisted members — this
 * models exactly what a restart looks like when the durable store is Redis
 * (the store outlives the process). The fresh agentOperations imports the
 * fresh distributedState, so hydrateChatQueue() reads the re-seeded data.
 */
async function simulateRestart(
  persisted: Array<{ member: string; score: number }>
): Promise<{ ops: AgentOpsModule; ds: DistributedStateModule }> {
  vi.resetModules();
  const ds: DistributedStateModule = await import("../distributedState");
  for (const { member, score } of persisted) {
    await ds.sortedSetAdd("chatq:waiting", score, member);
  }
  const ops: AgentOpsModule = await import("../agentOperations");
  return { ops, ds };
}

function makeEntry(sessionId: number, priority: QueueEntry["priority"], enqueuedAt: number): Omit<QueueEntry, "position" | "estimatedWaitMs"> {
  return {
    sessionId,
    userId: `user-${sessionId}`,
    userName: `User ${sessionId}`,
    subject: "help",
    category: "general",
    priority,
    enqueuedAt,
    requiredSkill: null,
    language: "en",
  };
}

describe("distributedState sorted-set queue primitives (A6)", () => {
  it("orders members ascending by score and supports remove/size", async () => {
    const key = `test:q:${Date.now()}`;
    await sortedSetAdd(key, 3, "c");
    await sortedSetAdd(key, 1, "a");
    await sortedSetAdd(key, 2, "b");
    expect(await sortedSetSize(key)).toBe(3);
    expect((await sortedSetRange(key)).map(m => m.member)).toEqual(["a", "b", "c"]);
    await sortedSetRemove(key, "b");
    expect((await sortedSetRange(key)).map(m => m.member)).toEqual(["a", "c"]);
    expect(await sortedSetSize(key)).toBe(2);
  });
});

describe("agentOperations chatQueue durability (A6)", () => {
  // 2026-10-02 (C2-ci): the original assertions assumed EXCLUSIVE ownership
  // of the "chatq:waiting" sorted-set key — true in the local unit-test env
  // (memory fallback) but FALSE in CI's "Vitest (postgres + redis)" job,
  // where a REAL shared Redis also receives write-through entries from other
  // chat test files running concurrently (foreign sessionId 101 polluted the
  // store; CI job 110648994986). The contract under test is about OUR
  // entries' durability/ordering/restoration, so all store assertions below
  // filter to this suite's session ids (501–503); global size assertions are
  // replaced with membership/relative-order assertions, which are strictly
  // what the persistence contract guarantees under concurrent load.
  const OUR_IDS = new Set([501, 502, 503]);
  const ourEntries = (
    stored: Array<{ member: string; score: number }>
  ): number[] =>
    stored
      .map(m => (JSON.parse(m.member) as QueueEntry).sessionId)
      .filter(id => OUR_IDS.has(id));

  beforeAll(async () => {
    // Remove OUR leftovers (e.g. from a retried job on a reused Redis) —
    // never flush the whole key (foreign suites share it).
    const stored = await sortedSetRange("chatq:waiting");
    for (const m of stored) {
      const id = (JSON.parse(m.member) as QueueEntry).sessionId;
      if (OUR_IDS.has(id)) await sortedSetRemove("chatq:waiting", m.member);
    }
  });

  it("enqueue/dequeue write-through to the durable store, with priority ordering", async () => {
    agentOps.enqueueChat(makeEntry(501, "low", 1_000));
    agentOps.enqueueChat(makeEntry(502, "critical", 2_000));
    agentOps.enqueueChat(makeEntry(503, "critical", 1_500));
    await agentOps.flushChatQueuePersistence();

    // In-memory queue sorted by priority, then FIFO within a priority.
    expect(agentOps.getQueueStatus().entries.map(e => e.sessionId)).toEqual([503, 502, 501]);

    // Durable store holds all three, head-first (relative order of OUR
    // entries is score-ordered regardless of foreign interleaving).
    const stored = await sortedSetRange("chatq:waiting");
    expect(ourEntries(stored)).toEqual([503, 502, 501]);

    agentOps.dequeueChat(502);
    await agentOps.flushChatQueuePersistence();
    expect(ourEntries(await sortedSetRange("chatq:waiting"))).toEqual([503, 501]);
  });

  it("restart simulation: a fresh module instance restores waiting customers via hydrateChatQueue()", async () => {
    // Capture what was persisted pre-restart (OUR 2 entries; 502 dequeued).
    const persisted = await sortedSetRange("chatq:waiting");
    expect(ourEntries(persisted)).toEqual([503, 501]);

    const { ops } = await simulateRestart(persisted);
    expect(ops.getQueueLength()).toBe(0); // in-memory queue lost on restart

    const restored = await ops.hydrateChatQueue();
    expect(restored).toBeGreaterThanOrEqual(2); // ours + any foreign entries
    // OUR entries restored, in priority order.
    const ids = ops.getQueueStatus().entries.map(e => e.sessionId);
    expect(ids.filter(id => OUR_IDS.has(id))).toEqual([503, 501]);
    // Positions recomputed after restore: strictly increasing 1..N.
    const positions = ops.getQueueStatus().entries.map(e => e.position);
    expect(positions).toEqual(positions.map((_, i) => i + 1));
  });

  it("hydrateChatQueue is idempotent (dedup by sessionId)", async () => {
    const persisted = await sortedSetRange("chatq:waiting");
    const { ops, ds } = await simulateRestart(persisted);

    await ops.hydrateChatQueue();
    const second = await ops.hydrateChatQueue();
    expect(second).toBe(0); // every stored entry already present
    const ids = ops.getQueueStatus().entries.map(e => e.sessionId);
    expect(ids.filter(id => OUR_IDS.has(id))).toEqual([503, 501]);
    // Store unchanged by the second hydrate (no duplicate writes): size
    // identical before and after.
    const before = await ds.sortedSetSize("chatq:waiting");
    await ops.hydrateChatQueue();
    expect(await ds.sortedSetSize("chatq:waiting")).toBe(before);
  });
});
