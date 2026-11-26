/**
 * 2026-11-27 (W28): stripe.* router — wire-protocol double tests
 *
 * The stripeRouter (./stripeRouter.ts, ported from the main repo) was an
 * empty `router({})` stub while the client (pages/Payments.tsx,
 * pages/PaymentSuccess.tsx) already invoked 8 procedures on it.
 *
 * Harness (accepted pattern — no mocks on production paths):
 *   - The REAL stripe npm SDK speaks the real Stripe HTTP wire protocol to
 *     an in-process double (ephemeral 127.0.0.1 port), pointed there via the
 *     STRIPE_API_HOST/PORT/PROTOCOL env override (router delta D4) — exactly
 *     the Permify-double pattern of vitest.setup.ts. The double records
 *     requests so the Idempotency-Key / Stripe-Version headers and form
 *     bodies are asserted on the wire.
 *   - ../db and the fire-and-forget observability/sidecar middlewares are
 *     stubbed at the module boundary (same convention as
 *     ../transactions.approveReversal.authz.test.ts); the procedure chain
 *     (requireUser → requirePermify → handler) runs unmodified.
 *   - requirePermify exercises the REAL Permify client against the
 *     vitest.setup.ts wire double (ALLOWED) — plus one suite that points
 *     PERMIFY_URL at a DENYING double to prove the base-authz denial fires.
 *   - Webhook signature tests drive handleStripeWebhook directly with
 *     HMAC-signed raw bodies (real stripe.webhooks.constructEvent).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { getDb } from "../db";

// ── Module-boundary doubles (accepted convention) ────────────────────────────
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../middleware/observabilityMiddleware", () => ({
  createObservabilityMiddleware: (t: any) =>
    t.middleware(({ next }: any) => next()),
}));
vi.mock("../middleware/sidecarIntegration", () => ({
  createSidecarMiddleware: (t: any) =>
    t.middleware(({ next }: any) => next()),
}));

// ── Stripe wire-protocol double ───────────────────────────────────────────────
type RecordedReq = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};
const recorded: RecordedReq[] = [];

const SUB_OK = {
  id: "sub_ok",
  object: "subscription",
  status: "active",
  customer: "cus_123",
  cancel_at_period_end: false,
  current_period_end: 1_900_000_000,
  metadata: { plan_id: "standard", plan_name: "Standard Agent" },
};

function stripeJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const stripeDouble = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    recorded.push({
      method: req.method || "",
      url: req.url || "",
      headers: req.headers,
      body,
    });
    const url = req.url || "";
    const method = req.method || "";

    if (method === "POST" && url === "/v1/customers") {
      return stripeJson(res, 200, { id: "cus_123", object: "customer" });
    }
    if (method === "POST" && url === "/v1/checkout/sessions") {
      return stripeJson(res, 200, {
        id: "cs_test_wire1",
        object: "checkout.session",
        url: "https://checkout.stripe.test/pay/cs_test_wire1",
      });
    }
    if (method === "GET" && url === "/v1/checkout/sessions/cs_test_wire1") {
      return stripeJson(res, 200, {
        id: "cs_test_wire1",
        object: "checkout.session",
        status: "complete",
        payment_status: "paid",
        amount_total: 1500,
        currency: "usd",
      });
    }
    if (method === "GET" && url.startsWith("/v1/checkout/sessions/")) {
      return stripeJson(res, 404, {
        error: {
          type: "invalid_request_error",
          message: "No such checkout session",
        },
      });
    }
    if (method === "GET" && url.startsWith("/v1/payment_intents")) {
      return stripeJson(res, 200, {
        object: "list",
        data: [
          {
            id: "pi_1",
            object: "payment_intent",
            amount: 1500,
            currency: "usd",
            status: "succeeded",
            description: "Standard Agent subscription",
            created: 1_800_000_000,
            metadata: { plan_name: "Standard Agent" },
          },
          {
            id: "pi_2",
            object: "payment_intent",
            amount: 1000,
            currency: "usd",
            status: "processing",
            description: null,
            created: 1_800_100_000,
            metadata: { product_name: "POS Device Activation Fee" },
          },
        ],
        has_more: false,
      });
    }
    if (method === "GET" && url.startsWith("/v1/subscriptions") && !url.includes("/v1/subscriptions/")) {
      return stripeJson(res, 200, {
        object: "list",
        data: [SUB_OK],
        has_more: false,
      });
    }
    if (method === "GET" && url === "/v1/subscriptions/sub_ok") {
      return stripeJson(res, 200, SUB_OK);
    }
    if (method === "GET" && url === "/v1/subscriptions/sub_foreign") {
      return stripeJson(res, 200, { ...SUB_OK, id: "sub_foreign", customer: "cus_999" });
    }
    if (method === "POST" && url === "/v1/subscriptions/sub_ok") {
      return stripeJson(res, 200, { ...SUB_OK, cancel_at_period_end: true });
    }
    if (method === "POST" && url === "/v1/billing_portal/sessions") {
      return stripeJson(res, 200, {
        id: "bps_1",
        object: "billing_portal.session",
        url: "https://billing.stripe.test/session/bps_1",
      });
    }
    return stripeJson(res, 404, {
      error: { type: "invalid_request_error", message: `Unrecognized request URL (${method} ${url})` },
    });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const USER = {
  id: 7,
  keycloakSub: "kc-sub-7",
  name: "Adaeze Agent",
  email: "adaeze@insureportal.ng",
  role: "user",
  tenantId: null,
};

function makeCtx(user: Record<string, unknown> | null): any {
  return {
    user,
    req: { headers: { origin: "https://portal.test" } },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  };
}

/** DB double: select returns [userRow]; update records the set() payload. */
function makeDb(userRow: any) {
  const updates: any[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (userRow ? [userRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: async () => {
          updates.push(v);
        },
      }),
    }),
  };
  return { db, updates };
}

