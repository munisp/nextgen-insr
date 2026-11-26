/**
 * 2026-11-26 (W22, audit F7): Permify fail-open boot-guard env matrix.
 *
 * Contract under test (server/_core/permify.ts, module-load guard):
 *   - PERMIFY_FAIL_OPEN=true + NODE_ENV ∈ {production, staging} WITHOUT
 *     PERMIFY_FAIL_OPEN_INCIDENT_ACK=true → module load THROWS (boot refusal).
 *   - Same with the incident-ack token → boots (declared-incident escape).
 *   - PERMIFY_FAIL_OPEN unset/false → boots in every NODE_ENV (fail-closed
 *     default; no guard needed).
 *   - NODE_ENV development / test / unset + PERMIFY_FAIL_OPEN=true → boots
 *     (local dev & integration-suite exemption; the integration suite boots
 *     with PERMIFY_FAIL_OPEN=true deliberately).
 *
 * Production behavior is unchanged from pre-W22 (Dockerfile sets
 * NODE_ENV=production): production + fail-open + no ack still refuses.
 *
 * The guard runs at module load, so each case re-imports the module under a
 * stubbed env (vi.resetModules + vi.stubEnv). NOTE: the unit vitest config
 * injects PERMIFY_FAIL_OPEN=true globally — every case below stubs the flag
 * explicitly so the matrix is exact.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

function stubEnv(env: {
  NODE_ENV?: string; // undefined → deleted (unset)
  PERMIFY_FAIL_OPEN?: string; // undefined → deleted
  PERMIFY_FAIL_OPEN_INCIDENT_ACK?: string; // undefined → deleted
}) {
  vi.resetModules();
  for (const key of [
    "NODE_ENV",
    "PERMIFY_FAIL_OPEN",
    "PERMIFY_FAIL_OPEN_INCIDENT_ACK",
  ] as const) {
    const v = env[key];
    // vitest ≥1.2: stubbing undefined deletes the variable for the stub
    // duration; originals (incl. the config-injected PERMIFY_FAIL_OPEN=true)
    // are restored by vi.unstubAllEnvs().
    vi.stubEnv(key, v as unknown as string);
  }
}

async function importPermify(): Promise<unknown> {
  return import("../permify");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("W22/F7: Permify fail-open boot-guard covers staging", () => {
  it("staging + PERMIFY_FAIL_OPEN=true + no incident ack → REFUSES TO BOOT", async () => {
    stubEnv({ NODE_ENV: "staging", PERMIFY_FAIL_OPEN: "true" });
    await expect(importPermify()).rejects.toThrow(
      /PERMIFY_FAIL_OPEN=true is forbidden when NODE_ENV is production or staging/
    );
  });

  it("staging + fail-open + PERMIFY_FAIL_OPEN_INCIDENT_ACK=true → boots (declared-incident escape)", async () => {
    stubEnv({
      NODE_ENV: "staging",
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_FAIL_OPEN_INCIDENT_ACK: "true",
    });
    const mod: any = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("staging WITHOUT PERMIFY_FAIL_OPEN → boots fail-closed (default)", async () => {
    stubEnv({ NODE_ENV: "staging" });
    const mod: any = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("production + PERMIFY_FAIL_OPEN=true + no incident ack → REFUSES TO BOOT (unchanged pre-W22)", async () => {
    stubEnv({ NODE_ENV: "production", PERMIFY_FAIL_OPEN: "true" });
    await expect(importPermify()).rejects.toThrow(
      /PERMIFY_FAIL_OPEN=true is forbidden/
    );
  });

  it("production + fail-open + incident ack → boots (unchanged pre-W22 escape)", async () => {
    stubEnv({
      NODE_ENV: "production",
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_FAIL_OPEN_INCIDENT_ACK: "true",
    });
    const mod: any = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("development + PERMIFY_FAIL_OPEN=true → boots (local-dev exemption)", async () => {
    stubEnv({ NODE_ENV: "development", PERMIFY_FAIL_OPEN: "true" });
    const mod: any = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("test + PERMIFY_FAIL_OPEN=true → boots (integration-suite exemption)", async () => {
    stubEnv({ NODE_ENV: "test", PERMIFY_FAIL_OPEN: "true" });
    const mod: any = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });

  it("unset NODE_ENV + PERMIFY_FAIL_OPEN=true → boots (unset is not a deployed-env marker)", async () => {
    stubEnv({ PERMIFY_FAIL_OPEN: "true" });
    const mod: any = await importPermify();
    expect(typeof mod.permifyCheck).toBe("function");
  });
});
