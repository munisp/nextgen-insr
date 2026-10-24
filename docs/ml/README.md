# ML Propensity & Data Readiness — Overview (W11-B5)

**Status: DESIGN / READINESS ONLY.** No model exists, is trained, or is
deployed. Every "current system" statement below cites a real file that was
read while writing this document. Nothing here ships ML code.

## What exists today (heuristics, not ML)

The member-intelligence program (W11) already reduces clicks/forms using
deterministic, inspectable logic:

| Capability | Where | What it actually does |
|---|---|---|
| Next-best-action (NBA) ranking | `server/lib/memberInsights.ts:316` (`computeNextBestActions`) | Fixed-priority rules: renewal (100) > failed refund (90) > recurring due (70) > KYC incomplete (40); every action carries an `explain` string (`memberInsights.ts:71-74`). |
| Recurring-payment detection | `memberInsights.ts:174` (`detectRecurring`) | ≥3 paid occurrences with every interval 30±5 days; failed/reversed rows excluded (`:182`). |
| Amount-anomaly check | `memberInsights.ts:397` (`evaluateAmountAnomaly`) | Fail-closed: flags only when amount > 3× median AND ≥ ₦5,000 floor, with ≥2 history points (`:53-57`). |
| Payee memory | `server/lib/memberPayees.ts:102` (`recordPayee`) | Upserts a payee after a gateway-verified capture only; AES-256-GCM encrypted identifiers + HMAC-SHA256 blind index (`:86-90`, `:115-122`). |
| UX instrumentation | `server/routers/memberUxEvents.ts:129` (`track`) | PII-scrubbed `ux_events` writes (flat ≤20-key metadata, ≤64-char strings — `:100-107`); implicit labels already exist: `prefill_accepted` / `prefill_overridden` (`:72-73`). |
| NL intent parser | `server/lib/memberIntentParser.ts` | Pure deterministic parser; refuses unsupported rails and never guesses amounts/payees (`:19-37`). Emits `intent_parsed` / `clarify_shown` events (`memberUxEvents.ts:83-86`). |
| OCR bill scan | `server/routers/memberBillScan.ts` | Extract-only; never persists the image, never writes a payment; prefill is a proposal the member confirms (`:6-15`). |

## Phased path to ML (proposal)

- **Phase A (now): collect honestly.** `ux_events` (90-day retention, see
  `drizzle/schema.ts:6663`) accumulates implicit labels; `payee_directory`
  accumulates use counts; transactions accumulate history. No training yet —
  label volume is unknown and unmeasured.
- **Phase B (when labels mature): simple baselines.** Logistic regression /
  GBM on the use cases in `data-readiness.md`, always compared against the
  current heuristics in shadow mode (`model-proposals.md`).
- **Phase C (later, only if justified): sequence models** over per-member
  `ux_events` + transaction cadence. Not proposed for any near-term work.

Hard rule for all phases: **no model will ever move funds autonomously.** ML
output feeds the SAME prefill/suggestion UX with explicit member confirmation;
existing guards (rail bounds, KYC gates, velocity limits) stay untouched.

## Documents in this directory

- `data-readiness.md` — per-use-case feature/label/coverage inventory vs `drizzle/schema.ts`.
- `model-proposals.md` — candidate approaches ranked by data maturity, evaluation protocol, fail-closed design.
- `experiment-tracking.md` — versioning + shadow-mode logging proposal (no schema migration).
- `risk-and-ethics.md` — NDPR/GDPR, bias, explainability, data minimization.
