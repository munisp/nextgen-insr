-- B11 + B12 + B13 (Zero-Undelivered-Scope wave 2c): honest heuristic claim
-- scorer persistence, USSD session telemetry, and compliance chatbot
-- conversation persistence. Additive only — no drops, no type changes.
--
-- ml_score_results: persisted outputs of the in-repo statistical scorer
-- (server/lib/claimRiskScorer.ts). model_type is 'heuristic-v1' — these are
-- transparent weighted-formula scores over documented real features, NOT
-- trained-ML inferences. feature_breakdown_json carries the exact feature
-- values and per-feature weighted contributions so every score is auditable.
CREATE TABLE IF NOT EXISTS ml_score_results (
  id SERIAL PRIMARY KEY,
  subject_type VARCHAR(32) NOT NULL,        -- 'claim' | 'transaction'
  subject_id INTEGER NOT NULL,
  model_type VARCHAR(32) NOT NULL,          -- always 'heuristic-v1' today
  score NUMERIC(6,5) NOT NULL,              -- weighted sum, 0..1
  risk_band VARCHAR(16) NOT NULL,           -- 'low' | 'medium' | 'high'
  feature_breakdown_json JSON NOT NULL,     -- features + weights + contributions
  scored_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS msr_subject_idx ON ml_score_results(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS msr_created_at_idx ON ml_score_results(created_at);

-- ussd_session_events: real USSD telemetry captured at the only production
-- capture point — ussdGateway.processInput, which forwards telco callbacks to
-- the Go ussd-gateway. One row per callback interaction (menu step). menu_path
-- is the cumulative path of user inputs within the session (e.g. "1>2"),
-- reconstructed by the capture code from prior events of the same session.
CREATE TABLE IF NOT EXISTS ussd_session_events (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  phone_number VARCHAR(32),
  agent_id VARCHAR(64),
  user_input VARCHAR(256),
  menu_path VARCHAR(512),
  gateway_response TEXT,
  end_session BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS use_session_idx ON ussd_session_events(session_id);
CREATE INDEX IF NOT EXISTS use_created_at_idx ON ussd_session_events(created_at);

-- chat_sessions / chat_messages: compliance chatbot conversation persistence.
-- Messages are inserted by complianceChatbot.sendMessage — the user message is
-- persisted before the Ollama call and the assistant reply after it, so a
-- session transcript never contains an assistant message that Ollama did not
-- actually generate. model records the Ollama model that produced the reply
-- (NULL on user messages).
CREATE TABLE IF NOT EXISTS chat_sessions (
  id SERIAL PRIMARY KEY,
  session_key VARCHAR(64) NOT NULL UNIQUE,
  user_id INTEGER,
  title VARCHAR(256),
  purpose VARCHAR(64) NOT NULL DEFAULT 'compliance',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cs_user_idx ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS cs_last_activity_idx ON chat_sessions(last_activity_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL,
  role VARCHAR(16) NOT NULL,                -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  model VARCHAR(128),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cm_session_idx ON chat_messages(session_id);

-- Scorer weights (B11): the heuristic-v1 formula weights live in
-- system_config so operators can re-tune them without a deploy. The scorer
-- FAILS LOUD (PRECONDITION_FAILED) if this key is absent or malformed —
-- these are documented defaults, not hidden magic constants.
-- Features (all from real rows; see server/lib/claimRiskScorer.ts):
--   amountToPremiumRatio  claims."claimedAmount" / policies."annualPremium"
--   claimantHistoryCount  prior claims by the same claimantId
--   policyAgeDays         policies."startDate" -> claim reportedDate
--   priorFraudFlag        any prior claim by this claimant with
--                         "isFraudSuspected" = true, or this claim flagged
INSERT INTO system_config (key, value, description, "updatedBy")
VALUES (
  'mlScoring.claimRisk.weights',
  '{"amountToPremiumRatio":0.40,"claimantHistoryCount":0.20,"policyAgeDays":0.15,"priorFraudFlag":0.25}',
  'heuristic-v1 claim-risk scorer weights (must sum to 1.0). Transparent weighted formula — NOT trained ML.',
  'migration-0059'
)
ON CONFLICT (key) DO NOTHING;
