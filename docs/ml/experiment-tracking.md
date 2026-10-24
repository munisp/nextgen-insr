# Experiment Tracking & Shadow-Mode Proposal (W11-B5)

**PROPOSAL ONLY — no schema migration, no code change.** This is a design for
how the repo's honest-count / verification culture extends to ML, if and when
`data-readiness.md` gaps close.

## Versioning discipline

| Artifact | Versioned as | Where |
|---|---|---|
| Feature definition | Markdown spec + SQL excerpt, semver-tagged (`feat-nba/v1.0.0`) | `docs/ml/features/` (to be created when needed) |
| Label definition | Same doc as features; any label change = major version bump | same |
| Training dataset | Content hash (SHA-256 of the export) + row count + time window — mirroring the audit-chain hash discipline (`audit_log.prevHash/entryHash`, schema.ts:581-586) | manifest file committed with the experiment |
| Model | `model-name/vMAJOR.MINOR.PATCH` + training-data hash + metric snapshot | registry TBD (none exists today — GAP) |
| Serving config | Runtime flag value recorded per deploy | deploy log |

Rule: a reported metric is only honest if it names the model version, the
data hash, and the evaluation window. This mirrors the repo's convention of
citing file:line and reporting inserted-vs-duplicate counts honestly
(`memberUxEvents.ts:182-185`).

## Shadow-mode logging schema (PROPOSAL — not migrated)

A future `ml_shadow_log` table (does NOT exist):

```
id              uuid pk defaultRandom()
modelName       text          -- e.g. 'payee-ranker'
modelVersion    text          -- semver
customerId      integer       -- join key only; no PII payload
scoredAt        timestamp
featuresHash    varchar(64)   -- hash of the feature vector, not the vector
scoreJson       jsonb         -- scrubbed: scores/ranks only, same ≤64-char discipline as ux_events
servedHeuristic text          -- what production actually showed
outcomeEventId  uuid null     -- later joined to ux_events.clientEventId
```

Design constraints inherited from the existing system:
- Same PII posture as `ux_events` (schema.ts:6658-6703): no raw identifiers,
  short strings, numeric payloads.
- Idempotent writes via a client/request id, like
  `(customerId, clientEventId)` unique (`memberUxEvents.ts:178-180`).
- Retention aligned to `ux_events` (90 days, schema.ts:6663) unless a
  separate consent-aware store is designed.

## Acceptance gates before promotion

An ML candidate may replace a heuristic only when ALL hold:

1. **Data gate:** the minimum maturation window in `data-readiness.md` is
   met, with the actual row counts measured and reported (not estimated).
2. **Offline gate:** beats the heuristic baseline on the primary metric on a
   time-split holdout; the baseline number is published alongside.
3. **Shadow gate:** ≥4 weeks of shadow logs; score distribution stable; no
   PII found in `scoreJson` during audit sampling.
4. **Guardrail gate:** fail-closed fallback demonstrated in a chaos test
   (model endpoint killed → heuristic serves, matching the
   `insufficient_history` precedent at `memberInsights.ts:401-406`).
5. **Legal gate:** consent posture checked against `data_consent_records`
   coverage (`risk-and-ethics.md`).
6. **Honesty gate:** the launch note states the measured metrics, the window,
   and the kill-switch flag name. No silent promotions.
