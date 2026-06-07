-- Seed script for 34 empty tables
-- Each table gets 3-5 sample records

-- ab_testing_framework
INSERT INTO ab_testing_framework (id, experiment_name, variant, status, created_at) VALUES
('seed-ab-1', 'premium-pricing-test', 'control', 'active', NOW()),
('seed-ab-2', 'premium-pricing-test', 'variant_a', 'active', NOW()),
('seed-ab-3', 'onboarding-flow-test', 'control', 'completed', NOW())
ON CONFLICT (id) DO NOTHING;

-- agent_mobile_app
INSERT INTO agent_mobile_app (id, agent_id, device_type, app_version, status, created_at) VALUES
('seed-ama-1', 'AGT-001', 'android', '2.1.0', 'active', NOW()),
('seed-ama-2', 'AGT-002', 'ios', '2.1.0', 'active', NOW()),
('seed-ama-3', 'AGT-003', 'android', '2.0.5', 'inactive', NOW())
ON CONFLICT (id) DO NOTHING;

-- agent_network_platform
INSERT INTO agent_network_platform (id, network_name, region, agent_count, status, created_at) VALUES
('seed-anp-1', 'Lagos Metro Network', 'Lagos', 150, 'active', NOW()),
('seed-anp-2', 'Abuja Capital Network', 'FCT', 85, 'active', NOW()),
('seed-anp-3', 'Port Harcourt Network', 'Rivers', 62, 'active', NOW())
ON CONFLICT (id) DO NOTHING;

-- agent_networks
INSERT INTO agent_networks (id, name, region, tier, status, created_at) VALUES
('seed-an-1', 'Premium Agents Lagos', 'Lagos', 'gold', 'active', NOW()),
('seed-an-2', 'Standard Agents Abuja', 'FCT', 'silver', 'active', NOW()),
('seed-an-3', 'Rural Agents Kano', 'Kano', 'bronze', 'active', NOW())
ON CONFLICT (id) DO NOTHING;

-- agent_onboarding_progress
INSERT INTO agent_onboarding_progress (id, agent_id, step, status, completed_at) VALUES
('seed-aop-1', 'AGT-NEW-001', 'kyc_verification', 'completed', NOW()),
('seed-aop-2', 'AGT-NEW-001', 'training_module', 'in_progress', NULL),
('seed-aop-3', 'AGT-NEW-002', 'kyc_verification', 'pending', NULL)
ON CONFLICT (id) DO NOTHING;

-- api_key_usage
INSERT INTO api_key_usage (id, api_key_id, endpoint, request_count, last_used_at) VALUES
('seed-aku-1', 'KEY-001', '/api/v1/policies', 1250, NOW()),
('seed-aku-2', 'KEY-001', '/api/v1/claims', 830, NOW()),
('seed-aku-3', 'KEY-002', '/api/v1/agents', 450, NOW())
ON CONFLICT (id) DO NOTHING;

-- audit_trail_system
INSERT INTO audit_trail_system (id, action, entity_type, entity_id, user_id, created_at) VALUES
('seed-ats-1', 'CREATE', 'policy', 'POL-SEED-001', 'USR-001', NOW()),
('seed-ats-2', 'UPDATE', 'claim', 'CLM-SEED-001', 'USR-002', NOW()),
('seed-ats-3', 'DELETE', 'agent', 'AGT-SEED-001', 'USR-ADMIN-001', NOW())
ON CONFLICT (id) DO NOTHING;

-- claims_adjudication_engine
INSERT INTO claims (id, policy_id, claimant_id, amount, claim_type, status) VALUES
('seed-cae-1', 'POL-SEED-001', 'CLM-SEED-001', 25000.00, 'health', 'approved'),
('seed-cae-2', 'POL-SEED-002', 'CLM-SEED-002', 150000.00, 'motor', 'escalated'),
('seed-cae-3', 'POL-SEED-003', 'CLM-SEED-003', 5000.00, 'micro', 'submitted')
ON CONFLICT (id) DO NOTHING;

