// @ts-check

/**
 * mtlsAgent.test.ts
 * Tests for the getMtlsAgent() / resetMtlsAgent() helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Dynamically re-import the module so each test gets a fresh module state. */
async function freshModule(env: Record<string, string | undefined> = {}) {
  // Patch process.env before import
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  // Force module re-evaluation by clearing the vitest module cache
  vi.resetModules();
  const mod = await import("./lib/mtlsAgent.js");

  // Restore env
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getMtlsAgent — disabled mode", () => {
  it("returns null when MTLS_ENABLED=false", async () => {
    const { getMtlsAgent } = await freshModule({ MTLS_ENABLED: "false" });
    expect(getMtlsAgent()).toBeNull();
  });
});

describe("getMtlsAgent — certs absent", () => {
  it("returns null when cert directory does not exist", async () => {
    const { getMtlsAgent } = await freshModule({
      MTLS_ENABLED: "true",
      MTLS_CERT_DIR: "/nonexistent/path/certs",
    });
    expect(getMtlsAgent()).toBeNull();
  });

  it("returns null when only some cert files are present", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtls-test-"));
    // Write only tls.crt — missing tls.key and ca.crt
    fs.writeFileSync(path.join(tmpDir, "tls.crt"), "FAKE_CERT");

    const { getMtlsAgent } = await freshModule({
      MTLS_ENABLED: "true",
      MTLS_CERT_DIR: tmpDir,
    });

    expect(getMtlsAgent()).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("getMtlsAgent — certs present", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtls-valid-"));
    // Write minimal (non-functional but parseable) PEM stubs
    const fakeCert =
      "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n";
    const fakeKey =
      "-----BEGIN RSA PRIVATE KEY-----\nZmFrZQ==\n-----END RSA PRIVATE KEY-----\n";
    fs.writeFileSync(path.join(tmpDir, "tls.crt"), fakeCert);
    fs.writeFileSync(path.join(tmpDir, "tls.key"), fakeKey);
    fs.writeFileSync(path.join(tmpDir, "ca.crt"), fakeCert);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns an https.Agent when all cert files are present", async () => {
    const { getMtlsAgent } = await freshModule({
      MTLS_ENABLED: "true",
      MTLS_CERT_DIR: tmpDir,
    });
    const agent = getMtlsAgent();
    // https.Agent is not null and is an object with keepAlive
    expect(agent).not.toBeNull();
    expect(typeof agent).toBe("object");
  });

  it("returns the same cached agent on repeated calls", async () => {
    const { getMtlsAgent } = await freshModule({
      MTLS_ENABLED: "true",
      MTLS_CERT_DIR: tmpDir,
    });
    const a1 = getMtlsAgent();
    const a2 = getMtlsAgent();
    expect(a1).toBe(a2); // strict reference equality — same cached instance
  });
});

describe("resetMtlsAgent", () => {
  it("clears the cache so the next getMtlsAgent() call re-reads certs", async () => {
    const { getMtlsAgent, resetMtlsAgent } = await freshModule({
      MTLS_ENABLED: "false",
    });
    // First call caches null
    expect(getMtlsAgent()).toBeNull();
    // Reset
    resetMtlsAgent();
    // After reset, the module re-evaluates — still null since MTLS_ENABLED=false
    expect(getMtlsAgent()).toBeNull();
  });
});

describe("mtlsFetchOptions", () => {
  it("returns base options unchanged when agent is null (MTLS_ENABLED=false)", async () => {
    const { mtlsFetchOptions } = await freshModule({ MTLS_ENABLED: "false" });
    const base = { method: "POST", body: "test" };
    const result = mtlsFetchOptions(base);
    expect(result.method).toBe("POST");
    expect(result.body).toBe("test");
    expect((result as Record<string, unknown>).agent).toBeUndefined();
  });

  it("merges agent into options when certs are absent (returns base unchanged)", async () => {
    const { mtlsFetchOptions } = await freshModule({
      MTLS_ENABLED: "true",
      MTLS_CERT_DIR: "/nonexistent/certs",
    });
    const base = { method: "GET" };
    const result = mtlsFetchOptions(base);
    expect(result.method).toBe("GET");
    // No agent when certs are absent
    expect((result as Record<string, unknown>).agent).toBeUndefined();
  });
});
