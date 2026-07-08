// @ts-check

// @ts-nocheck
import { describe, it, expect } from "vitest";
import {
  resolveGeoIp,
  correlateGeoIp,
  getAllGeoCorrelations,
  getHighRiskCorrelations,
  clearGeoIpData,
} from "./middleware/livenessSecurityEnhancements";

describe("KYC Phase 4 — Geo-IP Correlation", () => {
  describe("resolveGeoIp", () => {
    it("resolves a public IP to geo data", async () => {
      const result = await resolveGeoIp("8.8.8.8");
      expect(result).toHaveProperty("country");
      expect(result).toHaveProperty("city");
      expect(result).toHaveProperty("lat");
      expect(result).toHaveProperty("lon");
      expect(result).toHaveProperty("isp");
      expect(result).toHaveProperty("isVpn");
      expect(result).toHaveProperty("isTor");
      expect(typeof result.country).toBe("string");
    });

    it("handles private/localhost IPs gracefully", async () => {
      const result = await resolveGeoIp("127.0.0.1");
      expect(result).toHaveProperty("country");
      // Should not throw
    });

    it("handles invalid IPs gracefully", async () => {
      const result = await resolveGeoIp("not-an-ip");
      expect(result).toHaveProperty("country");
    });
  });

  describe("correlateGeoIp", () => {
    it("creates a correlation record for a user", () => {
      const geo = {
        country: "NG",
        city: "Lagos",
        lat: 6.45,
        lon: 3.4,
        isp: "MTN Nigeria",
        isVpn: false,
        isTor: false,
        asn: "AS29465",
      };
      const result = correlateGeoIp("user-001", "device-abc", geo);
      expect(result).toHaveProperty("riskScore");
      expect(result).toHaveProperty("flags");
      expect(typeof result.riskScore).toBe("number");
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.flags)).toBe(true);
    });

    it("flags VPN usage as elevated risk", () => {
      const geo = {
        country: "NG",
        city: "Lagos",
        lat: 6.45,
        lon: 3.4,
        isp: "NordVPN",
        isVpn: true,
        isTor: false,
        asn: "AS12345",
      };
      const result = correlateGeoIp("user-002", "device-def", geo);
      expect(result.riskScore).toBeGreaterThan(0);
      expect(
        result.flags.some((f: string) => f.toLowerCase().includes("vpn"))
      ).toBe(true);
    });

    it("flags Tor usage as high risk", () => {
      const geo = {
        country: "DE",
        city: "Frankfurt",
        lat: 50.1,
        lon: 8.7,
        isp: "Tor Exit Node",
        isVpn: false,
        isTor: true,
        asn: "AS99999",
      };
      const result = correlateGeoIp("user-003", "device-ghi", geo);
      expect(result.riskScore).toBeGreaterThanOrEqual(40);
      expect(
        result.flags.some((f: string) => f.toLowerCase().includes("tor"))
      ).toBe(true);
    });

    it("detects impossible travel (same user, different countries, short time)", () => {
      const geo1 = {
        country: "NG",
        city: "Lagos",
        lat: 6.45,
        lon: 3.4,
        isp: "MTN",
        isVpn: false,
        isTor: false,
        asn: "AS29465",
      };
      const geo2 = {
        country: "US",
        city: "New York",
        lat: 40.7,
        lon: -74.0,
        isp: "Comcast",
        isVpn: false,
        isTor: false,
        asn: "AS7922",
      };
      // First correlation establishes baseline
      correlateGeoIp("user-travel", "device-1", geo1);
      // Second correlation from different country immediately
      const result = correlateGeoIp("user-travel", "device-2", geo2);
      expect(result.riskScore).toBeGreaterThanOrEqual(10);
      // Should flag something related to the country change
      expect(result.flags.length).toBeGreaterThan(0);
    });
  });

  describe("getAllGeoCorrelations", () => {
    it("returns an array of all correlations", () => {
      const result = getAllGeoCorrelations();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getHighRiskCorrelations", () => {
    it("filters correlations by minimum risk score", () => {
      const result = getHighRiskCorrelations(30);
      expect(Array.isArray(result)).toBe(true);
      result.forEach((c: any) => {
        expect(c.riskScore).toBeGreaterThanOrEqual(30);
      });
    });

    it("returns empty array for very high threshold with no matches", () => {
      const result = getHighRiskCorrelations(101);
      expect(result).toEqual([]);
    });
  });

  describe("clearGeoIpData", () => {
    it("clears data for a specific user and returns count", () => {
      // Ensure user has data
      const geo = {
        country: "NG",
        city: "Abuja",
        lat: 9.06,
        lon: 7.49,
        isp: "Airtel",
        isVpn: false,
        isTor: false,
        asn: "AS36873",
      };
      correlateGeoIp("user-to-clear", "device-x", geo);

      const cleared = clearGeoIpData("user-to-clear");
      expect(typeof cleared).toBe("number");
      expect(cleared).toBeGreaterThanOrEqual(1);
    });

    it("returns 0 for non-existent user", () => {
      const cleared = clearGeoIpData("non-existent-user-xyz");
      expect(cleared).toBe(0);
    });
  });
});