/** Fresh module registry → fresh getStripe() singleton + fresh env reads. */
async function loadCaller() {
  vi.resetModules();
  const [{ stripeRouter }, { router }] = await Promise.all([
    import("./stripeRouter"),
    import("../_core/trpc"),
  ]);
  const appRouter = router({ stripe: stripeRouter });
  return appRouter;
}

const savedEnv = { ...process.env };
let stripePort: number;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    stripeDouble.once("error", reject);
    stripeDouble.listen(0, "127.0.0.1", () => resolve());
  });
  stripePort = (stripeDouble.address() as AddressInfo).port;
});

afterAll(async () => {
  process.env = savedEnv;
  await new Promise<void>(resolve => stripeDouble.close(() => resolve()));
});

function pointAtStripeDouble() {
  process.env.STRIPE_SECRET_KEY = "sk_test_wire_double";
  process.env.STRIPE_API_HOST = "127.0.0.1";
  process.env.STRIPE_API_PORT = String(stripePort);
  process.env.STRIPE_API_PROTOCOL = "http";
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_API_HOST;
  delete process.env.STRIPE_API_PORT;
  delete process.env.STRIPE_API_PROTOCOL;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

// ── getPlans (public, static) ─────────────────────────────────────────────────
describe("stripe.getPlans", () => {
  it("returns the plan catalogue and one-time products with the UI-consumed fields", async () => {
    const appRouter = await loadCaller();
    const caller = appRouter.createCaller(makeCtx(null));
    const result = await caller.stripe.getPlans();

    expect(result.plans.length).toBe(3);
    for (const plan of result.plans) {
      expect(typeof plan.id).toBe("string");
      expect(typeof plan.name).toBe("string");
      expect(typeof plan.description).toBe("string");
      expect(Array.isArray(plan.features)).toBe(true);
      expect(typeof plan.monthlyPriceUSD).toBe("number"); // Payments.tsx: ${(plan.monthlyPriceUSD / 100)}
    }
    expect(result.oneTimeProducts.length).toBe(3);
    for (const product of result.oneTimeProducts) {
      expect(typeof product.id).toBe("string");
      expect(typeof product.priceUSD).toBe("number"); // Payments.tsx: ${(product.priceUSD / 100)}
    }
    // No Stripe key configured — the static catalogue must not require one.
  });
});

// ── Authn / base-authz gates ──────────────────────────────────────────────────
describe("stripe router auth gates", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED (requireUser)", async () => {
    const appRouter = await loadCaller();
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.stripe.getPaymentHistory()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.stripe.createOneTimeCheckout({ productId: "device-activation" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects authenticated callers when the Permify base gate DENIES (fail-closed)", async () => {
    // A second, DENYING Permify wire double; the router's protectedProcedure
    // chain (requirePermify → real permifyCheck HTTP client) must short-circuit
    // FORBIDDEN before the handler body runs.
    const denyDouble = http.createServer((req, res) => {
      if (req.method === "POST" && req.url?.includes("/permissions/check")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ can: "CHECK_RESULT_DENIED" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve, reject) => {
      denyDouble.once("error", reject);
      denyDouble.listen(0, "127.0.0.1", () => resolve());
    });
    const denyPort = (denyDouble.address() as AddressInfo).port;
    const savedPermifyUrl = process.env.PERMIFY_URL;
    process.env.PERMIFY_URL = `http://127.0.0.1:${denyPort}`;
    try {
      const appRouter = await loadCaller(); // re-imports permify.ts with the deny URL
      const { db } = makeDb({ ...USER, stripeCustomerId: "cus_123" });
      vi.mocked(getDb).mockResolvedValue(db as any);
      const caller = appRouter.createCaller(makeCtx(USER));
      await expect(caller.stripe.getPaymentHistory()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      // Denied at the base gate: the Stripe double must see ZERO traffic.
      expect(recorded.length).toBe(0);
    } finally {
      process.env.PERMIFY_URL = savedPermifyUrl;
      await new Promise<void>(resolve => denyDouble.close(() => resolve()));
    }
  });
});

// ── Fail-closed configuration ─────────────────────────────────────────────────
describe("stripe configuration fail-closed", () => {
  it("fails with PRECONDITION_FAILED when STRIPE_SECRET_KEY is absent (no fabricated data)", async () => {
    const appRouter = await loadCaller(); // no STRIPE_SECRET_KEY in env
    const { db } = makeDb({ ...USER, stripeCustomerId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));
    await expect(
      caller.stripe.createOneTimeCheckout({ productId: "device-activation" })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("STRIPE_SECRET_KEY"),
    });
    // The user has no stored customer, so customer-creation hit Stripe first:
    // the config error must mean ZERO outbound payment traffic.
    expect(recorded.filter(r => r.url !== "/v1/customers").length).toBe(0);
  });

  it("returns empty history without a Stripe customer (no key needed, no fabrication)", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));
    await expect(caller.stripe.getPaymentHistory()).resolves.toEqual({ payments: [] });
    await expect(caller.stripe.getSubscriptionStatus()).resolves.toEqual({
      subscriptions: [],
      activePlan: null,
    });
  });
});

