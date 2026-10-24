/**
 * memberIntentParser.ts — W11-B4a (2026-10-24): deterministic natural-language
 * intent parser for the member funds/claims omnibox (member-intelligence
 * program, Phase 4a).
 *
 * PURE FUNCTIONS ONLY. No LLM, no network, no DB, no Date.now — the same
 * input text always yields the same ParseResult (unit-testable without
 * PGlite; see server/lib/__tests__/memberIntentParser.test.ts).
 *
 * SCOPE (fail-closed, honesty boundary). The parser maps text onto flows
 * that correspond to EXISTING member-safe server mutations only:
 *   - airtime_vend   → memberAirtime.vend    (network, phone, amountNGN)
 *   - bill_pay       → memberBillPayments.pay (billerCode, customerNumber, amountNGN)
 *   - momo_cash_in   → memberMobileMoney.cashIn (provider, amountNGN)
 *   - navigate       → claims file / policy renewal NAVIGATION intent only
 *                      (no payload is fabricated for these — the member is
 *                      routed to the real form).
 *
 * DELIBERATELY UNSUPPORTED (returns status:'unsupported', NEVER guessed):
 *   - data bundles: memberAirtime.vend carries no bundle/plan field — the
 *     rail does not exist, so "buy 1gb data" is refused, not approximated.
 *   - bank transfers / "send money to my bank": no member-safe bank payout
 *     rail exists.
 *   - momo cash OUT: memberMobileMoney.cashOut is a PENDING provider-debit
 *     request rail with different semantics; the omnibox does not prefill it.
 *   - providers/billers NOT in the server registries (e.g. OPay, PalmPay —
 *     the memberMobileMoney registry is MTN MoMo / Airtel Money / Glo Xtra /
 *     9PSB only; memberMobileMoney.ts:104).
 *   - broader Yoruba/Pidgin grammar: only "abeg" (please) is treated as an
 *     ignorable filler word. Anything beyond that is NOT parsed — a half
 *     understood sentence that moves money is worse than a refusal.
 *
 * NEVER GUESSED: amounts, payees, networks. Network inference from phone
 * prefix is FORBIDDEN (Nigerian numbers are ported between networks — an
 * 0814 number may no longer be Glo); the network must be explicit text.
 * Ambiguity (two amounts, two phones, an unrecognised biller) ALWAYS yields
 * status:'clarification' with the specific missing fields, never a pick.
 *   - alphanumeric customer numbers: extractCustomerNumbers matches digit
 *     runs only (meter/smartcard reality); an alphanumeric exam/profile
 *     code → clarification (missing customerNumber), never a truncation.
 *
 * Amount grammar: ₦ / NGN / naira as a PREFIX marker (₦-as-suffix was
 * removed 2026-10-24 — it swallowed preceding meter digit runs), k / ngn /
 * naira as a suffix (5k = 5000, 2.5k = 2500), strict thousands commas
 * (1,000 / 1,000,000 only). Explicit AND bare candidates are combined; two
 * DISTINCT values → ambiguous clarification, with no precedence pick.
 * Bounds are per-rail and mirror the server routers exactly:
 *   airtime ₦50–₦50,000  (memberAirtime.ts:91-92)
 *   bill    ₦100–₦500,000 (memberBillPayments.ts MIN_AMOUNT/MAX_AMOUNT)
 *   momo    ₦100–₦300,000 (memberMobileMoney.ts:105-106)
 * An out-of-bounds amount is reported as missing:['amount'] (the value is
 * present but not usable) with the offending value kept in partial for the
 * client to display — the router NEVER clamps silently.
 */

// ── Registries (kept in sync with the routers they mirror; dated above) ─────

export const AIRTIME_NETWORKS = ["MTN", "Glo", "Airtel", "9mobile"] as const;
export type AirtimeNetwork = (typeof AIRTIME_NETWORKS)[number];

export const MOMO_PROVIDERS = [
  "MTN MoMo",
  "Airtel Money",
  "Glo Xtra",
  "9PSB",
] as const;
export type MomoProvider = (typeof MOMO_PROVIDERS)[number];

