/**
 * 2026-11-26 (W22, audit F6): SECURITY_FAIL_OPEN posture matrix.
 *
 * Contract under test (server/middleware/securityOrchestrator.ts):
 *   - SECURITY_FAIL_OPEN === "true"           → fail-open (explicit opt-in,
 *     loud warning) in ANY NODE_ENV.
 *   - NODE_ENV exactly "development" / unset  → documented local-dev escape:
 *     fail-open unless SECURITY_FAIL_OPEN === "false".
 *   - Any other NODE_ENV (production, staging, test, …) → fail-CLOSED unless
 *     the explicit literal is set. Fail-open can no longer be inherited
 *     accidentally from NODE_ENV (previously staging silently failed open).
 *
 * Deny-contracts asserted with sidecars UNREACHABLE (connection refused):
 *   - DDoS layer  → HTTP 429 (fail-closed) / next() (fail-open)
 *   - PBAC layer  → HTTP 403 (fail-closed) / next() (fail-open)
 *   - Fraud layer → unreachable scorer yields a null score and next() in
 *     BOTH modes (pre-existing behavior: a null score never blocks; only a
 *     thrown exception blocks when fail-closed) — asserted for parity.
 *
 * FAIL_OPEN is computed at module load, so each scenario re-imports the
 * module under a stubbed env (vi.resetModules + vi.stubEnv).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Port 1: connection refused immediately — sidecars deterministically down.
const DEAD_URL = "http://127.0.0.1:1";

function stubBaseEnv() {
  vi.stubEnv("DDOS_SHIELD_URL", DEAD_URL);
  vi.stubEnv("PBAC_ENGINE_URL", DEAD_URL);
  vi.stubEnv("FRAUD_ML_URL", DEAD_URL);
  vi.stubEnv("SECURITY_SERVICE_TIMEOUT", "500");
}

function makeApp() {
  const layers: any[] = [];
  const routes: Record<string, any> = {};
  const app: any = {
    use: (fn: any) => layers.push(fn),
    get: (p: string, fn: any) => {
      routes[`GET ${p}`] = fn;
    },
    post: (p: string, fn: any) => {
      routes[`POST ${p}`] = fn;
    },
  };
  return { app, layers, routes };
}

function makeReq(over: Record<string, any> = {}): any {
  return {
    path: "/api/policies",
    method: "GET",
    ip: "203.0.113.7",
    headers: {},
    socket: { remoteAddress: "203.0.113.7" },
    user: { id: 42, role: "user", kycLevel: 1 },
    ...over,
  };
}

function makeRes(): any {
  const r: any = { headers: {} as Record<string, string> };
  r.status = (code: number) => {
    r.statusCode = code;
    return r;
  };
  r.json = (body: any) => {
    r.body = body;
    return r;
  };
  r.setHeader = (k: string, v: string) => {
    r.headers[k] = v;
  };
  return r;
}

async function runLayer(layer: any, req: any, res: any): Promise<boolean> {
  let nexted = false;
  await layer(req, res, () => {
    nexted = true;
  });
  return nexted;
}

interface OrchestratorHandle {
  layers: any[];
  routes: Record<string, any>;
  logger: any;
}

async function loadOrchestrator(env: {
  NODE_ENV?: string; // undefined → truly unset (deleted)
  SECURITY_FAIL_OPEN?: string;
}): Promise<OrchestratorHandle> {
  vi.resetModules();
  stubBaseEnv();
  if (env.NODE_ENV === undefined) {
    vi.stubEnv("NODE_ENV", undefined as unknown as string); // deleted
  } else {
    vi.stubEnv("NODE_ENV", env.NODE_ENV);
  }
  if (env.SECURITY_FAIL_OPEN === undefined) {
    vi.stubEnv("SECURITY_FAIL_OPEN", undefined as unknown as string);
  } else {
    vi.stubEnv("SECURITY_FAIL_OPEN", env.SECURITY_FAIL_OPEN);
  }
  // Import logger AFTER resetModules so the spy attaches to the same
  // instance the re-imported orchestrator module will use.
  const { logger } = await import("../../_core/logger");
  const mod = await import("../securityOrchestrator");
  const { app, layers, routes } = makeApp();
  mod.applySecurityOrchestrator(app);
  return { layers, routes, logger };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("W22/F6: SECURITY_FAIL_OPEN requires explicit opt-in", () => {
  it("staging WITHOUT the flag → fail-CLOSED (DDoS 429, PBAC 403, health fail_open=false)", async () => {
    const { layers, routes } = await loadOrchestrator({ NODE_ENV: "staging" });

    const ddosRes = makeRes();
    expect(await runLayer(layers[0], makeReq(), ddosRes)).toBe(false);
    expect(ddosRes.statusCode).toBe(429);

    const pbacRes = makeRes();
    expect(await runLayer(layers[1], makeReq(), pbacRes)).toBe(false);
    expect(pbacRes.statusCode).toBe(403);

    const healthRes = makeRes();
    await routes["GET /api/security/health"](makeReq(), healthRes);
    expect(healthRes.body.fail_open).toBe(false);
    expect(healthRes.body.status).toBe("degraded");
  });

  it("staging WITH explicit SECURITY_FAIL_OPEN=true → fail-open", async () => {
    // (The loud load-time warning for this posture is asserted in the
    // dedicated warning test below, with spies attached before import.)
    const { layers, routes } = await loadOrchestrator({
      NODE_ENV: "staging",
      SECURITY_FAIL_OPEN: "true",
    });

    const ddosRes = makeRes();
    expect(await runLayer(layers[0], makeReq(), ddosRes)).toBe(true);
    expect(ddosRes.statusCode).toBeUndefined();

    const pbacRes = makeRes();
    expect(await runLayer(layers[1], makeReq(), pbacRes)).toBe(true);
    expect(pbacRes.statusCode).toBeUndefined();

    const healthRes = makeRes();
    await routes["GET /api/security/health"](makeReq(), healthRes);
    expect(healthRes.body.fail_open).toBe(true);
  });

  it("production WITHOUT the flag → fail-CLOSED (unchanged pre-W22 behavior)", async () => {
    const { layers, routes } = await loadOrchestrator({ NODE_ENV: "production" });

    const ddosRes = makeRes();
    expect(await runLayer(layers[0], makeReq(), ddosRes)).toBe(false);
    expect(ddosRes.statusCode).toBe(429);

    const pbacRes = makeRes();
    expect(await runLayer(layers[1], makeReq(), pbacRes)).toBe(false);
    expect(pbacRes.statusCode).toBe(403);

    const healthRes = makeRes();
    await routes["GET /api/security/health"](makeReq(), healthRes);
    expect(healthRes.body.fail_open).toBe(false);
  });

  it("production WITH explicit SECURITY_FAIL_OPEN=true → fail-open (unchanged pre-W22 behavior)", async () => {
    const { layers, routes } = await loadOrchestrator({
      NODE_ENV: "production",
      SECURITY_FAIL_OPEN: "true",
    });

    expect(await runLayer(layers[0], makeReq(), makeRes())).toBe(true);
    expect(await runLayer(layers[1], makeReq(), makeRes())).toBe(true);

    const healthRes = makeRes();
    await routes["GET /api/security/health"](makeReq(), healthRes);
    expect(healthRes.body.fail_open).toBe(true);
  });

  it("development WITHOUT the flag → fail-open (documented local-dev escape)", async () => {
    const { layers, routes } = await loadOrchestrator({ NODE_ENV: "development" });

    expect(await runLayer(layers[0], makeReq(), makeRes())).toBe(true);
    expect(await runLayer(layers[1], makeReq(), makeRes())).toBe(true);

    const healthRes = makeRes();
    await routes["GET /api/security/health"](makeReq(), healthRes);
    expect(healthRes.body.fail_open).toBe(true);
  });

  it("development WITH SECURITY_FAIL_OPEN=false → fail-CLOSED (escape is overridable)", async () => {
    const { layers } = await loadOrchestrator({
      NODE_ENV: "development",
      SECURITY_FAIL_OPEN: "false",
    });

    const ddosRes = makeRes();
    expect(await runLayer(layers[0], makeReq(), ddosRes)).toBe(false);
    expect(ddosRes.statusCode).toBe(429);
  });

  it("NODE_ENV unset WITHOUT the flag → fail-open (local-dev escape)", async () => {
    const { layers, routes } = await loadOrchestrator({});

    expect(await runLayer(layers[0], makeReq(), makeRes())).toBe(true);

    const healthRes = makeRes();
    await routes["GET /api/security/health"](makeReq(), healthRes);
    expect(healthRes.body.fail_open).toBe(true);
  });

  it("test WITHOUT the flag → fail-CLOSED (test is not a local-dev escape)", async () => {
    const { layers } = await loadOrchestrator({ NODE_ENV: "test" });

    const ddosRes = makeRes();
    expect(await runLayer(layers[0], makeReq(), ddosRes)).toBe(false);
    expect(ddosRes.statusCode).toBe(429);
  });

  it("fraud layer: unreachable scorer → null score → next() in BOTH postures (pre-existing parity)", async () => {
    const txReq = () =>
      makeReq({
        path: "/api/transactions/create",
        method: "POST",
        body: { amount: 5000 },
      });

    const closed = await loadOrchestrator({ NODE_ENV: "staging" });
    expect(await runLayer(closed.layers[2], txReq(), makeRes())).toBe(true);

    const open = await loadOrchestrator({
      NODE_ENV: "staging",
      SECURITY_FAIL_OPEN: "true",
    });
    expect(await runLayer(open.layers[2], txReq(), makeRes())).toBe(true);
  });

  it("fail-open warning fires at module load (warn in local dev, error otherwise)", async () => {
    // Local dev escape → warn-level.
    vi.resetModules();
    stubBaseEnv();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SECURITY_FAIL_OPEN", undefined as unknown as string);
    const devLogger = (await import("../../_core/logger")).logger;
    const devWarn = vi.spyOn(devLogger, "warn");
    await import("../securityOrchestrator");
    expect(
      devWarn.mock.calls.some((c) =>
        String(c[0]).includes("SECURITY_FAIL_OPEN ACTIVE")
      )
    ).toBe(true);

    // Staging explicit opt-in → error-level.
    vi.resetModules();
    stubBaseEnv();
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("SECURITY_FAIL_OPEN", "true");
    const stgLogger = (await import("../../_core/logger")).logger;
    const stgError = vi.spyOn(stgLogger, "error");
    await import("../securityOrchestrator");
    expect(
      stgError.mock.calls.some((c) =>
        String(c[0]).includes("SECURITY_FAIL_OPEN ACTIVE")
      )
    ).toBe(true);

    // Staging fail-closed → NO fail-open warning.
    vi.resetModules();
    stubBaseEnv();
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("SECURITY_FAIL_OPEN", undefined as unknown as string);
    const closedLogger = (await import("../../_core/logger")).logger;
    const closedError = vi.spyOn(closedLogger, "error");
    await import("../securityOrchestrator");
    expect(
      closedError.mock.calls.some((c) =>
        String(c[0]).includes("SECURITY_FAIL_OPEN ACTIVE")
      )
    ).toBe(false);
  });
});