// ── Checkout creation (wire protocol) ─────────────────────────────────────────
describe("stripe checkout creation over the wire", () => {
  beforeEach(() => {
    pointAtStripeDouble();
  });

  it("createSubscriptionCheckout creates the customer, sends an Idempotency-Key, and persists the customer id", async () => {
    const appRouter = await loadCaller();
    const { db, updates } = makeDb({ ...USER, stripeCustomerId: null, stripePlanId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx(USER));
    const result = await caller.stripe.createSubscriptionCheckout({ planId: "standard" });

    expect(result).toEqual({
      url: "https://checkout.stripe.test/pay/cs_test_wire1",
      sessionId: "cs_test_wire1",
    });

    const customerReq = recorded.find(r => r.method === "POST" && r.url === "/v1/customers");
    expect(customerReq).toBeDefined();
    expect(customerReq!.headers.authorization).toBe("Bearer sk_test_wire_double");
    expect(customerReq!.body).toContain("email=adaeze%40insureportal.ng");
    expect(customerReq!.body).toContain("metadata[userId]=7");

    const checkoutReq = recorded.find(r => r.method === "POST" && r.url === "/v1/checkout/sessions");
    expect(checkoutReq).toBeDefined();
    expect(checkoutReq!.headers["stripe-version"]).toBe("2025-04-30.basil");
    expect(typeof checkoutReq!.headers["idempotency-key"]).toBe("string");
    expect((checkoutReq!.headers["idempotency-key"] as string).length).toBe(64); // sha256 hex
    expect(checkoutReq!.body).toContain("mode=subscription");
    expect(checkoutReq!.body).toContain("metadata[plan_id]=standard");
    expect(checkoutReq!.body).toContain("success_url=https%3A%2F%2Fportal.test%2Fpayments");

    // The new Stripe customer id is persisted onto the user row.
    expect(updates[0]).toMatchObject({ stripeCustomerId: "cus_123" });
  });

  it("sends a deterministic idempotency key: same input replays, different item differs", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: "cus_123", stripePlanId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));

    await caller.stripe.createSubscriptionCheckout({ planId: "standard" });
    await caller.stripe.createSubscriptionCheckout({ planId: "standard" });
    await caller.stripe.createSubscriptionCheckout({ planId: "premium" });
    await caller.stripe.createOneTimeCheckout({ productId: "device-activation" });

    const keys = recorded
      .filter(r => r.method === "POST" && r.url === "/v1/checkout/sessions")
      .map(r => r.headers["idempotency-key"] as string);
    expect(keys.length).toBe(4);
    expect(keys[0]).toBe(keys[1]); // identical input → identical key (Stripe replays)
    expect(keys[0]).not.toBe(keys[2]); // different plan → different key
    expect(keys[0]).not.toBe(keys[3]); // different kind → different key
    // Existing customer: no customer-creation call on the wire.
    expect(recorded.filter(r => r.url === "/v1/customers").length).toBe(0);
  });

  it("rejects an unknown plan with NOT_FOUND and zero Stripe traffic", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: "cus_123" });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));
    await expect(
      caller.stripe.createSubscriptionCheckout({ planId: "platinum-ultra" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(recorded.length).toBe(0);
  });
});

