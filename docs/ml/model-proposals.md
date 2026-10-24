# Model Proposals (W11-B5)

**Status: PROPOSALS ONLY.** No model is trained, deployed, or scheduled.
Every approach below is ranked by *data maturity* per `data-readiness.md`.
The current heuristics remain the production behavior in every case until an
acceptance gate in `experiment-tracking.md` is passed.

## Cross-cutting invariants (non-negotiable)

- **No model will ever move funds autonomously.** ML outputs feed the SAME
  prefill/suggestion UX the heuristics feed today, with explicit member
  confirmation; the member then drives the existing validated mutations
  (e.g. `memberBillPayments.pay`, `memberAirtime.vend`) which re-run every
  server-side guard — the same execution boundary the OCR scan honors
  (`memberBillScan.ts:6-15`).
- **Fail-closed:** on model error, timeout, low confidence, or missing
  features, output = the current heuristic (or "no suggestion"), mirroring
  `evaluateAmountAnomaly`'s `insufficient_history → anomalous:false`
  (`memberInsights.ts:401-406`).
- **Existing guards untouched:** rail amount bounds (`memberIntentParser.ts:70-74`),
  KYC gates, velocity limits, and payment idempotency are upstream of any
  suggestion layer and never bypassed.

## 1. Payee recommendation ranking (most mature)

- **Today:** `listPayees` orders by `lastUsedAt` desc (`memberPayees.ts:173-190`).
- **Baseline (when `prefill_accepted`/`prefill_overridden` volume is known):**
  logistic regression on [useCount, recency days, lastAmountKobo bucket,
  rail, hour-of-day]. Features from `payee_directory` (schema.ts:6619) only.
- **Later:** gradient-boosted ranking (LambdaMART-style) per member cohort.
- **Metrics:** offline top-1 acceptance rate vs. recency baseline;
  shadow mode for ≥4 weeks; promote only if acceptance lifts with no
  increase in `prefill_overridden` rate.
- **Kill switch:** config flag reverts ordering to `lastUsedAt` desc — one
  line of behavior, zero data migration.

## 2. Next-best-action propensity

- **Today:** fixed priorities in `computeNextBestActions` (`memberInsights.ts:316-382`).
- **Baseline (after NBA-impression logging exists — a prerequisite GAP):**
  per-action-type logistic model predicting accept probability; rank by
  expected value, capped so `failed_refund_pending` (an ops-safety surface,
  `memberInsights.ts:341-349`) can never be demoted below other types.
- **Later:** contextual bandit only after baseline calibration is proven;
  exploration must be ε-greedy with ε ≥ 0.1 so no action class starves.
- **Metrics:** offline AUC/log-loss per action type; online accept rate per
  type; guardrail: KYC-incomplete nudge CTR must not drop.
- **Kill switch:** revert to the fixed priority table (it is 5 constants).

## 3. Amount-anomaly personalization

- **Today:** median-multiple rule with ₦5,000 floor (`memberInsights.ts:397-420`).
- **Baseline:** per-(member, payee) robust z-score on log-amount, replacing
  the fixed 3× multiple; still floored at `ANOMALY_FLOOR_KOBO`. This is
  statistics, not ML — honestly labeled.
- **Later:** isolation forest over [amount, hour, day-of-month, cadence
  deviation] once ≥20 labeled outcomes exist — note the label GAP
  (`data-readiness.md` §3), so this is speculative.
- **Metrics:** false-flag rate (must stay below the rule's), member override
  rate after a flag. A soft confirm that fires too often is a regression.
- **Kill switch:** constant revert; the rule is a pure function.

## 4. Churn / renewal-lapse risk

- **Today:** date-window rule (`listRenewalsDue`, `memberInsights.ts:260-290`).
- **Baseline (after ≥2 renewal cycles of history):** logistic regression /
  GBM on [policy age, premium band, days-to-due, prior lapse count, payment
  cadence gap]. Output = risk score used only to *order reminder timing*,
  never to alter pricing or eligibility.
- **Later:** survival analysis (time-to-lapse). Sequence models not proposed.
- **Metrics:** calibration curve (Brier score) — a ranking that is wrong
  about *when* members lapse wastes notification budget; uplift vs.
  date-window baseline measured on reminder→renewal conversion.
- **Kill switch:** disable scoring; the 14-day window rule remains.

## 5. Intent-parser ML fallback (least mature — do not start)

- **Today:** deterministic parser that refuses ambiguity by design
  (`memberIntentParser.ts:19-37`).
- **Precondition:** consented utterance collection (does not exist).
- **If ever justified:** a small intent classifier as a *fallback* invoked
  only after the deterministic parser returns `unsupported`, and even then
  its output must route through the same `clarification` contract —
  an ML intent NEVER produces a `ready` payload on its own.
- **Kill switch:** not applicable until built; fallback flag = "always
  refuse", which is today's behavior.

## Evaluation protocol (applies to all)

1. Offline metrics on a time-split holdout (no random splits — behavior drifts).
2. Shadow mode: model scores logged, heuristics still serve — ≥4 weeks.
3. Promotion gate: beats baseline on the primary metric with guardrails flat
   or better (see `experiment-tracking.md`).
4. Rollback: every promotion ships with the heuristic path intact and a
   runtime flag; rollback = flip flag, no migration, no retraining.
