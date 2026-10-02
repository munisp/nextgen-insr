/**
 * premiumPaymentGateway.ts — W7-B6 (2026-10-03)
 *
 * REAL Paystack HTTP client for member-initiated premium collection
 * (initiate → authorization URL → server-side verify → premium credit).
 *
 * INVESTIGATION NOTE (W7-B6 audit): the monorepo had NO usable payment
 * gateway client before this module — server/routers/paymentGatewayRouter.ts
 * is plain CRUD over the `transactions` table, customer-portal-full
 * payments.initiate/verify are honest 501s, and no Paystack/Flutterwave
 * code existed anywhere under server/. This module is the first real
 * gateway integration; it is deliberately minimal (initialize + verify +
 * webhook signature) and NEVER simulates success.
 *
 * FAIL-CLOSED: when PAYSTACK_SECRET_KEY is unset every operation throws
 * GatewayNotConfiguredError; callers must map that to a 503-style honest
 * error. No sandbox/dev bypass: an unconfigured gateway can never produce a
 * payment reference, and verify can never return "paid" without a real
 * gateway response whose status is "success" AND whose amount matches the
 * recorded row (kobo-exact).
 *
 * Env (declared in server/_core/env.ts):
 *   PAYSTACK_SECRET_KEY   — required; no default, never logged.
 *   PAYSTACK_BASE_URL     — default https://api.paystack.co (overridable so
 *                           tests can point at a real local wire server).
 *   PAYSTACK_CALLBACK_URL — optional redirect target after checkout.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Thrown when the gateway credentials are not provisioned (fail-closed). */
export class GatewayNotConfiguredError extends Error {
  constructor() {
    super(
      "Payment gateway is not configured on this deployment (PAYSTACK_SECRET_KEY unset) — premium collection is unavailable, no payment was initiated"
    );
    this.name = "GatewayNotConfiguredError";
  }
}

/** Thrown when the gateway answered with an error or an unparseable body. */
export class GatewayRequestError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

export interface InitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifyResult {
  /** Paystack transaction status verbatim ("success", "failed", ...). */
  status: string;
  /** Amount in kobo as reported by the gateway. */
  amountKobo: number;
  reference: string;
  gatewayTransactionId?: number;
  paidAt?: string;
  channel?: string;
}

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.trim() === "") throw new GatewayNotConfiguredError();
  return key;
}

function baseUrl(): string {
  return (
    (process.env.PAYSTACK_BASE_URL ?? "https://api.paystack.co").replace(
      /\/+$/,
      ""
    ) || "https://api.paystack.co"
  );
}

/** True when the gateway is provisioned (never throws — for honest gating). */
export function gatewayConfigured(): boolean {
  return !!(process.env.PAYSTACK_SECRET_KEY ?? "").trim();
}

async function callGateway<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const key = secretKey();
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new GatewayRequestError(
      `Payment gateway unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let payload: { status?: boolean; message?: string; data?: T };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    throw new GatewayRequestError(
      `Payment gateway returned a non-JSON response (HTTP ${res.status})`,
      res.status
    );
  }
  if (!res.ok || payload.status !== true || payload.data == null) {
    throw new GatewayRequestError(
      `Payment gateway rejected the request (HTTP ${res.status}): ${payload.message ?? "no message"}`,
      res.status
    );
  }
  return payload.data;
}

/**
 * Initialize a transaction. `amountKobo` is the EXACT kobo amount derived
 * server-side; `reference` is the caller-derived idempotent reference.
 */
export async function initializeTransaction(params: {
  email: string;
  amountKobo: number;
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<InitializeResult> {
  const data = await callGateway<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>("POST", "/transaction/initialize", {
    email: params.email,
    amount: params.amountKobo,
    reference: params.reference,
    ...(process.env.PAYSTACK_CALLBACK_URL
      ? { callback_url: process.env.PAYSTACK_CALLBACK_URL }
      : {}),
    metadata: params.metadata ?? {},
  });
  if (!data.authorization_url || !data.reference) {
    throw new GatewayRequestError(
      "Payment gateway initialize response lacked authorization_url/reference"
    );
  }
  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

/**
 * Verify a transaction server-side. Returns the gateway's verbatim status —
 * callers MUST treat anything other than "success" as unpaid. Amount is
 * returned for an exact-match check against the recorded row.
 */
export async function verifyTransaction(
  reference: string
): Promise<VerifyResult> {
  const data = await callGateway<{
    status: string;
    amount: number;
    reference: string;
    id?: number;
    paid_at?: string;
    channel?: string;
  }>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  return {
    status: String(data.status ?? ""),
    amountKobo: Number(data.amount ?? NaN),
    reference: String(data.reference ?? reference),
    gatewayTransactionId: data.id,
    paidAt: data.paid_at,
    channel: data.channel,
  };
}

/**
 * Verify a Paystack webhook signature: HMAC-SHA512 of the RAW body with the
 * secret key, hex-encoded, in the `x-paystack-signature` header. Fail-closed:
 * no secret → false (never accept); mismatch → false; timing-safe compare.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined
): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.trim() === "" || !signatureHeader) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
