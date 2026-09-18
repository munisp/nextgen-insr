import { describe, it, expect } from "vitest";
import { deriveFraudFeatures } from "../securityOrchestrator";

describe("deriveFraudFeatures (AB-5: no client-controlled scorer inputs)", () => {
  it("derives kycLevel and session age from the server-side user record", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const f = deriveFraudFeatures({ kycLevel: 2, iat: nowSec - 300, deviceId: "dev-abc" });
    expect(f.kycLevel).toBe(2);
    expect(f.sessionAgeSeconds).toBeGreaterThanOrEqual(300);
    expect(f.deviceId).toBe("dev-abc");
  });

  it("never trusts client headers — conservative defaults when unknown", () => {
    const f = deriveFraudFeatures(undefined);
    expect(f.kycLevel).toBe(0);
    expect(f.sessionAgeSeconds).toBe(0);
    expect(f.deviceId).toBe("");
    expect(f.geoCountry).toBe("");
    expect(f.isNewRecipient).toBe(true);
    expect(f.isInternational).toBe(false);
  });

  it("rejects garbage kycLevel and future iat", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const f = deriveFraudFeatures({ kycLevel: Number.NaN, iat: nowSec + 10000 });
    expect(f.kycLevel).toBe(0);
    expect(f.sessionAgeSeconds).toBe(0);
  });
});
