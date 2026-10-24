-- W11-B2 (2026-10-24): ux_events — privacy-minimal UX instrumentation
-- backbone for the member-intelligence program (Phase 2). Mirrors the
-- uxEvents table in drizzle/schema.ts so `drizzle-kit push` (integration
-- harness) materializes the same structure. Append-only and idempotent
-- (IF NOT EXISTS); no existing table or column is altered.
--
-- PRIVACY MANDATE (hard rules, enforced zod-side in
-- server/routers/memberUxEvents.ts):
--   - NO PII payloads. Columns carry flow names, event kinds, field NAMES
--     (never values), and step names only.
--   - metadataJson is SMALL and scrubbed: zod admits only
--     number/boolean/short-string (<= 64 chars) leaf values so no free-text
--     PII can be smuggled through it.
--   - sessionId is a CLIENT-GENERATED uuid (per browser/app session) — it
--     is deliberately NOT the auth session id, so instrumentation cannot be
--     correlated to auth tokens server-side beyond the (already known)
--     customerId.
--
-- RETENTION: rows are raw telemetry with a 90-day intended retention
-- (purge job to be scheduled by ops; aggregates in admin funnel queries are
-- computed on the fly). Documented here so the lifecycle is explicit, not
-- implicit.
--
-- IDEMPOTENCY: (customerId, clientEventId) is UNIQUE — client retries of a
-- batch never double-count (INSERT ... ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS "ux_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customerId" integer NOT NULL REFERENCES "customers"("id"),
  -- Client-generated per-session uuid (NOT the auth session).
  "sessionId" text NOT NULL,
  -- e.g. 'bill_pay', 'airtime_vend', 'momo_cash_in', 'claim_file', 'kyc_submit'
  "flow" text NOT NULL,
  -- zod-validated enum-ish: form_started | field_edited | prefill_accepted |
  -- prefill_overridden | step_abandoned | completed | recommendation_accepted |
  -- recommendation_dismissed | recommendation_dismissed_forever
  "event" text NOT NULL,
  -- Field NAME only, never the value.
  "fieldName" text,
  "step" text,
  -- Small scrubbed bag: numeric durations/counts; short strings only.
  "metadataJson" jsonb,
  "clientEventId" uuid NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ux_events_customer_idx"
  ON "ux_events" ("customerId");
CREATE INDEX IF NOT EXISTS "ux_events_customer_flow_created_idx"
  ON "ux_events" ("customerId", "flow", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_events_client_event_unique"
  ON "ux_events" ("customerId", "clientEventId");
-- Admin funnel scans by date range.
CREATE INDEX IF NOT EXISTS "ux_events_created_idx"
  ON "ux_events" ("createdAt");