/** Per-rail naira bounds — copies of the router constants (see header). */
export const RAIL_BOUNDS = {
  airtime_vend: { min: 50, max: 50_000 },
  bill_pay: { min: 100, max: 500_000 },
  momo_cash_in: { min: 100, max: 300_000 },
} as const;

// ── Output contract ─────────────────────────────────────────────────────────

export type MemberIntent =
  | {
      flow: "airtime_vend";
      network: AirtimeNetwork;
      phone: string; // normalized 0XXXXXXXXXX
      amountNGN: number;
    }
  | {
      flow: "bill_pay";
      billerCode: string; // canonical registry code (e.g. IKEDC)
      customerNumber: string; // meter / smartcard / exam number
      amountNGN: number;
    }
  | {
      flow: "momo_cash_in";
      provider: MomoProvider;
      amountNGN: number;
    }
  | { flow: "navigate"; target: "claims_file" | "policy_renewal" };

export type MissingField =
  | "amount"
  | "phone"
  | "network"
  | "biller"
  | "customerNumber"
  | "provider";

export type ParseResult =
  | { status: "ready"; intent: MemberIntent }
  | {
      status: "clarification";
      flow: MemberIntent["flow"] | null;
      missing: MissingField[];
      /** Best-effort extracted fields — NEVER contains guessed values. */
      partial: Record<string, string | number>;
      reason: string;
    }
  | { status: "unsupported"; reason: string };

// ── Biller alias table (2026-10-24, W11-B4a) ────────────────────────────────
// Fuzzy common-name → canonical code. The canonical code set is the
// BILLER_COMMISSION registry in memberBillPayments.ts (registry block,
// 2026-10-01 R3-b3): EKEDC/IKEDC/AEDC/PHED/BEDC/EEDC/JED/KEDCO, DSTV/GOtv/
// Startimes/Showmax, WAEC/JAMB/NECO/NABTEB, LCC/LASG/FIRS/CAC. Aliases are
// matched against lowercase word-boundary substrings of the input, LONGEST
// alias first, so "eko electric" beats "electric". A biller name with no
// table hit is NEVER mapped to a code — clarification, not a guess.
export const BILLER_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["port harcourt electric", "PHED"],
  ["portharcourt electric", "PHED"],
  ["ikeja electric", "IKEDC"],
  ["ikeja disco", "IKEDC"],
  ["eko electric", "EKEDC"],
  ["eko disco", "EKEDC"],
  ["abuja electric", "AEDC"],
  ["benin electric", "BEDC"],
  ["enugu electric", "EEDC"],
  ["jos electric", "JED"],
  ["kano electric", "KEDCO"],
  ["ikedc", "IKEDC"],
  ["ekedc", "EKEDC"],
  ["aedc", "AEDC"],
  ["phed", "PHED"],
  ["bedc", "BEDC"],
  ["eedc", "EEDC"],
  ["kedco", "KEDCO"],
  ["jed", "JED"],
  ["dstv", "DSTV"],
  ["gotv", "GOtv"],
  ["go tv", "GOtv"],
  ["startimes", "Startimes"],
  ["star times", "Startimes"],
  ["showmax", "Showmax"],
  ["waec", "WAEC"],
  ["jamb", "JAMB"],
  ["neco", "NECO"],
  ["nabteb", "NABTEB"],
  ["lekki toll", "LCC"],
  ["lcc", "LCC"],
  ["lagos state", "LASG"],
  ["lasg", "LASG"],
  ["firs", "FIRS"],
  ["cac", "CAC"],
];

/**
 * Resolve a biller alias to its canonical registry code. Exported for the
 * router's resolvePayeeHint proc. Returns null on no hit (never a guess).
 */
export function resolveBillerAlias(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [alias, code] of BILLER_ALIASES) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(lower)) {
      return code;
    }
  }
  return null;
}