-- commission_payouts
INSERT INTO commission_payouts (id, agent_id, amount, payout_type, status, created_at) VALUES
('seed-cp-1', 'AGT-001', 15000.00, 'monthly', 'paid', NOW()),
('seed-cp-2', 'AGT-002', 22000.00, 'monthly', 'pending', NOW()),
('seed-cp-3', 'AGT-003', 8500.00, 'bonus', 'approved', NOW())
ON CONFLICT (id) DO NOTHING;

-- credit_applications
INSERT INTO credit_applications (id, applicant_id, amount, purpose, status, created_at) VALUES
('seed-ca-1', 'APP-001', 500000.00, 'premium_financing', 'approved', NOW()),
('seed-ca-2', 'APP-002', 250000.00, 'premium_financing', 'pending', NOW()),
('seed-ca-3', 'APP-003', 1000000.00, 'business_expansion', 'rejected', NOW())
ON CONFLICT (id) DO NOTHING;

-- credit_score_history
INSERT INTO credit_score_history (id, applicant_id, score, provider, assessed_at) VALUES
('seed-csh-1', 'APP-001', 720, 'credit_bureau_ng', NOW()),
('seed-csh-2', 'APP-002', 650, 'credit_bureau_ng', NOW()),
('seed-csh-3', 'APP-003', 480, 'credit_bureau_ng', NOW())
ON CONFLICT (id) DO NOTHING;

-- enhanced_kyc_kyb
INSERT INTO enhanced_kyc_kyb (id, applicant_id, document_type, verification_status, created_at) VALUES
('seed-kyc-1', 'APP-KYC-001', 'national_id', 'verified', NOW()),
('seed-kyc-2', 'APP-KYC-002', 'passport', 'pending', NOW()),
('seed-kyc-3', 'APP-KYC-003', 'drivers_license', 'rejected', NOW())
ON CONFLICT (id) DO NOTHING;

-- experiments
INSERT INTO experiments (id, name, description, status, created_at) VALUES
('seed-exp-1', 'Premium Pricing A/B Test', 'Test dynamic pricing models', 'active', NOW()),
('seed-exp-2', 'Onboarding Flow Optimization', 'Reduce drop-off rate', 'completed', NOW()),
('seed-exp-3', 'Claims UX Redesign', 'Simplify claims submission', 'draft', NOW())
ON CONFLICT (id) DO NOTHING;

-- fraud_detection_engine
INSERT INTO fraud_detection_engine (id, transaction_id, risk_score, decision, triggered_rules, created_at) VALUES
('seed-fde-1', 'TXN-001', 0.15, 'allow', 'none', NOW()),
('seed-fde-2', 'TXN-002', 0.72, 'review', 'high_amount,new_device', NOW()),
('seed-fde-3', 'TXN-003', 0.95, 'block', 'velocity_limit,blacklisted_ip,high_amount', NOW())
ON CONFLICT (id) DO NOTHING;

-- gamification_service
INSERT INTO gamification_service (id, user_id, points, level, badge, created_at) VALUES
('seed-gam-1', 'USR-GAM-001', 500, 3, 'policy_champion', NOW()),
('seed-gam-2', 'USR-GAM-002', 150, 1, 'newcomer', NOW()),
('seed-gam-3', 'USR-GAM-003', 1200, 5, 'insurance_guru', NOW())
ON CONFLICT (id) DO NOTHING;

-- merchant_settlements
INSERT INTO merchant_settlements (id, merchant_id, amount, settlement_date, status) VALUES
('seed-ms-1', 'MER-001', 250000.00, NOW(), 'completed'),
('seed-ms-2', 'MER-002', 180000.00, NOW(), 'pending'),
('seed-ms-3', 'MER-003', 95000.00, NOW(), 'failed')
ON CONFLICT (id) DO NOTHING;

-- merchants
INSERT INTO merchants (id, name, category, status, created_at) VALUES
('seed-mer-1', 'PharmaCare Lagos', 'healthcare', 'active', NOW()),
('seed-mer-2', 'AutoFix Motors', 'automotive', 'active', NOW()),
('seed-mer-3', 'AgriTech Farms', 'agriculture', 'pending', NOW())
ON CONFLICT (id) DO NOTHING;

