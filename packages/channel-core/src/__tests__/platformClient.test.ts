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
  // 2026-10-03 (W8-B7): construction-time validation (fail-closed).
  it("rejects an unparseable PLATFORM_API_URL", () => {
    expect(() =>
      loadPlatformConfig("whatsapp-bot", {
        PLATFORM_API_URL: "not a url",
        PLATFORM_SERVICE_TOKEN: "t",
      })
    ).toThrow(PlatformConfigError);
  });
  it("rejects non-http(s) PLATFORM_API_URL schemes", () => {
    expect(() =>
      loadPlatformConfig("whatsapp-bot", {
        PLATFORM_API_URL: "ftp://platform.example",
        PLATFORM_SERVICE_TOKEN: "t",
      })
    ).toThrow(/http/);
  });
  it("rejects an explicitly invalid PLATFORM_API_TIMEOUT_MS (no silent default)", () => {
    for (const bad of ["abc", "0", "50", "999999"]) {
      expect(() =>
        loadPlatformConfig("whatsapp-bot", {
          PLATFORM_API_URL: "https://x",
          PLATFORM_SERVICE_TOKEN: "t",
          PLATFORM_API_TIMEOUT_MS: bad,
        })
      ).toThrow(/PLATFORM_API_TIMEOUT_MS/);
    }
    const ok = loadPlatformConfig("whatsapp-bot", {
      PLATFORM_API_URL: "https://x",
      PLATFORM_SERVICE_TOKEN: "t",
      PLATFORM_API_TIMEOUT_MS: "3000",
    });
    expect(ok.timeoutMs).toBe(3000);
  });
  it("rejects an empty serviceName", () => {
    expect(() =>
      loadPlatformConfig("  ", {
        PLATFORM_API_URL: "https://x",
        PLATFORM_SERVICE_TOKEN: "t",
      })
    ).toThrow(/serviceName/);
  });
});

describe("PlatformClient construction validation (DI path)", () => {
  it("throws on construction when config is invalid", () => {
    expect(() =>
      createPlatformClient({ ...CFG, baseUrl: "::bad::" })
    ).toThrow(PlatformConfigError);
    expect(() => createPlatformClient({ ...CFG, serviceToken: " " })).toThrow(
      /serviceToken/
    );
    expect(() => createPlatformClient({ ...CFG, timeoutMs: -1 })).toThrow(/timeoutMs/);
    expect(() => createPlatformClient({ ...CFG, serviceName: "" })).toThrow(
      /serviceName/
    );
  });
  it("normalizes trailing slashes on baseUrl", () => {
    const client = createPlatformClient({ ...CFG, baseUrl: "https://platform.example///" });
    // Indirect proof: request URL has no double slash before /api/trpc.
    fakeFetch(async (url: string) => {
      expect(url).toContain("https://platform.example/api/trpc/p");
      return { ok: true, json: async () => ({ result: { data: { json: 1 } } }) };
    });
    return client.query("p", {}).then((out) => expect(out).toBe(1));
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