// ── Momo provider aliases (registry: memberMobileMoney.ts:104) ──────────────
// Names that clearly intend a SUPPORTED provider map to it; names of
// well-known providers NOT on the rail (OPay, PalmPay, ...) are detected
// separately so the parser can refuse them honestly instead of clarifying.
// Momo provider aliases (registry: memberMobileMoney.ts:104).
// 2026-10-24 (verifier finding 5): LONGEST / most-specific FIRST and
// brand-composed forms ("airtel momo" → Airtel Money, "glo momo" → Glo
// Xtra) precede the generic "momo" alias, and collectAliases discards
// overlapping shorter hits — a brand next to "momo" can never be hijacked
// into MTN MoMo. Two DISTINCT brands → clarification.
const MOMO_PROVIDER_ALIASES: ReadonlyArray<readonly [string, MomoProvider]> = [
  ["airtel mobile money", "Airtel Money"],
  ["mtn mobile money", "MTN MoMo"],
  ["glo mobile money", "Glo Xtra"],
  ["airtel money", "Airtel Money"],
  ["airtel momo", "Airtel Money"],
  ["glo momo", "Glo Xtra"],
  ["mtn momo", "MTN MoMo"],
  ["glo xtra", "Glo Xtra"],
  ["9 payment", "9PSB"],
  ["9payment", "9PSB"],
  ["momo", "MTN MoMo"],
  ["9psb", "9PSB"],
];

/** Wallet brands with NO member rail — named so we can refuse honestly. */
const UNSUPPORTED_WALLET_BRANDS = [
  "opay",
  "palmpay",
  "palm pay",
  "kuda",
  "moniepoint",
  "monie point",
  "fairmoney",
  "fair money",
  "chipper",
] as const;

// ── Network aliases (explicit text ONLY — prefix inference is forbidden) ────
const NETWORK_ALIASES: ReadonlyArray<readonly [string, AirtimeNetwork]> = [
  ["mtn", "MTN"],
  ["glo", "Glo"],
  ["airtel", "Airtel"],
  ["9mobile", "9mobile"],
  ["9 mobile", "9mobile"],
  ["etisalat", "9mobile"], // legacy brand of 9mobile
];

// ── Amount parsing ──────────────────────────────────────────────────────────
// 2026-10-24 (W11-B4a verifier hardening, adversarial findings 1/2/3/7):
//   - ₦ is PREFIX-ONLY. As a suffix it swallowed the preceding digit run
//     ("…123456 ₦5000…" parsed the METER as the amount) — funds-critical.
//   - Comma grouping is strict: only \d{1,3}(,\d{3})+ shapes; "1,00,0" is
//     not an amount at all (→ clarification, not a guessed 1000).
//   - Negative adjacency is rejected: a digit run immediately preceded by
//     '-', '.', ',' or another digit is never an amount token ("-500" and
//     "₦-500" clarify; they never become +500).
//   - Explicit AND bare candidates are ALWAYS combined before the decision;
//     two DISTINCT values — in any mix — is ambiguous_amounts (never a
//     precedence pick).

interface AmountHit {
  value: number;
  index: number;
  length: number;
}

/**
 * Strict amount token: plain digits with optional decimal, OR strict
 * thousands grouping (1,000 / 1,000,000). Malformed comma runs match
 * NOTHING here — the lookarounds then also block fragment matches inside
 * them, so garbage clarifies instead of parsing.
 */
const AMOUNT_TOKEN = String.raw`\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?`;
/** Not preceded by '-'/digit/'.'/',' and not followed by digit/'.'/','. */
const TOK_LEFT = String.raw`(?<![-\d.,])`;
const TOK_RIGHT = String.raw`(?![\d.,])`;

/** Explicit: currency marker BEFORE the token (₦/NGN/naira, prefix only). */
const AMOUNT_PREFIX_RE = new RegExp(
  `(₦|ngn|naira)\\s*(${AMOUNT_TOKEN})${TOK_RIGHT}`,
  "gi"
);
/** Explicit: token followed by k / ngn / naira (k = ×1000). */
const AMOUNT_SUFFIX_RE = new RegExp(
  `${TOK_LEFT}(${AMOUNT_TOKEN})${TOK_RIGHT}\\s*(k|ngn|naira)\\b`,
  "gi"
);

