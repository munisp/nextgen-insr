/**
 * actuaryAdapter.test.ts — W34-D (2026-11-28) acceptance tests for
 * server/actuaryAdapter.ts circuit-breaker semantics, mirroring the
 * goServiceBridge constants (failure threshold 5, reset timeout 30 s,
 * fetchWithTimeout retries/backoff).
 *
 * Wire-double policy: the pricing service is doubled at the HTTP BOUNDARY
 * with a real in-process node:http server (platform precedent — identical
 * to the Permify wire-protocol double in vitest.setup.ts); the adapter's
 * production code path (breaker → fetchWithTimeout → fetch) runs unmodified.
 * No mocks/stubs on the compute path.
 *
 * Semantics asserted (identical to goServiceBridge's model):
 *   1. 5 consecutive failures trip the circuit OPEN.
 *   2. OPEN circuits fail fast — no HTTP request is emitted (6th call never
 *      reaches the server).
 *   3. After the reset timeout elapses the circuit moves to HALF-OPEN and
 *      emits exactly one probe (the resetTimeoutMs is injected short —
 *      100 ms — so the 30 s production wall-clock is not needed; threshold
 *      5 and the state machine itself are unchanged).
 *   4. A successful probe CLOSES the circuit and resets the failure count
 *      (recovery).
 *   5. A FAILED probe re-OPENS the circuit.
 *   6. fetchWithTimeout retries with backoff: 2 transient network failures
 *      then a success on attempt 3 still yields the response (retries=3).
 *   7. The Go service's own fail-closed 503 (no approved rate version —
 *      design Appendix I step 3) surfaces as ActuaryServiceRefusedError and
 *      counts toward the breaker; a 4xx caller error does NOT trip it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createActuaryAdapter,
  ActuaryServiceRefusedError,
  ActuaryServiceUnavailableError,
} from "../../server/actuaryAdapter";

// ── Programmable in-process fake pricing service (HTTP-boundary double) ────
let server: http.Server;
let baseUrl: string;
let hitCount: number;
type Behaviour =
  | { kind: "ok" }
  | { kind: "hangup" } // TCP destroy → network failure (ECONNRESET)
  | { kind: "status"; status: number; body?: unknown };

let behaviour: Behaviour = { kind: "ok" };

const GOLDEN_RATE = {
  purePremium: 4200.5,
  loadings: { expense: 1200, commission: 800, profit: 350 },
  taxes: [{ code: "VAT", amountKobo: 75000 }],
  totalPremiumKobo: 560050,
  rateVersion: "2026.09",
  decision: "accept",
  reasonCodes: [],
  accumulationDelta: 500000,
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hitCount += 1;
    if (behaviour.kind === "hangup") {
      // Destroy the socket → the adapter sees a network error, exactly the
      // outage class the breaker exists for.
      req.socket.destroy();
      res.socket.destroy();
      return;
    }
    if (behaviour.kind === "status") {
      res.writeHead(behaviour.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          behaviour.body ?? {
            error: `status ${behaviour.status}`,
          }
        )
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/rate") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(GOLDEN_RATE));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const QUOTE = {
  productLine: "motor",
  variables: { vehicle_class: "saloon", age_band: "2" },
  sumInsured: 5_000_000,
  exposures: 1,
  geoCell: "lagos_mainland",
  quoteRef: "Q-TEST-1",
};

describe("W34-D: actuaryAdapter circuit breaker (goServiceBridge semantics)", () => {
  it("5 consecutive failures trip OPEN; 6th call fails fast WITHOUT hitting the server", async () => {
    const adapter = createActuaryAdapter({
      baseUrl,
      retries: 1, // one attempt per call → each call is exactly one failure
      timeoutMs: 500,
    });
    behaviour = { kind: "hangup" };
    hitCount = 0;

    for (let i = 0; i < 5; i++) {
      await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
        ActuaryServiceUnavailableError
      );
    }
    expect(adapter.circuitState()).toBe("open");
    expect(adapter.circuitFailures()).toBe(5);
    const hitsAfter5 = hitCount;
    expect(hitsAfter5).toBe(5);

    // 6th call: fail-fast, no HTTP request emitted.
    await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
      ActuaryServiceUnavailableError
    );
    expect(hitCount).toBe(hitsAfter5);
  });

  it("after the reset timeout a half-open probe succeeds → CLOSED + failures reset (recovery)", async () => {
    const adapter = createActuaryAdapter({
      baseUrl,
      retries: 1,
      timeoutMs: 500,
      // Injected short reset so the wall-clock 30 s production value is not
      // needed — threshold and state machine remain the production ones.
      resetTimeoutMs: 100,
    });
    behaviour = { kind: "hangup" };
    for (let i = 0; i < 5; i++) {
      await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
        ActuaryServiceUnavailableError
      );
    }
    expect(adapter.circuitState()).toBe("open");

    await new Promise(r => setTimeout(r, 120)); // reset window elapses
    behaviour = { kind: "ok" };
    const res = await adapter.rate(QUOTE); // the single half-open probe
    expect(res).toEqual(GOLDEN_RATE);
    expect(adapter.circuitState()).toBe("closed");
    expect(adapter.circuitFailures()).toBe(0);

    // Circuit healthy again: subsequent calls flow normally.
    const again = await adapter.rate(QUOTE);
    expect(again).toEqual(GOLDEN_RATE);
  });

  it("a FAILED half-open probe re-OPENS the circuit", async () => {
    const adapter = createActuaryAdapter({
      baseUrl,
      retries: 1,
      timeoutMs: 500,
      resetTimeoutMs: 100,
    });
    behaviour = { kind: "hangup" };
    for (let i = 0; i < 5; i++) {
      await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
        ActuaryServiceUnavailableError
      );
    }
    await new Promise(r => setTimeout(r, 120));
    // Probe also fails → re-open.
    await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
      ActuaryServiceUnavailableError
    );
    expect(adapter.circuitState()).toBe("open");
    expect(adapter.circuitFailures()).toBeGreaterThanOrEqual(5);
  });

  it("fetchWithTimeout retries with backoff: transient failures then success still yields the response", async () => {
    // retries=3 (goServiceBridge default): hang up the first two attempts,
    // then answer OK on the third.
    let attempt = 0;
    const flaky = http.createServer((req, res) => {
      attempt += 1;
      if (attempt < 3) {
        req.socket.destroy();
        res.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(GOLDEN_RATE));
    });
    await new Promise<void>(r => flaky.listen(0, "127.0.0.1", () => r()));
    const flakyAddr = flaky.address() as AddressInfo;
    try {
      const adapter = createActuaryAdapter({
        baseUrl: `http://127.0.0.1:${flakyAddr.port}`,
        retries: 3,
        timeoutMs: 1000,
      });
      const res = await adapter.rate(QUOTE);
      expect(res).toEqual(GOLDEN_RATE);
      expect(attempt).toBe(3); // two failures + one success
      // Successes do not leave the circuit degraded.
      expect(adapter.circuitState()).toBe("closed");
    } finally {
      await new Promise<void>(r => flaky.close(() => r()));
    }
  });

  it("the Go service's own fail-closed 503 counts toward the breaker; a 4xx does NOT", async () => {
    const adapter = createActuaryAdapter({
      baseUrl,
      retries: 1,
      timeoutMs: 500,
    });
    behaviour = { kind: "status", status: 503, body: { error: "no approved rate version for managed line" } };
    await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
      ActuaryServiceRefusedError
    );
    expect(adapter.circuitFailures()).toBe(1);

    behaviour = { kind: "status", status: 400, body: { error: "invalid variables" } };
    await expect(adapter.rate(QUOTE)).rejects.toBeInstanceOf(
      ActuaryServiceRefusedError
    );
    // Caller errors are not service failures — breaker count unchanged.
    expect(adapter.circuitFailures()).toBe(1);
    expect(adapter.circuitState()).toBe("closed");
  });
});
