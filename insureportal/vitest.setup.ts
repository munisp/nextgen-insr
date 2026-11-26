import { vi } from "vitest";
import http from "node:http";

// ── 2026-11-27 (W24): the former global `vi.mock("./server/db", …)` was
// REMOVED, not extended. Two independent reasons:
//   1. It was structurally false: the real server/db.ts exports an async
//      getDb()/getPool() plus helper functions — it has NO `db` export at
//      all. The mocked shape (`{ db: { select… } }`) matched no production
//      interface, and any real consumer failed with "No 'getDb' export is
//      defined on the './server/db' mock".
//   2. A global mock cannot be scoped: the REAL-DB integration suites
//      (tests/integration/*.integration.test.ts) import the real
//      ../../server/db and point its getDb() at a spawned PGlite
//      wire-protocol server; the global mock silently replaced that module
//      and made those suites impossible to run.
// Unit tests that need a DB double declare their OWN local mock
// (see tests/routers/fraud.test.ts, which mocks ../../server/db with a
// faithful `getDb` export). Code paths that call the real getDb() with no
// database configured get db.ts's own fail-closed NO-OP chain — that is
// the production outage posture and is what the fail-closed tests assert.

// ── 2026-11-27 (W24): Permify check-endpoint test double ────────────────────
// server/_core/trpc.ts runs a Permify base-access gate (requirePermify) on
// every protectedProcedure. Since the 2026-11-26 (W23) hardening of
// server/_core/permify.ts, an UNREACHABLE Permify denies (fail-closed),
// which short-circuits every procedure-level test with FORBIDDEN before the
// identity/outage gates under test are even reached. The fail-closed
// outage contract itself is covered by server/_core/permifyBootGuardW23.test.ts
// (which points PERMIFY_URL at an explicitly unreachable address). For the
// remaining suites to exercise what they assert, the harness provides a
// real (in-process HTTP) Permify double that answers the wire-protocol
// check endpoint with CHECK_RESULT_ALLOWED — the production code path
// (permifyCheck → fetch → middleware) runs unmodified; only the external
// service is doubled, exactly like the PGlite double for Postgres.
// Each vitest worker binds its own ephemeral port — no fixed-port
// collisions between parallel workers or concurrent runs on a shared host.
const permifyStub = http.createServer((req, res) => {
  if (req.method === "POST" && req.url?.includes("/permissions/check")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ can: "CHECK_RESULT_ALLOWED" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end("{}");
});
await new Promise<void>((resolve, reject) => {
  permifyStub.once("error", reject);
  permifyStub.listen(0, "127.0.0.1", () => resolve());
});
const permifyAddr = permifyStub.address();
if (!permifyAddr || typeof permifyAddr === "string") {
  throw new Error("vitest.setup: Permify stub failed to bind");
}
process.env.PERMIFY_URL = `http://127.0.0.1:${permifyAddr.port}`;

// Mock Redis for tests
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hset: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    ping: vi.fn().mockResolvedValue("PONG"),
    quit: vi.fn().mockResolvedValue("OK"),
  })),
}));

// Mock Kafka for tests
vi.mock("kafkajs", () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    producer: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue([{ topicName: "test", partition: 0, errorCode: 0 }]),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
    consumer: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

// Global test environment setup
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/insureportal_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.KAFKA_BROKERS = "localhost:9092";
