/**
 * providerStripe.integration.test.ts — Stripe webhook unknown-outcome /
 * idempotency / reordering tests against the REAL handler and REAL DB
 * (F-02, THREAT_MODEL.md §F-02).
 *
 * Deliveries are produced by tests/providers/stripeSimulator.ts — a
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR (real HMAC-SHA256 stripe-signature
 * algorithm, correct secret, Stripe event document shape). It is NOT
 * evidence of Stripe behavior; official-sandbox verification remains an open
 * external item.
 *
 * Scenarios:
 *   (d) duplicate webhook delivery        -> exactly ONE durable ledger effect
 *   (e) webhook before local record       -> safe handling, no fabrication
 *   (c) tampered payload / wrong secret   -> loud 400, zero durable effect
 *       stale signed timestamp (replay)   -> loud 400
 */
import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  billingAuditLog,
  platformBillingLedger,
  users,
} from "../../drizzle/schema";
import { handleStripeWebhook } from "../../server/stripe/webhookHandler";
import {
  deliverableInvoicePaid,
  buildStripeEvent,
  signStripePayload,
  asExpressRequest,
} from "../providers/stripeSimulator";
import {
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "providerStripe";
const WH_SECRET = "whsec_protocol_sim_f02";

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

async function ledgerRows(invoiceId: string) {
  const db = (await getDb())!;
  return db
    .select()
    .from(platformBillingLedger)
    .where(eq(platformBillingLedger.transactionRef, invoiceId));
}

async function auditRows(invoiceId: string) {
  const db = (await getDb())!;
  return db
    .select()
    .from(billingAuditLog)
    .where(eq(billingAuditLog.resourceId, invoiceId));
}

describe("stripe webhook: idempotency + ordering (protocol-faithful local simulator)", () => {
  beforeAll(() => {
    resetAssertionCount();
  });
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_protocol_sim";
    process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
    process.env.NODE_ENV = "test";
  });
  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("(d) first valid invoice.paid delivery records exactly one ledger effect", async () => {
    const invoiceId = `in_sim_${Date.now()}_first`;
    const delivery = deliverableInvoicePaid({
      invoiceId,
      tenantId: 4242,
      amountPaid: 125_000, // ₦1,250.00 in kobo
      secret: WH_SECRET,
    });
    const res = mockRes();
    await handleStripeWebhook(asExpressRequest(delivery), res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).received).toBe(true);

    const rows = await ledgerRows(invoiceId);
    expect(rows.length).toBe(1);
    expect(rows[0].grossAmount).toBe("1250.00");
    const audits = await auditRows(invoiceId);
    expect(audits.length).toBe(1);
  });

  it("(d) duplicate webhook delivery -> single durable effect (idempotent)", async () => {
    const invoiceId = `in_sim_${Date.now()}_dup`;
    const first = deliverableInvoicePaid({
      invoiceId,
      tenantId: 4242,
      amountPaid: 60_000,
      secret: WH_SECRET,
    });
    const res1 = mockRes();
    await handleStripeWebhook(asExpressRequest(first), res1 as any);
    expect(res1.statusCode).toBe(200);

    // Stripe retries with a DIFFERENT event id but the same invoice —
    // re-sign a fresh delivery (new event id) to simulate the retry.
    const retry = deliverableInvoicePaid({
      invoiceId,
      tenantId: 4242,
      amountPaid: 60_000,
      secret: WH_SECRET,
    });
    const res2 = mockRes();
    await handleStripeWebhook(asExpressRequest(retry), res2 as any);
    expect(res2.statusCode).toBe(200);
    expect((res2.body as any).duplicate).toBe(true);

    // Single durable effect: one ledger row, one audit row.
    expect((await ledgerRows(invoiceId)).length).toBe(1);
    expect((await auditRows(invoiceId)).length).toBe(1);
  });

  it("(c) wrong-secret delivery is rejected loudly and writes NOTHING", async () => {
    const invoiceId = `in_sim_${Date.now()}_evil`;
    const delivery = deliverableInvoicePaid({
      invoiceId,
      tenantId: 4242,
      amountPaid: 999_900,
      secret: "whsec_attacker_controlled",
    });
    const res = mockRes();
    await handleStripeWebhook(asExpressRequest(delivery), res as any);
    expect(res.statusCode).toBe(400);
    expect((await ledgerRows(invoiceId)).length).toBe(0);
    expect((await auditRows(invoiceId)).length).toBe(0);
  });

  it("(c) stale signed timestamp (captured replay) is rejected loudly", async () => {
    const invoiceId = `in_sim_${Date.now()}_stale`;
    const staleTs = Math.floor(Date.now() / 1000) - 600;
    const delivery = deliverableInvoicePaid({
      invoiceId,
      tenantId: 4242,
      amountPaid: 10_000,
      secret: WH_SECRET,
      timestamp: staleTs,
    });
    const res = mockRes();
    await handleStripeWebhook(asExpressRequest(delivery), res as any);
    expect(res.statusCode).toBe(400);
    expect((await ledgerRows(invoiceId)).length).toBe(0);
  });

  it("(e) checkout.session.completed for an UNKNOWN user (reordering) -> 200, no fabricated user", async () => {
    const db = (await getDb())!;
    const [{ userCount }] = await db
      .select({ userCount: count() })
      .from(users);
    const event = buildStripeEvent("checkout.session.completed", {
      id: `cs_sim_${Date.now()}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: `sub_sim_${Date.now()}`,
      customer: `cus_sim_${Date.now()}`,
      client_reference_id: "99999999",
      metadata: { user_id: "99999999", plan_id: "pro" },
      amount_total: 5000,
    });
    const delivery = signStripePayload(JSON.stringify(event), WH_SECRET);
    const res = mockRes();
    await handleStripeWebhook(asExpressRequest(delivery), res as any);
    // Safe handling: acknowledged, no crash, and no user row fabricated.
    expect(res.statusCode).toBe(200);
    const [{ userCount: after }] = await db
      .select({ userCount: count() })
      .from(users);
    expect(after).toBe(userCount);
  });

  it("(e) invoice.paid for an unknown tenant -> acknowledged, no crash, ledger recorded without linkage", async () => {
    // The ledger effect is keyed to the invoice, not to a local tenant row;
    // arriving before tenant provisioning must not crash or fabricate.
    const invoiceId = `in_sim_${Date.now()}_notenant`;
    const delivery = deliverableInvoicePaid({
      invoiceId,
      tenantId: 77_777_777,
      amountPaid: 42_000,
      secret: WH_SECRET,
    });
    const res = mockRes();
    await handleStripeWebhook(asExpressRequest(delivery), res as any);
    expect(res.statusCode).toBe(200);
    const rows = await ledgerRows(invoiceId);
    expect(rows.length).toBe(1);
  });
});
