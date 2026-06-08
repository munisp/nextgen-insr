/**
 * termii.test.ts — Vitest coverage for the shared Termii SMS helper.
 *
 * Tests:
 *  1. sendSms falls back gracefully when TERMII_API_KEY is absent
 *  2. sendSms returns success with a CONSOLE-* messageId in fallback mode
 *  3. sendSms calls the Termii API when key is present (mocked fetch)
 *  4. sendSms handles non-OK HTTP response from Termii
 *  5. sendSms handles network errors (fetch throws)
 *  6. buildConfirmationSms includes required CBN fields
 *  7. buildConfirmationSms formats amount with 2 decimal places
 *  8. buildReceiptSms includes fee when non-zero
 *  9. buildReceiptSms omits fee line when fee is zero
 * 10. buildConfirmationSms includes dispute instructions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendSms,
  buildConfirmationSms,
  buildReceiptSms,
  type SmsResult,
} from "./termii";
import { ENV } from "./_core/env";

// ── 1 & 2. Fallback mode (no API key) ────────────────────────────────────────
describe("sendSms — fallback mode (no TERMII_API_KEY)", () => {
  let savedEnvKey: string;
  beforeEach(() => {
    delete process.env.TERMII_API_KEY;
    // Also clear the ENV default so the fallback path is actually taken
    savedEnvKey = ENV.termiiApiKey;
    (ENV as any).termiiApiKey = "";
  });
  afterEach(() => {
    (ENV as any).termiiApiKey = savedEnvKey;
  });

  it("returns success:true when TERMII_API_KEY is absent", async () => {
    const result: SmsResult = await sendSms(
      "+2348012345678",
      "Test OTP: 123456"
    );
    expect(result.success).toBe(true);
  });

  it("returns a CONSOLE-* messageId in fallback mode", async () => {
    const result: SmsResult = await sendSms(
      "+2348012345678",
      "Test OTP: 123456"
    );
    expect(result.messageId).toMatch(/^CONSOLE-\d+$/);
  });

  it("does not call the Termii API in fallback mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendSms("+2348012345678", "Test OTP: 123456");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ── 3. Live mode — successful Termii API call ─────────────────────────────────
describe("sendSms — live mode (TERMII_API_KEY set)", () => {
  const savedKey = process.env.TERMII_API_KEY;

  beforeEach(() => {
    process.env.TERMII_API_KEY = "test-api-key-123";
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.TERMII_API_KEY;
    else process.env.TERMII_API_KEY = savedKey;
    vi.restoreAllMocks();
  });

  it("calls the Termii API with correct payload", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "termii-msg-001" }),
      text: async () => "",
    } as Response);

    await sendSms("+2348012345678", "Your OTP is 654321");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(options?.method).toBe("POST");

    const body = JSON.parse(options?.body as string);
    expect(body.to).toBe("+2348012345678");
    expect(body.sms).toBe("Your OTP is 654321");
    expect(body.from).toBe("InsurePortal");
    expect(body.api_key).toBe("test-api-key-123");
    expect(body.type).toBe("plain");
    expect(body.channel).toBe("generic");
  });

  it("returns success:true and messageId from Termii response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "termii-msg-abc" }),
      text: async () => "",
    } as Response);

    const result = await sendSms("+2348012345678", "Your OTP is 654321");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("termii-msg-abc");
  });

  // ── 4. Non-OK HTTP response ─────────────────────────────────────────────────
  it("returns success:false when Termii returns a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "Bad Request: invalid phone",
    } as Response);

    const result = await sendSms("+2348012345678", "Your OTP is 654321");
    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });

  // ── 5. Network error ────────────────────────────────────────────────────────
  it("returns success:false when fetch throws a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network unreachable")
    );

    const result = await sendSms("+2348012345678", "Your OTP is 654321");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network unreachable");
  });
});

// ── 6 & 7. buildConfirmationSms ───────────────────────────────────────────────
describe("buildConfirmationSms", () => {
  const baseData = {
    ref: "TXN-20260330-001",
    type: "Cash Out",
    amount: 5000,
    agentCode: "AGT001",
    agentName: "John Doe",
    customerName: "Jane Smith",
    timestamp: new Date("2026-03-30T10:00:00Z"),
  };

  it("includes the transaction reference", () => {
    const sms = buildConfirmationSms(baseData);
    expect(sms).toContain("TXN-20260330-001");
  });

  it("includes the transaction type", () => {
    const sms = buildConfirmationSms(baseData);
    expect(sms).toContain("Cash Out");
  });

  it("formats amount with 2 decimal places", () => {
    const sms = buildConfirmationSms(baseData);
    expect(sms).toContain("5,000.00");
  });

  it("includes agent code and name", () => {
    const sms = buildConfirmationSms(baseData);
    expect(sms).toContain("AGT001");
    expect(sms).toContain("John Doe");
  });

  it("includes customer name when provided", () => {
    const sms = buildConfirmationSms(baseData);
    expect(sms).toContain("Jane Smith");
  });

  it("includes dispute instructions (CBN requirement)", () => {
    const sms = buildConfirmationSms(baseData);
    expect(sms).toContain("DISPUTE");
  });

  it("omits customer line when customerName is null", () => {
    const sms = buildConfirmationSms({ ...baseData, customerName: null });
    expect(sms).not.toContain("Customer:");
  });
});

// ── 8 & 9. buildReceiptSms ────────────────────────────────────────────────────
describe("buildReceiptSms", () => {
  const baseData = {
    ref: "TXN-20260330-002",
    type: "Transfer",
    amount: 10000,
    fee: 50,
    agentCode: "AGT002",
    agentName: "Mary Jane",
    customerName: "Bob Builder",
  };

  it("includes fee line when fee is non-zero", () => {
    const sms = buildReceiptSms(baseData);
    expect(sms).toContain("Fee:");
    expect(sms).toContain("50.00");
  });

  it("omits fee line when fee is zero", () => {
    const sms = buildReceiptSms({ ...baseData, fee: 0 });
    expect(sms).not.toContain("Fee:");
  });

  it("includes InsurePortal branding", () => {
    const sms = buildReceiptSms(baseData);
    expect(sms).toContain("InsurePortal");
  });

  it("includes the transaction reference", () => {
    const sms = buildReceiptSms(baseData);
    expect(sms).toContain("TXN-20260330-002");
  });
});