-- multi_tenant_platform
INSERT INTO multi_tenant_platform (id, tenant_name, domain, status, created_at) VALUES
('seed-mtp-1', 'NigeriaInsure Ltd', 'nigeriainsure.platform.ng', 'active', NOW()),
('seed-mtp-2', 'GhanaProtect Corp', 'ghanaprotect.platform.gh', 'active', NOW()),
('seed-mtp-3', 'KenyaShield Inc', 'kenyashield.platform.ke', 'trial', NOW())
ON CONFLICT (id) DO NOTHING;

-- notification_service
INSERT INTO notification_service (id, recipient, channel, message, status, created_at) VALUES
('seed-ns-1', 'user@example.com', 'email', 'Your policy has been renewed', 'sent', NOW()),
('seed-ns-2', '+2341234567890', 'sms', 'Claim approved: NGN 25,000', 'sent', NOW()),
('seed-ns-3', 'agent@example.com', 'email', 'New commission payment processed', 'pending', NOW())
ON CONFLICT (id) DO NOTHING;

-- payments
INSERT INTO payments (id, user_id, amount, payment_method, status, created_at) VALUES
('seed-pay-1', 'USR-001', 15000.00, 'card', 'completed', NOW()),
('seed-pay-2', 'USR-002', 8500.00, 'bank_transfer', 'pending', NOW()),
('seed-pay-3', 'USR-003', 25000.00, 'mobile_money', 'completed', NOW())
ON CONFLICT (id) DO NOTHING;

-- pep_screening
INSERT INTO pep_screening (id, applicant_id, screening_result, matched_lists, screened_at) VALUES
('seed-pep-1', 'APP-001', 'clear', 'none', NOW()),
('seed-pep-2', 'APP-002', 'review', 'domestic_pep_list', NOW()),
('seed-pep-3', 'APP-003', 'clear', 'none', NOW())
ON CONFLICT (id) DO NOTHING;

-- qr_codes
INSERT INTO qr_codes (id, entity_type, entity_id, qr_data, created_at) VALUES
('seed-qr-1', 'policy', 'POL-001', 'https://insureportal.ng/verify/POL-001', NOW()),
('seed-qr-2', 'agent', 'AGT-001', 'https://insureportal.ng/agent/AGT-001', NOW()),
('seed-qr-3', 'claim', 'CLM-001', 'https://insureportal.ng/claim/CLM-001', NOW())
ON CONFLICT (id) DO NOTHING;

-- reconciliation_engine
INSERT INTO reconciliation_engine (id, transaction_id, source, amount, status, reconciled_at) VALUES
('seed-re-1', 'TXN-REC-001', 'bank_transfer', 150000.00, 'reconciled', NOW()),
('seed-re-2', 'TXN-REC-002', 'mobile_money', 25000.00, 'pending', NOW()),
('seed-re-3', 'TXN-REC-003', 'card_payment', 80000.00, 'discrepancy', NOW())
ON CONFLICT (id) DO NOTHING;

-- reversal_requests
INSERT INTO reversal_requests (id, transaction_id, reason, amount, status, created_at) VALUES
('seed-rr-1', 'TXN-REV-001', 'duplicate_payment', 15000.00, 'approved', NOW()),
('seed-rr-2', 'TXN-REV-002', 'customer_request', 8000.00, 'pending', NOW()),
('seed-rr-3', 'TXN-REV-003', 'fraud_detected', 250000.00, 'completed', NOW())
ON CONFLICT (id) DO NOTHING;

-- sanctions_screening
INSERT INTO sanctions_screening (id, entity_id, entity_type, screening_result, lists_checked, screened_at) VALUES
('seed-ss-1', 'APP-001', 'individual', 'clear', 'OFAC,UN,EU', NOW()),
('seed-ss-2', 'MER-001', 'organization', 'clear', 'OFAC,UN,EU', NOW()),
('seed-ss-3', 'APP-003', 'individual', 'review', 'domestic_watchlist', NOW())
ON CONFLICT (id) DO NOTHING;

