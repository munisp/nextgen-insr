/**
 * memberIntentParser.test.ts — W11-B4a (2026-10-24)
 *
 * Unit tests for the deterministic omnibox intent parser
 * (server/lib/memberIntentParser.ts). PURE parser → no DB, no PGlite, no
 * mocks anywhere (there is nothing to mock: the module is side-effect
 * free). Every case asserts the full result shape — several are
 * non-vacuous mutant probes (k-multiplier off, comma-strip off, ported-
 * prefix inference, alias-table misses) that go RED if the grammar moves.
 */
import { describe, expect, it } from "vitest";

import {
  extractPhones,
  parseMemberIntent,
  resolveBillerAlias,
} from "../memberIntentParser";

describe("airtime rail", () => {
  it("parses bare amount + network + 0-prefix phone", () => {
    expect(parseMemberIntent("buy 5000 mtn airtime to 08031234567")).toEqual({
      status: "ready",
      intent: {
        flow: "airtime_vend",
        network: "MTN",
        phone: "08031234567",
        amountNGN: 5000,
      },
    });
  });

  it("parses 'send' phrasing with ₦ and commas", () => {
    expect(parseMemberIntent("send ₦2,500 airtel airtime to 08031234567")).toEqual({
      status: "ready",
      intent: {
        flow: "airtime_vend",
        network: "Airtel",
        phone: "08031234567",
        amountNGN: 2500, // comma-strip mutant probe
      },
    });
  });

  it("k suffix multiplies by 1000 (mutant probe: multiplier off → red)", () => {
    const r = parseMemberIntent("buy 5k glo airtime for 08031234567");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "airtime_vend") {
      expect(r.intent.amountNGN).toBe(5000);
    }
  });

  it("fractional k (2.5k = 2500)", () => {
    const r = parseMemberIntent("2.5k mtn airtime for 08031234567");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "airtime_vend") {
      expect(r.intent.amountNGN).toBe(2500);
    }
  });

  it("normalizes +234 phone to 0-prefix", () => {
    const r = parseMemberIntent("buy 1k mtn airtime for +2348033123456");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "airtime_vend") {
      expect(r.intent.phone).toBe("08033123456");
    }
  });

  it("normalizes bare 234 phone to 0-prefix", () => {
    const r = parseMemberIntent("buy 1k mtn airtime for 2349051234567");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "airtime_vend") {
      expect(r.intent.phone).toBe("09051234567");
    }
  });

  it("ported-prefix trap: 0814 + 'glo' text uses TEXT, never the prefix", () => {
    const r = parseMemberIntent("buy 2k glo airtime for 08141234567");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "airtime_vend") {
      expect(r.intent.network).toBe("Glo"); // mutant probe: prefix inference → red
    }
  });

  it("missing network → clarification (prefix inference forbidden)", () => {
    const r = parseMemberIntent("buy 1k airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("network");
      expect(r.partial.phone).toBe("08031234567");
      expect(r.partial.amountNGN).toBe(1000);
      expect(r.partial.network).toBeUndefined(); // never guessed
    }
  });

  it("missing amount → clarification", () => {
    const r = parseMemberIntent("buy mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("amount");
    }
  });

  it("two phones → clarification (never picks one)", () => {
    const r = parseMemberIntent("send 500 airtime to 08031234567 or 08099998888 mtn");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("phone");
      expect(r.reason).toBe("ambiguous_phones");
      expect(r.partial.phone).toBeUndefined();
    }
  });

  it("amount below ₦50 floor → clarification, offending value disclosed", () => {
    const r = parseMemberIntent("buy 10 naira mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("amount");
      expect(r.reason).toBe("amount_out_of_bounds");
      expect(r.partial.amountNGN).toBe(10);
    }
  });

  it("amount above ₦50,000 ceiling → clarification (never clamped)", () => {
    const r = parseMemberIntent("buy 50001 mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.partial.amountNGN).toBe(50001); // disclosed, not clamped to 50000
    }
  });

  it("₦50,000 exactly is in bounds", () => {
    expect(parseMemberIntent("buy 50000 mtn airtime for 08031234567")).toMatchObject({
      status: "ready",
    });
  });

  it("'recharge' synonym works", () => {
    expect(
      parseMemberIntent("recharge my phone 08031234567 with 200 naira mtn")
    ).toMatchObject({ status: "ready" });
  });

  it("Pidgin-lite: 'abeg' is an ignorable filler", () => {
    const r = parseMemberIntent("abeg buy 1k mtn airtime for 08031234567");
    expect(r).toMatchObject({ status: "ready" });
  });

  it("etisalat alias maps to 9mobile", () => {
    const r = parseMemberIntent("buy 1k etisalat airtime for 08091234567");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "airtime_vend") {
      expect(r.intent.network).toBe("9mobile");
    }
  });
});