// ── Read procedures (wire protocol) ───────────────────────────────────────────
describe("stripe read procedures over the wire", () => {
  beforeEach(() => {
    pointAtStripeDouble();
    const { db } = makeDb({
      ...USER,
      stripeCustomerId: "cus_123",
      stripePlanId: "standard",
    });
    vi.mocked(getDb).mockResolvedValue(db as any);
  });

  it("getPaymentHistory maps PaymentIntents to the UI shape", async () => {
    const appRouter = await loadCaller();
    const caller = appRouter.createCaller(makeCtx(USER));
    const result = await caller.stripe.getPaymentHistory();

    expect(result.payments.length).toBe(2);
    expect(result.payments[0]).toEqual({
      id: "pi_1",
      amount: 1500,
      currency: "usd",
      status: "succeeded",
      description: "Standard Agent subscription",
      createdAt: new Date(1_800_000_000 * 1000).toISOString(),
      metadata: { plan_name: "Standard Agent" },
    });
    // UI fallback chain: description || metadata.plan_name || metadata.product_name
    expect(result.payments[1].description).toBeNull();
    expect(result.payments[1].metadata?.product_name).toBe("POS Device Activation Fee");

    const listReq = recorded.find(r => r.url.startsWith("/v1/payment_intents"));
    expect(listReq!.url).toContain("customer=cus_123");
  });

  it("getSubscriptionStatus maps subscriptions + activePlan to the UI shape", async () => {
    const appRouter = await loadCaller();
    const caller = appRouter.createCaller(makeCtx(USER));
    const result = await caller.stripe.getSubscriptionStatus();

    expect(result.activePlan).toEqual({
      planId: "standard",
      planName: "Standard Agent",
      status: "active",
    });
    expect(result.subscriptions.length).toBe(1);
    expect(result.subscriptions[0]).toEqual({
      id: "sub_ok",
      status: "active",
      planId: "standard",
      currentPeriodEnd: new Date(1_900_000_000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it("getCheckoutSession returns session details; unknown session returns null", async () => {
    const appRouter = await loadCaller();
    const caller = appRouter.createCaller(makeCtx(USER));

    const found = await caller.stripe.getCheckoutSession({ sessionId: "cs_test_wire1" });
    expect(found).toEqual({
      id: "cs_test_wire1",
      status: "complete",
      paymentStatus: "paid",
      amountTotal: 1500,
      currency: "usd",
    });

    const missing = await caller.stripe.getCheckoutSession({ sessionId: "cs_nope" });
    expect(missing).toBeNull();
  });
});

// ── cancelSubscription (ownership fail-closed) ───────────────────────────────
describe("stripe.cancelSubscription", () => {
  beforeEach(() => {
    pointAtStripeDouble();
  });

  it("cancels the user's own subscription at period end", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: "cus_123", stripePlanId: "standard" });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));

    const result = await caller.stripe.cancelSubscription({ subscriptionId: "sub_ok" });
    expect(result).toEqual({
      id: "sub_ok",
      status: "active",
      cancelAtPeriodEnd: true,
    });
    const updateReq = recorded.find(r => r.method === "POST" && r.url === "/v1/subscriptions/sub_ok");
    expect(updateReq!.body).toContain("cancel_at_period_end=true");
  });

  it("denies cancelling a subscription owned by a DIFFERENT customer (FORBIDDEN, no mutation sent)", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: "cus_123", stripePlanId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));

    await expect(
      caller.stripe.cancelSubscription({ subscriptionId: "sub_foreign" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The ownership check fired BEFORE any mutation: only the retrieve hit the wire.
    expect(
      recorded.filter(r => r.method === "POST" && r.url.startsWith("/v1/subscriptions/")).length
    ).toBe(0);
  });

  it("fails PRECONDITION_FAILED when the user has no Stripe customer", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));
    await expect(
      caller.stripe.cancelSubscription({ subscriptionId: "sub_ok" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(recorded.length).toBe(0);
  });
});