-- settlement_reconciliation
INSERT INTO settlement_reconciliation (id, settlement_id, expected_amount, actual_amount, status, reconciled_at) VALUES
('seed-sr-1', 'SET-001', 250000.00, 250000.00, 'matched', NOW()),
('seed-sr-2', 'SET-002', 180000.00, 175000.00, 'discrepancy', NOW()),
('seed-sr-3', 'SET-003', 95000.00, 95000.00, 'matched', NOW())
ON CONFLICT (id) DO NOTHING;

-- shareable_links
INSERT INTO shareable_links (id, entity_type, entity_id, token, expires_at, created_at) VALUES
('seed-sl-1', 'policy_quote', 'QUOTE-001', 'tok_abc123', NOW() + INTERVAL '7 days', NOW()),
('seed-sl-2', 'claim_status', 'CLM-001', 'tok_def456', NOW() + INTERVAL '30 days', NOW()),
('seed-sl-3', 'referral', 'REF-001', 'tok_ghi789', NOW() + INTERVAL '90 days', NOW())
ON CONFLICT (id) DO NOTHING;

-- storefront_ads
INSERT INTO storefront_ads (id, title, product_type, target_audience, status, created_at) VALUES
('seed-sa-1', 'Motor Insurance - 20% Off', 'motor', 'new_drivers', 'active', NOW()),
('seed-sa-2', 'Family Health Plan', 'health', 'families', 'active', NOW()),
('seed-sa-3', 'Crop Insurance - Rainy Season', 'agriculture', 'farmers', 'scheduled', NOW())
ON CONFLICT (id) DO NOTHING;

-- takaful_module
INSERT INTO takaful_module (id, product_name, contribution_amount, surplus_share, status, created_at) VALUES
('seed-tak-1', 'Takaful Health Basic', 5000.00, 0.30, 'active', NOW()),
('seed-tak-2', 'Takaful Motor Standard', 12000.00, 0.25, 'active', NOW()),
('seed-tak-3', 'Takaful Family Protection', 8000.00, 0.35, 'draft', NOW())
ON CONFLICT (id) DO NOTHING;

-- vat_records
INSERT INTO vat_records (id, transaction_id, amount, vat_amount, vat_rate, recorded_at) VALUES
('seed-vat-1', 'TXN-VAT-001', 100000.00, 7500.00, 0.075, NOW()),
('seed-vat-2', 'TXN-VAT-002', 50000.00, 3750.00, 0.075, NOW()),
('seed-vat-3', 'TXN-VAT-003', 250000.00, 18750.00, 0.075, NOW())
ON CONFLICT (id) DO NOTHING;

-- wa_claims
INSERT INTO wa_claims (id, policy_id, claimant_name, amount, claim_type, status, created_at) VALUES
('seed-wac-1', 'POL-WA-001', 'Kwame Asante', 35000.00, 'health', 'submitted', NOW()),
('seed-wac-2', 'POL-WA-002', 'Ama Mensah', 120000.00, 'motor', 'approved', NOW()),
('seed-wac-3', 'POL-WA-003', 'Kofi Adjei', 8000.00, 'micro', 'pending', NOW())
ON CONFLICT (id) DO NOTHING;

-- pii_encryption_keys (sensitive - minimal seed)
INSERT INTO pii_encryption_keys (id, key_name, algorithm, status, created_at) VALUES
('seed-pek-1', 'customer_data_key_v1', 'AES-256-GCM', 'active', NOW()),
('seed-pek-2', 'agent_data_key_v1', 'AES-256-GCM', 'active', NOW())
ON CONFLICT (id) DO NOTHING;

-- fido2_challenges
INSERT INTO fido2_challenges (id, user_id, challenge, status, expires_at) VALUES
('seed-f2c-1', 'USR-FIDO-001', 'challenge_base64_data_here', 'pending', NOW() + INTERVAL '5 minutes'),
('seed-f2c-2', 'USR-FIDO-002', 'challenge_base64_data_here2', 'completed', NOW())
ON CONFLICT (id) DO NOTHING;

