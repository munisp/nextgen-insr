-- F5 abuse controls part 2 (audit wave F5) — additive only, re-runnable.
--
-- AB-19: refunds gain the server-derived destination account and the
-- authenticated initiating user; refund velocity is keyed on these instead
-- of the attacker-chosen customerId.
--
-- AB-10 support: refund-loop detection writes fraud_alerts rows
-- (type='refund_loop_velocity'); no new table required — the fraud queue
-- already exists. Indexes below keep the velocity COUNT queries cheap.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS "destinationAccount" VARCHAR(20);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS "initiatedByUserId" INTEGER;

CREATE INDEX IF NOT EXISTS refund_initiated_by_idx ON refunds("initiatedByUserId");
CREATE INDEX IF NOT EXISTS refund_destination_idx ON refunds("destinationAccount");
CREATE INDEX IF NOT EXISTS pwe_policy_type_created_idx ON policy_workflow_events("policyId", "eventType", "createdAt");