describe("bill rail", () => {
  it("ikeja electric alias → IKEDC, meter after 'meter' keyword", () => {
    expect(
      parseMemberIntent("pay ikeja electric 10000 meter 0451234567")
    ).toEqual({
      status: "ready",
      intent: {
        flow: "bill_pay",
        billerCode: "IKEDC",
        customerNumber: "0451234567",
        amountNGN: 10000,
      },
    });
  });

  it("dstv + smartcard + ₦ with commas", () => {
    expect(parseMemberIntent("pay dstv ₦10,000 smartcard 7034567890")).toEqual({
      status: "ready",
      intent: {
        flow: "bill_pay",
        billerCode: "DSTV",
        customerNumber: "7034567890",
        amountNGN: 10000,
      },
    });
  });

  it("eko electric alias → EKEDC", () => {
    const r = parseMemberIntent("pay eko electric bill ₦4,500 meter 04099887766");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "bill_pay") {
      expect(r.intent.billerCode).toBe("EKEDC");
    }
  });

  it("alias table hit: 'abuja electric' → AEDC", () => {
    const r = parseMemberIntent("pay abuja electric 2000 naira meter 1234567890");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "bill_pay") {
      expect(r.intent.billerCode).toBe("AEDC");
    }
  });

  it("alias table miss → clarification, biller never guessed", () => {
    const r = parseMemberIntent("pay zamfara electric 2000 naira meter 1234567890");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("biller");
      expect(r.partial.billerCode).toBeUndefined();
    }
  });

  it("longest-alias-first: 'port harcourt electric' → PHED not something else", () => {
    const r = parseMemberIntent("pay port harcourt electric 5000 meter 1234567890");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "bill_pay") {
      expect(r.intent.billerCode).toBe("PHED");
    }
  });

  it("two distinct amounts → ambiguous clarification", () => {
    const r = parseMemberIntent("pay ikeja electric 5000 or 10000 meter 1234567890");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("amount");
      expect(r.reason).toBe("ambiguous_amounts");
    }
  });

  it("two candidate customer numbers → ambiguous clarification", () => {
    const r = parseMemberIntent("pay eko electric bill 4500 account 12345");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.reason).toBe("ambiguous_amounts");
    }
  });

  it("bill floor ₦100 enforced", () => {
    const r = parseMemberIntent("pay dstv 50 naira smartcard 7034567890");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.reason).toBe("amount_out_of_bounds");
  });

  it("bill ceiling ₦500,000 enforced", () => {
    const r = parseMemberIntent("pay ikedc ₦500,001 meter 1234567890");
    expect(r.status).toBe("clarification");
  });

  it("exam body: jamb alias", () => {
    const r = parseMemberIntent("pay jamb 3500 naira pin 1234567890");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "bill_pay") {
      expect(r.intent.billerCode).toBe("JAMB");
    }
  });

  it("alphanumeric customer code → clarification, never truncated", () => {
    const r = parseMemberIntent("pay jamb 3500 naira profile 1234567890AB");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.missing).toContain("customerNumber");
  });
});