// ── createPortalSession ───────────────────────────────────────────────────────
describe("stripe.createPortalSession", () => {
  beforeEach(() => {
    pointAtStripeDouble();
  });

  it("returns the billing portal URL for a user with a Stripe customer", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: "cus_123" });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));

    const result = await caller.stripe.createPortalSession();
    expect(result).toEqual({ url: "https://billing.stripe.test/session/bps_1" });
    const req = recorded.find(r => r.url === "/v1/billing_portal/sessions");
    expect(req!.body).toContain("customer=cus_123");
    expect(req!.body).toContain("return_url=https%3A%2F%2Fportal.test%2Fpayments");
  });

  it("fails PRECONDITION_FAILED without a Stripe customer (no portal call)", async () => {
    const appRouter = await loadCaller();
    const { db } = makeDb({ ...USER, stripeCustomerId: null });
    vi.mocked(getDb).mockResolvedValue(db as any);
    const caller = appRouter.createCaller(makeCtx(USER));
    await expect(caller.stripe.createPortalSession()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(recorded.length).toBe(0);
  });
});

// ── Webhook signature verification (real constructEvent) ─────────────────────
describe("handleStripeWebhook signature verification", () => {
  const WEBHOOK_SECRET = "whsec_test_wire_secret";

  function makeRes() {
    const res: any = {
      statusCode: 200,
      body: undefined as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  function sign(payload: string, secret: string, ts = Math.floor(Date.now() / 1000)) {
    const v1 = crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
    return `t=${ts},v1=${v1}`;
  }

  async function loadHandler() {
    vi.resetModules();
    const mod = await import("./webhookHandler");
    return mod.handleStripeWebhook;
  }

  it("rejects a missing stripe-signature header (400)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_wire_double";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const handle = await loadHandler();
    const res = makeRes();
    await handle({ headers: {}, body: Buffer.from("{}") } as any, res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects a forged signature (400) — real constructEvent verification", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_wire_double";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const handle = await loadHandler();
    const payload = JSON.stringify({
      id: "evt_live_forged",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_forged", amount: 99999900 } },
    });
    const res = makeRes();
    await handle(
      { headers: { "stripe-signature": sign(payload, "whsec_WRONG_secret") }, body: Buffer.from(payload) } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Webhook Error/);
  });

  it("fails closed (400) when STRIPE_WEBHOOK_SECRET is unset", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_wire_double";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const handle = await loadHandler();
    const payload = JSON.stringify({ id: "evt_live_1", object: "event", type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } });
    const res = makeRes();
    await handle(
      { headers: { "stripe-signature": sign(payload, WEBHOOK_SECRET) }, body: Buffer.from(payload) } as any,
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it("accepts a correctly signed test event (verified:true)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_wire_double";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const handle = await loadHandler();
    const payload = JSON.stringify({
      id: "evt_test_wire1",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1" } },
    });
    const res = makeRes();
    await handle(
      { headers: { "stripe-signature": sign(payload, WEBHOOK_SECRET) }, body: Buffer.from(payload) } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ verified: true });
  });

  it("processes a correctly signed live event (received:true)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_wire_double";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const handle = await loadHandler();
    const { db } = makeDb(null);
    vi.mocked(getDb).mockResolvedValue(db as any);
    const payload = JSON.stringify({
      id: "evt_live_ok",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", amount: 1500 } },
    });
    const res = makeRes();
    await handle(
      { headers: { "stripe-signature": sign(payload, WEBHOOK_SECRET) }, body: Buffer.from(payload) } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
