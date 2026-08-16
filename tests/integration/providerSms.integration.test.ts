/**
 * providerSms.integration.test.ts — Termii SMS unknown-outcome tests against
 * the REAL smsService code path (F-02, THREAT_MODEL.md §F-02).
 *
 * The provider is tests/providers/termiiSimulator.ts — a PROTOCOL-FAITHFUL
 * LOCAL SIMULATOR implementing the Termii Send Message API wire shapes. It
 * is NOT evidence of Termii behavior; official-sandbox verification remains
 * an open external item.
 *
 * Scenarios:
 *   (a) timeout BEFORE/AT send (provider down)  -> honest failure, no fabricated id
 *   (b) timeout AFTER provider accepted          -> outcome UNKNOWN, no blind
 *        retry / failover (simulator proves exactly ONE request received)
 *   (c) malformed provider reply                 -> loud failure, no phantom success
 *   definitive rejection (4xx)                   -> safe failover allowed
 *   happy path                                    -> real message_id returned
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { TermiiSimulator } from "../providers/termiiSimulator";
import {
  sendSms,
  sendSmsWithRetry,
  getSmsDeliveryLog,
  normalizePhone,
} from "../../server/lib/smsService";
import {
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "providerSms";

let sim: TermiiSimulator;
const ENV_KEYS = [
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_TIMEOUT_MS",
  "TERMII_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "AT_API_KEY",
  "AT_USERNAME",
] as const;
let savedEnv: Record<string, string | undefined> = {};

// Distinct phones per test to avoid the anti-spam per-phone rate limit.
let phoneSeq = 0;
function nextPhone(): string {
  return `0809${String(1000000 + phoneSeq++).slice(-7)}`;
}

describe("termii SMS: unknown-outcome resolution (protocol-faithful local simulator)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    sim = await TermiiSimulator.start();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });

  beforeEach(() => {
    // Termii ONLY (other providers disabled so behavior is isolated).
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.TERMII_API_KEY = "termii-sim-api-key";
    process.env.TERMII_BASE_URL = sim.baseUrl;
    process.env.TERMII_TIMEOUT_MS = "500";
    sim.mode = "normal";
  });

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await sim.stop();
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("happy path: well-formed reply yields the real provider message_id", async () => {
    const result = await sendSms({ to: nextPhone(), body: "OTP 123456" });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("termii");
    expect(result.messageId).toMatch(/^termii_sim_/);
    expect(result.unknownOutcome).toBeUndefined();
    // The simulator received the documented Termii request shape.
    const req = sim.requests[sim.requests.length - 1];
    expect(req.type).toBe("plain");
    expect(req.channel).toBe("generic");
    expect(req.api_key).toBe("termii-sim-api-key");
  });

  it("(b) timeout AFTER provider accepted -> unknown outcome, NO blind retry, NO duplicate send", async () => {
    sim.mode = "drop_response"; // provider accepts, response is lost
    const phone = nextPhone();
    const before = sim.acceptedCount;

    const result = await sendSmsWithRetry({ to: phone, body: "Retry me" }, 3);

    expect(result.success).toBe(false);
    expect(result.unknownOutcome).toBe(true);
    expect(result.provider).toBe("termii");
    expect(String(result.error)).toMatch(/NOT re-sent/);
    // THE funds-safety property: despite maxRetries=3 the provider saw
    // EXACTLY ONE request — no blind duplicate effect.
    expect(sim.acceptedCount - before).toBe(1);
    // The delivery log records the attempt as pending (unknown), not success.
    const logs = getSmsDeliveryLog({ phone: normalizePhone(phone), provider: "termii" });
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("pending");
  });

  it("(c) malformed provider reply -> loud failure, no phantom message_id", async () => {
    sim.mode = "malformed";
    const result = await sendSms({ to: nextPhone(), body: "Malformed" });
    expect(result.success).toBe(false);
    expect(result.unknownOutcome).toBe(true);
    expect(String(result.error)).toMatch(/malformed/i);
    expect(result.messageId).toBeUndefined();
  });

  it("(a) provider unreachable (fails before/at send) -> honest failure, never fabricated", async () => {
    // Point at a dead port: connection refused BEFORE the request is sent.
    process.env.TERMII_BASE_URL = "http://127.0.0.1:9";
    const result = await sendSms({ to: nextPhone(), body: "Down" });
    expect(result.success).toBe(false);
    // Connection-refused is reported as unknown outcome (never fabricated).
    expect(result.unknownOutcome).toBe(true);
  });

  it("definitive rejection (4xx) -> safe failover to console (dev), NOT marked unknown", async () => {
    sim.mode = "reject";
    const result = await sendSms({ to: nextPhone(), body: "Rejected" });
    // Termii definitively rejected BEFORE accepting; failover is duplicate-safe.
    expect(result.provider).toBe("console");
    expect(result.unknownOutcome).toBeUndefined();
  });
});
