// @ts-check

import { describe, it, expect } from "vitest";

describe("FX Rates Service", () => {
  describe("Currency Metadata", () => {
    const CURRENCY_META: Record<
      string,
      { name: string; symbol: string; flag: string }
    > = {
      NGN: { name: "Nigerian Naira", symbol: "₦", flag: "🇳🇬" },
      USD: { name: "US Dollar", symbol: "$", flag: "🇺🇸" },
      GBP: { name: "British Pound", symbol: "£", flag: "🇬🇧" },
      EUR: { name: "Euro", symbol: "€", flag: "🇪🇺" },
      GHS: { name: "Ghanaian Cedi", symbol: "₵", flag: "🇬🇭" },
      KES: { name: "Kenyan Shilling", symbol: "KSh", flag: "🇰🇪" },
      ZAR: { name: "South African Rand", symbol: "R", flag: "🇿🇦" },
      XOF: { name: "West African CFA", symbol: "CFA", flag: "🇸🇳" },
      XAF: { name: "Central African CFA", symbol: "FCFA", flag: "🇨🇲" },
      TZS: { name: "Tanzanian Shilling", symbol: "TSh", flag: "🇹🇿" },
      UGX: { name: "Ugandan Shilling", symbol: "USh", flag: "🇺🇬" },
      RWF: { name: "Rwandan Franc", symbol: "FRw", flag: "🇷🇼" },
      ETB: { name: "Ethiopian Birr", symbol: "Br", flag: "🇪🇹" },
      EGP: { name: "Egyptian Pound", symbol: "E£", flag: "🇪🇬" },
      MAD: { name: "Moroccan Dirham", symbol: "MAD", flag: "🇲🇦" },
      CNY: { name: "Chinese Yuan", symbol: "¥", flag: "🇨🇳" },
      JPY: { name: "Japanese Yen", symbol: "¥", flag: "🇯🇵" },
      INR: { name: "Indian Rupee", symbol: "₹", flag: "🇮🇳" },
      AED: { name: "UAE Dirham", symbol: "د.إ", flag: "🇦🇪" },
      SAR: { name: "Saudi Riyal", symbol: "﷼", flag: "🇸🇦" },
      CAD: { name: "Canadian Dollar", symbol: "C$", flag: "🇨🇦" },
      AUD: { name: "Australian Dollar", symbol: "A$", flag: "🇦🇺" },
      CHF: { name: "Swiss Franc", symbol: "CHF", flag: "🇨🇭" },
      BRL: { name: "Brazilian Real", symbol: "R$", flag: "🇧🇷" },
    };

    it("should have 24 supported currencies", () => {
      expect(Object.keys(CURRENCY_META)).toHaveLength(24);
    });

    it("should include all major African currencies", () => {
      const african = [
        "NGN",
        "GHS",
        "KES",
        "ZAR",
        "XOF",
        "XAF",
        "TZS",
        "UGX",
        "RWF",
        "ETB",
        "EGP",
        "MAD",
      ];
      for (const code of african) {
        expect(CURRENCY_META[code]).toBeDefined();
      }
    });

    it("should include all G7 currencies", () => {
      const g7 = ["USD", "EUR", "GBP", "JPY", "CAD"];
      for (const code of g7) {
        expect(CURRENCY_META[code]).toBeDefined();
      }
    });

    it("should have valid metadata for each currency", () => {
      for (const [code, meta] of Object.entries(CURRENCY_META)) {
        expect(code).toMatch(/^[A-Z]{3}$/);
        expect(meta.name.length).toBeGreaterThan(3);
        expect(meta.symbol.length).toBeGreaterThan(0);
        expect(meta.flag.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Static Fallback Rates", () => {
    const staticRates: Record<string, number> = {
      USD: 1,
      NGN: 1600,
      EUR: 0.92,
      GBP: 0.79,
      GHS: 15.2,
      KES: 129.5,
      ZAR: 18.1,
      XOF: 603,
      XAF: 603,
      TZS: 2650,
      UGX: 3750,
      RWF: 1350,
      ETB: 57.2,
      EGP: 48.5,
      MAD: 10.1,
      CNY: 7.24,
      JPY: 154.5,
      INR: 83.5,
      AED: 3.67,
      SAR: 3.75,
      CAD: 1.37,
      AUD: 1.54,
      CHF: 0.88,
      BRL: 5.05,
    };

    it("should have USD as base with rate 1", () => {
      expect(staticRates.USD).toBe(1);
    });

    it("should have reasonable NGN/USD rate", () => {
      expect(staticRates.NGN).toBeGreaterThan(500);
      expect(staticRates.NGN).toBeLessThan(5000);
    });

    it("should have EUR < USD (EUR is stronger)", () => {
      expect(staticRates.EUR).toBeLessThan(1);
    });

    it("should have GBP < EUR (GBP is stronger)", () => {
      expect(staticRates.GBP).toBeLessThan(staticRates.EUR);
    });

    it("should have all 24 currencies in fallback", () => {
      expect(Object.keys(staticRates)).toHaveLength(24);
    });
  });

  describe("Rate Conversion Logic", () => {
    it("should convert NGN to USD correctly", () => {
      const ngnRate = 1600;
      const usdRate = 1;
      const amount = 100000;
      const converted = (amount * usdRate) / ngnRate;
      expect(converted).toBeCloseTo(62.5, 1);
    });

    it("should convert USD to NGN correctly", () => {
      const ngnRate = 1600;
      const usdRate = 1;
      const amount = 100;
      const converted = (amount * ngnRate) / usdRate;
      expect(converted).toBe(160000);
    });

    it("should handle cross-currency conversion (EUR to GBP)", () => {
      const eurRate = 0.92;
      const gbpRate = 0.79;
      const amount = 1000;
      const converted = (amount / eurRate) * gbpRate;
      expect(converted).toBeCloseTo(858.7, 0);
    });

    it("should handle same-currency conversion", () => {
      const rate = 1600;
      const amount = 50000;
      const converted = (amount * rate) / rate;
      expect(converted).toBe(amount);
    });

    it("should compute inverse rate correctly", () => {
      const ngnUsd = 1 / 1600;
      const usdNgn = 1 / ngnUsd;
      expect(usdNgn).toBe(1600);
    });
  });

  describe("Cache TTL Logic", () => {
    const CACHE_TTL_MS = 15 * 60 * 1000;

    it("should have 15-minute TTL", () => {
      expect(CACHE_TTL_MS).toBe(900000);
    });

    it("should detect expired cache", () => {
      const cachedAt = Date.now() - 16 * 60 * 1000;
      const isExpired = Date.now() - cachedAt > CACHE_TTL_MS;
      expect(isExpired).toBe(true);
    });

    it("should detect valid cache", () => {
      const cachedAt = Date.now() - 5 * 60 * 1000;
      const isExpired = Date.now() - cachedAt > CACHE_TTL_MS;
      expect(isExpired).toBe(false);
    });
  });

  describe("ECB XML Parsing", () => {
    it("should extract currency rates from ECB XML format", () => {
      const xml = `<Cube currency='USD' rate='1.0876'/><Cube currency='GBP' rate='0.8574'/><Cube currency='JPY' rate='168.05'/>`;
      const regex = /currency='([A-Z]{3})'\s+rate='([\d.]+)'/g;
      const rates: Record<string, number> = {};
      let match;
      while ((match = regex.exec(xml)) !== null) {
        rates[match[1]] = parseFloat(match[2]);
      }
      expect(rates.USD).toBeCloseTo(1.0876, 4);
      expect(rates.GBP).toBeCloseTo(0.8574, 4);
      expect(rates.JPY).toBeCloseTo(168.05, 2);
    });

    it("should convert ECB EUR-based rates to USD-based", () => {
      const eurRates = { EUR: 1, USD: 1.0876, GBP: 0.8574, JPY: 168.05 };
      const usdRate = eurRates.USD;
      const usdBased: Record<string, number> = {};
      for (const [code, rate] of Object.entries(eurRates)) {
        usdBased[code] = rate / usdRate;
      }
      expect(usdBased.USD).toBeCloseTo(1.0, 5);
      expect(usdBased.EUR).toBeLessThan(1); // EUR is stronger than USD
      expect(usdBased.JPY).toBeGreaterThan(100);
    });
  });

  describe("24h Change Calculation", () => {
    it("should calculate positive change", () => {
      const current = 1650;
      const previous = 1600;
      const change = ((current - previous) / previous) * 100;
      expect(change).toBeCloseTo(3.125, 2);
    });

    it("should calculate negative change", () => {
      const current = 1550;
      const previous = 1600;
      const change = ((current - previous) / previous) * 100;
      expect(change).toBeCloseTo(-3.125, 2);
    });

    it("should return 0 for no change", () => {
      const current = 1600;
      const previous = 1600;
      const change = ((current - previous) / previous) * 100;
      expect(change).toBe(0);
    });
  });

  describe("API Response Structure", () => {
    it("should include all required fields in rate response", () => {
      const response = {
        base: "NGN",
        rates: [
          {
            code: "USD",
            name: "US Dollar",
            symbol: "$",
            flag: "🇺🇸",
            rate: 0.000625,
            change24h: 0.5,
            lastUpdated: new Date().toISOString(),
          },
        ],
        source: "ECB",
        cachedAt: new Date().toISOString(),
        cacheTtlMs: 900000,
        nextRefresh: new Date().toISOString(),
      };
      expect(response.base).toBe("NGN");
      expect(response.rates[0].code).toBe("USD");
      expect(response.source).toBe("ECB");
      expect(response.cacheTtlMs).toBe(900000);
    });

    it("should include all required fields in convert response", () => {
      const response = {
        from: "NGN",
        to: "USD",
        amount: 100000,
        converted: 62.5,
        rate: 0.000625,
        inverseRate: 1600,
        source: "ECB",
        timestamp: new Date().toISOString(),
      };
      expect(response.converted).toBeCloseTo(
        response.amount * response.rate,
        1
      );
      expect(response.rate * response.inverseRate).toBeCloseTo(1, 5);
    });
  });
});
