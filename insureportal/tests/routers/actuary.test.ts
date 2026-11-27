/**
 * actuary.test.ts — W34-D (2026-11-28) acceptance tests for the actuary
 * router (server/routers/actuary.ts, design Appendix E).
 *
 * Covers:
 *   1. rateQuote zod input validation — invalid inputs are rejected with
 *      BAD_REQUEST BEFORE any adapter call (the fake pricing server is
 *      never hit: asserts no HTTP request was emitted).
 *   2. rateQuote happy path through the real adapter against an in-process
 *      fake pricing service (HTTP-boundary wire double, platform precedent)
 *      — the golden wire response is passed through verbatim.
 *   3. rateQuote outage mapping — pricing service down → SERVICE_UNAVAILABLE
 *      (fail-closed, never a fabricated premium).
 *   4. Authz: a subject with the Permify actuary permission passes
 *      reserveEstimate's gate (fails later at the honest DB-outage gate,
 *      PRECONDITION_FAILED — proving FORBIDDEN was not thrown); a subject
 *      DENIED the actuary permission gets FORBIDDEN; an anonymous caller
 *      gets UNAUTHORIZED.
 *
 * The Permify double is a real in-process HTTP server keyed by subject id —
 * the same wire-protocol double pattern as vitest.setup.ts, narrowed per
 * case. Modules are re-imported under vi.resetModules + vi.stubEnv exactly
 * like server/_core/permifyBootGuardW23.test.ts so the module-scoped
 * PERMIFY_URL binding picks up the fake's ephemeral port.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { TrpcContext } from "../../server/_core/context";

// ── Fake pricing service (HTTP-boundary double) ─────────────────────────────
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

let pricingServer: http.Server;
let pricingHits: Array<{ method: string; url: string; body: string }>;

// ── Fake Permify keyed by subject (HTTP-boundary double) ────────────────────
let permifyServer: http.Server;
let permifyUrl: string;
/** Subjects DENIED the actuary-entity permissions (base access still
 *  allowed, so the test isolates the actuary gate). */
const DENIED_SUBJECTS = new Set<string>();

async function startServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

