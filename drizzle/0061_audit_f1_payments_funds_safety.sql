-- Audit wave F1 (payments) — additive only, IF NOT EXISTS guards keep this
-- re-runnable; the drizzle journal intentionally stays stale per repo pattern
-- (schema is pushed via drizzle-kit push).
--
-- PAY-3: tb_transfer_registry — durable client-side idempotency registry for
-- TigerBeetle transfers (the tb-sidecar is a transparent proxy with no dedup;
-- see server/tbClient.ts). ref → payloadHash + deterministic transferId +
-- outcome makes retry-after-timeout safe and ref-reuse-across-payloads an
-- explicit conflict.
CREATE TABLE IF NOT EXISTS tb_transfer_registry (
  ref           varchar(128) PRIMARY KEY,
  "payloadHash" varchar(64)  NOT NULL,
  "transferId"  varchar(128),
  status        varchar(16)  NOT NULL DEFAULT 'indeterminate',
  response      text,
  "createdAt"   timestamp    NOT NULL DEFAULT now(),
  "updatedAt"   timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tbreg_status_idx ON tb_transfer_registry (status);

-- PAY-2 (double-refund block): one ACTIVE refund per dispute. Rejected and
-- failed refunds are terminal/non-moving states and do not block a corrected
-- resubmission; pending/approved/processing/processed do.
CREATE UNIQUE INDEX IF NOT EXISTS refund_active_dispute_unique
  ON refunds ("disputeId")
  WHERE status NOT IN ('rejected', 'failed') AND "deletedAt" IS NULL;

-- PAY-4 (wallet top-up rail binding): one settled wallet credit per rail
-- reference — a rail reference can never be consumed twice.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_rail_reference_unique
  ON transactions ((metadata->>'railReference'))
  WHERE type = 'Cash In' AND status = 'success'
    AND metadata->>'railReference' IS NOT NULL;
