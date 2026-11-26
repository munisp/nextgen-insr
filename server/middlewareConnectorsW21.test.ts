/**
 * middlewareConnectorsW21.test.ts — 2026-11-26 (W21)
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the F4 finding (W20-B audit) in
 * server/middleware/middlewareConnectors.ts:
 *
 * `return res.json();` (no await) inside the connector try/catch blocks let a
 * JSON parse rejection (200/202 with a malformed body) ESCAPE the catch —
 * bypassing both the graceful `null` degradation AND the circuit-breaker
 * recordFailure(...), so a consistently-malformed upstream never tripped the
 * breaker. Fixed to `return await res.json();` (W19 load-bearing-await class).
 *
 * Malformed bodies are REAL `new Response("…not json…")` objects so
 * res.json() genuinely rejects (undici), not a stubbed throw. Fetch is
 * stubbed globally; permify/envValidation are module-mocked to keep the unit
 * hermetic (repo node_modules is husked); vi.resetModules() per test so the
 * module-level circuit map starts clean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./_core/permify", () => ({
  invalidatePermifyDecisionsForSubject: vi.fn(async () => {}),
}));

vi.mock("./lib/envValidation", () => ({
  getApisixAdminKey: () => "w21-dummy-apisix-key",
}));

const MALFORMED_BODY = "<html>502 Bad Gateway</html>"; // not JSON

function malformedResponse(status = 200) {
  return new Response(MALFORMED_BODY, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function freshModule() {
  vi.resetModules();
  return import("./middleware/middlewareConnectors");
}

beforeEach(() => {
  // nothing shared — each test stubs its own fetch
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("middlewareConnectors W21 — malformed upstream JSON hits catch + recordFailure", () => {
  it("keycloak.verifyToken: malformed 200 body degrades to null AND records a circuit failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => malformedResponse()));
    const m = await freshModule();

    // Pre-fix this REJECTED with the SyntaxError, escaping the catch.
    await expect(m.keycloak.verifyToken("tok")).resolves.toBeNull();
    const state = m.getCircuitStates().keycloak;
    expect(state.failures).toBe(1);
    expect(state.state).toBe("closed"); // below threshold of 5
  });

  it("keycloak.getUser: malformed 200 body on the admin API degrades to null AND records a failure", async () => {
    const fetchMock = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/protocol/openid-connect/token")) {
        return jsonResponse({ access_token: "adm", expires_in: 3600 });
      }
      return malformedResponse(); // /admin/realms/.../users/...
    });
    vi.stubGlobal("fetch", fetchMock);
    const m = await freshModule();

    await expect(m.keycloak.getUser("u1")).resolves.toBeNull();
    expect(m.getCircuitStates().keycloak.failures).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mojaloop.initiateTransfer: malformed 202 body (money-transfer path) degrades to null AND records a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => malformedResponse(202)));
    const m = await freshModule();

    await expect(
      m.mojaloop.initiateTransfer({
        payerFsp: "payer",
        payeeFsp: "payee",
        amount: { amount: "10.00", currency: "NGN" },
        transferId: "t-1",
      })
    ).resolves.toBeNull();
    expect(m.getCircuitStates().mojaloop.failures).toBe(1);
  });

  it("mojaloop.lookupParty: malformed 200 body degrades to null AND records a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => malformedResponse()));
    const m = await freshModule();

    await expect(m.mojaloop.lookupParty("MSISDN", "123")).resolves.toBeNull();
    expect(m.getCircuitStates().mojaloop.failures).toBe(1);
  });

  it("dapr.getState: malformed 200 body (ternary return) degrades to null AND records a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => malformedResponse()));
    const m = await freshModule();

    await expect(m.dapr.getState("store", "k")).resolves.toBeNull();
    expect(m.getCircuitStates().dapr.failures).toBe(1);
  });

  it("a consistently-malformed upstream now TRIPS the circuit breaker (5 failures → open, 6th call short-circuits)", async () => {
    const fetchMock = vi.fn(async () => malformedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const m = await freshModule();

    for (let i = 0; i < 5; i++) {
      await expect(m.keycloak.verifyToken("tok")).resolves.toBeNull();
    }
    const state = m.getCircuitStates().keycloak;
    expect(state.failures).toBe(5);
    expect(state.state).toBe("open");

    // Circuit open: canAttempt gates the call — no further fetch, still null.
    await expect(m.keycloak.verifyToken("tok")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("success contract unchanged: valid JSON resolves with the parsed body and resets the failure count", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => malformedResponse()) // 1 failure
      .mockImplementation(async () =>
        jsonResponse({ sub: "user-1", role: "admin" })
      );
    vi.stubGlobal("fetch", fetchMock);
    const m = await freshModule();

    await expect(m.keycloak.verifyToken("bad")).resolves.toBeNull();
    expect(m.getCircuitStates().keycloak.failures).toBe(1);

    await expect(m.keycloak.verifyToken("good")).resolves.toEqual({
      sub: "user-1",
      role: "admin",
    });
    expect(m.getCircuitStates().keycloak.failures).toBe(0);
    expect(m.getCircuitStates().keycloak.state).toBe("closed");
  });
});