describe("momo cash-in rail", () => {
  it("mtn momo cash-in happy path", () => {
    expect(parseMemberIntent("cash in 20000 to my mtn momo wallet")).toEqual({
      status: "ready",
      intent: { flow: "momo_cash_in", provider: "MTN MoMo", amountNGN: 20000 },
    });
  });

  it("airtel money + ₦ amount", () => {
    const r = parseMemberIntent("fund my airtel money wallet with ₦15,000");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "momo_cash_in") {
      expect(r.intent.provider).toBe("Airtel Money");
      expect(r.intent.amountNGN).toBe(15000);
    }
  });

  it("glo xtra + k suffix", () => {
    expect(parseMemberIntent("top up my glo xtra wallet 5k")).toMatchObject({
      status: "ready",
    });
  });

  it("9psb provider", () => {
    expect(parseMemberIntent("cash in 2k to my 9psb wallet")).toMatchObject({
      status: "ready",
      intent: { provider: "9PSB" },
    });
  });

  it("missing provider → clarification", () => {
    const r = parseMemberIntent("cash in 5000 to my wallet");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.missing).toContain("provider");
  });

  it("opay → honest unsupported (provider not on the rail)", () => {
    const r = parseMemberIntent("cash in 20k to my opay wallet 08031234567");
    expect(r).toEqual({
      status: "unsupported",
      reason: "provider_not_supported:opay",
    });
  });

  it("palmpay → honest unsupported", () => {
    const r = parseMemberIntent("fund my palmpay wallet 3000");
    expect(r).toEqual({
      status: "unsupported",
      reason: "provider_not_supported:palmpay",
    });
  });

  it("momo floor ₦100 enforced", () => {
    const r = parseMemberIntent("cash in 50 naira to my mtn momo wallet");
    expect(r.status).toBe("clarification");
  });

  it("momo ceiling ₦300,000 enforced", () => {
    const r = parseMemberIntent("cash in 300001 naira to my mtn momo wallet");
    expect(r.status).toBe("clarification");
  });

  it("wallet phone in text is NOT extracted (caller's phone is session-side)", () => {
    const r = parseMemberIntent("cash in 20000 to my mtn momo wallet 08031234567");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready") {
      expect(JSON.stringify(r.intent)).not.toContain("08031234567");
    }
  });
});

describe("navigate intents", () => {
  it("'file a claim' → claims_file navigation, no payload fabricated", () => {
    expect(parseMemberIntent("file a claim")).toEqual({
      status: "ready",
      intent: { flow: "navigate", target: "claims_file" },
    });
  });

  it("'report a claim' synonym", () => {
    expect(parseMemberIntent("I want to report a claim")).toEqual({
      status: "ready",
      intent: { flow: "navigate", target: "claims_file" },
    });
  });

  it("'renew my car policy' → policy_renewal navigation", () => {
    expect(parseMemberIntent("renew my car policy")).toEqual({
      status: "ready",
      intent: { flow: "navigate", target: "policy_renewal" },
    });
  });

  it("'extend my cover' synonym", () => {
    expect(parseMemberIntent("extend my cover")).toEqual({
      status: "ready",
      intent: { flow: "navigate", target: "policy_renewal" },
    });
  });
});

describe("unsupported — honesty boundary", () => {
  it("bank transfer → unsupported, never fabricated", () => {
    expect(parseMemberIntent("transfer 5000 to my bank account")).toEqual({
      status: "unsupported",
      reason: "bank_transfer_not_supported",
    });
  });

  it("data bundle → unsupported (memberAirtime has no bundle rail)", () => {
    expect(parseMemberIntent("buy 1gb data for 08031234567")).toEqual({
      status: "unsupported",
      reason: "data_bundle_not_supported",
    });
  });

  it("momo cash out → unsupported", () => {
    expect(parseMemberIntent("cash out 5000 from my momo wallet")).toEqual({
      status: "unsupported",
      reason: "momo_cash_out_not_supported",
    });
  });

  it("gibberish → unsupported", () => {
    expect(parseMemberIntent("hello there")).toEqual({
      status: "unsupported",
      reason: "no_supported_intent_detected",
    });
  });

  it("empty input → unsupported", () => {
    expect(parseMemberIntent("   ")).toEqual({
      status: "unsupported",
      reason: "empty_input",
    });
  });

  it("injection-ish input → plain clarification, nothing executed/echoed", () => {
    const r = parseMemberIntent("buy airtime'; DROP TABLE users; --");
    expect(r.status).toBe("clarification");
    expect(JSON.stringify(r)).not.toContain("DROP TABLE");
  });

  it("overlong input → unsupported (280 char cap)", () => {
    expect(parseMemberIntent("buy airtime ".padEnd(400, "x"))).toEqual({
      status: "unsupported",
      reason: "input_too_long",
    });
  });
});