-- fido2_credentials
INSERT INTO fido2_credentials (id, user_id, credential_id, public_key, created_at) VALUES
('seed-f2r-1', 'USR-FIDO-001', 'cred_id_base64', 'pubkey_base64', NOW()),
('seed-f2r-2', 'USR-FIDO-002', 'cred_id_base64_2', 'pubkey_base64_2', NOW())
ON CONFLICT (id) DO NOTHING;
-- Fix seed v3 — all integer IDs and correct enum values

-- sanctions_screening (all integer IDs)
INSERT INTO sanctions_screening (id, user_id, screening_date, is_sanctioned, list_source, match_score, details) VALUES
(90001, 1, NOW(), false, 'OFAC', 0.0, '{"result":"clear"}'::jsonb),
(90002, 2, NOW(), false, 'UN', 0.0, '{"result":"clear"}'::jsonb),
(90003, 3, NOW(), true, 'domestic_watchlist', 0.85, '{"result":"review_required"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- settlement_reconciliation (integer agent_id, enum status)
INSERT INTO settlement_reconciliation (id, settlement_date, agent_id, agent_code, expected_amount, actual_amount, discrepancy, status) VALUES
(90001, '2026-06-01', 1, 'AC001', 250000.00, 250000.00, 0.00, 'matched'),
(90002, '2026-06-01', 2, 'AC002', 180000.00, 175000.00, 5000.00, 'discrepancy'),
(90003, '2026-06-01', 3, 'AC003', 95000.00, 95000.00, 0.00, 'resolved')
ON CONFLICT (id) DO NOTHING;

-- shareable_links (integer agentId, enum type/status)
INSERT INTO shareable_links (id, slug, type, status, "agentId", amount, currency, description) VALUES
(90001, 'payment-link-001', 'payment', 'active', 1, 50000.00, 'NGN', 'Motor insurance payment'),
(90002, 'collection-002', 'collection', 'active', 2, 0, 'NGN', 'Agent collection link'),
(90003, 'invoice-003', 'invoice', 'expired', 3, 25000.00, 'NGN', 'Invoice link')
ON CONFLICT (id) DO NOTHING;

-- storefront_ads (integer agentId, enum status)
INSERT INTO storefront_ads (id, title, body, "agentId", status, impressions, clicks, budget, spent) VALUES
(90001, 'Motor Insurance - 20% Off', 'Get comprehensive motor coverage', 1, 'active', 1500, 120, 50000.00, 15000.00),
(90002, 'Family Health Plan', 'Protect your family', 2, 'active', 2200, 180, 75000.00, 32000.00),
(90003, 'Crop Insurance', 'Shield your harvest', 3, 'paused', 800, 45, 30000.00, 8000.00)
ON CONFLICT (id) DO NOTHING;

-- vat_records (integer agentId, enum rateType)
INSERT INTO vat_records (id, "transactionId", "agentId", "taxableAmount", "vatAmount", "vatRate", "rateType", period) VALUES
(90001, 'TXN-VAT-001', 1, 100000.00, 7500.00, 0.075, 'standard', '2026-Q1'),
(90002, 'TXN-VAT-002', 2, 50000.00, 3750.00, 0.075, 'standard', '2026-Q1'),
(90003, 'TXN-VAT-003', 3, 250000.00, 18750.00, 0.075, 'standard', '2026-Q2')
ON CONFLICT (id) DO NOTHING;

-- fido2_challenges (integer userId)
INSERT INTO fido2_challenges (id, challenge, "userId", type, "expiresAt") VALUES
(90001, 'challenge_base64_seed_1', 1, 'registration', NOW() + INTERVAL '5 minutes'),
(90002, 'challenge_base64_seed_2', 2, 'authentication', NOW() + INTERVAL '5 minutes')
ON CONFLICT (id) DO NOTHING;

-- fido2_credentials (integer userId, enum status)
INSERT INTO fido2_credentials (id, "userId", "credentialId", "publicKey", counter, "deviceType", status) VALUES
(90001, 1, 'cred_id_base64_seed1', 'pubkey_base64_seed1', 0, 'platform', 'active'),
(90002, 2, 'cred_id_base64_seed2', 'pubkey_base64_seed2', 0, 'cross-platform', 'active')
ON CONFLICT (id) DO NOTHING;
-- Seed remaining empty tables with correct schemas

-- Tables with (id integer, data jsonb, status, created_at, updated_at, tenant_id)
INSERT INTO ab_testing_framework (id, data, status, created_at, tenant_id) VALUES
(90001, '{"experiment":"premium-pricing","variant":"control","metrics":{"conversion":0.12}}', 'active', NOW(), 1),
(90002, '{"experiment":"premium-pricing","variant":"variant_a","metrics":{"conversion":0.15}}', 'active', NOW(), 1),
(90003, '{"experiment":"onboarding-flow","variant":"control","metrics":{"dropoff":0.35}}', 'completed', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_mobile_app (id, data, status, created_at, tenant_id) VALUES
(90001, '{"agent_id":"AGT-001","device":"android","version":"2.1.0","last_sync":"2026-06-01"}', 'active', NOW(), 1),
(90002, '{"agent_id":"AGT-002","device":"ios","version":"2.1.0","last_sync":"2026-06-01"}', 'active', NOW(), 1),
(90003, '{"agent_id":"AGT-003","device":"android","version":"2.0.5","last_sync":"2026-05-20"}', 'inactive', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_network_platform (id, data, status, created_at, tenant_id) VALUES
(90001, '{"network":"Lagos Metro","region":"Lagos","agent_count":150}', 'active', NOW(), 1),
(90002, '{"network":"Abuja Capital","region":"FCT","agent_count":85}', 'active', NOW(), 1),
(90003, '{"network":"Port Harcourt","region":"Rivers","agent_count":62}', 'active', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_trail_system (id, data, status, created_at, tenant_id) VALUES
(90001, '{"action":"CREATE","entity_type":"policy","entity_id":"POL-001","user_id":"USR-001"}', 'active', NOW(), 1),
(90002, '{"action":"UPDATE","entity_type":"claim","entity_id":"CLM-001","user_id":"USR-002"}', 'active', NOW(), 1),
(90003, '{"action":"DELETE","entity_type":"agent","entity_id":"AGT-001","user_id":"USR-ADMIN"}', 'active', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO claims_adjudication_engine (id, data, status, created_at, tenant_id) VALUES
(90001, '{"policy_id":"POL-001","amount":25000,"type":"health","risk_score":15}', 'approved', NOW(), 1),
(90002, '{"policy_id":"POL-002","amount":150000,"type":"motor","risk_score":85}', 'escalated', NOW(), 1),
(90003, '{"policy_id":"POL-003","amount":5000,"type":"micro","risk_score":5}', 'submitted', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO enhanced_kyc_kyb (id, data, status, created_at, tenant_id) VALUES
(90001, '{"applicant":"APP-001","doc_type":"national_id","verified":true}', 'verified', NOW(), 1),
(90002, '{"applicant":"APP-002","doc_type":"passport","verified":false}', 'pending', NOW(), 1),
(90003, '{"applicant":"APP-003","doc_type":"drivers_license","verified":false}', 'rejected', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fraud_detection_engine (id, data, status, created_at, tenant_id) VALUES
(90001, '{"transaction":"TXN-001","risk_score":0.15,"decision":"allow"}', 'active', NOW(), 1),
(90002, '{"transaction":"TXN-002","risk_score":0.72,"decision":"review","rules":["high_amount","new_device"]}', 'active', NOW(), 1),
(90003, '{"transaction":"TXN-003","risk_score":0.95,"decision":"block","rules":["velocity","blacklist","high_amount"]}', 'active', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO gamification_service (id, data, status, created_at, tenant_id) VALUES
(90001, '{"user":"USR-001","points":500,"level":3,"badge":"policy_champion"}', 'active', NOW(), 1),
(90002, '{"user":"USR-002","points":150,"level":1,"badge":"newcomer"}', 'active', NOW(), 1),
(90003, '{"user":"USR-003","points":1200,"level":5,"badge":"insurance_guru"}', 'active', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO multi_tenant_platform (id, data, status, created_at, tenant_id) VALUES
(90001, '{"name":"NigeriaInsure Ltd","domain":"nigeriainsure.ng","plan":"enterprise"}', 'active', NOW(), 1),
(90002, '{"name":"GhanaProtect Corp","domain":"ghanaprotect.gh","plan":"professional"}', 'active', NOW(), 2),
(90003, '{"name":"KenyaShield Inc","domain":"kenyashield.ke","plan":"trial"}', 'trial', NOW(), 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notification_service (id, data, status, created_at, tenant_id) VALUES
(90001, '{"recipient":"user@example.com","channel":"email","message":"Policy renewed","sent":true}', 'sent', NOW(), 1),
(90002, '{"recipient":"+2341234567890","channel":"sms","message":"Claim approved: NGN 25,000","sent":true}', 'sent', NOW(), 1),
(90003, '{"recipient":"agent@example.com","channel":"email","message":"Commission processed","sent":false}', 'pending', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO reconciliation_engine (id, data, status, created_at, tenant_id) VALUES
(90001, '{"txn":"TXN-REC-001","source":"bank_transfer","amount":150000,"reconciled":true}', 'reconciled', NOW(), 1),
(90002, '{"txn":"TXN-REC-002","source":"mobile_money","amount":25000,"reconciled":false}', 'pending', NOW(), 1),
(90003, '{"txn":"TXN-REC-003","source":"card_payment","amount":80000,"discrepancy":500}', 'discrepancy', NOW(), 1)
ON CONFLICT (id) DO NOTHING;

-- Tables with specific schemas

-- agent_networks (text id)
INSERT INTO agent_networks (id, network_name, region, agent_count, status, created_at) VALUES
('seed-an-1', 'Premium Agents Lagos', 'Lagos', 150, 'active', NOW()),
('seed-an-2', 'Standard Agents Abuja', 'FCT', 85, 'active', NOW()),
('seed-an-3', 'Rural Agents Kano', 'Kano', 62, 'active', NOW())
ON CONFLICT (id) DO NOTHING;

-- experiments (text id)
INSERT INTO experiments (id, name, feature, status, traffic_pct, start_date) VALUES
('seed-exp-1', 'Premium Pricing A/B', 'pricing_engine', 'active', 50, NOW()),
('seed-exp-2', 'Onboarding Flow V2', 'onboarding', 'completed', 100, NOW() - INTERVAL '30 days'),
('seed-exp-3', 'Claims UX Redesign', 'claims_ui', 'draft', 0, NULL)
ON CONFLICT (id) DO NOTHING;

-- agent_onboarding_progress (integer id, enum current_step)
-- Check enum values first, use safe insert
DO $$
BEGIN
  INSERT INTO agent_onboarding_progress (id, agent_id, agent_code, profile_complete, kyc_complete)
  VALUES (90001, 1, 'AC-NEW-001', true, true),
         (90002, 2, 'AC-NEW-002', true, false),
         (90003, 3, 'AC-NEW-003', false, false);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'agent_onboarding_progress insert skipped: %', SQLERRM;
END $$;

-- api_key_usage (bigint id)
INSERT INTO api_key_usage (id, "apiKeyId", endpoint, method, "statusCode", "responseMs") VALUES
(90001, 1, '/api/v1/policies', 'GET', 200, 45),
(90002, 1, '/api/v1/claims', 'POST', 201, 120),
(90003, 2, '/api/v1/agents', 'GET', 200, 38)
ON CONFLICT (id) DO NOTHING;

-- commission_payouts (integer id, enum status)
DO $$
BEGIN
  INSERT INTO commission_payouts (id, agent_id, agent_code, amount, currency, status)
  VALUES (90001, 1, 'AC001', 15000.00, 'NGN', 'paid'),
         (90002, 2, 'AC002', 22000.00, 'NGN', 'pending'),
         (90003, 3, 'AC003', 8500.00, 'NGN', 'approved');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'commission_payouts insert skipped: %', SQLERRM;
END $$;

-- credit_applications (integer id)
DO $$
BEGIN
  INSERT INTO credit_applications (id, "agentId", "requestedAmount", "approvedAmount", "interestRate", "termDays")
  VALUES (90001, 1, 500000.00, 500000.00, 12.5, 365),
         (90002, 2, 250000.00, 200000.00, 15.0, 180),
         (90003, 3, 1000000.00, 0.00, 0.0, 0);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'credit_applications insert skipped: %', SQLERRM;
END $$;

-- credit_score_history (integer id, enum rating)
DO $$
BEGIN
  INSERT INTO credit_score_history (id, "agentId", score, "computedAt")
  VALUES (90001, 1, 720, NOW()),
         (90002, 2, 650, NOW()),
         (90003, 3, 480, NOW());
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'credit_score_history insert skipped: %', SQLERRM;
END $$;

-- merchant_settlements (integer id)
DO $$
BEGIN
  INSERT INTO merchant_settlements (id, "merchantId", period, "grossAmount", "feeAmount", "netAmount")
  VALUES (90001, 1, '2026-06', 250000.00, 12500.00, 237500.00),
         (90002, 2, '2026-06', 180000.00, 9000.00, 171000.00),
         (90003, 3, '2026-06', 95000.00, 4750.00, 90250.00);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'merchant_settlements insert skipped: %', SQLERRM;
END $$;

-- merchants (integer id)
DO $$
BEGIN
  INSERT INTO merchants (id, "merchantCode", "businessName", "ownerName", email, phone)
  VALUES (90001, 'MER-001', 'PharmaCare Lagos', 'Oluwaseun Adeyemi', 'pharma@example.com', '+2341234567890'),
         (90002, 'MER-002', 'AutoFix Motors', 'Chibueze Okonkwo', 'autofix@example.com', '+2349876543210'),
         (90003, 'MER-003', 'AgriTech Farms', 'Aminat Bello', 'agritech@example.com', '+2347654321098');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'merchants insert skipped: %', SQLERRM;
END $$;

-- payments (integer id, enum status)
DO $$
BEGIN
  INSERT INTO payments (id, "userId", "policyId", amount, "dueDate")
  VALUES (90001, 1, 1, 15000.00, NOW() + INTERVAL '30 days'),
         (90002, 2, 2, 8500.00, NOW() + INTERVAL '15 days'),
         (90003, 3, 3, 25000.00, NOW() + INTERVAL '60 days');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'payments insert skipped: %', SQLERRM;
END $$;

-- pep_screening (integer id, integer user_id)
INSERT INTO pep_screening (id, user_id, screening_date, is_pep, pep_category, source) VALUES
(90001, 1, NOW(), false, NULL, 'watchlist_db'),
(90002, 2, NOW(), true, 'government_official', 'sanctions_db'),
(90003, 3, NOW(), false, NULL, 'watchlist_db')
ON CONFLICT (id) DO NOTHING;

-- qr_codes (integer id, enum type/status)
DO $$
BEGIN
  INSERT INTO qr_codes (id, code, "agentId", amount, currency)
  VALUES (90001, 'QR-POL-001', 1, 50000.00, 'NGN'),
         (90002, 'QR-AGT-001', 2, 0, 'NGN'),
         (90003, 'QR-CLM-001', 3, 25000.00, 'NGN');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'qr_codes insert skipped: %', SQLERRM;
END $$;

-- reversal_requests (integer id)
DO $$
BEGIN
  INSERT INTO reversal_requests (id, "transactionId", "agentId", reason, amount, currency)
  VALUES (90001, 'TXN-REV-001', 1, 'duplicate_payment', 15000.00, 'NGN'),
         (90002, 'TXN-REV-002', 2, 'customer_request', 8000.00, 'NGN'),
         (90003, 'TXN-REV-003', 3, 'fraud_detected', 250000.00, 'NGN');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'reversal_requests insert skipped: %', SQLERRM;
END $$;
