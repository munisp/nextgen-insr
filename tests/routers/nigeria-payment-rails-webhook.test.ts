import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyPaystackSignature } from "../../server/routers/nigeriaPaymentRails";

// NG-18: Paystack webhook signature must be verified fail-closed, always.
describe("verifyPaystackSignature", () => {
  const secret = "sk_test_abc123";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "ref-1", amount: 50000 } });
  const goodSig = crypto.createHmac("sha512", secret).update(body, "utf8").digest("hex");

  it("accepts a valid HMAC-SHA512 signature over the raw body", () => {
    expect(verifyPaystackSignature(body, goodSig, secret)).toBe(true);
  });

  it("rejects a forged signature", () => {
    expect(verifyPaystackSignature(body, "deadbeef".repeat(16), secret)).toBe(false);
  });

  it("rejects a signature computed over a tampered body", () => {
    const tampered = body.replace("50000", "999999999");
    expect(verifyPaystackSignature(tampered, goodSig, secret)).toBe(false);
  });

  it("fails closed when the secret is empty", () => {
    expect(verifyPaystackSignature(body, goodSig, "")).toBe(false);
  });

  it("fails closed when the signature is missing", () => {
    expect(verifyPaystackSignature(body, "", secret)).toBe(false);
  });

  it("rejects signatures with mismatched length without throwing", () => {
    expect(verifyPaystackSignature(body, goodSig.slice(0, 32), secret)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const other = crypto.createHmac("sha512", "sk_test_OTHER").update(body, "utf8").digest("hex");
    expect(verifyPaystackSignature(body, other, secret)).toBe(false);
  });
});
