/**
 * webhookSecurity.integration.test.ts — inbound webhook verification
 * (F-05 residuals, THREAT_MODEL.md §7.4/§7.5).
 *
 * Rules under test (fail-closed philosophy):
 *   1. If a signing secret IS configured, verification is MANDATORY and any
 *      failure rejects the webhook (Stripe: 400; generic HMAC routes: 401).
 *   2. If the secret is UNSET and NODE_ENV=production, the endpoint answers
 *      503 PRECONDITION_FAILED loudly — never silent-accept.
 *   3. Dev/test keeps a LABELED bypass only (Stripe acknowledges without
 *      processing; generic middleware warns and calls next()).
 *   4. Replay freshness: Stripe signs a `t=` timestamp into the
 *      stripe-signature header; events older than 5 minutes are rejected
 *      even with an otherwise valid signature.
 *
 * Stripe verification is offline HMAC (stripe-node constructEvent), so these
 * tests need no network and no database.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { expectCounted as expect } from "./helpers/trpc";
import { handleStripeWebhook } from "../../server/stripe/webhookHandler";
import { verifyWebhookHmac } from "../../server/middleware/webhookHmac";

// ── Env management ───────────────────────────────────────────────────────────
const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "GENERIC_TEST_WEBHOOK_SECRET",
  "NODE_ENV",
] as const;
let savedEnv: Record<string, string | undefined> = {};

const TEST_STRIPE_KEY = "sk_test_integration_webhook";
const TEST_WH_SECRET = "whsec_integration_test_secret";

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WH_SECRET;
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ── Express req/res mocks ────────────────────────────────────────────────────
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function stripeSignatureHeader(payload: string, secret: string, ts: number): string {
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${payload}`, "utf8")
    .digest("hex");
  return `t=${ts},v1=${v1}`;
}

function stripeReq(payload: string, sig?: string) {
  return {
    headers: sig ? { "stripe-signature": sig } : {},
    body: Buffer.from(payload, "utf8"),
  } as any;
}

// evt_test_* short-circuits AFTER signature verification, so a 200 with
// verified:true proves the signature was accepted without touching the DB.
const TEST_EVENT = JSON.stringify({
  id: "evt_test_integration_security",
  object: "event",
  type: "invoice.paid",
  data: { object: { id: "in_test", metadata: {} } },
});

describe("stripe webhook: signature mandatory when secret configured", () => {
  it("valid signature is accepted", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const res = mockRes();
    await handleStripeWebhook(
      stripeReq(TEST_EVENT, stripeSignatureHeader(TEST_EVENT, TEST_WH_SECRET, ts)),
      res as any
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as any).verified).toBe(true);
  });

  it("wrong-secret signature is rejected (400)", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const res = mockRes();
    await handleStripeWebhook(
      stripeReq(TEST_EVENT, stripeSignatureHeader(TEST_EVENT, "whsec_wrong", ts)),
      res as any
    );
    expect(res.statusCode).toBe(400);
  });

  it("garbage signature is rejected (400)", async () => {
    const res = mockRes();
    await handleStripeWebhook(stripeReq(TEST_EVENT, "t=1,v1=deadbeef"), res as any);
    expect(res.statusCode).toBe(400);
  });

  it("missing stripe-signature header is rejected (400)", async () => {
    const res = mockRes();
    await handleStripeWebhook(stripeReq(TEST_EVENT), res as any);
    expect(res.statusCode).toBe(400);
  });

  it("stale timestamp (10 min old, validly signed) is rejected as replay (400)", async () => {
    const staleTs = Math.floor(Date.now() / 1000) - 600;
    const res = mockRes();
    await handleStripeWebhook(
      stripeReq(TEST_EVENT, stripeSignatureHeader(TEST_EVENT, TEST_WH_SECRET, staleTs)),
      res as any
    );
    expect(res.statusCode).toBe(400);
    expect(String((res.body as any).error)).toMatch(/tolerance|timestamp/i);
  });

  it("tampered payload with the original signature is rejected (400)", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = stripeSignatureHeader(TEST_EVENT, TEST_WH_SECRET, ts);
    const tampered = TEST_EVENT.replace("in_test", "in_evil");
    const res = mockRes();
    await handleStripeWebhook(stripeReq(tampered, sig), res as any);
    expect(res.statusCode).toBe(400);
  });
});

describe("stripe webhook: secret-unset behavior", () => {
  it("production without STRIPE_WEBHOOK_SECRET answers 503 (fail-closed, loud)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    const ts = Math.floor(Date.now() / 1000);
    const res = mockRes();
    await handleStripeWebhook(
      stripeReq(TEST_EVENT, stripeSignatureHeader(TEST_EVENT, "whsec_any", ts)),
      res as any
    );
    expect(res.statusCode).toBe(503);
    expect(String((res.body as any).error)).toMatch(/PRECONDITION_FAILED/);
  });

  it("dev/test without secret uses the labeled bypass and does NOT process the event", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.NODE_ENV = "development";
    const res = mockRes();
    await handleStripeWebhook(stripeReq(TEST_EVENT, "t=1,v1=anything"), res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).received).toBe(true);
    expect(String((res.body as any).devBypass)).toMatch(/verification skipped/);
  });
});

describe("generic webhook HMAC middleware (tigerbeetle/termii/partner routes)", () => {
  const SECRET_ENV = "GENERIC_TEST_WEBHOOK_SECRET";
  const payload = Buffer.from(JSON.stringify({ event: "settled", data: { id: 1 } }));

  function mwReq(sig?: string) {
    return {
      headers: sig ? { "x-webhook-signature": sig } : {},
      rawBody: payload,
      path: "/webhooks/test",
    } as any;
  }

  function sign(secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  it("valid signature calls next()", () => {
    process.env[SECRET_ENV] = "generic-secret";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV)(mwReq(sign("generic-secret")), res as any, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("invalid signature is rejected (401)", () => {
    process.env[SECRET_ENV] = "generic-secret";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV)(mwReq(sign("wrong-secret")), res as any, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("missing signature header is rejected (401)", () => {
    process.env[SECRET_ENV] = "generic-secret";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV)(mwReq(), res as any, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("secret UNSET in production answers 503 PRECONDITION_FAILED (no silent accept)", () => {
    delete process.env[SECRET_ENV];
    process.env.NODE_ENV = "production";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV)(mwReq(sign("anything")), res as any, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(String((res.body as any).error)).toMatch(/PRECONDITION_FAILED/);
  });

  it("secret UNSET in dev/test keeps the labeled bypass (next() + warning)", () => {
    delete process.env[SECRET_ENV];
    process.env.NODE_ENV = "development";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV)(mwReq(sign("anything")), res as any, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  // DD-TSSEC (A7-10): failClosed routes (e.g. /webhooks/termii — a provider
  // with no native HMAC signing scheme) reject unconfigured secrets in EVERY
  // environment; no dev bypass exists for an unverifiable contract.
  it("failClosed route rejects secret-UNSET even outside production (503)", () => {
    delete process.env[SECRET_ENV];
    process.env.NODE_ENV = "development";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV, "x-webhook-signature", { failClosed: true })(
      mwReq(sign("anything")),
      res as any,
      () => {
        called = true;
      }
    );
    expect(called).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(String((res.body as any).error)).toMatch(/PRECONDITION_FAILED/);
  });

  it("failClosed route still verifies normally once the secret is configured", () => {
    process.env[SECRET_ENV] = "generic-secret";
    process.env.NODE_ENV = "development";
    const res = mockRes();
    let called = false;
    verifyWebhookHmac(SECRET_ENV, "x-webhook-signature", { failClosed: true })(
      mwReq(sign("generic-secret")),
      res as any,
      () => {
        called = true;
      }
    );
    expect(called).toBe(true);
  });
});