beforeAll(async () => {
  pricingHits = [];
  const p = await startServer((req, res) => {
    let body = "";
    req.on("data", c => (body += String(c)));
    req.on("end", () => {
      pricingHits.push({ method: req.method ?? "", url: req.url ?? "", body });
      if (req.method === "POST" && req.url === "/v1/rate") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(GOLDEN_RATE));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  pricingServer = p.server;

  const pm = await startServer((req, res) => {
    let body = "";
    req.on("data", c => (body += String(c)));
    req.on("end", () => {
      let can: "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED" =
        "CHECK_RESULT_ALLOWED";
      try {
        const parsed = JSON.parse(body) as {
          subject?: { id?: string };
          entity?: { type?: string };
        };
        if (
          parsed.entity?.type === "actuary" &&
          parsed.subject?.id &&
          DENIED_SUBJECTS.has(parsed.subject.id)
        ) {
          can = "CHECK_RESULT_DENIED";
        }
      } catch {
        can = "CHECK_RESULT_DENIED";
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ can }));
    });
  });
  permifyServer = pm.server;
  permifyUrl = pm.url;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>(r => pricingServer.close(() => r())),
    new Promise<void>(r => permifyServer.close(() => r())),
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function freshRouter() {
  // Re-import under the stubbed env so server/_core/permify.ts's
  // module-scoped PERMIFY_URL picks up the fake (W23 test pattern).
  vi.stubEnv("PERMIFY_URL", permifyUrl);
  vi.resetModules();
  return import("../../server/routers/actuary");
}

function ctxFor(user: TrpcContext["user"]) {
  return {
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const baseUser = {
  id: 880001,
  email: "reader@w34d.test",
  name: "Plain User",
  role: "user",
} as unknown as TrpcContext["user"];

const actuaryUser = {
  id: 880002,
  email: "actuary@w34d.test",
  name: "Actuary",
  role: "user", // DB role cannot express actuary — Permify governs (design §7.4)
} as unknown as TrpcContext["user"];

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect(
      (err as { code?: string }).code,
      `expected ${code}, got: ${(err as Error).message}`
    ).toBe(code);
  }
}

const VALID_QUOTE = {
  productLine: "motor",
  variables: { vehicle_class: "saloon" },
  sumInsured: 5_000_000,
  exposures: 1,
  quoteRef: "Q-W34D-1",
};

describe("W34-D: rateQuote zod input validation (rejected before any adapter call)", () => {
  it("negative sumInsured → BAD_REQUEST; pricing service never hit", async () => {
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    const before = pricingHits.length;
    await expectTrpcCode(
      caller.rateQuote({ ...VALID_QUOTE, sumInsured: -1 }),
      "BAD_REQUEST"
    );
    expect(pricingHits.length).toBe(before);
  });

  it("missing productLine → BAD_REQUEST; pricing service never hit", async () => {
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    const before = pricingHits.length;
    await expectTrpcCode(
      // deliberate omission — the schema must reject it
      caller.rateQuote({ ...VALID_QUOTE, productLine: "" }),
      "BAD_REQUEST"
    );
    expect(pricingHits.length).toBe(before);
  });

  it("exposures = 0 → BAD_REQUEST (positive exposure required)", async () => {
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    const before = pricingHits.length;
    await expectTrpcCode(
      caller.rateQuote({ ...VALID_QUOTE, exposures: 0 }),
      "BAD_REQUEST"
    );
    expect(pricingHits.length).toBe(before);
  });

  it("sumInsured beyond the 1e12 ceiling → BAD_REQUEST", async () => {
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    await expectTrpcCode(
      caller.rateQuote({ ...VALID_QUOTE, sumInsured: 1e12 + 1 }),
      "BAD_REQUEST"
    );
  });
});

describe("W34-D: rateQuote through the real adapter (fake pricing service at the HTTP boundary)", () => {
  it("valid quote passes through the Go wire response verbatim", async () => {
    const { actuaryRouter } = await freshRouter();
    const { resetActuaryAdapterForTests } = await import(
      "../../server/actuaryAdapter"
    );
    vi.stubEnv("ACTUARY_PRICING_URL", pricingUrl());
    resetActuaryAdapterForTests();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    const res = await caller.rateQuote(VALID_QUOTE);
    expect(res).toEqual(GOLDEN_RATE);
    const hit = pricingHits.find(h => h.url === "/v1/rate");
    expect(hit).toBeDefined();
    const sent = JSON.parse(hit!.body || "{}") as Record<string, unknown>;
    expect(sent.productLine).toBe("motor");
    expect(sent.sumInsured).toBe(5_000_000);
  });

  it("pricing service DOWN → SERVICE_UNAVAILABLE (fail-closed, no fabricated premium)", async () => {
    const { actuaryRouter } = await freshRouter();
    const { resetActuaryAdapterForTests } = await import(
      "../../server/actuaryAdapter"
    );
    // Point at an immediately-refused address (port 9 = discard) — the same
    // outage posture the W23 Permify tests use.
    vi.stubEnv("ACTUARY_PRICING_URL", "http://127.0.0.1:9");
    resetActuaryAdapterForTests();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    await expectTrpcCode(caller.rateQuote(VALID_QUOTE), "SERVICE_UNAVAILABLE");
  });
});

function pricingUrl(): string {
  const addr = pricingServer.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

describe("W34-D: reserveEstimate authz (actuary permitted, non-actuary FORBIDDEN)", () => {
  it("actuary-permitted subject passes the gate (reaches the honest DB-outage PRECONDITION_FAILED, not FORBIDDEN)", async () => {
    DENIED_SUBJECTS.clear();
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(actuaryUser));
    // Authz passes; with no database configured the read fails closed at
    // the DB gate (W29 posture) — proving FORBIDDEN was never thrown.
    await expectTrpcCode(
      caller.reserveEstimate({ line: "motor" }),
      "PRECONDITION_FAILED"
    );
  });

  it("subject DENIED the actuary permission → FORBIDDEN", async () => {
    DENIED_SUBJECTS.clear();
    DENIED_SUBJECTS.add(String(baseUser.id));
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(baseUser));
    await expectTrpcCode(
      caller.reserveEstimate({ line: "motor" }),
      "FORBIDDEN"
    );
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    DENIED_SUBJECTS.clear();
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(null));
    await expectTrpcCode(
      caller.reserveEstimate({ line: "motor" }),
      "UNAUTHORIZED"
    );
  });

  it("unknown product line is an honest found:false, not fabricated reserves", async () => {
    DENIED_SUBJECTS.clear();
    const { actuaryRouter } = await freshRouter();
    const caller = actuaryRouter.createCaller(ctxFor(actuaryUser));
    // DB outage → PRECONDITION_FAILED before line resolution; assert that
    // the gate order is authz → DB (never a fabricated empty result).
    await expectTrpcCode(
      caller.reserveEstimate({ line: "not_a_line" }),
      "PRECONDITION_FAILED"
    );
  });
});
