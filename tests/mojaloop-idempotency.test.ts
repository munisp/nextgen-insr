/**
 * PAY-9: Mojaloop TS-SDK idempotency keys must bind entity + amount +
 * currency (previously `prem-${policyId}` / `payout-${claimId}` were reused
 * across amounts — lost payments or no replay protection).
 */
import { describe, it, expect } from "vitest";

import { paymentScopedKey } from "../infrastructure/ts-sdk/src/mojaloop";

describe("paymentScopedKey (PAY-9)", () => {
  it("is stable for the same payment intent", () => {
    expect(paymentScopedKey("prem", "POL-1", "5000.00", "NGN"))
      .toBe(paymentScopedKey("prem", "POL-1", "5000.00", "NGN"));
  });

  it("differs when the amount differs (the audit finding)", () => {
    expect(paymentScopedKey("prem", "POL-1", "5000.00", "NGN"))
      .not.toBe(paymentScopedKey("prem", "POL-1", "7500.00", "NGN"));
  });

  it("differs when the currency differs", () => {
    expect(paymentScopedKey("prem", "POL-1", "5000.00", "NGN"))
      .not.toBe(paymentScopedKey("prem", "POL-1", "5000.00", "USD"));
  });

  it("attempt nonce permits a deliberate second payment for same entity+amount", () => {
    expect(paymentScopedKey("payout", "CLM-9", "10000.00", "NGN"))
      .not.toBe(paymentScopedKey("payout", "CLM-9", "10000.00", "NGN", "installment-2"));
  });

  it("never collapses to the old bare entity key", () => {
    expect(paymentScopedKey("prem", "POL-1", "5000.00", "NGN")).not.toBe("prem-POL-1");
  });
});