/** Strict-token numeric value; null when not a positive integer. */
function tokenValue(digits: string): number | null {
  const numeric = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0)
    return null;
  return numeric;
}

/** Raw numeric value of a strict token (may be fractional, e.g. "2.5"). */
function tokenNumber(digits: string): number | null {
  const numeric = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

/**
 * Extract every EXPLICIT amount (currency marker or k suffix). Fail-closed:
 * a token with no money signal is never returned here.
 */
export function extractAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  let m: RegExpExecArray | null;
  const pre = new RegExp(AMOUNT_PREFIX_RE.source, "gi");
  while ((m = pre.exec(text)) !== null) {
    const value = tokenValue(m[2]);
    if (value === null) continue;
    hits.push({ value, index: m.index, length: m[0].length });
  }
  const suf = new RegExp(AMOUNT_SUFFIX_RE.source, "gi");
  while ((m = suf.exec(text)) !== null) {
    const base = tokenNumber(m[1]);
    if (base === null) continue;
    // k multiplies (2.5k = 2500); a fractional NAIRA value (2.5 naira)
    // is not a legal amount and is dropped.
    const value = /k/i.test(m[2]) ? base * 1000 : base;
    if (!Number.isInteger(value) || value <= 0) continue;
    hits.push({ value, index: m.index, length: m[0].length });
  }
  // Drop hits fully contained in an earlier hit's span (overlapping
  // prefix/suffix double-matches such as "₦5k").
  return hits.filter(
    (h, i) =>
      !hits.some(
        (o, j) =>
          j < i && h.index >= o.index && h.index + h.length <= o.index + o.length
      )
  );
}

/**
 * Bare (no currency marker) amount candidates for rail contexts. Nigerian
 * omnibox phrasing is marker-less more often than not ("buy 5000 mtn
 * airtime to 0803…"). Standalone digit groups of at most 6 digits (rail
 * max ₦500,000) that are NOT phone spans and NOT explicit-amount spans
 * count as candidates; longer digit runs (meter/account numbers) never
 * qualify. Bare candidates are COMBINED with explicit ones — they never
 * silently lose, and they never silently win: any distinct pair of values
 * is ambiguous_amounts (verifier finding 2).
 */
function phoneSpansOf(text: string): Array<{ index: number; length: number }> {
  const spans: Array<{ index: number; length: number }> = [];
  const re = new RegExp(PHONE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ index: m.index, length: m[0].length });
  }
  return spans;
}

function overlaps(
  span: { index: number; length: number },
  spans: Array<{ index: number; length: number }>
): boolean {
  return spans.some(
    s => span.index < s.index + s.length && s.index < span.index + span.length
  );
}

function extractBareAmountCandidates(
  text: string,
  explicit: AmountHit[]
): AmountHit[] {
  const phoneSpans = phoneSpansOf(text);
  const hits: AmountHit[] = [];
  // Bare tokens additionally reject LETTER adjacency — "9psb" (provider
  // code), "5000k" (k is the explicit suffix's job) never leak a bare digit.
  const bare = text.matchAll(
    new RegExp(
      `(?<![-\\d.,A-Za-z])(${AMOUNT_TOKEN})(?![\\d.,A-Za-z])`,
      "g"
    )
  );
  for (const b of bare) {
    const span = { index: b.index ?? 0, length: b[0].length };
    // Never inside an explicit amount span or a phone number span.
    if (overlaps(span, explicit) || overlaps(span, phoneSpans)) continue;
    const digits = b[1].replace(/,/g, "");
    if (digits.length > 6) continue; // meter/account/smartcard territory
    const value = tokenValue(b[1]);
    if (value === null) continue;
    hits.push({ value, index: span.index, length: span.length });
  }
  return hits;
}

/**
 * The rail amount decision: explicit + bare candidates COMBINED. Zero
 * candidates → no_amount; two or more DISTINCT values → ambiguous_amounts.
 * There is no precedence rule that could silently pick one (verifier
 * findings 1 & 2).
 */
