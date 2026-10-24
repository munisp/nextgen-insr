# Risk & Ethics — ML on Member Behavior (W11-B5)

**Status: guidance for future work; nothing here describes a running model.**

## NDPR / GDPR considerations

- **Lawful basis & consent.** A consent ledger exists: `data_consent_records`
  (schema.ts:3841) with types `data_processing | marketing | analytics |
  third_party_sharing | biometric` (`dataConsentRecordsCrud.ts:10-16`), a
  365-day expiry constant (`:17`), grant with `grantedAt`/`expiresAt`
  (`:109-117`), and withdrawal (`withdrawConsent`, `:132-165`, referencing
  NDPR Article 2.3 at `:155`).
  - **Honesty caveat found while reading:** the router writes fields
    (`status`, `withdrawalReason`) that are NOT in the `data_consent_records`
    schema definition (schema.ts:3841-3860 has `granted`, `revokedAt`,
    no `status`/`expiresAt`/`withdrawalReason` columns), and filters users
    via `dataConsentRecords.userAgent` cast to a number (`:35`). This router
    needs reconciliation with its schema before any ML pipeline relies on it
    as a consent gate. Flagged, not fixed (docs-only scope).
- **Consent type for training:** member-behavior training should require the
  `analytics` consent (or a new explicit `ml_personalization` type). UI
  instrumentation today is operational telemetry, not consent for model
  training — do not silently repurpose it.
- **Retention:** `ux_events` retention is 90 days (schema.ts:6663). Training
  sets must not outlive the retention of their source rows; derived features
  need their own retention rule.
- **Erasure:** the audit log already supports PII redaction with tombstones
  (`redactedAt`, schema.ts:587-592). An erasure request must cascade to
  feature stores and shadow logs — the proposed `ml_shadow_log` keeps only a
  `customerId` join key to make that feasible.

## Bias risks

- **Low-history penalty (biggest risk).** The anomaly heuristic already fails
  closed on `<2` history points (`memberInsights.ts:57`, `:401-406`) — a
  learned model must preserve this: new/low-activity members must not receive
  MORE friction (false anomaly flags, demoted payees) because the model is
  confident about everyone else. Evaluate metrics sliced by history depth.
- **Wealth proxying.** `lastAmountKobo` and premium bands correlate with
  income. NBA propensity must not systematically suppress KYC-completion or
  refund nudges for low-amount members; cap any ranking so safety surfaces
  (failed refunds — `memberInsights.ts:341-349`) are never demoted.
- **Rail exclusion.** Momo cash-in has no per-payee identifier
  (`memberInsights.ts:20-21`), so momo-dominant members get no
  personalization at all — an equity gap to fix at the data layer first,
  not to paper over with model guesses.
- **Language.** The intent parser handles English + "abeg" only
  (`memberIntentParser.ts:29-31`). Any ML fallback trained on stored
  utterances would inherit whatever language mix consented to collection —
  measure parse success per language before claiming coverage.

## Explainability requirements

- The existing NBA contract carries a human-readable `explain` string per
  action (`memberInsights.ts:71-74`, e.g. `:355-358`). Any ML-ranked surface
  must emit an equivalent reason the member can read — "because you usually
  pay this around the 1st" — not a score.
- The anomaly check already returns a machine-readable `reason`
  (`insufficient_history | below_floor | exceeds_historical_multiple |
  within_historical_range`, `memberInsights.ts:401-419`); model replacements
  must keep an equivalent reason enum.
- Members can already inspect what telemetry exists about them via
  `mySummary` (`memberUxEvents.ts:193-220`) — ML feature usage should be
  disclosed in the same transparency surface.

## Data-minimization rules

1. Train on `naturalKey` blind indexes and aggregates, never on decrypted
   meter/phone/wallet values (`memberPayees.ts:24-27`).
2. Respect the `ux_events` scrub discipline (≤20 keys, ≤64-char strings,
   no nesting — `memberUxEvents.ts:100-107`) in every derived store.
3. Never collect raw omnibox utterances without a DPIA and explicit consent —
   their absence today is deliberate (`data-readiness.md` §5).
4. Features keyed by `customerId` only; no device fingerprinting, no
   cross-member graph features for member-facing personalization.
5. When in doubt, fail closed — the platform's own precedent is that "a
   half-understood sentence that moves money is worse than a refusal"
   (`memberIntentParser.ts:30-31`). The same standard applies to models.
