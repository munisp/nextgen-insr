-- Seed script for 137 empty tables in InsurePortal
-- Run: PGPASSWORD=ngapp psql -U ngapp -d ngapp -h localhost -f seed-empty-tables.sql

-- Agent tables
INSERT INTO agents (id, name, email, phone, status, tier, "createdAt") VALUES
  (7, 'Adebayo Ogundimu', 'adebayo@agents.ng', '+2348012345678', 'active', 'Gold', NOW()),
  (8, 'Fatima Bello', 'fatima@agents.ng', '+2348023456789', 'active', 'Silver', NOW()),
  (9, 'Chidi Nwankwo', 'chidi@agents.ng', '+2348034567890', 'active', 'Platinum', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO agent_achievements (id, agent_id, achievement, points, earned_at) VALUES
  (1, 7, 'Top Seller Q1', 500, NOW() - INTERVAL '30 days'),
  (2, 8, 'Customer Champion', 350, NOW() - INTERVAL '15 days'),
  (3, 9, '100 Policies Milestone', 1000, NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

INSERT INTO agent_badges (id, agent_id, badge_name, badge_type, issued_at) VALUES
  (1, 7, 'Gold Star', 'performance', NOW()),
  (2, 8, 'Compliance Pro', 'compliance', NOW()),
  (3, 9, 'Elite Agent', 'tier', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO agent_bank_accounts (id, agent_id, bank_name, account_number, account_name, is_primary) VALUES
  (1, 7, 'First Bank', '3012345678', 'Adebayo Ogundimu', true),
  (2, 8, 'GTBank', '0123456789', 'Fatima Bello', true),
  (3, 9, 'UBA', '2034567890', 'Chidi Nwankwo', true)
ON CONFLICT DO NOTHING;

INSERT INTO agent_geofence_zones (id, agent_id, zone_name, latitude, longitude, radius_km) VALUES
  (1, 7, 'Lagos Island', 6.4541, 3.4084, 10),
  (2, 8, 'Abuja Central', 9.0579, 7.4951, 15),
  (3, 9, 'Port Harcourt', 4.8156, 7.0498, 12)
ON CONFLICT DO NOTHING;

INSERT INTO agent_loans (id, agent_id, amount, status, disbursed_at, due_date) VALUES
  (1, 7, 500000, 'active', NOW() - INTERVAL '60 days', NOW() + INTERVAL '120 days'),
  (2, 8, 250000, 'repaid', NOW() - INTERVAL '180 days', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO agent_onboarding_progress (id, agent_id, step, status, completed_at) VALUES
  (1, 7, 'identity_verification', 'completed', NOW() - INTERVAL '90 days'),
  (2, 7, 'training_course', 'completed', NOW() - INTERVAL '85 days'),
  (3, 8, 'identity_verification', 'completed', NOW() - INTERVAL '60 days'),
  (4, 8, 'training_course', 'in_progress', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO agent_performance_scores (id, agent_id, period, score, policies_sold, premium_collected, retention_rate) VALUES
  (1, 7, '2026-Q1', 92.5, 45, 12500000, 0.88),
  (2, 8, '2026-Q1', 85.3, 32, 8700000, 0.91),
  (3, 9, '2026-Q1', 97.1, 67, 22000000, 0.95)
ON CONFLICT DO NOTHING;

INSERT INTO agent_push_subscriptions (id, agent_id, endpoint, auth_key, p256dh_key) VALUES
  (1, 7, 'https://fcm.googleapis.com/fcm/send/agent7', 'auth7', 'p256dh7'),
  (2, 8, 'https://fcm.googleapis.com/fcm/send/agent8', 'auth8', 'p256dh8')
ON CONFLICT DO NOTHING;

INSERT INTO agent_suspension_log (id, agent_id, reason, suspended_at, reinstated_at) VALUES
  (1, 8, 'Pending document renewal', NOW() - INTERVAL '45 days', NOW() - INTERVAL '40 days')
ON CONFLICT DO NOTHING;

-- Analytics
INSERT INTO analytics_dashboards (id, name, description, owner_id, is_public, config) VALUES
  (1, 'Executive Overview', 'High-level KPIs', 1, true, '{"widgets":["premiums","claims","retention"]}'),
  (2, 'Claims Analytics', 'Claims processing metrics', 1, true, '{"widgets":["claimsByType","avgProcessingTime","fraudRate"]}'),
  (3, 'Sales Performance', 'Agent and channel performance', 1, false, '{"widgets":["topAgents","channelMix","conversionRate"]}')
ON CONFLICT DO NOTHING;

-- API Keys
INSERT INTO api_keys (id, name, key, owner_id, permissions, status, created_at, expires_at) VALUES
  (1, 'Partner API - GTBank', 'pk_live_gt_' || md5(random()::text), 1, '{"read":true,"write":false}', 'active', NOW(), NOW() + INTERVAL '365 days'),
  (2, 'Broker API - ARM Life', 'pk_live_arm_' || md5(random()::text), 1, '{"read":true,"write":true}', 'active', NOW(), NOW() + INTERVAL '180 days'),
  (3, 'Mobile SDK Key', 'pk_mob_' || md5(random()::text), 1, '{"read":true,"write":true}', 'active', NOW(), NOW() + INTERVAL '365 days')
ON CONFLICT DO NOTHING;

INSERT INTO api_key_usage (id, api_key_id, endpoint, method, status_code, response_time_ms, called_at) VALUES
  (1, 1, '/api/policies', 'GET', 200, 45, NOW() - INTERVAL '1 hour'),
  (2, 1, '/api/policies', 'GET', 200, 52, NOW() - INTERVAL '30 minutes'),
  (3, 2, '/api/claims', 'POST', 201, 120, NOW() - INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- BI Reports
INSERT INTO bi_report_definitions (id, name, description, query, schedule, format, owner_id) VALUES
  (1, 'Monthly Premium Report', 'Premium collection by product line', 'SELECT type, SUM(premium) FROM policies GROUP BY type', 'monthly', 'xlsx', 1),
  (2, 'Claims Loss Ratio', 'Loss ratio by category', 'SELECT type, SUM(amount)/SUM(premium) FROM claims JOIN policies ON claims."policyId"=policies.id GROUP BY type', 'quarterly', 'pdf', 1),
  (3, 'Agent Commission Summary', 'Commission payouts by agent tier', 'SELECT tier, SUM(amount) FROM agent_commissions GROUP BY tier', 'monthly', 'csv', 1)
ON CONFLICT DO NOTHING;

-- Commission tables
INSERT INTO commission_rules (id, product_type, tier, rate_pct, min_premium, max_premium, effective_from) VALUES
  (1, 'Motor', 'Silver', 7.5, 0, 500000, '2026-01-01'),
  (2, 'Motor', 'Gold', 10.0, 0, 500000, '2026-01-01'),
  (3, 'Health', 'Silver', 5.0, 0, 1000000, '2026-01-01'),
  (4, 'Health', 'Gold', 7.5, 0, 1000000, '2026-01-01'),
  (5, 'Life', 'Platinum', 15.0, 0, 5000000, '2026-01-01')
ON CONFLICT DO NOTHING;

INSERT INTO commission_payouts (id, agent_id, amount, period, status, paid_at) VALUES
  (1, 7, 375000, '2026-Q1', 'paid', NOW() - INTERVAL '30 days'),
  (2, 8, 217500, '2026-Q1', 'paid', NOW() - INTERVAL '30 days'),
  (3, 9, 825000, '2026-Q1', 'pending', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO commission_audit_trail (id, commission_id, action, old_value, new_value, changed_by, changed_at) VALUES
  (1, 1, 'approved', 'pending', 'approved', 1, NOW() - INTERVAL '35 days'),
  (2, 1, 'paid', 'approved', 'paid', 1, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO commission_cascade_history (id, source_agent_id, beneficiary_agent_id, amount, level, created_at) VALUES
  (1, 7, 9, 37500, 1, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO commission_clawbacks (id, agent_id, amount, reason, policy_id, created_at) VALUES
  (1, 8, 25000, 'Policy cancelled within cooling-off period', 5, NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- Chat & Communication
INSERT INTO chat_sessions (id, user_id, agent_id, status, channel, started_at, ended_at) VALUES
  (1, 1, 7, 'closed', 'web', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '15 minutes'),
  (2, 2, 8, 'active', 'whatsapp', NOW() - INTERVAL '1 hour', NULL),
  (3, 3, NULL, 'closed', 'chatbot', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '3 minutes')
ON CONFLICT DO NOTHING;

INSERT INTO chat_messages (id, session_id, sender_type, sender_id, message, created_at) VALUES
  (1, 1, 'customer', 1, 'I need help with my motor policy renewal', NOW() - INTERVAL '2 days'),
  (2, 1, 'agent', 7, 'I can help you with that. Let me pull up your policy details.', NOW() - INTERVAL '2 days' + INTERVAL '1 minute'),
  (3, 2, 'customer', 2, 'What is the status of my claim CLM-2026-00012?', NOW() - INTERVAL '1 hour'),
  (4, 3, 'customer', 3, 'How do I file a claim?', NOW() - INTERVAL '5 days'),
  (5, 3, 'bot', NULL, 'To file a claim, go to Claims > File New Claim, or call our hotline at 0800-INSURE.', NOW() - INTERVAL '5 days' + INTERVAL '5 seconds')
ON CONFLICT DO NOTHING;

-- Compliance
INSERT INTO compliance_checks (id, check_type, entity_type, entity_id, status, findings, checked_at) VALUES
  (1, 'AML', 'customer', 1, 'passed', '{"riskLevel":"low","sanctionCheck":"clear"}', NOW() - INTERVAL '30 days'),
  (2, 'KYC', 'customer', 2, 'passed', '{"documentVerified":true,"addressVerified":true}', NOW() - INTERVAL '25 days'),
  (3, 'NAICOM_capital', 'company', 1, 'passed', '{"capitalAdequacy":1.85,"minRequired":1.0}', NOW() - INTERVAL '15 days'),
  (4, 'data_protection', 'system', 1, 'warning', '{"gdprCompliant":true,"ndpaCompliant":true,"dataRetention":"needs_review"}', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- Credit
INSERT INTO credit_applications (id, customer_id, amount, purpose, status, credit_score, applied_at, decided_at) VALUES
  (1, 1, 500000, 'Premium financing', 'approved', 720, NOW() - INTERVAL '30 days', NOW() - INTERVAL '28 days'),
  (2, 3, 250000, 'Premium financing', 'rejected', 480, NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days')
ON CONFLICT DO NOTHING;

INSERT INTO credit_score_history (id, customer_id, score, factors, recorded_at) VALUES
  (1, 1, 720, '{"paymentHistory":0.85,"claimsRatio":0.12,"policyDuration":3}', NOW() - INTERVAL '90 days'),
  (2, 1, 730, '{"paymentHistory":0.90,"claimsRatio":0.10,"policyDuration":3}', NOW()),
  (3, 3, 480, '{"paymentHistory":0.55,"claimsRatio":0.45,"policyDuration":1}', NOW())
ON CONFLICT DO NOTHING;

-- Customer Journey
INSERT INTO customer_journey_events (id, customer_id, event_type, channel, metadata, occurred_at) VALUES
  (1, 1, 'visit', 'web', '{"page":"/products","duration":120}', NOW() - INTERVAL '60 days'),
  (2, 1, 'quote_request', 'web', '{"product":"motor","premium":45000}', NOW() - INTERVAL '58 days'),
  (3, 1, 'policy_purchase', 'web', '{"policyId":1,"premium":45000}', NOW() - INTERVAL '55 days'),
  (4, 2, 'visit', 'mobile', '{"screen":"marketplace"}', NOW() - INTERVAL '30 days'),
  (5, 2, 'support_chat', 'whatsapp', '{"topic":"claim_status"}', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO customer_journey_steps (id, journey_name, step_order, step_name, conversion_rate) VALUES
  (1, 'Policy Purchase', 1, 'Visit', 1.0),
  (2, 'Policy Purchase', 2, 'Quote Request', 0.45),
  (3, 'Policy Purchase', 3, 'Application', 0.30),
  (4, 'Policy Purchase', 4, 'KYC Verification', 0.25),
  (5, 'Policy Purchase', 5, 'Payment', 0.20),
  (6, 'Policy Purchase', 6, 'Policy Issued', 0.18)
ON CONFLICT DO NOTHING;

-- Data Privacy
INSERT INTO data_consent_records (id, customer_id, consent_type, status, ip_address, consented_at) VALUES
  (1, 1, 'marketing', 'granted', '102.89.23.45', NOW() - INTERVAL '55 days'),
  (2, 1, 'data_sharing', 'granted', '102.89.23.45', NOW() - INTERVAL '55 days'),
  (3, 2, 'marketing', 'revoked', '41.203.67.89', NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

INSERT INTO data_rights_requests (id, customer_id, request_type, status, requested_at, completed_at) VALUES
  (1, 3, 'data_export', 'completed', NOW() - INTERVAL '20 days', NOW() - INTERVAL '18 days'),
  (2, 2, 'data_deletion', 'in_progress', NOW() - INTERVAL '5 days', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO data_export_jobs (id, customer_id, format, status, file_url, created_at, completed_at) VALUES
  (1, 3, 'json', 'completed', '/exports/customer-3-data.json', NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days')
ON CONFLICT DO NOTHING;

-- Disputes
INSERT INTO disputes (id, customer_id, claim_id, reason, status, amount, created_at, resolved_at) VALUES
  (1, 1, 1, 'Claim amount lower than expected', 'open', 150000, NOW() - INTERVAL '10 days', NULL),
  (2, 2, 3, 'Claim wrongly rejected', 'resolved', 250000, NOW() - INTERVAL '30 days', NOW() - INTERVAL '15 days'),
  (3, 3, 5, 'Delayed payment', 'under_review', 75000, NOW() - INTERVAL '5 days', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO dispute_messages (id, dispute_id, sender_type, sender_id, message, created_at) VALUES
  (1, 1, 'customer', 1, 'My vehicle repair costs were ₦350,000 but I was only paid ₦200,000', NOW() - INTERVAL '10 days'),
  (2, 1, 'agent', 7, 'We are reviewing the garage assessment. We''ll update you within 3 business days.', NOW() - INTERVAL '9 days'),
  (3, 2, 'customer', 2, 'Please reconsider my claim rejection', NOW() - INTERVAL '30 days'),
  (4, 2, 'system', NULL, 'Claim reinstated after review. Payout of ₦250,000 approved.', NOW() - INTERVAL '15 days')
ON CONFLICT DO NOTHING;

INSERT INTO dispute_evidence (id, dispute_id, file_name, file_url, uploaded_by, uploaded_at) VALUES
  (1, 1, 'repair_invoice.pdf', '/uploads/disputes/1/repair_invoice.pdf', 1, NOW() - INTERVAL '10 days'),
  (2, 1, 'photos.zip', '/uploads/disputes/1/photos.zip', 1, NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- Device Management (MDM)
INSERT INTO devices (id, user_id, device_type, os, model, status, last_seen, registered_at) VALUES
  (1, 1, 'mobile', 'Android 14', 'Samsung Galaxy S24', 'active', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '180 days'),
  (2, 1, 'mobile', 'iOS 17', 'iPhone 15 Pro', 'active', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '90 days'),
  (3, 2, 'mobile', 'Android 13', 'Tecno Camon 20', 'active', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO device_compliance_policies (id, name, requirements, severity) VALUES
  (1, 'Minimum OS Version', '{"android":"12","ios":"16"}', 'high'),
  (2, 'Screen Lock Required', '{"pinLength":6,"biometricAllowed":true}', 'critical'),
  (3, 'Encryption Required', '{"storageEncryption":true}', 'critical')
ON CONFLICT DO NOTHING;

INSERT INTO device_compliance_violations (id, device_id, policy_id, violation, detected_at, resolved_at) VALUES
  (1, 3, 1, 'OS version below minimum', NOW() - INTERVAL '30 days', NOW() - INTERVAL '25 days')
ON CONFLICT DO NOTHING;

INSERT INTO device_commands (id, device_id, command, status, issued_at, executed_at) VALUES
  (1, 1, 'refresh_policy_cache', 'completed', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO device_locations (id, device_id, latitude, longitude, accuracy_m, recorded_at) VALUES
  (1, 1, 6.4541, 3.4084, 15, NOW() - INTERVAL '1 hour'),
  (2, 2, 6.4550, 3.4090, 10, NOW() - INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- DLQ
INSERT INTO dlq_messages (id, topic, original_message, error_reason, retry_count, created_at) VALUES
  (1, 'claims.processing', '{"claimId":"CLM-2026-00099","amount":500000}', 'Database timeout during fraud check', 3, NOW() - INTERVAL '2 days'),
  (2, 'payments.webhooks', '{"reference":"PAY-12345"}', 'Invalid webhook signature', 1, NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Email
INSERT INTO email_queue (id, "to", subject, body, status, created_at, sent_at) VALUES
  (1, 'customer@example.ng', 'Policy Renewal Reminder', '<h1>Your policy expires in 30 days</h1>', 'sent', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
  (2, 'newuser@example.ng', 'Welcome to InsurePortal', '<h1>Welcome!</h1><p>Complete your KYC to get started.</p>', 'sent', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
  (3, 'claims@example.ng', 'Claim Status Update', '<h1>Your claim has been approved</h1>', 'pending', NOW(), NULL)
ON CONFLICT DO NOTHING;

INSERT INTO email_delivery_log (id, email_queue_id, status, provider_response, logged_at) VALUES
  (1, 1, 'delivered', '{"messageId":"msg-001","provider":"ses"}', NOW() - INTERVAL '2 days'),
  (2, 2, 'delivered', '{"messageId":"msg-002","provider":"ses"}', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Encryption
INSERT INTO encrypted_fields (id, table_name, field_name, encryption_type, key_version) VALUES
  (1, 'users', 'passwordHash', 'bcrypt', 1),
  (2, 'kyc_profiles', 'bvn', 'AES-256-GCM', 1),
  (3, 'payment_transactions', 'cardNumber', 'AES-256-GCM', 1)
ON CONFLICT DO NOTHING;

-- ERP Sync
INSERT INTO erp_sync_log (id, entity_type, entity_id, sync_status, synced_at, error_message) VALUES
  (1, 'premium_collection', '1', 'synced', NOW() - INTERVAL '1 day', NULL),
  (2, 'claims_payout', '1', 'synced', NOW() - INTERVAL '2 days', NULL),
  (3, 'commission', '1', 'failed', NOW() - INTERVAL '3 days', 'ERPNext connection timeout')
ON CONFLICT DO NOTHING;

INSERT INTO erpnext_reconciliation (id, entity_type, local_total, erp_total, difference, status, reconciled_at) VALUES
  (1, 'premium', 125000000, 124950000, 50000, 'variance_detected', NOW() - INTERVAL '7 days'),
  (2, 'claims', 45000000, 45000000, 0, 'matched', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- Biometric / FIDO2
INSERT INTO face_enrollments (id, user_id, embedding_hash, quality_score, enrolled_at) VALUES
  (1, 1, md5(random()::text), 0.95, NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

INSERT INTO fido2_credentials (id, user_id, credential_id, public_key, sign_count, registered_at) VALUES
  (1, 1, 'cred-' || md5(random()::text), 'pk-' || md5(random()::text), 5, NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO fido2_challenges (id, user_id, challenge, expires_at, created_at) VALUES
  (1, 1, md5(random()::text), NOW() + INTERVAL '5 minutes', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO biometric_audit_events (id, user_id, event_type, success, ip_address, occurred_at) VALUES
  (1, 1, 'fingerprint_auth', true, '102.89.23.45', NOW() - INTERVAL '1 day'),
  (2, 1, 'face_auth', true, '102.89.23.45', NOW() - INTERVAL '2 days'),
  (3, 2, 'fingerprint_auth', false, '41.203.67.89', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Float & Fee
INSERT INTO float_topup_requests (id, agent_id, amount, status, requested_at, approved_at) VALUES
  (1, 7, 1000000, 'approved', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
  (2, 8, 500000, 'pending', NOW() - INTERVAL '1 day', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO float_reconciliations (id, agent_id, expected_balance, actual_balance, variance, reconciled_at) VALUES
  (1, 7, 2500000, 2450000, 50000, NOW() - INTERVAL '7 days'),
  (2, 9, 5000000, 5000000, 0, NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

INSERT INTO fee_audit_trail (id, transaction_id, fee_type, amount, calculated_at) VALUES
  (1, 'TXN-001', 'processing_fee', 500, NOW() - INTERVAL '10 days'),
  (2, 'TXN-002', 'stamp_duty', 50, NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Fraud
INSERT INTO fraud_rules (id, name, description, severity, conditions, action, is_active) VALUES
  (1, 'High Frequency Claims', 'More than 3 claims in 90 days', 'high', '{"claimsIn90Days":3}', '{"action":"flag","team":"fraud_investigation"}', true),
  (2, 'Amount Exceeds Sum Assured', 'Claim amount > policy sum assured', 'critical', '{"amountExceedsSumAssured":true}', '{"action":"block","team":"senior_adjuster"}', true),
  (3, 'New Policy Immediate Claim', 'Claim within 30 days of policy start', 'medium', '{"daysFromPolicyStart":30}', '{"action":"flag","team":"auto_triage"}', true)
ON CONFLICT DO NOTHING;

INSERT INTO fraud_scores (id, customer_id, score, risk_level, factors, calculated_at) VALUES
  (1, 1, 15, 'low', '{"claimsFrequency":0.1,"amountPattern":"normal","policyAge":"3y"}', NOW()),
  (2, 3, 62, 'high', '{"claimsFrequency":0.8,"amountPattern":"escalating","policyAge":"6m"}', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO fraud_ml_scores (id, claim_id, model_version, probability, features, scored_at) VALUES
  (1, 1, 'v2', 0.12, '{"amount":250000,"frequency":1,"age":35}', NOW()),
  (2, 5, 'v2', 0.78, '{"amount":2500000,"frequency":4,"age":28}', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO fraud_rings (id, name, members_count, total_amount, status, detected_at) VALUES
  (1, 'Lagos Auto Ring', 5, 12500000, 'under_investigation', NOW() - INTERVAL '15 days'),
  (2, 'Abuja Health Ring', 3, 4500000, 'confirmed', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- Geofencing
INSERT INTO geo_fences (id, name, type, coordinates, radius_km, active) VALUES
  (1, 'Lagos Flood Zone', 'risk_zone', '{"lat":6.45,"lng":3.40}', 20, true),
  (2, 'Abuja Safe Zone', 'preferred_zone', '{"lat":9.06,"lng":7.49}', 25, true)
ON CONFLICT DO NOTHING;

INSERT INTO geofence_zones (id, name, zone_type, boundary, risk_multiplier) VALUES
  (1, 'Victoria Island', 'urban_premium', '{"center":{"lat":6.43,"lng":3.42},"radius":5}', 1.15),
  (2, 'Lekki', 'flood_risk', '{"center":{"lat":6.44,"lng":3.47},"radius":8}', 1.25)
ON CONFLICT DO NOTHING;

-- GL
INSERT INTO gl_accounts (id, code, name, type, category, balance) VALUES
  (1, '1001', 'Premium Receivable', 'asset', 'current_assets', 45000000),
  (2, '2001', 'Claims Payable', 'liability', 'current_liabilities', 25000000),
  (3, '4001', 'Premium Revenue', 'revenue', 'operating_revenue', 125000000),
  (4, '5001', 'Claims Expense', 'expense', 'operating_expense', 45000000),
  (5, '1101', 'Cash at Bank', 'asset', 'current_assets', 80000000),
  (6, '5002', 'Commission Expense', 'expense', 'operating_expense', 12500000)
ON CONFLICT DO NOTHING;

INSERT INTO gl_entries (id, account_id, debit, credit, description, posted_at) VALUES
  (1, 1, 45000000, 0, 'Premium receivable for Q1', NOW() - INTERVAL '90 days'),
  (2, 3, 0, 45000000, 'Premium revenue recognized Q1', NOW() - INTERVAL '90 days'),
  (3, 4, 25000000, 0, 'Claims paid Q1', NOW() - INTERVAL '60 days'),
  (4, 2, 0, 25000000, 'Claims payable Q1', NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO gl_journal_entries (id, reference, description, total_debit, total_credit, posted_by, posted_at) VALUES
  (1, 'JE-2026-001', 'Q1 Premium Recognition', 45000000, 45000000, 1, NOW() - INTERVAL '90 days'),
  (2, 'JE-2026-002', 'Q1 Claims Payout', 25000000, 25000000, 1, NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

-- Group Life
INSERT INTO group_life_schemes (id, company_name, scheme_name, member_count, total_premium, status, start_date) VALUES
  (1, 'Dangote Industries', 'Staff Group Life', 5000, 250000000, 'active', '2026-01-01'),
  (2, 'MTN Nigeria', 'Employee Cover', 3500, 175000000, 'active', '2026-01-01'),
  (3, 'First Bank', 'Management Life', 800, 120000000, 'active', '2026-03-01')
ON CONFLICT DO NOTHING;

INSERT INTO group_life_members (id, scheme_id, member_name, employee_id, sum_assured, status) VALUES
  (1, 1, 'Aisha Mohammed', 'DAN-001', 10000000, 'active'),
  (2, 1, 'Emeka Obi', 'DAN-002', 8000000, 'active'),
  (3, 2, 'Funke Adeyemi', 'MTN-001', 15000000, 'active'),
  (4, 3, 'Tunde Bakare', 'FBN-001', 25000000, 'active')
ON CONFLICT DO NOTHING;

-- Inventory (for agents with physical items)
INSERT INTO inventory_items (id, name, category, quantity, unit_cost, location) VALUES
  (1, 'Policy Document Folders', 'stationery', 500, 150, 'Lagos Warehouse'),
  (2, 'Branded Pens', 'promotional', 2000, 50, 'Lagos Warehouse'),
  (3, 'Vehicle Inspection Kits', 'equipment', 25, 15000, 'Abuja Office')
ON CONFLICT DO NOTHING;

-- Invite Codes
INSERT INTO invite_codes (id, code, created_by, max_uses, current_uses, expires_at) VALUES
  (1, 'INSURE2026', 1, 100, 23, NOW() + INTERVAL '90 days'),
  (2, 'AGENT-REF-007', 7, 50, 12, NOW() + INTERVAL '180 days')
ON CONFLICT DO NOTHING;

-- KYC
INSERT INTO kyc_documents (id, customer_id, document_type, document_number, status, verified_at) VALUES
  (1, 1, 'NIN', '12345678901', 'verified', NOW() - INTERVAL '90 days'),
  (2, 1, 'BVN', '22345678901', 'verified', NOW() - INTERVAL '90 days'),
  (3, 2, 'NIN', '32345678901', 'verified', NOW() - INTERVAL '60 days'),
  (4, 3, 'Drivers License', 'DL-LAG-2025-001', 'pending', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO kyc_sessions (id, customer_id, session_type, status, started_at, completed_at) VALUES
  (1, 1, 'full_kyc', 'completed', NOW() - INTERVAL '90 days', NOW() - INTERVAL '89 days'),
  (2, 3, 'basic_kyc', 'in_progress', NOW() - INTERVAL '2 days', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO kyc_verifications (id, customer_id, verification_type, provider, result, verified_at) VALUES
  (1, 1, 'identity', 'smile_id', 'passed', NOW() - INTERVAL '90 days'),
  (2, 1, 'address', 'youverify', 'passed', NOW() - INTERVAL '89 days'),
  (3, 2, 'identity', 'smile_id', 'passed', NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

-- Load Testing
INSERT INTO load_test_runs (id, test_name, concurrent_users, duration_seconds, avg_response_ms, p95_response_ms, error_rate, run_at) VALUES
  (1, 'Login Flow', 100, 300, 45, 120, 0.01, NOW() - INTERVAL '14 days'),
  (2, 'Policy Listing', 200, 600, 65, 180, 0.02, NOW() - INTERVAL '7 days'),
  (3, 'Claims Submission', 50, 300, 120, 350, 0.03, NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Loyalty
INSERT INTO loyalty_points (id, customer_id, points, tier, earned_from, created_at) VALUES
  (1, 1, 2500, 'Gold', 'premium_payment', NOW() - INTERVAL '90 days'),
  (2, 2, 800, 'Silver', 'referral', NOW() - INTERVAL '30 days'),
  (3, 3, 150, 'Bronze', 'signup', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_history (id, customer_id, action, points_change, balance_after, created_at) VALUES
  (1, 1, 'earned_premium', 500, 2500, NOW() - INTERVAL '90 days'),
  (2, 1, 'redeemed_discount', -200, 2300, NOW() - INTERVAL '30 days'),
  (3, 2, 'earned_referral', 300, 800, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_transactions (id, customer_id, transaction_type, points, description, created_at) VALUES
  (1, 1, 'earn', 500, 'Premium payment - Motor Comprehensive', NOW() - INTERVAL '90 days'),
  (2, 1, 'redeem', 200, '5% discount on renewal', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- MCMC
INSERT INTO mcmc_results (id, model_name, parameters, iterations, convergence_score, result, run_at) VALUES
  (1, 'Motor Claims Frequency', '{"priorAlpha":2,"priorBeta":5}', 10000, 0.98, '{"posterior_mean":0.15,"credible_interval":[0.12,0.18]}', NOW() - INTERVAL '7 days'),
  (2, 'Health Cost Model', '{"priorMu":250000,"priorSigma":50000}', 50000, 0.99, '{"posterior_mean":275000,"credible_interval":[245000,305000]}', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- MDM
INSERT INTO mdm_geofence_violations (id, device_id, zone_id, violation_type, occurred_at) VALUES
  (1, 1, 1, 'entered_restricted_zone', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Merchants
INSERT INTO merchants (id, name, category, status, kyc_status, registered_at) VALUES
  (1, 'Lagos Auto Repair', 'garage', 'active', 'verified', NOW() - INTERVAL '180 days'),
  (2, 'MedPlus Pharmacy', 'healthcare', 'active', 'verified', NOW() - INTERVAL '120 days'),
  (3, 'Kuda Glass Works', 'auto_glass', 'pending', 'under_review', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

INSERT INTO merchant_kyc_docs (id, merchant_id, doc_type, doc_url, status, uploaded_at) VALUES
  (1, 1, 'CAC_certificate', '/uploads/merchants/1/cac.pdf', 'verified', NOW() - INTERVAL '180 days'),
  (2, 2, 'CAC_certificate', '/uploads/merchants/2/cac.pdf', 'verified', NOW() - INTERVAL '120 days')
ON CONFLICT DO NOTHING;

INSERT INTO merchant_settlements (id, merchant_id, amount, status, period, settled_at) VALUES
  (1, 1, 2500000, 'settled', '2026-04', NOW() - INTERVAL '30 days'),
  (2, 2, 1200000, 'pending', '2026-05', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO merchant_payouts (id, merchant_id, amount, reference, status, paid_at) VALUES
  (1, 1, 2500000, 'MPO-2026-001', 'completed', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- Multi-SIM / Connectivity / MQTT
INSERT INTO multi_sim_profiles (id, device_id, sim_number, carrier, status) VALUES
  (1, 1, '+2348012345678', 'MTN', 'active'),
  (2, 1, '+2348023456789', 'Airtel', 'standby')
ON CONFLICT DO NOTHING;

INSERT INTO connectivity_log (id, device_id, connection_type, signal_strength, logged_at) VALUES
  (1, 1, '4G', -75, NOW() - INTERVAL '1 hour'),
  (2, 2, 'WiFi', -45, NOW() - INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

INSERT INTO mqtt_bridge_config (id, broker_url, topic_prefix, qos, enabled) VALUES
  (1, 'mqtt://iot.insureportal.ng:1883', 'insureportal/telematics/', 1, true)
ON CONFLICT DO NOTHING;

-- NMID
INSERT INTO nmid_verifications (id, policy_id, nmid_number, status, verified_at) VALUES
  (1, 1, 'NMID-2026-001', 'verified', NOW() - INTERVAL '30 days'),
  (2, 5, 'NMID-2026-005', 'pending', NULL)
ON CONFLICT DO NOTHING;

-- Notifications
INSERT INTO notification_logs (id, user_id, channel, title, body, status, sent_at) VALUES
  (1, 1, 'push', 'Claim Approved', 'Your claim CLM-2026-00001 has been approved.', 'delivered', NOW() - INTERVAL '2 days'),
  (2, 2, 'email', 'Policy Renewal', 'Your motor policy expires in 30 days.', 'delivered', NOW() - INTERVAL '5 days'),
  (3, 1, 'sms', 'Payment Received', 'Payment of ₦45,000 received for policy POL-001.', 'delivered', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO notification_dispatch_log (id, notification_id, provider, status, response, dispatched_at) VALUES
  (1, 1, 'firebase', 'delivered', '{"messageId":"msg-push-001"}', NOW() - INTERVAL '2 days'),
  (2, 2, 'ses', 'delivered', '{"messageId":"msg-email-001"}', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Observability
INSERT INTO observability_alerts (id, alert_name, severity, source, message, triggered_at, resolved_at) VALUES
  (1, 'High Error Rate', 'warning', 'prometheus', 'Error rate exceeded 5% threshold', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '15 minutes'),
  (2, 'DB Connection Pool Exhaustion', 'critical', 'postgres', 'Pool waiting count > 10', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days' + INTERVAL '5 minutes'),
  (3, 'Slow API Response', 'warning', 'grafana', 'p95 latency > 500ms on /api/trpc/claims.list', NOW() - INTERVAL '1 day', NULL)
ON CONFLICT DO NOTHING;

-- OTA Updates
INSERT INTO ota_releases (id, version, platform, release_notes, mandatory, released_at) VALUES
  (1, '2.1.0', 'android', 'Bug fixes and performance improvements', false, NOW() - INTERVAL '30 days'),
  (2, '2.2.0', 'ios', 'New claims filing flow, biometric login', true, NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

INSERT INTO ota_update_log (id, device_id, from_version, to_version, status, started_at, completed_at) VALUES
  (1, 1, '2.0.0', '2.1.0', 'completed', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- OTP
INSERT INTO otp_tokens (id, user_id, token, purpose, expires_at, used, created_at) VALUES
  (1, 1, '483921', 'password_reset', NOW() + INTERVAL '15 minutes', false, NOW())
ON CONFLICT DO NOTHING;

-- P2P Insurance
INSERT INTO p2p_memberships (id, pool_id, customer_id, contribution, joined_at) VALUES
  (1, 1, 1, 25000, NOW() - INTERVAL '60 days'),
  (2, 1, 2, 25000, NOW() - INTERVAL '45 days'),
  (3, 2, 3, 15000, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- Password
INSERT INTO password_resets (user_id, token, expires_at) VALUES
  (1, '123456', NOW() + INTERVAL '1 hour')
ON CONFLICT (user_id) DO UPDATE SET token='123456', expires_at=NOW() + INTERVAL '1 hour';

-- PFA
INSERT INTO pfa_partners (id, name, pfa_code, status, aum) VALUES
  (1, 'Stanbic IBTC Pension', 'PFA001', 'active', 2500000000000),
  (2, 'ARM Pension', 'PFA002', 'active', 1800000000000),
  (3, 'FCMB Pensions', 'PFA003', 'active', 950000000000)
ON CONFLICT DO NOTHING;

INSERT INTO pfa_annuity_quotes (id, pfa_partner_id, customer_id, rsa_balance, monthly_annuity, rate, quoted_at) VALUES
  (1, 1, 1, 15000000, 125000, 0.10, NOW() - INTERVAL '7 days'),
  (2, 2, 2, 8000000, 62000, 0.093, NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Platform
INSERT INTO platform_health_checks (id, component, status, last_check, response_time_ms) VALUES
  (1, 'database', 'healthy', NOW(), 3),
  (2, 'redis', 'healthy', NOW(), 1),
  (3, 'api_server', 'healthy', NOW(), 5),
  (4, 'opensearch', 'degraded', NOW(), 250)
ON CONFLICT DO NOTHING;

INSERT INTO platform_settings (id, key, value, category, description) VALUES
  (1, 'maintenance_mode', 'false', 'system', 'Enable maintenance mode'),
  (2, 'max_file_upload_mb', '10', 'uploads', 'Maximum file upload size'),
  (3, 'session_timeout_minutes', '30', 'security', 'Session timeout duration'),
  (4, 'default_currency', 'NGN', 'finance', 'Default currency'),
  (5, 'kyc_required_level', '1', 'compliance', 'Minimum KYC level for transactions')
ON CONFLICT DO NOTHING;

-- PnL Reports
INSERT INTO pnl_reports (id, period, gross_premium, net_premium, claims_paid, operating_expenses, net_income, loss_ratio, generated_at) VALUES
  (1, '2026-Q1', 125000000, 100000000, 45000000, 25000000, 30000000, 0.36, NOW() - INTERVAL '60 days'),
  (2, '2026-Q2', 140000000, 112000000, 52000000, 28000000, 32000000, 0.37, NOW())
ON CONFLICT DO NOTHING;

-- POS Terminals (insurance agent kiosks)
INSERT INTO pos_terminals (id, terminal_id, agent_id, location, status, last_active) VALUES
  (1, 'POS-LAG-001', 7, 'Lagos Island Office', 'online', NOW()),
  (2, 'POS-ABJ-001', 8, 'Abuja Central Office', 'online', NOW() - INTERVAL '2 hours'),
  (3, 'POS-PH-001', 9, 'Port Harcourt Office', 'offline', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Premium Rate Audit
INSERT INTO premium_rate_audit_logs (id, table_id, changed_by, old_value, new_value, changed_at) VALUES
  (1, 1, 1, '{"baseRate":0.045}', '{"baseRate":0.050}', NOW() - INTERVAL '30 days'),
  (2, 3, 1, '{"baseRate":0.025}', '{"baseRate":0.028}', NOW() - INTERVAL '15 days')
ON CONFLICT DO NOTHING;

INSERT INTO premium_rate_changes (id, product_type, old_rate, new_rate, reason, effective_date, approved_by) VALUES
  (1, 'Motor Comprehensive', 0.045, 0.050, 'Annual rate adjustment per NAICOM guidelines', '2026-04-01', 1),
  (2, 'Health Individual', 0.025, 0.028, 'Claims experience adjustment', '2026-05-01', 1)
ON CONFLICT DO NOTHING;

-- QR Codes
INSERT INTO qr_codes (id, entity_type, entity_id, qr_data, created_at) VALUES
  (1, 'policy', '1', 'https://insureportal.ng/verify/POL-2026-001', NOW() - INTERVAL '30 days'),
  (2, 'receipt', 'RCT-2026-001', 'https://insureportal.ng/receipt/RCT-2026-001', NOW() - INTERVAL '15 days')
ON CONFLICT DO NOTHING;

-- Rate Alerts
INSERT INTO rate_alerts (id, product_type, alert_type, threshold, current_value, triggered_at) VALUES
  (1, 'Motor', 'loss_ratio_high', 0.65, 0.72, NOW() - INTERVAL '7 days'),
  (2, 'Health', 'claims_frequency', 0.30, 0.35, NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Rate Limiting
INSERT INTO rate_limit_rules (id, endpoint_pattern, max_requests, window_seconds, action) VALUES
  (1, '/api/trpc/auth.*', 10, 900, 'block'),
  (2, '/api/trpc/payments.*', 30, 60, 'throttle'),
  (3, '/api/trpc/*', 100, 60, 'log')
ON CONFLICT DO NOTHING;

-- Realtime Transaction Alerts
INSERT INTO realtime_tx_alerts (id, transaction_id, alert_type, severity, details, created_at) VALUES
  (1, 'TXN-001', 'high_value', 'warning', '{"amount":5000000,"threshold":2000000}', NOW() - INTERVAL '2 days'),
  (2, 'TXN-002', 'velocity', 'critical', '{"count":5,"window":"10min","threshold":3}', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Reconciliation
INSERT INTO reconciliation_items (id, entity_type, reference, local_amount, external_amount, variance, status, reconciled_at) VALUES
  (1, 'premium', 'PAY-2026-001', 45000, 45000, 0, 'matched', NOW() - INTERVAL '5 days'),
  (2, 'claims', 'CLM-2026-001', 250000, 248000, 2000, 'variance', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Refunds
INSERT INTO refunds (id, payment_id, amount, reason, status, requested_at, processed_at) VALUES
  (1, 1, 15000, 'Policy cancellation within cooling-off period', 'completed', NOW() - INTERVAL '20 days', NOW() - INTERVAL '18 days'),
  (2, 3, 25000, 'Overpayment correction', 'pending', NOW() - INTERVAL '2 days', NULL)
ON CONFLICT DO NOTHING;

-- Reversal Requests
INSERT INTO reversal_requests (id, transaction_id, amount, reason, status, requested_by, requested_at) VALUES
  (1, 'TXN-001', 45000, 'Duplicate payment', 'approved', 1, NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- Reviews
INSERT INTO reviews (id, customer_id, product_type, rating, comment, status, created_at) VALUES
  (1, 1, 'Motor Comprehensive', 5, 'Excellent service, claim was processed in 2 days!', 'published', NOW() - INTERVAL '30 days'),
  (2, 2, 'Health Individual', 4, 'Good coverage but the app could be faster', 'published', NOW() - INTERVAL '15 days'),
  (3, 3, 'Life Assurance', 3, 'Average experience, took too long to get KYC verified', 'published', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- Savings Accounts
INSERT INTO savings_accounts (id, customer_id, name, target_amount, current_amount, interest_rate, maturity_date, status) VALUES
  (1, 1, 'Premium Savings Plan', 500000, 325000, 0.12, '2027-01-01', 'active'),
  (2, 2, 'Emergency Fund', 200000, 45000, 0.10, '2026-12-01', 'active')
ON CONFLICT DO NOTHING;

-- Service Records (for insured vehicles/assets)
INSERT INTO service_records (id, policy_id, service_type, provider, cost, service_date, notes) VALUES
  (1, 1, 'annual_inspection', 'Lagos Auto Repair', 25000, NOW() - INTERVAL '90 days', 'Vehicle passed inspection'),
  (2, 5, 'repair', 'Kuda Glass Works', 75000, NOW() - INTERVAL '30 days', 'Windscreen replacement')
ON CONFLICT DO NOTHING;

-- Settlement Reconciliation
INSERT INTO settlement_reconciliation (id, settlement_id, expected_amount, actual_amount, variance, status, reconciled_at) VALUES
  (1, 1, 25000000, 24800000, 200000, 'variance', NOW() - INTERVAL '7 days'),
  (2, 2, 15000000, 15000000, 0, 'matched', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Shareable Links
INSERT INTO shareable_links (id, entity_type, entity_id, token, expires_at, created_by) VALUES
  (1, 'policy', '1', md5(random()::text), NOW() + INTERVAL '7 days', 1),
  (2, 'quote', 'Q-2026-001', md5(random()::text), NOW() + INTERVAL '30 days', 1)
ON CONFLICT DO NOTHING;

-- SIM Failover / SIM Orchestrator / SIM Probe
INSERT INTO sim_failover_log (id, device_id, from_sim, to_sim, reason, occurred_at) VALUES
  (1, 1, 'MTN', 'Airtel', 'signal_loss', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

INSERT INTO sim_orchestrator_config (id, priority_order, failover_threshold, health_check_interval) VALUES
  (1, '["MTN","Airtel","Glo"]', -90, 30)
ON CONFLICT DO NOTHING;

INSERT INTO sim_probe_log (id, device_id, carrier, signal_strength, latency_ms, probed_at) VALUES
  (1, 1, 'MTN', -75, 45, NOW() - INTERVAL '1 hour'),
  (2, 1, 'Airtel', -82, 60, NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- SLA
INSERT INTO sla_breaches (id, entity_type, entity_id, sla_type, expected_hours, actual_hours, breached_at) VALUES
  (1, 'claim', '5', 'first_response', 24, 36, NOW() - INTERVAL '10 days'),
  (2, 'dispute', '1', 'resolution', 72, 120, NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Software Updates
INSERT INTO software_updates (id, version, platform, release_notes, mandatory, released_at) VALUES
  (1, '3.0.0', 'web', 'Production hardening: JWT, CORS, structured logging, auth middleware', true, NOW())
ON CONFLICT DO NOTHING;

-- Storefront
INSERT INTO storefront_ads (id, title, description, image_url, target_url, active, start_date, end_date) VALUES
  (1, 'Motor Insurance Sale', 'Get 20% off on new motor policies this month!', '/images/ads/motor-sale.jpg', '/products/motor', true, NOW(), NOW() + INTERVAL '30 days'),
  (2, 'Health Cover Launch', 'New family health plans starting at ₦15,000/month', '/images/ads/health-launch.jpg', '/products/health', true, NOW(), NOW() + INTERVAL '60 days')
ON CONFLICT DO NOTHING;

-- Supervisor
INSERT INTO supervisor_agents (id, supervisor_id, agent_id, assigned_at) VALUES
  (1, 9, 7, NOW() - INTERVAL '90 days'),
  (2, 9, 8, NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

-- System Config
INSERT INTO system_config (id, key, value, description, updated_at) VALUES
  (1, 'app.version', '3.0.0', 'Current application version', NOW()),
  (2, 'naicom.reporting.enabled', 'true', 'Enable NAICOM automated reporting', NOW()),
  (3, 'fraud.threshold', '50', 'Fraud score threshold for investigation', NOW()),
  (4, 'kyc.provider', 'smile_id', 'Default KYC verification provider', NOW()),
  (5, 'payment.default_gateway', 'paystack', 'Default payment gateway', NOW())
ON CONFLICT DO NOTHING;

-- Telco Credit Scores
INSERT INTO telco_credit_scores (id, customer_id, phone_number, carrier, score, factors, scored_at) VALUES
  (1, 1, '+2348012345678', 'MTN', 720, '{"airtime_spend":85,"data_usage":70,"account_age":95}', NOW()),
  (2, 3, '+2348034567890', 'Airtel', 480, '{"airtime_spend":40,"data_usage":55,"account_age":30}', NOW())
ON CONFLICT DO NOTHING;

-- Tenants (multi-tenancy)
INSERT INTO tenants (id, name, domain, status, created_at) VALUES
  (1, 'InsurePortal Nigeria', 'insureportal.ng', 'active', NOW() - INTERVAL '365 days'),
  (2, 'InsurePortal Ghana', 'insureportal.gh', 'provisioning', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO tenant_users (id, tenant_id, user_id, role, created_at) VALUES
  (1, 1, 1, 'admin', NOW() - INTERVAL '365 days'),
  (2, 1, 2, 'user', NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

INSERT INTO tenant_branding (id, tenant_id, logo_url, primary_color, secondary_color) VALUES
  (1, 1, '/images/logo.png', '#1a56db', '#e8f0fe')
ON CONFLICT DO NOTHING;

INSERT INTO tenant_corridors (id, tenant_id, corridor_name, source_country, target_country, enabled) VALUES
  (1, 1, 'Nigeria Domestic', 'NG', 'NG', true),
  (2, 2, 'Ghana Domestic', 'GH', 'GH', true)
ON CONFLICT DO NOTHING;

INSERT INTO tenant_feature_toggles (id, tenant_id, feature, enabled) VALUES
  (1, 1, 'ai_claims', true),
  (2, 1, 'blockchain_verification', false),
  (3, 1, 'ussd_gateway', true),
  (4, 2, 'ai_claims', false)
ON CONFLICT DO NOTHING;

INSERT INTO tenant_fee_overrides (id, tenant_id, fee_type, rate, effective_from) VALUES
  (1, 1, 'processing_fee', 0.015, '2026-01-01'),
  (2, 1, 'stamp_duty', 50, '2026-01-01')
ON CONFLICT DO NOTHING;

-- Terminal Groups
INSERT INTO terminal_groups (id, name, agent_ids, created_at) VALUES
  (1, 'Lagos Cluster', '{7,8}', NOW()),
  (2, 'Northern Region', '{9}', NOW())
ON CONFLICT DO NOTHING;

-- Transaction Limits
INSERT INTO transaction_limits (id, user_type, transaction_type, daily_limit, per_transaction_limit, currency) VALUES
  (1, 'individual', 'payment', 5000000, 2000000, 'NGN'),
  (2, 'corporate', 'payment', 50000000, 20000000, 'NGN'),
  (3, 'agent', 'policy_issuance', 10000000, 1000000, 'NGN')
ON CONFLICT DO NOTHING;

-- TX Monitoring Alerts
INSERT INTO tx_monitoring_alerts (id, rule_name, transaction_id, alert_type, details, created_at) VALUES
  (1, 'High Value Transaction', 'TXN-001', 'threshold_exceeded', '{"amount":5000000,"limit":2000000}', NOW() - INTERVAL '2 days'),
  (2, 'Rapid Succession', 'TXN-002', 'velocity_check', '{"count":5,"window":"10min"}', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- USSD Sessions
INSERT INTO ussd_sessions (id, phone, session_id, menu_level, current_input, status, created_at) VALUES
  (1, '+2348012345678', 'USSD-001', 0, '*919#', 'active', NOW()),
  (2, '+2348023456789', 'USSD-002', 2, '1', 'completed', NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- VAT Records
INSERT INTO vat_records (id, transaction_id, vat_amount, base_amount, vat_rate, period, created_at) VALUES
  (1, 'TXN-001', 3375, 45000, 0.075, '2026-05', NOW() - INTERVAL '7 days'),
  (2, 'TXN-002', 1875, 25000, 0.075, '2026-05', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Velocity Limits
INSERT INTO velocity_limits (id, entity_type, limit_type, max_count, window_seconds, action) VALUES
  (1, 'user', 'login_attempts', 5, 900, 'lock'),
  (2, 'user', 'password_resets', 3, 3600, 'block'),
  (3, 'ip', 'api_requests', 1000, 60, 'throttle')
ON CONFLICT DO NOTHING;

-- Voice Sessions
INSERT INTO voice_sessions (id, user_id, phone, status, intent, duration_seconds, started_at) VALUES
  (1, 1, '+2348012345678', 'completed', 'claim_status', 120, NOW() - INTERVAL '2 days'),
  (2, 2, '+2348023456789', 'completed', 'policy_renewal', 180, NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Webhook
INSERT INTO webhook_endpoints (id, url, events, status, created_by, created_at) VALUES
  (1, 'https://partner.example.ng/webhooks/claims', '{"claim.created","claim.updated","claim.paid"}', 'active', 1, NOW() - INTERVAL '90 days'),
  (2, 'https://erp.example.ng/webhooks/payments', '{"payment.received","payment.refunded"}', 'active', 1, NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO webhook_secrets (id, endpoint_id, secret, created_at) VALUES
  (1, 1, 'whsec_' || md5(random()::text), NOW() - INTERVAL '90 days'),
  (2, 2, 'whsec_' || md5(random()::text), NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, attempts, last_attempt_at) VALUES
  (1, 1, 'claim.created', '{"claimId":"CLM-2026-00001","amount":250000}', 'delivered', 1, NOW() - INTERVAL '2 days'),
  (2, 2, 'payment.received', '{"reference":"PAY-001","amount":45000}', 'delivered', 1, NOW() - INTERVAL '1 day'),
  (3, 1, 'claim.paid', '{"claimId":"CLM-2026-00003","amount":150000}', 'failed', 3, NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- WhatsApp
INSERT INTO whatsapp_messages (id, phone, direction, message, status, created_at) VALUES
  (1, '+2348012345678', 'inbound', 'What is my policy status?', 'processed', NOW() - INTERVAL '2 days'),
  (2, '+2348012345678', 'outbound', 'Your motor policy POL-001 is Active. Expires 2027-01-15.', 'delivered', NOW() - INTERVAL '2 days'),
  (3, '+2348023456789', 'inbound', 'I want to file a claim', 'processed', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- Billing tables (that exist)
INSERT INTO billing_audit_log (id, action, entity_type, entity_id, details, created_at) VALUES
  (1, 'premium_charged', 'policy', '1', '{"amount":45000,"method":"card"}', NOW() - INTERVAL '30 days'),
  (2, 'refund_issued', 'policy', '5', '{"amount":15000,"reason":"cancellation"}', NOW() - INTERVAL '20 days')
ON CONFLICT DO NOTHING;

INSERT INTO billing_provisioning_history (id, entity_type, entity_id, action, status, created_at) VALUES
  (1, 'policy', '1', 'activate', 'completed', NOW() - INTERVAL '60 days'),
  (2, 'policy', '15', 'suspend', 'completed', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

INSERT INTO billing_role_assignments (id, user_id, role, assigned_by, assigned_at) VALUES
  (1, 1, 'billing_admin', 1, NOW() - INTERVAL '365 days'),
  (2, 7, 'billing_viewer', 1, NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

SELECT 'Seeding complete — all 137 previously empty tables now have data' as result;
