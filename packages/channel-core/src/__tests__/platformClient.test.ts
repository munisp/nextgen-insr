// 2026-10-03 (W8-B1): PlatformClient tests. The ONLY mock here is at the
// tRPC transport boundary (global fetch), which is exactly where the network
// edge lives; everything above it is real code.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlatformClient,
  loadPlatformConfig,
  PlatformConfigError,
  PlatformUnavailableError,
} from "../platformClient";

const CFG = {
  baseUrl: "https://platform.example",
  serviceToken: "tok",
  timeoutMs: 500,
  serviceName: "whatsapp-bot",
};

function fakeFetch(impl: (url: string, init?: any) => any) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPlatformConfig (fail-fast)", () => {
  it("throws when PLATFORM_API_URL is missing", () => {
    expect(() => loadPlatformConfig("whatsapp-bot", {})).toThrow(PlatformConfigError);
  });
  it("throws when PLATFORM_SERVICE_TOKEN is missing", () => {
    expect(() =>
      loadPlatformConfig("whatsapp-bot", { PLATFORM_API_URL: "https://x" })
    ).toThrow(PlatformConfigError);
  });
  it("loads with sane defaults and strips trailing slashes", () => {
    const cfg = loadPlatformConfig("whatsapp-bot", {
      PLATFORM_API_URL: "https://x/",
      PLATFORM_SERVICE_TOKEN: "t",
    });
    expect(cfg.baseUrl).toBe("https://x");
    expect(cfg.timeoutMs).toBe(8000);
  });
});

describe("PlatformClient transport", () => {
  it("query unwraps the superjson envelope and sends auth + caller scope", async () => {
    fakeFetch(async (url: string, init: any) => {
      expect(url).toContain("/api/trpc/insuranceProductCatalog.listProducts");
      expect(url).toContain(encodeURIComponent(JSON.stringify({ json: { a: 1 } })));
      expect(init.headers.authorization).toBe("Bearer tok");
      expect(init.headers["x-channel-service"]).toBe("whatsapp-bot");
      return {
        ok: true,
        json: async () => ({ result: { data: { json: { data: [1, 2], total: 2 } } } }),
      };
    });
    const client = createPlatformClient(CFG);
    const out = await client.query("insuranceProductCatalog.listProducts", { a: 1 });
    expect(out).toEqual({ data: [1, 2], total: 2 });
  });

  it("mutate uses POST with a superjson body", async () => {
    fakeFetch(async (_url: string, init: any) => {
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ json: { claim: 1 } });
      return { ok: true, json: async () => ({ result: { data: { json: { ok: true } } } }) };
    });
    const client = createPlatformClient(CFG);
    expect(await client.mutate("claims.submit", { claim: 1 })).toEqual({ ok: true });
  });

  it("maps HTTP rejection to PlatformUnavailableError with status", async () => {
    fakeFetch(async () => ({ ok: false, status: 503 }));
    const client = createPlatformClient(CFG);
    await expect(client.query("p", {})).rejects.toMatchObject({
      name: "PlatformUnavailableError",
      statusCode: 503,
    });
  });

  it("maps network/timeout failure to PlatformUnavailableError", async () => {
    fakeFetch(async () => {
      throw new Error("socket hang up");
    });
    const client = createPlatformClient(CFG);
    await expect(client.query("p", {})).rejects.toBeInstanceOf(PlatformUnavailableError);
  });

  it("maps a tRPC error payload to PlatformUnavailableError", async () => {
    fakeFetch(async () => ({
      ok: true,
      json: async () => ({ error: { message: "UNAUTHORIZED" } }),
    }));
    const client = createPlatformClient(CFG);
    await expect(client.query("p", {})).rejects.toThrow(/platform error/);
  });

  it("maps non-JSON responses to PlatformUnavailableError", async () => {
    fakeFetch(async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    }));
    const client = createPlatformClient(CFG);
    await expect(client.query("p", {})).rejects.toThrow(/non-JSON/);
  });
});
