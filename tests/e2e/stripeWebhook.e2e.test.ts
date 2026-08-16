/**
 * stripeWebhook.e2e.test.ts — end-to-end Stripe webhook delivery over REAL
 * HTTP through the mounted route (raw-body capture -> HMAC verification ->
 * durable effect), with the full middleware chain of createApp().
 *
 * Deliveries come from tests/providers/stripeSimulator.ts — a
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR (real stripe-signature algorithm,
 * correct secret). NOT evidence of Stripe behavior; official-sandbox
 * verification remains an open external item (THREAT_MODEL.md §F-02).
 *
 * Proves over the wire:
 *   1. validly signed invoice.paid -> 200 + durable ledger row
 *   2. duplicate delivery          -> 200 duplicate, still ONE ledger row
 *   3. mis-signed POST             -> 400, zero durable effect
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import { platformBillingLedger } from "../../drizzle/schema";
import { bootServer, shutdownServer, apiUrl } from "./helpers/http";
import { deliverableInvoicePaid } from "../providers/stripeSimulator";

const WH_SECRET = "whsec_e2e_protocol_sim";
let savedSecret: string | undefined;
let savedKey: string | undefined;

async function postWebhook(payload: string, signature?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature) headers["stripe-signature"] = signature;
  return fetch(apiUrl("/api/stripe/webhook"), {
    method: "POST",
    headers,
    body: payload,
  });
}

async function ledgerRows(invoiceId: string) {
  const db = (await getDb())!;
  return db
    .select()
    .from(platformBillingLedger)
    .where(eq(platformBillingLedger.transactionRef, invoiceId));
}

describe("stripe webhook over real HTTP (protocol-faithful local simulator)", () => {
  beforeAll(async () => {
    savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    savedKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_e2e_protocol_sim";
    await bootServer();
  });

  afterAll(async () => {
    await shutdownServer();
    if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  it("validly signed invoice.paid -> 200 and one durable ledger row", async () => {
    const invoiceId = `in_e2e_${Date.now()}_ok`;
    const d = deliverableInvoicePaid({
      invoiceId,
      tenantId: 5150,
      amountPaid: 88_000,
      secret: WH_SECRET,
    });
    const res = await postWebhook(d.payload, d.signatureHeader);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.received).toBe(true);
    expect((await ledgerRows(invoiceId)).length).toBe(1);
  });

  it("duplicate delivery -> 200 duplicate:true and still ONE ledger row", async () => {
    const invoiceId = `in_e2e_${Date.now()}_dup`;
    const first = deliverableInvoicePaid({
      invoiceId,
      tenantId: 5150,
      amountPaid: 55_000,
      secret: WH_SECRET,
    });
    const res1 = await postWebhook(first.payload, first.signatureHeader);
    expect(res1.status).toBe(200);

    const retry = deliverableInvoicePaid({
      invoiceId,
      tenantId: 5150,
      amountPaid: 55_000,
      secret: WH_SECRET,
    });
    const res2 = await postWebhook(retry.payload, retry.signatureHeader);
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as any;
    expect(body.duplicate).toBe(true);
    expect((await ledgerRows(invoiceId)).length).toBe(1);
  });

  it("mis-signed POST -> 400 and zero durable effect", async () => {
    const invoiceId = `in_e2e_${Date.now()}_evil`;
    const d = deliverableInvoicePaid({
      invoiceId,
      tenantId: 5150,
      amountPaid: 10_000,
      secret: "whsec_wrong_secret",
    });
    const res = await postWebhook(d.payload, d.signatureHeader);
    expect(res.status).toBe(400);
    expect((await ledgerRows(invoiceId)).length).toBe(0);
  });
});
