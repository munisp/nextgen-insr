-- Audit wave F1 (payments) — additive only.
--
-- PAY-6: payment_discrepancies — real findings produced by
-- paymentReconciliation.runReconciliation (PG-vs-ledger comparison) and
-- resolved via resolveDiscrepancy. Replaces the previous theatre where the
-- procedure inserted/selected a row and returned "completed" without any
-- comparison logic.
CREATE TABLE IF NOT EXISTS payment_discrepancies (
  id              serial PRIMARY KEY,
  "runId"         varchar(64)  NOT NULL,
  kind            varchar(64)  NOT NULL,
  ref             varchar(128),
  "agentId"       integer,
  "expectedAmount" numeric(18,2),
  "actualAmount"   numeric(18,2),
  detail          text,
  status          varchar(16)  NOT NULL DEFAULT 'open',
  "resolvedBy"    varchar(128),
  "resolvedAt"    timestamp,
  "resolutionNote" text,
  "createdAt"     timestamp    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pdisc_run_idx    ON payment_discrepancies ("runId");
CREATE INDEX IF NOT EXISTS pdisc_status_idx ON payment_discrepancies (status);
CREATE INDEX IF NOT EXISTS pdisc_ref_idx    ON payment_discrepancies (ref);