function railAmounts(text: string, explicit: AmountHit[]): AmountHit[] {
  return [...explicit, ...extractBareAmountCandidates(text, explicit)];
}

// ── Phone parsing ──────────────────────────────────────────────────────────

// 2026-10-24 (verifier finding 6): digit lookarounds on BOTH ends — a
// phone-shaped run embedded in a longer digit run ("108031234567",
// "008031234567", an account/reference number) is NEVER extracted as a
// phone. Fabricating a beneficiary from a reference number is a mis-pay
// vector; fail-closed.
const PHONE_RE = /(?<!\d)(?:\+?234|0)([789][01]\d{8})(?!\d)/g;

/**
 * Extract Nigerian MSISDNs in any of the three written forms
 * (0803…, +234803…, 234803…) and normalize to 0XXXXXXXXXX (11 digits).
 * Invalid candidates are ignored, never repaired.
 */
export function extractPhones(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(PHONE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const full = m[0];
    const national = full.startsWith("+234")
      ? `0${full.slice(4)}`
      : full.startsWith("234")
        ? `0${full.slice(3)}`
        : full;
    if (/^0[789][01]\d{8}$/.test(national) && national.length === 11) {
      out.push(national);
    }
  }
  return [...new Set(out)];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collect ALL alias hits, table order = priority (tables list longest /
 * most-specific aliases first); hits overlapping an already-accepted span
 * are discarded so "airtel momo" yields ONE hit (Airtel Money), not a
 * second "momo" hit (verifier finding 5 — brand hijack by the generic
 * alias). Callers inspect DISTINCT canonicals: >1 → clarification, never
 * a table-order pick (verifier finding 4).
 */
function collectAliases(
  lower: string,
  aliases: ReadonlyArray<readonly [string, string]>
): Array<{ canonical: string; index: number; length: number }> {
  const hits: Array<{ canonical: string; index: number; length: number }> = [];
  for (const [alias, canonical] of aliases) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const span = { index: m.index, length: m[0].length };
      if (!overlaps(span, hits)) hits.push({ canonical, ...span });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Exactly one distinct canonical → it; otherwise null (absent/conflict). */
function singleCanonical(
  hits: Array<{ canonical: string }>
): { value: string | null; conflict: boolean } {
  const distinct = [...new Set(hits.map(h => h.canonical))];
  if (distinct.length === 0) return { value: null, conflict: false };
  if (distinct.length > 1) return { value: null, conflict: true };
  return { value: distinct[0], conflict: false };
}

/** (stripSpans removed 2026-10-24 — overlap-skip on original indices.) */

/** Meter / smartcard / exam number: 5-13 digits, not a phone, not an amount. */
function extractCustomerNumbers(
  text: string,
  amounts: AmountHit[]
): string[] {
  const phoneSpans = phoneSpansOf(text);
  const hits: string[] = [];
  const re = /(?<![\dA-Za-z])\d{5,13}(?![\dA-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const span = { index: m.index, length: m[0].length };
    if (overlaps(span, amounts) || overlaps(span, phoneSpans)) continue;
    hits.push(m[0]);
  }
  return [...new Set(hits)];
}

function unsupported(reason: string): ParseResult {
  return { status: "unsupported", reason };
}

function clarify(
  flow: MemberIntent["flow"] | null,
  missing: MissingField[],
  partial: Record<string, string | number>,
  reason: string
): ParseResult {
  return { status: "clarification", flow, missing, partial, reason };
}

function amountStatus(
  amounts: AmountHit[],
  bounds: { min: number; max: number }
):
  | { ok: true; amount: number }
  | { ok: false; reason: string; offending?: number } {
  if (amounts.length === 0) {
    return { ok: false, reason: "no_amount" };
  }
  const distinct = [...new Set(amounts.map(a => a.value))];
  if (distinct.length > 1) {
    return { ok: false, reason: "ambiguous_amounts" };
  }
  const amount = distinct[0];
  if (amount < bounds.min || amount > bounds.max) {
    return { ok: false, reason: "amount_out_of_bounds", offending: amount };
  }
  return { ok: true, amount };
}

// ── Main entry ──────────────────────────────────────────────────────────────

/**
 * Parse one omnibox string into a structured intent PROPOSAL. This function
 * never executes anything and never will — the router returns the proposal
 * and the client drives the normal validated mutation with prefilled values.
 */
export function parseMemberIntent(rawText: string): ParseResult {
  if (typeof rawText !== "string") {
    return unsupported("empty_input");
  }
  const text = rawText.trim().replace(/\s+/g, " ");
  if (text.length === 0) return unsupported("empty_input");
  if (text.length > 280) return unsupported("input_too_long");
  // "abeg" (Pidgin: please) is the ONE supported politeness filler — it
  // carries no semantic load, so removing it is deterministic and safe.
  const lower = text.toLowerCase().replace(/\babeg\b/g, " ");

  const amounts = extractAmounts(text);
  const phones = extractPhones(text);

  // ── Navigate: claims ──────────────────────────────────────────────────
  // A claim word together with an action intent (verb or "new"), or the
  // single word "claim" — navigation only, no claim payload is fabricated.
  const hasClaimWord = /\bclaims?\b/.test(lower);
  const hasClaimAction =
    /\b(file|make|submit|report|lodge|register|open|start|new)\b/.test(lower);
  if (hasClaimWord && (hasClaimAction || /^claims?$/.test(lower))) {
    return {
      status: "ready",
      intent: { flow: "navigate", target: "claims_file" },
    };
  }

  // ── Navigate: policy renewal ──────────────────────────────────────────
  if (/\b(renew|renewal|extend|rollover)\b/.test(lower) &&
      /\b(policy|policies|cover|insurance|plan)\b/.test(lower)) {
    return {
      status: "ready",
      intent: { flow: "navigate", target: "policy_renewal" },
    };
  }

  // ── Honestly unsupported rails (detected BEFORE happy-path parsing) ──
  if (/\bdata\b/.test(lower) && /(\bbundle\b|\bplan\b|\d\s*(gb|mb)\b)/.test(lower)) {
    // memberAirtime.vend has no bundle field — the rail does not exist.
    return unsupported("data_bundle_not_supported");
  }
  if (/\b(bank|account)\b/.test(lower) &&
      /\b(transfer|send|move|withdraw)\b/.test(lower)) {
    return unsupported("bank_transfer_not_supported");
  }
  if (/\b(cash\s?out|withdraw)\b/.test(lower) &&
      /\b(wallet|momo|mobile money)\b/.test(lower)) {
    return unsupported("momo_cash_out_not_supported");
  }

  // ── Airtime ───────────────────────────────────────────────────────────
  if (/\b(airtime|recharge|top\s?up)\b/.test(lower) &&
      !/\b(wallet|momo|mobile money)\b/.test(lower)) {
    const partial: Record<string, string | number> = {};
    const missing: MissingField[] = [];
    // Two DISTINCT network names → clarification, never a table-order pick
    // (verifier finding 4: "mtn glo" silently vended MTN).
    const net = singleCanonical(collectAliases(lower, NETWORK_ALIASES));
    if (net.value) partial.network = net.value;
    else missing.push("network"); // absent, conflict, or ported-prefix trap
    const netConflict = net.conflict;
    if (phones.length === 1) partial.phone = phones[0];
    else if (phones.length === 0) missing.push("phone");
    else missing.push("phone"); // ambiguous: two numbers
    const bounds = RAIL_BOUNDS.airtime_vend;
    const amt = amountStatus(railAmounts(text, amounts), bounds);
    if (amt.ok) partial.amountNGN = amt.amount;
    else {
      missing.push("amount");
      if (amt.offending !== undefined) partial.amountNGN = amt.offending;
    }
    if (missing.length === 0) {
      return {
        status: "ready",
        intent: {
          flow: "airtime_vend",
          network: partial.network as AirtimeNetwork,
          phone: partial.phone as string,
          amountNGN: partial.amountNGN as number,
        },
      };
    }
    const reason =
      phones.length > 1
        ? "ambiguous_phones"
        : netConflict
          ? "conflicting_networks"
          : !amt.ok && amt.reason !== "no_amount"
            ? amt.reason
            : "missing_fields";
    return clarify("airtime_vend", missing, partial, reason);
  }

  // ── Momo cash-in ──────────────────────────────────────────────────────
  if (/\b(cash\s?in|fund|add money|load|top\s?up)\b/.test(lower) &&
      /\b(wallet|momo|mobile money)\b/.test(lower)) {
    const badBrand = UNSUPPORTED_WALLET_BRANDS.find(b =>
      new RegExp(`\\b${escapeRegExp(b)}\\b`, "i").test(lower)
    );
    if (badBrand) {
      return unsupported(`provider_not_supported:${badBrand.replace(/\s+/g, "_")}`);
    }
    const partial: Record<string, string | number> = {};
    const missing: MissingField[] = [];
    const prov = singleCanonical(collectAliases(lower, MOMO_PROVIDER_ALIASES));
    if (prov.value) partial.provider = prov.value;
    else missing.push("provider"); // absent or two distinct brands
    const provConflict = prov.conflict;
    const amt = amountStatus(railAmounts(text, amounts), RAIL_BOUNDS.momo_cash_in);
    if (amt.ok) partial.amountNGN = amt.amount;
    else {
      missing.push("amount");
      if (amt.offending !== undefined) partial.amountNGN = amt.offending;
    }
    // A phone in a cash-in sentence is the caller's OWN wallet phone — the
    // cashIn mutation derives it session-side, so it is intentionally not
    // extracted into the intent (never overrides server-side identity).
    if (missing.length === 0) {
      return {
        status: "ready",
        intent: {
          flow: "momo_cash_in",
          provider: partial.provider as MomoProvider,
          amountNGN: partial.amountNGN as number,
        },
      };
    }
    return clarify(
      "momo_cash_in",
      missing,
      partial,
      provConflict
        ? "conflicting_providers"
        : !amt.ok && amt.reason !== "no_amount"
          ? amt.reason
          : "missing_fields"
    );
  }

  // ── Bill payment ──────────────────────────────────────────────────────
  // Distinct-biller conflict ("pay ikeja electric and dstv …") → missing
  // biller clarification, never a longest/first pick.
  const billerHits = collectAliases(lower, BILLER_ALIASES);
  const biller = singleCanonical(billerHits);
  const billerCode = biller.value;
  const billerMentioned =
    billerCode !== null ||
    biller.conflict ||
    (/\b(pay|settle|clear)\b/.test(lower) &&
      /\b(bill|electric|electricity|power|meter|tv|cable|exam|toll|tax)\b/.test(lower));
  if (billerMentioned) {
    const partial: Record<string, string | number> = {};
    const missing: MissingField[] = [];
    if (billerCode) partial.billerCode = billerCode;
    else missing.push("biller"); // unrecognised biller — never guessed
    const customers = extractCustomerNumbers(text, railAmounts(text, amounts));
    if (customers.length === 1) partial.customerNumber = customers[0];
    else missing.push("customerNumber"); // absent or ambiguous
    const amt = amountStatus(railAmounts(text, amounts), RAIL_BOUNDS.bill_pay);
    if (amt.ok) partial.amountNGN = amt.amount;
    else {
      missing.push("amount");
      if (amt.offending !== undefined) partial.amountNGN = amt.offending;
    }
    if (missing.length === 0) {
      return {
        status: "ready",
        intent: {
          flow: "bill_pay",
          billerCode: partial.billerCode as string,
          customerNumber: partial.customerNumber as string,
          amountNGN: partial.amountNGN as number,
        },
      };
    }
    const reason =
      customers.length > 1
        ? "ambiguous_customer_numbers"
        : biller.conflict
          ? "conflicting_billers"
          : !amt.ok && amt.reason !== "no_amount"
            ? amt.reason
            : "missing_fields";
    return clarify("bill_pay", missing, partial, reason);
  }

  return unsupported("no_supported_intent_detected");
}