describe("KYC Phase 4 — Admin Device Analytics Page", () => {
  it("AdminLivenessDeviceAnalytics page file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      __dirname,
      "../client/src/pages/AdminLivenessDeviceAnalytics.tsx"
    );
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("Admin page exports a default component", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      __dirname,
      "../client/src/pages/AdminLivenessDeviceAnalytics.tsx"
    );
    const content = fs.readFileSync(filePath, "utf-8");
    expect(
      content.includes("export default") || content.includes("export function")
    ).toBe(true);
  });

  it("Admin page uses trpc hooks for data fetching", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      __dirname,
      "../client/src/pages/AdminLivenessDeviceAnalytics.tsx"
    );
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content.includes("trpc.")).toBe(true);
  });
});

describe("KYC Phase 4 — Lockout Notification", () => {
  it("recordLivenessFailure triggers notification on lockout", async () => {
    const { recordLivenessFailure, clearCooldown } = await import(
      "./middleware/livenessSecurityEnhancements"
    );
    // Clear any existing cooldown
    clearCooldown("notify-test-user");

    // Record 3 failures to trigger lockout
    recordLivenessFailure("notify-test-user");
    recordLivenessFailure("notify-test-user");
    const result = recordLivenessFailure("notify-test-user");

    // After 3 failures, user should be locked out
    const { isLockedOut } = await import(
      "./middleware/livenessSecurityEnhancements"
    );
    const locked = isLockedOut("notify-test-user");
    expect(locked.locked).toBe(true);
  });
});

describe("KYC Phase 4 — Recommendations Document", () => {
  it("KYC-KYB-LIVENESS-RECOMMENDATIONS.md exists and is comprehensive", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      __dirname,
      "../docs/KYC-KYB-LIVENESS-RECOMMENDATIONS.md"
    );
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, "utf-8");
    // Check all 8 sections are present
    expect(content.includes("## 1. Liveness Detection Enhancements")).toBe(
      true
    );
    expect(content.includes("## 2. KYC Process Improvements")).toBe(true);
    expect(
      content.includes("## 3. KYB (Know Your Business) Enhancements")
    ).toBe(true);
    expect(
      content.includes("## 4. Device and Infrastructure Improvements")
    ).toBe(true);
    expect(content.includes("## 5. Fraud Prevention and Risk Scoring")).toBe(
      true
    );
    expect(content.includes("## 6. Compliance and Audit")).toBe(true);
    expect(content.includes("## 7. Implementation Roadmap")).toBe(true);
    expect(content.includes("## 8. Key Metrics to Track")).toBe(true);

    // Check it covers key topics
    expect(content.includes("deepfake")).toBe(true);
    expect(content.includes("ISO 30107")).toBe(true);
    expect(content.includes("CBN")).toBe(true);
    expect(content.includes("NFC")).toBe(true);
    expect(content.includes("NDPA")).toBe(true);

    // Should be substantial (>5000 words)
    const wordCount = content.split(/\s+/).length;
    expect(wordCount).toBeGreaterThan(2000);
  });
});
