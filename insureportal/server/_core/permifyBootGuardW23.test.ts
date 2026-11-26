/**
 * 2026-11-26 (W23): insureportal Permify fail-open boot-guard env matrix —
 * ported from the main repo's server/_core/__tests__/permifyBootGuardW22.test.ts
 * (W22, audit F7) after this client's outage fallback was found to be an
 * unconditional fail-open (see the W23 block in ./permify.ts).
 *
 * Contract under test (insureportal/server/_core/permify.ts, module-load guard):
 *   - PERMIFY_FAIL_OPEN=true + NODE_ENV ∈ {production, staging} WITHOUT
 *     PERMIFY_FAIL_OPEN_INCIDENT_ACK=true → module load THROWS (boot refusal).
 *   - Same with the incident-ack token → boots (declared-incident escape).
 *   - PERMIFY_FAIL_OPEN unset/false → boots in every NODE_ENV (fail-closed
 *     default; no guard needed).
 *   - NODE_ENV development / test / unset + PERMIFY_FAIL_OPEN=true → boots
 *     (local dev & test exemption).
 *
 * Plus the gated fallback behavior itself (Permify pointed at an unreachable
 * port): default → deny (fail-closed); PERMIFY_FAIL_OPEN=true → allow.
 *
 * The guard runs at module load, so each case re-imports the module under a
 * stubbed env (vi.resetModules + vi.stubEnv). Every case stubs all four
 * variables explicitly so the matrix is exact regardless of shell env.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

function stubEnv(env: {
  NODE_ENV?: string; // undefined → deleted (unset)
  PERMIFY_FAIL_OPEN?: string; // undefined → deleted
  PERMIFY_FAIL_OPEN_INCIDENT_ACK?: string; // undefined → deleted
  PERMIFY_URL?: string; // undefined → deleted
}) {
  vi.resetModules();
  for (const key of [
    "NODE_ENV",
    "PERMIFY_FAIL_OPEN",
    "PERMIFY_FAIL_OPEN_INCIDENT_ACK",
    "PERMIFY_URL",
  ] as const) {
    const v = env[key];
    // vitest ≥1.2: stubbing undefined deletes the variable for the stub
    // duration; originals are restored by vi.unstubAllEnvs().
    vi.stubEnv(key, v as unknown as string);
  }
}

async function importPermify(): Promise<any> {
  return import("./permify");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("W23: insureportal Permify fail-open boot-guard covers production/staging", () => {
  it("production + PERMIFY_FAIL_OPEN=true + no incident ack → REFUSES TO BOOT", async () => {
    stubEnv({ NODE_ENV: "production", PERMIFY_FAIL_OPEN: "true" });
    await expect(importPermify()).rejects.toThrow(
      /PERMIFY_FAIL_OPEN=true is forbidden when NODE_ENV is production or staging/
    );
  });

  it("staging + PERMIFY_FAIL_OPEN=true + no incident ack → REFUSES TO BOOT", async () => {
    stubEnv({ NODE_ENV: "staging", PERMIFY_FAIL_OPEN: "true" });
    await expect(importPermify()).rejects.toThrow(
      /PERMIFY_FAIL_OPEN=true is forbidden when NODE_ENV is production or staging/
    );
  });

  it("production + fail-open + PERMIFY_FAIL_OPEN_INCIDENT_ACK=true → boots (declared-incident escape)", async () => {
    stubEnv({
      NODE_ENV: "production",
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_FAIL_OPEN_INCIDENT_ACK: "true",
    });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("staging + fail-open + PERMIFY_FAIL_OPEN_INCIDENT_ACK=true → boots (declared-incident escape)", async () => {
    stubEnv({
      NODE_ENV: "staging",
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_FAIL_OPEN_INCIDENT_ACK: "true",
    });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("production WITHOUT PERMIFY_FAIL_OPEN → boots fail-closed (default)", async () => {
    stubEnv({ NODE_ENV: "production" });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("staging WITHOUT PERMIFY_FAIL_OPEN → boots fail-closed (default)", async () => {
    stubEnv({ NODE_ENV: "staging" });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("development + PERMIFY_FAIL_OPEN=true → boots (local-dev exemption)", async () => {
    stubEnv({ NODE_ENV: "development", PERMIFY_FAIL_OPEN: "true" });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("test + PERMIFY_FAIL_OPEN=true → boots (test exemption)", async () => {
    stubEnv({ NODE_ENV: "test", PERMIFY_FAIL_OPEN: "true" });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("unset NODE_ENV + PERMIFY_FAIL_OPEN=true → boots (unset is not a deployed-env marker)", async () => {
    stubEnv({ PERMIFY_FAIL_OPEN: "true" });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("PERMIFY_FAIL_OPEN=false (non-literal) + production → boots fail-closed (flag is literal 'true' only)", async () => {
    stubEnv({ NODE_ENV: "production", PERMIFY_FAIL_OPEN: "false" });
    const mod = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });
});

describe("W23: gated outage fallback behavior (Permify unreachable)", () => {
  // Port 9 (discard) is refused immediately — no 2s timeout wait.
  const DOWN = "http://127.0.0.1:9";
  const CHECK = {
    subjectType: "agent",
    subjectId: "agent-1",
    entityType: "transaction",
    entityId: "tx-1",
    permission: "read",
  };

  it("default (no flag): Permify unreachable → DENIES (fail-closed; pre-W23 this allowed)", async () => {
    stubEnv({ NODE_ENV: "test", PERMIFY_URL: DOWN });
    const mod = await importPermify();
    await expect(mod.permifyCheck(CHECK)).resolves.toBe(false);
  });

  it("PERMIFY_FAIL_OPEN=true: Permify unreachable → ALLOWS (explicit insecure opt-in, pre-W23 default)", async () => {
    stubEnv({ NODE_ENV: "test", PERMIFY_FAIL_OPEN: "true", PERMIFY_URL: DOWN });
    const mod = await importPermify();
    await expect(mod.permifyCheck(CHECK)).resolves.toBe(true);
  });
});
