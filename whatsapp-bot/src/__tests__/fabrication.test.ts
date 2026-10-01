// 2026-10-01 (R1a): Fabrication regression tests. Prove that with the
// platform backend UNREACHABLE the bot never emits fabricated claim refs
// (NGA-CLM-...), payment receipts (PAY-...), policy refs (NGA-MTR-...) or
// invented statuses — every transactional intent fails closed and honest.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConversationEngine } from "../engine/conversation";
import { InsuranceIntentClassifier } from "../engine/intent";
import {
  PlatformClient,
  loadPlatformConfig,
  PlatformConfigError,
} from "../clients/platform";

// Port 1 on loopback is unreachable — connection refused immediately.
const UNREACHABLE = loadPlatformConfig({
  PLATFORM_API_URL: "http://127.0.0.1:1",
  PLATFORM_SERVICE_TOKEN: "test-token",
} as NodeJS.ProcessEnv);

const FABRICATED = [/NGA-CLM-/i, /NGA-MTR-/i, /\bPAY-[A-Z0-9]{4,}/i, /Status: Active/i];

function expectHonestFailure(text: string): void {
  for (const pattern of FABRICATED) {
    expect(text).not.toMatch(pattern);
  }
  expect(text.toLowerCase()).toContain("couldn't verify");
}

describe("fail-closed behavior with backend unreachable", () => {
  let engine: ConversationEngine;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    engine = new ConversationEngine(
      new InsuranceIntentClassifier(),
      new PlatformClient(UNREACHABLE)
    );
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it("claim flow never fabricates a claim reference", async () => {
    const phone = "2349000000001";
    await engine.processMessage(phone, "file a claim");
    await engine.processMessage(phone, "POL-12345");
    await engine.processMessage(phone, "claim_accident");
    await engine.processMessage(phone, "Someone rear-ended me at the junction");
    const final = await engine.processMessage(phone, "skip");
    expectHonestFailure(final.text);
    expect(errSpy).toHaveBeenCalled(); // logged loudly
  });

  it("policy check never fabricates an Active status", async () => {
    const phone = "2349000000002";
    await engine.processMessage(phone, "check my policy");
    const res = await engine.processMessage(phone, "POL-99999");
    expectHonestFailure(res.text);
    expect(errSpy).toHaveBeenCalled();
  });

  it("premium payment fails closed immediately with no fake amount or receipt", async () => {
    const phone = "2349000000003";
    const res = await engine.processMessage(phone, "pay my premium");
    expectHonestFailure(res.text);
    expect(res.text).not.toContain("5,000");
    expect(errSpy).toHaveBeenCalled();
  });

  it("motor quote fails closed instead of inventing a premium/policy ref", async () => {
    const phone = "2349000000004";
    await engine.processMessage(phone, "motor insurance");
    await engine.processMessage(phone, "motor_comp");
    await engine.processMessage(phone, "ABC-123-XY");
    const res = await engine.processMessage(phone, "3500000");
    expectHonestFailure(res.text);
    expect(errSpy).toHaveBeenCalled();
  });

  it("menu button ids resolve to real intents (no unknown fallthrough)", async () => {
    const phone = "2349000000005";
    const res = await engine.processMessage(phone, "buy_motor");
    expect(res.text).toContain("Motor Insurance");
    const res2 = await engine.processMessage(phone, "menu");
    expect(res2.text).toContain("Welcome");
  });

  it("life/health/funeral purchases are honest directional messages", async () => {
    const phone = "2349000000006";
    const res = await engine.processMessage(phone, "buy_life");
    expect(res.text).toContain("available on WhatsApp");
    expectHonestFailureTextOnly(res.text);
  });

  it("rejects a non-numeric vehicle value without fabricating anything", async () => {
    const phone = "2349000000007";
    await engine.processMessage(phone, "motor insurance");
    await engine.processMessage(phone, "motor_tp");
    await engine.processMessage(phone, "ABC-123-XY");
    const res = await engine.processMessage(phone, "not-a-number");
    expect(res.text).toContain("valid vehicle value");
    expectHonestFailureTextOnly(res.text);
  });
});

function expectHonestFailureTextOnly(text: string): void {
  for (const pattern of FABRICATED) {
    expect(text).not.toMatch(pattern);
  }
}

describe("platform config fail-fast", () => {
  it("throws when PLATFORM_API_URL is missing", () => {
    expect(() =>
      loadPlatformConfig({ PLATFORM_SERVICE_TOKEN: "x" } as NodeJS.ProcessEnv)
    ).toThrow(PlatformConfigError);
  });
  it("throws when PLATFORM_SERVICE_TOKEN is missing", () => {
    expect(() =>
      loadPlatformConfig({
        PLATFORM_API_URL: "https://platform.example",
      } as NodeJS.ProcessEnv)
    ).toThrow(PlatformConfigError);
  });
});

describe("motor quote against a real (stubbed HTTP) catalog", () => {
  // Uses a live local HTTP server — no mocked client object — to prove the
  // wired path returns catalog-computed premiums and no policy reference.
  it("returns the real computed premium and no policy ref", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/api/trpc/insuranceProductCatalog.listProducts")) {
        res.end(JSON.stringify({ result: { data: { json: { data: [{ id: 7, name: "Motor Comprehensive", minPremium: "5000", maxCoverageAmount: "10000000" }], total: 1 } } } }));
      } else if (req.url?.startsWith("/api/trpc/insuranceProductCatalog.calculatePremium")) {
        res.end(JSON.stringify({ result: { data: { json: { annualPremium: 5250.75, currency: "NGN" } } } }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const engine = new ConversationEngine(
        new InsuranceIntentClassifier(),
        new PlatformClient(
          loadPlatformConfig({
            PLATFORM_API_URL: `http://127.0.0.1:${port}`,
            PLATFORM_SERVICE_TOKEN: "test-token",
          } as NodeJS.ProcessEnv)
        )
      );
      const phone = "2349000000008";
      await engine.processMessage(phone, "motor insurance");
      await engine.processMessage(phone, "motor_comp");
      await engine.processMessage(phone, "ABC-123-XY");
      const res = await engine.processMessage(phone, "3500000");
      expect(res.text).toContain("5,250.75");
      expectHonestFailureTextOnly(res.text);
      expect(res.text).not.toMatch(/Policy:/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
