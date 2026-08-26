-- DD-TSMONEY (F4/F5): durable event dedupe for the Kafka event consumer and
-- inbound webhooks (Stripe). Additive only — no drops, no type changes.
--
-- processed_events: the Kafka consumer inserts the marker row in the SAME
-- transaction as the event handler's effects (single dedicated connection,
-- BEGIN/COMMIT on that client). A redelivery conflicts on event_id and all
-- side effects are skipped; a handler failure rolls the marker back so the
-- event is retried instead of half-applied.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(200) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- webhook_events: inserted BEFORE any webhook side effect (audit rows,
-- ledger writes, event publishes). Duplicate deliveries conflict and are
-- acknowledged without re-running side effects.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id VARCHAR(255) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  event_type VARCHAR(200) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS processed_events_type_idx ON processed_events(event_type, processed_at);
CREATE INDEX IF NOT EXISTS webhook_events_provider_idx ON webhook_events(provider, processed_at);
