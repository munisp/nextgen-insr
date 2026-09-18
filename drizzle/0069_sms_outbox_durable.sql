-- F4 audit NG-5/NG-6: durable SMS delivery log with retry/backoff + inbound
-- command record (canonical schema; sms-service also self-creates these).
CREATE TABLE IF NOT EXISTS sms_messages (
  id SERIAL PRIMARY KEY,
  recipient VARCHAR(32) NOT NULL,
  body TEXT NOT NULL,
  provider VARCHAR(32),
  message_id VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sms_msg_retry_idx ON sms_messages(status, next_retry_at);
CREATE INDEX IF NOT EXISTS sms_msg_provider_id_idx ON sms_messages(provider, message_id);