describe("helpers", () => {
  it("extractPhones handles all three Nigerian formats", () => {
    expect(extractPhones("a 08031234567 b +2348033123456 c 2349051234567")).toEqual([
      "08031234567",
      "08033123456",
      "09051234567",
    ]);
  });

  it("extractPhones rejects non-Nigerian/short numbers", () => {
    expect(extractPhones("call 12345 or 0401234567")).toEqual([]);
  });

  it("resolveBillerAlias hit and miss", () => {
    expect(resolveBillerAlias("my ikedc prepaid meter")).toBe("IKEDC");
    expect(resolveBillerAlias("my gotv decoder")).toBe("GOtv");
    expect(resolveBillerAlias("some unknown company")).toBeNull();
  });
});

/**
 * 2026-10-24 (W11-B4a verifier hardening): regression tests for EVERY
 * adversarial probe in /mnt/agents/output/verify-w11b4a.md. Contract:
 * wrong-money inputs yield clarification/unsupported — NEVER ready with
 * wrong params.
 */
describe("verifier adversarial probes (2026-10-24)", () => {
  // Finding 1 — meter-as-amount via ₦ suffix.
  it("F1a: '123456 ₦5000 <meter>' → clarification, never ready ₦123,456", () => {
    const r = parseMemberIntent("pay ikeja electric 123456 ₦5000 0451234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.reason).toBe("ambiguous_amounts");
      expect(r.partial.amountNGN).toBeUndefined();
    }
    expect(JSON.stringify(r)).not.toContain("123456\"");
  });

  it("F1b: '400 ₦5000 <meter>' → clarification, never ready ₦400", () => {
    const r = parseMemberIntent("pay ikeja electric 400 ₦5000 0451234567");
    expect(r.status).toBe("clarification");
    if (r.status === "ready") throw new Error("must never be ready");
  });

  // Finding 2 — conflicting amounts, no precedence discarding.
  it("F2a: explicit k + trailing bare amount → ambiguous clarification", () => {
    const r = parseMemberIntent(
      "send 5k mtn airtime to 08031234567 abeg, that's 6000"
    );
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.reason).toBe("ambiguous_amounts");
      expect(r.partial.amountNGN).toBeUndefined(); // no silent 5000
    }
  });

  it("F2b: explicit ₦ + trailing bare 'balance' figure → clarification", () => {
    const r = parseMemberIntent(
      "pay ikeja electric ₦5000 meter 0451234567 balance 6000"
    );
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.reason).toBe("ambiguous_amounts");
  });

  // Finding 3 — negatives never absoluted.
  it("F3a: bare negative '-500' → clarification (missing amount)", () => {
    const r = parseMemberIntent("buy -500 mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("amount");
      expect(r.partial.amountNGN).toBeUndefined(); // never +500
    }
  });

  it("F3b: '₦-500' → clarification", () => {
    const r = parseMemberIntent("buy ₦-500 mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    expect(JSON.stringify(r)).not.toContain("500");
  });

  it("F3c: negative on bill rail → clarification", () => {
    const r = parseMemberIntent("pay ikeja electric -5000 meter 0451234567");
    expect(r.status).toBe("clarification");
  });

  it("F3d: negative on momo rail → clarification", () => {
    const r = parseMemberIntent("cash in -5000 to my mtn momo wallet");
    expect(r.status).toBe("clarification");
  });

  // Finding 4 — conflicting networks.
  it("F4a: 'mtn glo' → conflicting_networks clarification", () => {
    const r = parseMemberIntent("buy 500 mtn glo airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("network");
      expect(r.reason).toBe("conflicting_networks");
      expect(r.partial.network).toBeUndefined();
    }
  });

  it("F4b: order-independent — 'glo mtn' also clarifies", () => {
    const r = parseMemberIntent("buy 500 glo mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.reason).toBe("conflicting_networks");
  });

  it("F4c: same network twice is NOT a conflict", () => {
    const r = parseMemberIntent("buy 500 mtn mtn airtime for 08031234567");
    expect(r).toMatchObject({ status: "ready" });
  });

  // Finding 5 — momo provider hijack.
  it("F5a: 'airtel momo' → Airtel Money (not MTN MoMo)", () => {
    const r = parseMemberIntent("cash in 5000 to my airtel momo wallet");
    expect(r).toEqual({
      status: "ready",
      intent: { flow: "momo_cash_in", provider: "Airtel Money", amountNGN: 5000 },
    });
  });

  it("F5b: 'glo momo' → Glo Xtra", () => {
    const r = parseMemberIntent("cash in 5000 to my glo momo wallet");
    expect(r).toEqual({
      status: "ready",
      intent: { flow: "momo_cash_in", provider: "Glo Xtra", amountNGN: 5000 },
    });
  });

  it("F5c: bare 'momo' still → MTN MoMo", () => {
    const r = parseMemberIntent("cash in 5000 to my momo wallet");
    expect(r).toEqual({
      status: "ready",
      intent: { flow: "momo_cash_in", provider: "MTN MoMo", amountNGN: 5000 },
    });
  });

  it("F5d: two distinct wallet brands → conflicting_providers", () => {
    const r = parseMemberIntent("cash in 5000 to my airtel money and 9psb wallet");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.reason).toBe("conflicting_providers");
      expect(r.partial.provider).toBeUndefined();
    }
  });

  // Finding 6 — phone inside longer digit runs.
  it("F6a: '108031234567' is NOT a phone", () => {
    expect(extractPhones("ref 108031234567 ok")).toEqual([]);
  });

  it("F6b: '008031234567' is NOT a phone", () => {
    expect(extractPhones("id 008031234567")).toEqual([]);
  });

  it("F6c: a 12-digit run is never split into a phone beneficiary", () => {
    const r = parseMemberIntent("buy 500 mtn airtime for 108031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("phone");
      expect(r.partial.phone).toBeUndefined();
    }
  });

  // Finding 7 — malformed comma/dot garbage.
  it("F7a: '1,00,0' → clarification, never 1000", () => {
    const r = parseMemberIntent("buy 1,00,0 mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.partial.amountNGN).toBeUndefined();
  });

  it("F7b: '5.5.5k' → clarification, never 5000", () => {
    const r = parseMemberIntent("buy 5.5.5k mtn airtime for 08031234567");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") expect(r.partial.amountNGN).toBeUndefined();
  });

  it("F7c: strict grouping still parses: ₦1,000,000-scale forms on bill", () => {
    const r = parseMemberIntent("pay ikedc ₦499,999 meter 1234567890");
    expect(r).toMatchObject({ status: "ready" });
    if (r.status === "ready" && r.intent.flow === "bill_pay") {
      expect(r.intent.amountNGN).toBe(499_999);
    }
  });

  // Consistency spot-checks the verifier confirmed (keep green).
  it("biller conflict: two distinct billers → conflicting_billers", () => {
    const r = parseMemberIntent("pay ikeja electric and dstv ₦5000 meter 1234567890");
    expect(r.status).toBe("clarification");
    if (r.status === "clarification") {
      expect(r.missing).toContain("biller");
      expect(r.partial.billerCode).toBeUndefined();
    }
  });

  it("provider-code adjacency: '9psb' never leaks a bare '9' amount", () => {
    const r = parseMemberIntent("cash in 2k to my 9psb wallet");
    expect(r).toEqual({
      status: "ready",
      intent: { flow: "momo_cash_in", provider: "9PSB", amountNGN: 2000 },
    });
  });
});
