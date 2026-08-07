-- ============================================================
-- Migration 0046: Innovation Schema Tables
-- Sprint 108 — All 20 innovations + 8 unwired services
-- ============================================================

-- 1. TELEMATICS EVENTS (UBI motor insurance)
CREATE TABLE IF NOT EXISTS telematics_events (
  id BIGSERIAL PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  device_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL, -- 'trip_start','trip_end','hard_brake','speeding','cornering','idle'
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  speed_kmh DECIMAL(6,2),
  acceleration DECIMAL(6,3),
  distance_km DECIMAL(10,3),
  duration_seconds INTEGER,
  risk_score DECIMAL(5,2), -- 0-100
  driving_score DECIMAL(5,2), -- 0-100 (higher = safer)
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telematics_policy ON telematics_events(policy_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telematics_customer ON telematics_events(customer_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telematics_device ON telematics_events(device_id, recorded_at DESC);

-- 2. WEARABLE READINGS (health & wellness insurance)
CREATE TABLE IF NOT EXISTS wearable_readings (
  id BIGSERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  policy_id INTEGER REFERENCES policies(id),
  device_type VARCHAR(32) NOT NULL, -- 'fitbit','apple_watch','garmin','samsung_health','manual'
  device_id VARCHAR(64),
  reading_date DATE NOT NULL,
  steps INTEGER,
  active_minutes INTEGER,
  sleep_hours DECIMAL(4,2),
  heart_rate_avg INTEGER,
  heart_rate_resting INTEGER,
  bmi DECIMAL(5,2),
  blood_pressure_systolic INTEGER,
  blood_pressure_diastolic INTEGER,
  blood_glucose DECIMAL(6,2),
  wellness_score DECIMAL(5,2), -- 0-100
  reward_points_earned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wearable_customer ON wearable_readings(customer_id, reading_date DESC);
CREATE INDEX IF NOT EXISTS idx_wearable_policy ON wearable_readings(policy_id, reading_date DESC);

-- 3. P2P POOLS (peer-to-peer risk pooling)
CREATE TABLE IF NOT EXISTS p2p_pools (
  id SERIAL PRIMARY KEY,
  pool_name VARCHAR(128) NOT NULL,
  pool_type VARCHAR(32) NOT NULL, -- 'family','cooperative','employer','community'
  product_type VARCHAR(32) NOT NULL, -- 'motor','health','life','property'
  organiser_id INTEGER NOT NULL REFERENCES customers(id),
  max_members INTEGER NOT NULL DEFAULT 50,
  contribution_amount DECIMAL(15,2) NOT NULL,
  contribution_frequency VARCHAR(16) NOT NULL DEFAULT 'monthly',
  pool_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  reinsurance_threshold DECIMAL(15,2) NOT NULL, -- claims above this go to insurer
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'forming', -- 'forming','active','closed','settled'
  tb_account_id VARCHAR(64), -- TigerBeetle pool account
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS p2p_pool_members (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES p2p_pools(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  policy_id INTEGER REFERENCES policies(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contribution_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  claims_made INTEGER NOT NULL DEFAULT 0,
  claims_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  UNIQUE(pool_id, customer_id)
);
CREATE TABLE IF NOT EXISTS p2p_pool_claims (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES p2p_pools(id),
  member_id INTEGER NOT NULL REFERENCES p2p_pool_members(id),
  claim_amount DECIMAL(15,2) NOT NULL,
  approved_amount DECIMAL(15,2),
  paid_from_pool DECIMAL(15,2),
  paid_from_insurer DECIMAL(15,2),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_p2p_pool_status ON p2p_pools(status, period_end);
CREATE INDEX IF NOT EXISTS idx_p2p_member_pool ON p2p_pool_members(pool_id, status);

-- 4. PARAMETRIC TRIGGERS (parametric/index insurance)
CREATE TABLE IF NOT EXISTS parametric_triggers (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  trigger_type VARCHAR(32) NOT NULL, -- 'rainfall','flood','drought','earthquake','temperature','wind'
  data_source VARCHAR(64) NOT NULL, -- 'NIMET','OpenWeather','USGS','satellite'
  location_name VARCHAR(128),
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  radius_km DECIMAL(6,2) DEFAULT 50,
  threshold_value DECIMAL(12,4) NOT NULL,
  threshold_unit VARCHAR(16) NOT NULL, -- 'mm','m','richter','celsius','kmh'
  threshold_direction VARCHAR(8) NOT NULL DEFAULT 'below', -- 'above','below'
  measurement_period_days INTEGER NOT NULL DEFAULT 30,
  payout_amount DECIMAL(15,2) NOT NULL,
  payout_percentage DECIMAL(5,2), -- % of sum insured
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS parametric_payouts (
  id SERIAL PRIMARY KEY,
  trigger_id INTEGER NOT NULL REFERENCES parametric_triggers(id),
  policy_id INTEGER NOT NULL REFERENCES policies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  trigger_date DATE NOT NULL,
  measured_value DECIMAL(12,4) NOT NULL,
  threshold_value DECIMAL(12,4) NOT NULL,
  payout_amount DECIMAL(15,2) NOT NULL,
  tb_transfer_id VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending','approved','paid','disputed'
  data_source_url TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parametric_policy ON parametric_triggers(policy_id, status);
CREATE INDEX IF NOT EXISTS idx_parametric_payout ON parametric_payouts(policy_id, trigger_date DESC);

-- 5. NHIA INTEGRATION (National Health Insurance Authority)
CREATE TABLE IF NOT EXISTS nhia_enrollments (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  nhia_id VARCHAR(32) UNIQUE NOT NULL,
  scheme_type VARCHAR(32) NOT NULL, -- 'NHIS','BHCPF','state_scheme','employer_scheme'
  employer_code VARCHAR(32),
  facility_code VARCHAR(32),
  enrollment_date DATE NOT NULL,
  expiry_date DATE,
  dependants INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS nhia_claims (
  id SERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES nhia_enrollments(id),
  claim_id INTEGER REFERENCES claims(id),
  nhia_claim_ref VARCHAR(32) UNIQUE,
  facility_code VARCHAR(32) NOT NULL,
  diagnosis_code VARCHAR(16), -- ICD-10
  procedure_code VARCHAR(16),
  claim_amount DECIMAL(15,2) NOT NULL,
  approved_amount DECIMAL(15,2),
  nhia_status VARCHAR(16) NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  adjudicated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nhia_customer ON nhia_enrollments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_nhia_claims ON nhia_claims(enrollment_id, nhia_status);

-- 6. COMPARISON QUOTES (multi-insurer comparison engine)
CREATE TABLE IF NOT EXISTS comparison_quotes (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  product_type VARCHAR(32) NOT NULL,
  risk_data JSONB NOT NULL,
  quotes JSONB NOT NULL, -- array of {insurer, product, premium, cover, rating}
  selected_quote_id VARCHAR(32),
  converted BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comparison_session ON comparison_quotes(session_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_comparison_customer ON comparison_quotes(customer_id, created_at DESC);

-- 7. GROUP INSURANCE (employer/cooperative schemes)
CREATE TABLE IF NOT EXISTS group_policies (
  id SERIAL PRIMARY KEY,
  group_name VARCHAR(128) NOT NULL,
  group_type VARCHAR(32) NOT NULL, -- 'employer','cooperative','association','sme'
  organiser_id INTEGER NOT NULL REFERENCES customers(id),
  product_id INTEGER NOT NULL,
  master_policy_number VARCHAR(32) UNIQUE NOT NULL,
  sum_insured_per_member DECIMAL(15,2) NOT NULL,
  premium_per_member DECIMAL(15,2) NOT NULL,
  total_members INTEGER NOT NULL DEFAULT 0,
  total_premium DECIMAL(15,2) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  tb_account_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_policy_id INTEGER NOT NULL REFERENCES group_policies(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  individual_policy_id INTEGER REFERENCES policies(id),
  employee_id VARCHAR(32),
  member_type VARCHAR(16) NOT NULL DEFAULT 'principal', -- 'principal','spouse','child'
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  UNIQUE(group_policy_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_group_policy_status ON group_policies(status, end_date);
CREATE INDEX IF NOT EXISTS idx_group_member ON group_members(group_policy_id, status);

-- 8. BANCASSURANCE (bank partner referrals)
CREATE TABLE IF NOT EXISTS bancassurance_partners (
  id SERIAL PRIMARY KEY,
  partner_name VARCHAR(128) NOT NULL,
  partner_type VARCHAR(32) NOT NULL, -- 'commercial_bank','microfinance','fintech','mobile_money'
  partner_code VARCHAR(16) UNIQUE NOT NULL,
  api_key_hash VARCHAR(64),
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 5.0, -- % of premium
  products_enabled JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bancassurance_referrals (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES bancassurance_partners(id),
  customer_id INTEGER REFERENCES customers(id),
  policy_id INTEGER REFERENCES policies(id),
  referral_code VARCHAR(32) UNIQUE NOT NULL,
  product_type VARCHAR(32) NOT NULL,
  premium_amount DECIMAL(15,2),
  commission_amount DECIMAL(15,2),
  status VARCHAR(16) NOT NULL DEFAULT 'referred', -- 'referred','quoted','bound','lapsed'
  referred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bancassurance_partner ON bancassurance_referrals(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_bancassurance_customer ON bancassurance_referrals(customer_id, referred_at DESC);

-- 9. OPEN INSURANCE (data portability / consent)
CREATE TABLE IF NOT EXISTS open_api_consents (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  third_party_id VARCHAR(64) NOT NULL, -- client_id of requesting app
  third_party_name VARCHAR(128) NOT NULL,
  scopes TEXT[] NOT NULL, -- ['policies:read','claims:read','no_claims_bonus:read']
  consent_token VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS open_api_data_requests (
  id SERIAL PRIMARY KEY,
  consent_id INTEGER NOT NULL REFERENCES open_api_consents(id),
  endpoint VARCHAR(128) NOT NULL,
  response_hash VARCHAR(64), -- SHA-256 of response for audit
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_customer ON open_api_consents(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_consent_token ON open_api_consents(consent_token);

-- 10. CLIMATE RISK SCORES
CREATE TABLE IF NOT EXISTS climate_risk_scores (
  id SERIAL PRIMARY KEY,
  location_name VARCHAR(128),
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  geohash VARCHAR(12),
  flood_risk DECIMAL(5,2), -- 0-100
  drought_risk DECIMAL(5,2),
  windstorm_risk DECIMAL(5,2),
  earthquake_risk DECIMAL(5,2),
  wildfire_risk DECIMAL(5,2),
  composite_risk DECIMAL(5,2),
  data_source VARCHAR(64),
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_climate_geohash ON climate_risk_scores(geohash, valid_from DESC);

-- 11. RENEWAL PREDICTIONS (predictive lapse prevention)
CREATE TABLE IF NOT EXISTS renewal_predictions (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  prediction_date DATE NOT NULL,
  lapse_probability DECIMAL(5,4) NOT NULL, -- 0.0000-1.0000
  lapse_risk_tier VARCHAR(8) NOT NULL, -- 'LOW','MEDIUM','HIGH','CRITICAL'
  key_factors JSONB, -- top features driving the score
  recommended_action VARCHAR(32), -- 'no_action','sms','call','discount_offer','agent_visit'
  discount_offer_pct DECIMAL(5,2),
  outreach_sent BOOLEAN NOT NULL DEFAULT FALSE,
  outreach_sent_at TIMESTAMPTZ,
  converted BOOLEAN,
  model_version VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_renewal_policy ON renewal_predictions(policy_id, prediction_date DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_risk ON renewal_predictions(lapse_risk_tier, outreach_sent, prediction_date);

-- 12. SLO DEFINITIONS & ERROR BUDGET
CREATE TABLE IF NOT EXISTS slo_definitions (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(64) NOT NULL,
  slo_name VARCHAR(128) NOT NULL,
  metric_type VARCHAR(32) NOT NULL, -- 'availability','latency_p99','error_rate','throughput'
  target_value DECIMAL(8,4) NOT NULL, -- e.g., 99.9 for availability, 500 for latency ms
  measurement_window_days INTEGER NOT NULL DEFAULT 30,
  alert_threshold DECIMAL(8,4), -- warn when budget burned > this %
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS error_budget_burns (
  id SERIAL PRIMARY KEY,
  slo_id INTEGER NOT NULL REFERENCES slo_definitions(id),
  measurement_date DATE NOT NULL,
  measured_value DECIMAL(12,4) NOT NULL,
  budget_remaining_pct DECIMAL(8,4) NOT NULL,
  burn_rate DECIMAL(8,4) NOT NULL,
  is_breached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  slo_id INTEGER REFERENCES slo_definitions(id),
  title VARCHAR(256) NOT NULL,
  severity VARCHAR(8) NOT NULL, -- 'P1','P2','P3','P4'
  status VARCHAR(16) NOT NULL DEFAULT 'open', -- 'open','investigating','resolved','postmortem'
  affected_services TEXT[],
  root_cause TEXT,
  resolution TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_slo_service ON slo_definitions(service_name, enabled);
CREATE INDEX IF NOT EXISTS idx_incident_status ON incidents(status, severity, opened_at DESC);

-- 13. CV DAMAGE ASSESSMENTS (computer vision claims)
CREATE TABLE IF NOT EXISTS cv_damage_assessments (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  image_url TEXT NOT NULL,
  damage_type VARCHAR(32), -- 'minor','moderate','severe','total_loss'
  damage_areas JSONB, -- [{area, severity, repair_cost_estimate}]
  estimated_repair_cost DECIMAL(15,2),
  confidence_score DECIMAL(5,4), -- 0-1
  model_version VARCHAR(16),
  auto_approved BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by INTEGER REFERENCES users(id),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cv_claim ON cv_damage_assessments(claim_id, assessed_at DESC);

-- 14. FRAUD GRAPH (network fraud detection)
CREATE TABLE IF NOT EXISTS fraud_graph_nodes (
  id SERIAL PRIMARY KEY,
  node_type VARCHAR(16) NOT NULL, -- 'customer','agent','claim','policy','account','device'
  node_id INTEGER NOT NULL,
  risk_score DECIMAL(5,4) NOT NULL DEFAULT 0,
  fraud_flags TEXT[],
  last_scored_at TIMESTAMPTZ,
  UNIQUE(node_type, node_id)
);
CREATE TABLE IF NOT EXISTS fraud_graph_edges (
  id SERIAL PRIMARY KEY,
  from_node_id INTEGER NOT NULL REFERENCES fraud_graph_nodes(id),
  to_node_id INTEGER NOT NULL REFERENCES fraud_graph_nodes(id),
  edge_type VARCHAR(32) NOT NULL, -- 'same_device','same_address','same_account','referred_by','shared_phone'
  weight DECIMAL(5,4) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_node_id, to_node_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_fraud_node ON fraud_graph_nodes(node_type, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_edge_from ON fraud_graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_fraud_edge_to ON fraud_graph_edges(to_node_id);

-- 15. VOICE CLAIM TRANSCRIPTS
CREATE TABLE IF NOT EXISTS voice_claim_transcripts (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER REFERENCES claims(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  audio_url TEXT,
  transcript TEXT NOT NULL,
  language VARCHAR(8) NOT NULL DEFAULT 'en', -- 'en','ha','yo','ig'
  intent VARCHAR(32), -- 'fnol','status_check','document_request','escalation'
  entities JSONB, -- extracted: policy_number, incident_date, amount, etc.
  confidence DECIMAL(5,4),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_claim ON voice_claim_transcripts(claim_id);
CREATE INDEX IF NOT EXISTS idx_voice_customer ON voice_claim_transcripts(customer_id, processed_at DESC);

-- 16. DID / VERIFIABLE CREDENTIALS (KYC portability)
CREATE TABLE IF NOT EXISTS did_identities (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) UNIQUE,
  did VARCHAR(128) UNIQUE NOT NULL, -- did:insureportal:0x...
  did_document JSONB NOT NULL,
  public_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS verifiable_credentials (
  id SERIAL PRIMARY KEY,
  did_id INTEGER NOT NULL REFERENCES did_identities(id),
  credential_type VARCHAR(32) NOT NULL, -- 'KYCCredential','InsuranceHistoryCredential','NoClaims'
  credential_id VARCHAR(128) UNIQUE NOT NULL,
  issuer VARCHAR(128) NOT NULL,
  subject_did VARCHAR(128) NOT NULL,
  claims JSONB NOT NULL,
  proof JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vc_did ON verifiable_credentials(did_id, credential_type);
CREATE INDEX IF NOT EXISTS idx_vc_subject ON verifiable_credentials(subject_did, credential_type);
