# Data Readiness Inventory (W11-B5)

**Honest baseline.** Coverage percentages are estimates from reading the
schema — NOT measured from production data (no row counts were available to
this exercise). Anything we could not verify is marked **unknown**.

Source-of-truth tables verified in `drizzle/schema.ts`:
`transactions` (:394), `payee_directory` (:6619), `ux_events` (:6666),
`policies` (:4916), `policy_renewals` (:5130), `claims` (:4990),
`kyc_sessions` (:1105), `data_consent_records` (:3841).

## 1. Next-best-action propensity

| Aspect | Detail |
|---|---|
| Required features | Member's recent tx mix by rail, days since last tx per rail, renewal proximity, KYC status, historical NBA accept/dismiss rate. |
| Source tables | `transactions` (`type`, `amount`, `status`, `metadata`, `createdAt` — schema.ts:402-433); `policies` (`status`, `renewalDate`, `endDate` — :4926-4932); `kyc_sessions` (`type`, `status` — :1115-1116); `ux_events` (`flow`, `event`, `metadataJson` — :6675-6683). |
| Current coverage | ~70% computable today: all features except per-NBA-action response, because `computeNextBestActions` output is not yet logged as an event with an action id (GAP — NBA impressions are not recorded; only downstream flow events are). |
| Label definition | `recommendation_accepted` / `recommendation_dismissed` / `recommendation_dismissed_forever` events exist (`memberUxEvents.ts:76-78`) but need an action-type field to join to a specific NBA — GAP. |
| PII/legal | `ux_events` is scrubbed by construction (`memberUxEvents.ts:100-107`); `sessionId` is a client uuid, not auth session (`:18-19`). 90-day retention (schema.ts:6663) caps training window. |
| Maturation window | ≥90 days (one full retention cycle) of NBA-impression logging before any metric is honest. Not started. |

## 2. Churn / renewal-lapse risk

| Aspect | Detail |
|---|---|
| Required features | Policy age, premium, days to `renewalDate`, prior renewals/lapses, member payment cadence, tenure. |
| Source tables | `policies` (:4916 — `annualPremium` :4929, `renewalDate` :4932, `status` enum includes `lapsed` :4810); `policy_renewals` (:5130 — `status`, `completedAt` :5140-5143); `policy_lifecycle_states` (:5607 — `lapsedAt`, `reinstatedAt`). |
| Current coverage | ~60%: dates/statuses/premiums exist; member payment cadence is computable from `transactions`; lapse reasons (`cancellationReason` :4934) are sparse free text. Member↔policy join is complicated by the dual identity space (`policies.customerId` is both `users.id` and `customers.id` — noted at `memberInsights.ts:6-8`). |
| Label definition | Policy reaches `renewalDate` without a `policy_renewals.completedAt` → lapsed. Recorded, but historical depth is unknown (renewals module maturity unverified). |
| PII/legal | Low: premiums and dates are not special-category; join through encrypted PII not required for training (ids suffice). |
| Maturation window | ≥2 renewal cycles of the dominant product (typically 12–24 months for annual policies). Not met. |

## 3. Amount-anomaly personalization

| Aspect | Detail |
|---|---|
| Required features | Per-(member, payee) amount history — mean/median/variance, trend, day-of-month. |
| Source tables | `transactions` (`amount` :403, `metadata` payee tuple — reconstructed via `txPayeeNaturalKey`, `memberInsights.ts:136-157`); `payee_directory.lastAmountKobo` (schema.ts:6640). |
| Current coverage | ~80% for bill/airtime rails; **0% for momo cash-in** — momo rows carry no wallet identifier in metadata (`memberInsights.ts:20-21`), a structural GAP. |
| Label definition | Weak implicit labels only: `prefill_overridden` on the amount field, or a completed payment after an anomaly confirm. No explicit "this was fraud/wrong" label — GAP. |
| PII/legal | Amounts are not PII; payee identifiers are AES-256-GCM encrypted with HMAC blind indexes (`memberPayees.ts:24-27`, `:86-90`) — training must key on `naturalKey`, never decrypted values. |
| Maturation window | ≥3 payments per payee (the current heuristic's own minimum, `memberInsights.ts:48`); fleet-wide, unknown. |

## 4. Payee recommendation ranking

| Aspect | Detail |
|---|---|
| Required features | `useCount`, `lastUsedAt` recency, `lastAmountKobo`, time-of-day/day-of-week, rail mix. |
| Source tables | `payee_directory` (:6619 — `useCount` :6641, `lastUsedAt` :6642); timestamps from `transactions`. |
| Current coverage | ~90%: the table is purpose-built; only time-context features need derivation. |
| Label definition | `prefill_accepted` / `prefill_overridden` per payee selection (`memberUxEvents.ts:72-73`) — recorded today when clients emit them; volume unknown. |
| PII/legal | Encrypted identifier columns are unusable as features (random-IV AES-256-GCM, `memberPayees.ts:12-16`); train on `naturalKey` + aggregates only. |
| Maturation window | ~60–90 days of `prefill_*` events; earliest of all use cases to mature. |

## 5. Intent-parser ML fallback

| Aspect | Detail |
|---|---|
| Required features | Raw utterance text, parse outcome, clarification loop depth, final completion. |
| Source tables | `ux_events` kinds `omnibox_opened`, `intent_parsed`, `prefill_applied`, `clarify_shown` (`memberUxEvents.ts:83-86`). |
| Current coverage | **~0% and structurally blocked**: the metadata scrub caps strings at 64 chars and the omnibox events carry intent type/rail only (`memberUxEvents.ts:79-86`) — the raw utterance is deliberately NOT stored. This is a privacy feature, not an oversight. |
| Label definition | Would need a consent-gated, separately-retained utterance log. Does not exist — GAP by design. |
| PII/legal | Utterances can contain phones/meter numbers = personal data; requires explicit consent (`analytics` type, see `dataConsentRecordsCrud.ts:10-16`) and a separate retention policy before any collection. |
| Maturation window | Indefinite — do not start collection without a DPIA. |

## Cross-cutting gaps (explicit)

1. NBA impressions are not logged with an action id → no NBA accept-rate labels.
2. Momo cash-in has no per-payee natural key (`memberInsights.ts:20-21`).
3. No explicit anomaly-outcome label (fraud vs. member intent).
4. Raw utterances are not (and should not be) captured by current telemetry.
5. `ux_events` 90-day retention (schema.ts:6663) means long-horizon features
   need a separate, aggregated, consent-aware store — not yet designed.
