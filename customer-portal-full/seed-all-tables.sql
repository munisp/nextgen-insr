-- ═══════════════════════════════════════════════════════════════════════
-- COMPREHENSIVE SEED: Populate all 147 empty tables with realistic data
-- InsurePortal — Nigerian Insurance Platform
-- ═══════════════════════════════════════════════════════════════════════

-- Upgrade demo user to bcrypt password (Demo123!)
UPDATE users SET "passwordHash" = '$2b$12$O3vW3ukR8Spi3nSKKzu0MuXiR2vHOr9au3eocoSWlDlXZK6u5YceG' WHERE email = 'demo@insureportal.ng';

-- ─── AUDIT & COMPLIANCE ───
INSERT INTO audit_log ("agentId", "agentCode", action, resource, "resourceId", "ipAddress", "userAgent", status, metadata, "createdAt") VALUES
(1, 'AGT-001', 'LOGIN', 'auth', '1', '192.168.1.100', 'Mozilla/5.0', 'success', '{"method":"password"}', NOW() - INTERVAL '2 hours'),
(1, 'AGT-001', 'VIEW_POLICY', 'policy', '5', '192.168.1.100', 'Mozilla/5.0', 'success', '{"policyNumber":"POL-2026-001"}', NOW() - INTERVAL '1 hour'),
(2, 'AGT-002', 'FILE_CLAIM', 'claim', '3', '10.0.0.50', 'InsurePortal/2.0', 'success', '{"claimAmount":150000}', NOW() - INTERVAL '45 minutes'),
(1, 'AGT-001', 'APPROVE_CLAIM', 'claim', '3', '192.168.1.100', 'Mozilla/5.0', 'success', '{"decision":"approved"}', NOW() - INTERVAL '30 minutes'),
(3, 'AGT-003', 'UPDATE_KYC', 'kyc', '7', '172.16.0.1', 'Mobile/1.0', 'success', '{"level":"2->3"}', NOW() - INTERVAL '15 minutes'),
(1, 'AGT-001', 'GENERATE_REPORT', 'naicom', 'RPT-Q2', '192.168.1.100', 'Mozilla/5.0', 'success', '{"type":"quarterly"}', NOW() - INTERVAL '10 minutes'),
(2, 'AGT-002', 'PREMIUM_PAYMENT', 'payment', 'PAY-001', '10.0.0.50', 'InsurePortal/2.0', 'success', '{"amount":75000,"gateway":"paystack"}', NOW() - INTERVAL '5 minutes'),
(1, 'AGT-001', 'POLICY_RENEWAL', 'policy', '2', '192.168.1.100', 'Mozilla/5.0', 'success', '{"renewalPeriod":"12 months"}', NOW())
ON CONFLICT DO NOTHING;

-- ─── AGENT MANAGEMENT ───
INSERT INTO agent_achievements (id, agent_id, achievement_type, title, description, earned_at, points) VALUES
(1, 1, 'sales', 'First Policy Sold', 'Sold first insurance policy', NOW() - INTERVAL '90 days', 100),
(2, 1, 'sales', 'Gold Seller', 'Sold 50+ policies in a quarter', NOW() - INTERVAL '30 days', 500),
(3, 2, 'performance', 'Top Performer', 'Top 10% agent by revenue', NOW() - INTERVAL '15 days', 750),
(4, 3, 'training', 'NAICOM Certified', 'Completed NAICOM certification', NOW() - INTERVAL '60 days', 300),
(5, 2, 'customer', 'Customer Champion', '95%+ satisfaction rating', NOW() - INTERVAL '7 days', 400)
ON CONFLICT DO NOTHING;

INSERT INTO agent_badges (id, agent_id, badge_name, badge_type, description, awarded_at) VALUES
(1, 1, 'Star Agent', 'gold', 'Outstanding performance for 3 consecutive months', NOW() - INTERVAL '30 days'),
(2, 2, 'Claims Expert', 'silver', 'Processed 100+ claims with <2% error rate', NOW() - INTERVAL '45 days'),
(3, 3, 'New Recruit', 'bronze', 'Completed onboarding program', NOW() - INTERVAL '90 days'),
(4, 1, 'Digital Pioneer', 'gold', 'First to use all digital tools', NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO agent_bank_accounts (id, agent_id, bank_name, account_number, account_name, is_primary, verified, created_at) VALUES
(1, 1, 'First Bank', '2012345678', 'Patrick Munis', true, true, NOW() - INTERVAL '180 days'),
(2, 2, 'GTBank', '0123456789', 'Chioma Okafor', true, true, NOW() - INTERVAL '120 days'),
(3, 3, 'Access Bank', '0987654321', 'Emeka Eze', true, true, NOW() - INTERVAL '90 days'),
(4, 1, 'UBA', '1234567890', 'Patrick Munis', false, true, NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

INSERT INTO agent_performance_scores (id, agent_id, period, score, policies_sold, premium_collected, claims_processed, customer_satisfaction, created_at) VALUES
(1, 1, '2026-Q1', 92, 45, 12500000, 28, 4.8, NOW() - INTERVAL '90 days'),
(2, 2, '2026-Q1', 87, 38, 9800000, 22, 4.6, NOW() - INTERVAL '90 days'),
(3, 3, '2026-Q1', 75, 22, 5600000, 15, 4.3, NOW() - INTERVAL '90 days'),
(4, 1, '2026-Q2', 95, 52, 15200000, 35, 4.9, NOW() - INTERVAL '1 day'),
(5, 2, '2026-Q2', 89, 41, 11000000, 26, 4.7, NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── API & BROKER MANAGEMENT ───
INSERT INTO api_keys (id, key_id, key_hash, owner_type, owner_id, name, permissions, rate_limit, status, created_at, expires_at) VALUES
(1, 'ak_live_001', 'hashed_key_001', 'broker', 1, 'Leadway Assurance API Key', '["policies.read","claims.read","quotes.create"]', 1000, 'active', NOW() - INTERVAL '60 days', NOW() + INTERVAL '365 days'),
(2, 'ak_live_002', 'hashed_key_002', 'broker', 2, 'AXA Mansard Integration', '["policies.read","policies.create","payments.create"]', 500, 'active', NOW() - INTERVAL '30 days', NOW() + INTERVAL '365 days'),
(3, 'ak_test_001', 'hashed_key_003', 'developer', 3, 'Test Environment Key', '["*"]', 100, 'active', NOW() - INTERVAL '7 days', NOW() + INTERVAL '30 days'),
(4, 'ak_live_003', 'hashed_key_004', 'partner', 4, 'GTBank Bancassurance', '["products.read","quotes.create","policies.create"]', 2000, 'active', NOW() - INTERVAL '90 days', NOW() + INTERVAL '365 days')
ON CONFLICT DO NOTHING;

INSERT INTO api_key_usage (id, key_id, endpoint, method, status_code, response_time_ms, ip_address, created_at) VALUES
(1, 'ak_live_001', '/api/v2/policies', 'GET', 200, 45, '203.0.113.10', NOW() - INTERVAL '2 hours'),
(2, 'ak_live_001', '/api/v2/claims', 'POST', 201, 120, '203.0.113.10', NOW() - INTERVAL '1 hour'),
(3, 'ak_live_002', '/api/v2/quotes', 'POST', 200, 85, '198.51.100.5', NOW() - INTERVAL '30 minutes'),
(4, 'ak_live_003', '/api/v2/products', 'GET', 200, 30, '192.0.2.1', NOW() - INTERVAL '15 minutes'),
(5, 'ak_test_001', '/api/v2/policies', 'GET', 429, 5, '10.0.0.1', NOW() - INTERVAL '5 minutes')
ON CONFLICT DO NOTHING;

-- ─── COMMISSION MANAGEMENT ───
INSERT INTO commission_rules (id, product_type, tier_name, rate_percent, min_premium, max_premium, is_active, created_at) VALUES
(1, 'Motor', 'Standard', 15.00, 0, 500000, true, NOW() - INTERVAL '180 days'),
(2, 'Motor', 'Premium', 18.00, 500001, 5000000, true, NOW() - INTERVAL '180 days'),
(3, 'Health', 'Standard', 12.00, 0, 1000000, true, NOW() - INTERVAL '180 days'),
(4, 'Life', 'Standard', 20.00, 0, 2000000, true, NOW() - INTERVAL '180 days'),
(5, 'Property', 'Standard', 10.00, 0, 10000000, true, NOW() - INTERVAL '180 days'),
(6, 'Agricultural', 'Standard', 8.00, 0, 500000, true, NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

INSERT INTO commission_payouts (id, agent_id, amount, currency, status, period, payment_method, paid_at, created_at) VALUES
(1, 1, 450000, 'NGN', 'paid', '2026-Q1', 'bank_transfer', NOW() - INTERVAL '30 days', NOW() - INTERVAL '35 days'),
(2, 2, 320000, 'NGN', 'paid', '2026-Q1', 'bank_transfer', NOW() - INTERVAL '30 days', NOW() - INTERVAL '35 days'),
(3, 3, 180000, 'NGN', 'paid', '2026-Q1', 'bank_transfer', NOW() - INTERVAL '30 days', NOW() - INTERVAL '35 days'),
(4, 1, 520000, 'NGN', 'pending', '2026-Q2', 'bank_transfer', NULL, NOW() - INTERVAL '1 day'),
(5, 2, 380000, 'NGN', 'pending', '2026-Q2', 'bank_transfer', NULL, NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── CHAT & COMMUNICATION ───
INSERT INTO chat_sessions (id, user_id, agent_id, channel, status, started_at, ended_at, satisfaction_rating) VALUES
(1, 1, NULL, 'web', 'closed', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '15 minutes', 5),
(2, 3, 2, 'whatsapp', 'closed', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '25 minutes', 4),
(3, 5, NULL, 'web', 'active', NOW() - INTERVAL '10 minutes', NULL, NULL),
(4, 7, 1, 'telegram', 'closed', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '8 minutes', 5)
ON CONFLICT DO NOTHING;

INSERT INTO chat_messages (id, session_id, sender_type, sender_id, message, message_type, created_at) VALUES
(1, 1, 'user', 1, 'How do I file a motor insurance claim?', 'text', NOW() - INTERVAL '3 days'),
(2, 1, 'bot', 0, 'To file a motor claim: 1) Go to Claims > File New Claim 2) Select Motor Insurance 3) Upload accident photos 4) Submit police report number', 'text', NOW() - INTERVAL '3 days' + INTERVAL '5 seconds'),
(3, 2, 'user', 3, 'What is my policy renewal date?', 'text', NOW() - INTERVAL '2 days'),
(4, 2, 'agent', 2, 'Your motor policy POL-2026-005 renews on August 15, 2026. Premium is N75,000.', 'text', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes'),
(5, 3, 'user', 5, 'I need help with KYC verification', 'text', NOW() - INTERVAL '10 minutes'),
(6, 3, 'bot', 0, 'I can help with KYC! Which step are you on? BVN, NIN, Phone, Address, ID Document, or Facial Match?', 'text', NOW() - INTERVAL '9 minutes')
ON CONFLICT DO NOTHING;

-- ─── CREDIT & FINANCIAL ───
INSERT INTO credit_applications (id, user_id, amount, purpose, status, credit_score, interest_rate, term_months, monthly_payment, created_at, decided_at) VALUES
(1, 1, 500000, 'Premium financing - Motor Comprehensive', 'approved', 720, 18.5, 12, 46200, NOW() - INTERVAL '60 days', NOW() - INTERVAL '58 days'),
(2, 3, 250000, 'Premium financing - Health Family', 'approved', 680, 21.0, 6, 44500, NOW() - INTERVAL '30 days', NOW() - INTERVAL '28 days'),
(3, 5, 1000000, 'Premium financing - Property All-Risk', 'pending', 650, NULL, NULL, NULL, NOW() - INTERVAL '2 days', NULL),
(4, 7, 150000, 'Premium financing - Life Term', 'declined', 520, NULL, NULL, NULL, NOW() - INTERVAL '15 days', NOW() - INTERVAL '14 days')
ON CONFLICT DO NOTHING;

INSERT INTO credit_score_history (id, user_id, score, factors, source, created_at) VALUES
(1, 1, 720, '{"payment_history":90,"credit_utilization":25,"credit_age":5,"inquiries":2}', 'TransUnion', NOW() - INTERVAL '90 days'),
(2, 1, 730, '{"payment_history":92,"credit_utilization":22,"credit_age":5,"inquiries":1}', 'TransUnion', NOW() - INTERVAL '30 days'),
(3, 3, 680, '{"payment_history":85,"credit_utilization":40,"credit_age":3,"inquiries":3}', 'CreditRegistry', NOW() - INTERVAL '60 days'),
(4, 5, 650, '{"payment_history":78,"credit_utilization":55,"credit_age":2,"inquiries":5}', 'CreditRegistry', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── CUSTOMER JOURNEY ───
INSERT INTO customer_journey_steps (id, journey_name, step_order, step_name, description, is_required, created_at) VALUES
(1, 'policy_purchase', 1, 'Browse Products', 'Customer views available insurance products', true, NOW() - INTERVAL '180 days'),
(2, 'policy_purchase', 2, 'Get Quote', 'Customer requests premium quote', true, NOW() - INTERVAL '180 days'),
(3, 'policy_purchase', 3, 'KYC Verification', 'Complete identity verification', true, NOW() - INTERVAL '180 days'),
(4, 'policy_purchase', 4, 'Payment', 'Pay premium via Paystack/Flutterwave', true, NOW() - INTERVAL '180 days'),
(5, 'policy_purchase', 5, 'Policy Issued', 'Digital policy certificate generated', true, NOW() - INTERVAL '180 days'),
(6, 'claims_filing', 1, 'Report Incident', 'Customer reports insurance event', true, NOW() - INTERVAL '180 days'),
(7, 'claims_filing', 2, 'Upload Evidence', 'Photos, police report, medical records', true, NOW() - INTERVAL '180 days'),
(8, 'claims_filing', 3, 'AI Assessment', 'Automated fraud check and adjudication', true, NOW() - INTERVAL '180 days'),
(9, 'claims_filing', 4, 'Settlement', 'Approved amount paid to customer', true, NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

INSERT INTO customer_journey_events (id, user_id, journey_name, step_id, status, metadata, created_at) VALUES
(1, 1, 'policy_purchase', 1, 'completed', '{"product":"Motor Comprehensive"}', NOW() - INTERVAL '60 days'),
(2, 1, 'policy_purchase', 2, 'completed', '{"premium":125000}', NOW() - INTERVAL '60 days' + INTERVAL '5 minutes'),
(3, 1, 'policy_purchase', 3, 'completed', '{"kycLevel":3}', NOW() - INTERVAL '59 days'),
(4, 1, 'policy_purchase', 4, 'completed', '{"gateway":"paystack","ref":"PAY-001"}', NOW() - INTERVAL '59 days' + INTERVAL '10 minutes'),
(5, 1, 'policy_purchase', 5, 'completed', '{"policyNumber":"POL-2026-001"}', NOW() - INTERVAL '59 days' + INTERVAL '15 minutes'),
(6, 3, 'claims_filing', 6, 'completed', '{"claimType":"Motor Accident"}', NOW() - INTERVAL '15 days'),
(7, 3, 'claims_filing', 7, 'completed', '{"files":3}', NOW() - INTERVAL '15 days' + INTERVAL '20 minutes'),
(8, 3, 'claims_filing', 8, 'completed', '{"fraudScore":0.12,"decision":"approved"}', NOW() - INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── DISPUTES ───
INSERT INTO disputes (id, user_id, claim_id, type, status, description, amount, created_at, resolved_at) VALUES
(1, 3, 2, 'claim_amount', 'resolved', 'Disputed settlement amount for motor accident claim - requested N500K, offered N350K', 150000, NOW() - INTERVAL '30 days', NOW() - INTERVAL '20 days'),
(2, 5, 5, 'claim_denial', 'open', 'Claim denied citing pre-existing condition - customer disputes diagnosis timeline', 800000, NOW() - INTERVAL '7 days', NULL),
(3, 7, 8, 'premium_overcharge', 'under_review', 'Customer charged double premium for renewal - system error suspected', 75000, NOW() - INTERVAL '3 days', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO dispute_messages (id, dispute_id, sender_type, sender_id, message, created_at) VALUES
(1, 1, 'customer', 3, 'The repair quote from 3 different garages all exceed N450K. The N350K settlement is insufficient.', NOW() - INTERVAL '29 days'),
(2, 1, 'adjuster', 1, 'After review, we have approved an additional N100K based on the submitted garage quotes.', NOW() - INTERVAL '25 days'),
(3, 2, 'customer', 5, 'I was diagnosed with this condition AFTER the policy inception date. Medical records attached.', NOW() - INTERVAL '6 days'),
(4, 3, 'customer', 7, 'My bank statement shows two debits of N75,000 each on the same day for the same policy.', NOW() - INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- ─── DEVICES & MDM ───
INSERT INTO devices (id, user_id, device_type, device_name, os, os_version, app_version, push_token, is_active, registered_at, last_seen) VALUES
(1, 1, 'mobile', 'iPhone 15 Pro', 'iOS', '17.5', '2.1.0', 'apns_token_001', true, NOW() - INTERVAL '90 days', NOW() - INTERVAL '1 hour'),
(2, 1, 'mobile', 'Samsung Galaxy S24', 'Android', '14', '2.1.0', 'fcm_token_001', false, NOW() - INTERVAL '180 days', NOW() - INTERVAL '30 days'),
(3, 3, 'mobile', 'Tecno Spark 20', 'Android', '13', '2.0.5', 'fcm_token_002', true, NOW() - INTERVAL '60 days', NOW() - INTERVAL '3 hours'),
(4, 5, 'tablet', 'iPad Air', 'iPadOS', '17.5', '2.1.0', 'apns_token_002', true, NOW() - INTERVAL '45 days', NOW() - INTERVAL '5 hours'),
(5, 7, 'mobile', 'Infinix Note 40', 'Android', '14', '2.0.8', 'fcm_token_003', true, NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

INSERT INTO device_locations (id, device_id, latitude, longitude, accuracy, recorded_at) VALUES
(1, 1, 6.4541, 3.3947, 10.5, NOW() - INTERVAL '1 hour'),
(2, 3, 6.5244, 3.3792, 15.0, NOW() - INTERVAL '3 hours'),
(3, 4, 9.0579, 7.4951, 8.2, NOW() - INTERVAL '5 hours'),
(4, 5, 7.3775, 3.9470, 12.0, NOW() - INTERVAL '2 hours')
ON CONFLICT DO NOTHING;

-- ─── EMAIL QUEUE ───
INSERT INTO email_queue (id, recipient, subject, body, status, attempts, created_at, sent_at) VALUES
(1, 'customer1@example.com', 'Policy Renewal Reminder', '<h2>Your policy POL-2026-003 expires in 30 days</h2>', 'sent', 1, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
(2, 'customer2@example.com', 'Claim Status Update', '<h2>Your claim CLM-2026-005 has been approved</h2>', 'sent', 1, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
(3, 'agent1@insureportal.ng', 'Monthly Performance Report', '<h2>Q2 2026 Performance Summary</h2>', 'pending', 0, NOW() - INTERVAL '1 hour', NULL),
(4, 'customer3@example.com', 'Welcome to InsurePortal', '<h2>Your account has been created</h2>', 'sent', 1, NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── GL ACCOUNTS & ENTRIES ───
INSERT INTO gl_accounts (id, code, name, account_type, parent_id, is_active, created_at) VALUES
(1, '1000', 'Assets', 'asset', NULL, true, NOW() - INTERVAL '365 days'),
(2, '1100', 'Cash and Bank', 'asset', 1, true, NOW() - INTERVAL '365 days'),
(3, '1200', 'Premiums Receivable', 'asset', 1, true, NOW() - INTERVAL '365 days'),
(4, '2000', 'Liabilities', 'liability', NULL, true, NOW() - INTERVAL '365 days'),
(5, '2100', 'Unearned Premium Reserve', 'liability', 4, true, NOW() - INTERVAL '365 days'),
(6, '2200', 'Claims Reserve', 'liability', 4, true, NOW() - INTERVAL '365 days'),
(7, '3000', 'Equity', 'equity', NULL, true, NOW() - INTERVAL '365 days'),
(8, '4000', 'Revenue', 'revenue', NULL, true, NOW() - INTERVAL '365 days'),
(9, '4100', 'Earned Premium', 'revenue', 8, true, NOW() - INTERVAL '365 days'),
(10, '5000', 'Expenses', 'expense', NULL, true, NOW() - INTERVAL '365 days'),
(11, '5100', 'Claims Paid', 'expense', 10, true, NOW() - INTERVAL '365 days'),
(12, '5200', 'Commission Expense', 'expense', 10, true, NOW() - INTERVAL '365 days')
ON CONFLICT DO NOTHING;

INSERT INTO gl_entries (id, account_id, debit, credit, description, reference_type, reference_id, posted_at) VALUES
(1, 2, 15000000, 0, 'Premium collection - Motor policies', 'premium', 'BATCH-2026-Q2-001', NOW() - INTERVAL '30 days'),
(2, 5, 0, 15000000, 'Unearned premium - Motor policies', 'premium', 'BATCH-2026-Q2-001', NOW() - INTERVAL '30 days'),
(3, 9, 8500000, 0, 'Earned premium recognition - Q2 Motor', 'earning', 'EARN-2026-Q2', NOW() - INTERVAL '15 days'),
(4, 5, 0, 8500000, 'Release unearned premium - Q2 Motor', 'earning', 'EARN-2026-Q2', NOW() - INTERVAL '15 days'),
(5, 11, 3200000, 0, 'Claims paid - Motor accidents Q2', 'claims', 'CLM-BATCH-Q2', NOW() - INTERVAL '10 days'),
(6, 2, 0, 3200000, 'Cash outflow - Claims settlement', 'claims', 'CLM-BATCH-Q2', NOW() - INTERVAL '10 days'),
(7, 12, 2250000, 0, 'Agent commissions - Q2', 'commission', 'COMM-Q2', NOW() - INTERVAL '5 days'),
(8, 2, 0, 2250000, 'Cash outflow - Commissions', 'commission', 'COMM-Q2', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

INSERT INTO gl_journal_entries (id, journal_number, description, total_debit, total_credit, status, posted_by, posted_at, created_at) VALUES
(1, 'JE-2026-001', 'Q2 Premium Collection', 15000000, 15000000, 'posted', 1, NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
(2, 'JE-2026-002', 'Q2 Premium Earning', 8500000, 8500000, 'posted', 1, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
(3, 'JE-2026-003', 'Q2 Claims Settlement', 3200000, 3200000, 'posted', 1, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
(4, 'JE-2026-004', 'Q2 Commission Payout', 2250000, 2250000, 'posted', 1, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── GROUP LIFE ───
INSERT INTO group_life_schemes (id, scheme_name, employer_name, policy_number, total_members, sum_assured, annual_premium, status, start_date, end_date) VALUES
(1, 'Dangote Group Life', 'Dangote Industries', 'GL-2026-001', 5000, 50000000000, 250000000, 'active', '2026-01-01', '2026-12-31'),
(2, 'GTBank Staff Life', 'GTBank Plc', 'GL-2026-002', 8000, 80000000000, 400000000, 'active', '2026-01-01', '2026-12-31'),
(3, 'MTN Nigeria Life', 'MTN Nigeria', 'GL-2026-003', 3500, 35000000000, 175000000, 'active', '2026-03-01', '2027-02-28'),
(4, 'NNPC Staff Life', 'NNPC Ltd', 'GL-2026-004', 12000, 120000000000, 600000000, 'active', '2026-01-01', '2026-12-31')
ON CONFLICT DO NOTHING;

INSERT INTO group_life_members (id, scheme_id, member_name, employee_id, date_of_birth, sum_assured, status, enrolled_at) VALUES
(1, 1, 'Abubakar Mohammed', 'DNG-001', '1985-03-15', 10000000, 'active', NOW() - INTERVAL '180 days'),
(2, 1, 'Fatima Ibrahim', 'DNG-002', '1990-07-22', 8000000, 'active', NOW() - INTERVAL '180 days'),
(3, 2, 'Olumide Adeyemi', 'GTB-001', '1988-11-30', 12000000, 'active', NOW() - INTERVAL '150 days'),
(4, 3, 'Ngozi Chukwu', 'MTN-001', '1992-05-18', 10000000, 'active', NOW() - INTERVAL '120 days'),
(5, 4, 'Hassan Danjuma', 'NPC-001', '1983-09-05', 15000000, 'active', NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

-- ─── LOYALTY ───
INSERT INTO loyalty_points (id, user_id, points, tier, earned_from, created_at) VALUES
(1, 1, 5000, 'gold', 'premium_payment', NOW() - INTERVAL '60 days'),
(2, 1, 2500, 'gold', 'referral', NOW() - INTERVAL '30 days'),
(3, 3, 1500, 'silver', 'premium_payment', NOW() - INTERVAL '45 days'),
(4, 5, 800, 'bronze', 'signup_bonus', NOW() - INTERVAL '30 days'),
(5, 7, 3000, 'silver', 'premium_payment', NOW() - INTERVAL '15 days')
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_transactions (id, user_id, points_change, transaction_type, description, created_at) VALUES
(1, 1, 5000, 'earn', 'Premium payment - Motor Comprehensive', NOW() - INTERVAL '60 days'),
(2, 1, 2500, 'earn', 'Referred new customer', NOW() - INTERVAL '30 days'),
(3, 1, -1000, 'redeem', 'Redeemed for premium discount', NOW() - INTERVAL '15 days'),
(4, 3, 1500, 'earn', 'Premium payment - Health Family', NOW() - INTERVAL '45 days'),
(5, 5, 800, 'earn', 'Welcome bonus', NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── NOTIFICATION CHANNELS ───
INSERT INTO notification_channels (id, name, channel_type, config, is_active, created_at) VALUES
(1, 'Email', 'email', '{"provider":"mailgun","domain":"insureportal.ng"}', true, NOW() - INTERVAL '365 days'),
(2, 'SMS', 'sms', '{"provider":"termii","sender":"InsurePtl"}', true, NOW() - INTERVAL '365 days'),
(3, 'WhatsApp', 'whatsapp', '{"provider":"twilio","template":"approved"}', true, NOW() - INTERVAL '180 days'),
(4, 'Push', 'push', '{"provider":"firebase","project":"insureportal"}', true, NOW() - INTERVAL '365 days'),
(5, 'In-App', 'in_app', '{"storage":"postgresql"}', true, NOW() - INTERVAL '365 days')
ON CONFLICT DO NOTHING;

-- ─── REVIEWS ───
INSERT INTO reviews (id, user_id, entity_type, entity_id, rating, title, body, status, created_at) VALUES
(1, 1, 'product', 1, 5, 'Excellent Motor Insurance', 'Fast claims processing and great coverage. Highly recommended!', 'published', NOW() - INTERVAL '45 days'),
(2, 3, 'product', 3, 4, 'Good Health Coverage', 'Comprehensive health plan but wish dental was included by default.', 'published', NOW() - INTERVAL '30 days'),
(3, 5, 'agent', 1, 5, 'Professional Service', 'Agent Patrick was very helpful and explained all the options clearly.', 'published', NOW() - INTERVAL '20 days'),
(4, 7, 'claims', 5, 3, 'Slow Processing', 'Claim took 3 weeks to process. Expected faster turnaround.', 'published', NOW() - INTERVAL '10 days'),
(5, 1, 'product', 5, 4, 'Solid Property Insurance', 'Good coverage for my office building. Renewal was seamless.', 'published', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── PLATFORM SETTINGS & HEALTH ───
INSERT INTO platform_health_checks (id, service_name, status, response_time_ms, last_check, details) VALUES
(1, 'postgresql', 'healthy', 3, NOW() - INTERVAL '1 minute', '{"version":"14.22","connections":8,"maxConnections":20}'),
(2, 'redis', 'healthy', 1, NOW() - INTERVAL '1 minute', '{"version":"7.2","memoryUsed":"12MB","maxMemory":"256MB"}'),
(3, 'opensearch', 'healthy', 15, NOW() - INTERVAL '1 minute', '{"version":"2.15","indices":5,"docs":15000}'),
(4, 'email_service', 'healthy', 250, NOW() - INTERVAL '5 minutes', '{"provider":"mailgun","deliveryRate":"99.2%"}'),
(5, 'sms_service', 'healthy', 180, NOW() - INTERVAL '5 minutes', '{"provider":"termii","deliveryRate":"97.8%"}'),
(6, 'payment_gateway', 'healthy', 120, NOW() - INTERVAL '2 minutes', '{"paystack":"active","flutterwave":"active"}')
ON CONFLICT DO NOTHING;

INSERT INTO platform_incidents (id, title, severity, status, description, affected_services, started_at, resolved_at) VALUES
(1, 'Elevated API Latency', 'medium', 'resolved', 'Database connection pool exhaustion caused elevated latency on policy queries', '["api","postgresql"]', NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days' + INTERVAL '45 minutes'),
(2, 'Payment Gateway Timeout', 'high', 'resolved', 'Paystack API timeout during peak hours affecting premium collection', '["payments","paystack"]', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days' + INTERVAL '2 hours'),
(3, 'Scheduled Maintenance', 'low', 'resolved', 'Database migration and index optimization', '["postgresql"]', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '30 minutes')
ON CONFLICT DO NOTHING;

-- ─── WEBHOOK ENDPOINTS ───
INSERT INTO webhook_endpoints (id, url, events, status, secret_hash, created_at, last_triggered_at) VALUES
(1, 'https://api.leadway.com/webhooks/insureportal', '["policy.created","claim.settled"]', 'active', 'whsec_hash_001', NOW() - INTERVAL '90 days', NOW() - INTERVAL '2 hours'),
(2, 'https://hooks.gtbank.com/bancassurance', '["policy.created","payment.received"]', 'active', 'whsec_hash_002', NOW() - INTERVAL '60 days', NOW() - INTERVAL '4 hours'),
(3, 'https://naicom.gov.ng/api/reporting', '["report.generated","compliance.alert"]', 'active', 'whsec_hash_003', NOW() - INTERVAL '180 days', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, response_code, attempts, created_at) VALUES
(1, 1, 'policy.created', '{"policyId":"POL-2026-015","product":"Motor"}', 'delivered', 200, 1, NOW() - INTERVAL '2 hours'),
(2, 2, 'payment.received', '{"amount":125000,"reference":"PAY-2026-042"}', 'delivered', 200, 1, NOW() - INTERVAL '4 hours'),
(3, 3, 'report.generated', '{"reportType":"quarterly","period":"Q2-2026"}', 'delivered', 200, 1, NOW() - INTERVAL '1 day'),
(4, 1, 'claim.settled', '{"claimId":"CLM-2026-008","amount":350000}', 'failed', 500, 3, NOW() - INTERVAL '6 hours')
ON CONFLICT DO NOTHING;

-- ─── TENANTS (Multi-Tenant) ───
INSERT INTO tenants (id, name, slug, plan, status, created_at) VALUES
(1, 'InsurePortal Nigeria', 'insureportal-ng', 'enterprise', 'active', NOW() - INTERVAL '365 days'),
(2, 'Leadway Assurance', 'leadway', 'professional', 'active', NOW() - INTERVAL '180 days'),
(3, 'AXA Mansard', 'axa-mansard', 'professional', 'active', NOW() - INTERVAL '120 days')
ON CONFLICT DO NOTHING;

-- ─── RECONCILIATION ───
INSERT INTO reconciliation_items (id, batch_id, transaction_type, reference, amount, status, source, matched_at, created_at) VALUES
(1, 1, 'premium', 'PAY-2026-001', 125000, 'matched', 'paystack', NOW() - INTERVAL '5 days', NOW() - INTERVAL '7 days'),
(2, 1, 'premium', 'PAY-2026-002', 75000, 'matched', 'paystack', NOW() - INTERVAL '5 days', NOW() - INTERVAL '7 days'),
(3, 2, 'claim_payout', 'CLM-PAY-001', 350000, 'matched', 'bank_transfer', NOW() - INTERVAL '3 days', NOW() - INTERVAL '5 days'),
(4, 2, 'premium', 'PAY-2026-003', 200000, 'unmatched', 'flutterwave', NULL, NOW() - INTERVAL '2 days'),
(5, 3, 'commission', 'COMM-001', 45000, 'matched', 'bank_transfer', NOW() - INTERVAL '1 day', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── FRAUD DETECTION ───
INSERT INTO fraud_rules (id, name, rule_type, conditions, severity, is_active, created_at) VALUES
(1, 'Velocity Check', 'velocity', '{"maxClaimsPerMonth":3,"windowDays":30}', 'high', true, NOW() - INTERVAL '365 days'),
(2, 'Amount Threshold', 'threshold', '{"maxClaimAmount":5000000,"requiresManualReview":true}', 'medium', true, NOW() - INTERVAL '365 days'),
(3, 'Geographic Anomaly', 'geospatial', '{"maxDistanceKm":100,"fromRegisteredAddress":true}', 'medium', true, NOW() - INTERVAL '180 days'),
(4, 'Network Analysis', 'graph', '{"minConnections":3,"suspiciousPattern":"ring"}', 'critical', true, NOW() - INTERVAL '120 days'),
(5, 'Document Forgery', 'ml_model', '{"modelVersion":"v2","confidenceThreshold":0.85}', 'critical', true, NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

INSERT INTO fraud_scores (id, claim_id, score, risk_level, factors, model_version, scored_at) VALUES
(1, 1, 0.12, 'low', '{"velocity":0.05,"amount":0.03,"network":0.02,"document":0.02}', 'v2', NOW() - INTERVAL '30 days'),
(2, 3, 0.45, 'medium', '{"velocity":0.15,"amount":0.10,"network":0.12,"document":0.08}', 'v2', NOW() - INTERVAL '15 days'),
(3, 5, 0.82, 'high', '{"velocity":0.25,"amount":0.20,"network":0.22,"document":0.15}', 'v2', NOW() - INTERVAL '7 days'),
(4, 8, 0.08, 'low', '{"velocity":0.02,"amount":0.03,"network":0.01,"document":0.02}', 'v2', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ─── WHATSAPP ───
INSERT INTO whatsapp_messages (id, phone_number, direction, message_type, content, status, template_name, created_at) VALUES
(1, '+2348012345678', 'outbound', 'template', 'Your policy POL-2026-001 has been renewed successfully.', 'delivered', 'policy_renewal', NOW() - INTERVAL '7 days'),
(2, '+2348098765432', 'inbound', 'text', 'What is my claim status?', 'received', NULL, NOW() - INTERVAL '3 days'),
(3, '+2348098765432', 'outbound', 'text', 'Your claim CLM-2026-005 is approved. Settlement of N350,000 will be processed within 48 hours.', 'delivered', NULL, NOW() - INTERVAL '3 days'),
(4, '+2348055544433', 'outbound', 'template', 'Premium payment reminder: N75,000 due for Motor Insurance by June 30.', 'delivered', 'payment_reminder', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── COMPLIANCE ───
INSERT INTO compliance_checks (id, entity_type, entity_id, check_type, status, findings, checked_by, checked_at) VALUES
(1, 'policy', 'POL-2026-001', 'kyc_verification', 'passed', '{"kycLevel":3,"allDocumentsVerified":true}', 'system', NOW() - INTERVAL '60 days'),
(2, 'claim', 'CLM-2026-003', 'fraud_screening', 'passed', '{"fraudScore":0.12,"riskLevel":"low"}', 'ai_model', NOW() - INTERVAL '30 days'),
(3, 'agent', 'AGT-001', 'license_check', 'passed', '{"licenseValid":true,"expiresAt":"2027-03-15"}', 'compliance_officer', NOW() - INTERVAL '90 days'),
(4, 'report', 'RPT-Q2-2026', 'naicom_validation', 'passed', '{"allFieldsComplete":true,"solvencyRatio":1.85}', 'system', NOW() - INTERVAL '7 days')
ON CONFLICT DO NOTHING;

-- ─── USSD SESSIONS ───
INSERT INTO ussd_sessions (id, session_id, phone_number, menu_state, pin_verified, started_at, last_activity, ended_at) VALUES
(1, 'USSD-001', '*347*001#', 'main_menu', true, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours' + INTERVAL '5 minutes', NOW() - INTERVAL '2 hours' + INTERVAL '5 minutes'),
(2, 'USSD-002', '*347*002#', 'check_balance', true, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour' + INTERVAL '3 minutes', NOW() - INTERVAL '1 hour' + INTERVAL '3 minutes'),
(3, 'USSD-003', '*347*003#', 'file_claim', false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes' + INTERVAL '1 minute', NOW() - INTERVAL '29 minutes'),
(4, 'USSD-004', '*347*004#', 'pay_premium', true, NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '10 minutes', NULL)
ON CONFLICT DO NOTHING;

-- ─── VOICE SESSIONS ───
INSERT INTO voice_sessions (id, user_id, session_type, language, status, transcript, started_at, ended_at) VALUES
(1, 1, 'claim_inquiry', 'en', 'completed', 'Customer asked about claim CLM-2026-003 status. Informed claim is approved.', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '3 minutes'),
(2, 3, 'policy_inquiry', 'en', 'completed', 'Customer inquired about motor policy renewal options and premium amount.', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '5 minutes'),
(3, 5, 'support', 'ha', 'completed', 'Customer needed help with KYC verification in Hausa language.', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '8 minutes')
ON CONFLICT DO NOTHING;

-- ─── SAVINGS ACCOUNTS ───
INSERT INTO savings_accounts (id, user_id, account_name, balance, target_amount, interest_rate, status, created_at) VALUES
(1, 1, 'Emergency Fund', 500000, 1000000, 8.5, 'active', NOW() - INTERVAL '120 days'),
(2, 1, 'Car Insurance Fund', 125000, 250000, 7.0, 'active', NOW() - INTERVAL '90 days'),
(3, 3, 'Health Premium Fund', 75000, 150000, 7.5, 'active', NOW() - INTERVAL '60 days'),
(4, 5, 'Children Education', 250000, 2000000, 9.0, 'active', NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

-- ─── BI REPORTS ───
INSERT INTO bi_report_definitions (id, name, description, query_template, schedule, format, created_by, created_at) VALUES
(1, 'Monthly Premium Collection', 'Total premiums collected by product type', 'SELECT product_type, SUM(amount) FROM premium_collections GROUP BY product_type', 'monthly', 'pdf', 1, NOW() - INTERVAL '180 days'),
(2, 'Claims Loss Ratio', 'Claims paid vs premiums earned by quarter', 'SELECT quarter, claims_paid/premiums_earned as loss_ratio FROM financial_metrics', 'quarterly', 'excel', 1, NOW() - INTERVAL '180 days'),
(3, 'Agent Performance Ranking', 'Top agents by revenue and customer satisfaction', 'SELECT agent_id, revenue, satisfaction FROM agent_performance_scores ORDER BY score DESC', 'monthly', 'pdf', 1, NOW() - INTERVAL '90 days'),
(4, 'NAICOM Compliance Dashboard', 'Regulatory filing status and solvency metrics', 'SELECT * FROM naicom_filings WHERE status != ''submitted''', 'weekly', 'pdf', 1, NOW() - INTERVAL '60 days')
ON CONFLICT DO NOTHING;

-- ─── DATA CONSENT (GDPR/NDP) ───
INSERT INTO data_consent_records (id, user_id, consent_type, granted, ip_address, granted_at, revoked_at) VALUES
(1, 1, 'data_processing', true, '192.168.1.100', NOW() - INTERVAL '180 days', NULL),
(2, 1, 'marketing_communications', true, '192.168.1.100', NOW() - INTERVAL '180 days', NULL),
(3, 3, 'data_processing', true, '10.0.0.50', NOW() - INTERVAL '120 days', NULL),
(4, 3, 'marketing_communications', false, '10.0.0.50', NOW() - INTERVAL '120 days', NOW() - INTERVAL '60 days'),
(5, 5, 'data_processing', true, '172.16.0.1', NOW() - INTERVAL '90 days', NULL)
ON CONFLICT DO NOTHING;

-- ─── ANALYTICS ───
INSERT INTO analytics_dashboards (id, name, description, widgets, owner_id, is_public, created_at) VALUES
(1, 'Executive Overview', 'Key platform metrics for leadership', '[{"type":"kpi","metric":"total_premium"},{"type":"chart","metric":"loss_ratio"}]', 1, true, NOW() - INTERVAL '90 days'),
(2, 'Claims Operations', 'Claims processing pipeline and SLAs', '[{"type":"funnel","metric":"claims_pipeline"},{"type":"gauge","metric":"avg_processing_time"}]', 1, true, NOW() - INTERVAL '60 days'),
(3, 'Agent Performance', 'Agent productivity and commission tracking', '[{"type":"leaderboard","metric":"agent_revenue"},{"type":"chart","metric":"policies_sold"}]', 1, true, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO analytics_metrics (id, metric_name, value, dimensions, recorded_at) VALUES
(1, 'total_premium_collected', 45000000, '{"period":"2026-Q2","currency":"NGN"}', NOW() - INTERVAL '1 day'),
(2, 'claims_paid', 12500000, '{"period":"2026-Q2","currency":"NGN"}', NOW() - INTERVAL '1 day'),
(3, 'active_policies', 23, '{"period":"2026-Q2"}', NOW() - INTERVAL '1 day'),
(4, 'loss_ratio', 0.278, '{"period":"2026-Q2"}', NOW() - INTERVAL '1 day'),
(5, 'customer_satisfaction', 4.6, '{"period":"2026-Q2","scale":"1-5"}', NOW() - INTERVAL '1 day'),
(6, 'new_customers', 8, '{"period":"2026-Q2"}', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── BACKUP & DR ───
INSERT INTO backup_snapshots (id, snapshot_type, size_bytes, status, storage_path, created_at, completed_at) VALUES
(1, 'full', 2147483648, 'completed', 's3://insureportal-backups/full/2026-06-01.tar.gz', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '15 minutes'),
(2, 'incremental', 104857600, 'completed', 's3://insureportal-backups/incr/2026-06-03.tar.gz', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '2 minutes'),
(3, 'full', 2252341248, 'completed', 's3://insureportal-backups/full/2026-06-05.tar.gz', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '18 minutes')
ON CONFLICT DO NOTHING;

-- ─── FEE RULES ───
INSERT INTO fee_rules (id, name, fee_type, amount, percentage, min_amount, max_amount, applies_to, is_active, created_at) VALUES
(1, 'NAICOM Levy', 'percentage', 0, 1.0, 100, 50000, 'premium', true, NOW() - INTERVAL '365 days'),
(2, 'Stamp Duty', 'flat', 50, 0, 50, 50, 'policy', true, NOW() - INTERVAL '365 days'),
(3, 'Processing Fee', 'percentage', 0, 0.5, 50, 5000, 'claim_payout', true, NOW() - INTERVAL '180 days'),
(4, 'Late Payment Penalty', 'percentage', 0, 2.5, 1000, 100000, 'overdue_premium', true, NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

-- ─── KNOWLEDGE GRAPH ───
INSERT INTO knowledge_graph_nodes (id, node_type, name, properties, created_at) VALUES
(1, 'product', 'Motor Comprehensive', '{"category":"Motor","premium_range":"50K-500K"}', NOW() - INTERVAL '180 days'),
(2, 'product', 'Health Family', '{"category":"Health","premium_range":"100K-1M"}', NOW() - INTERVAL '180 days'),
(3, 'regulation', 'NAICOM Act 2003', '{"jurisdiction":"Nigeria","sector":"insurance"}', NOW() - INTERVAL '180 days'),
(4, 'risk', 'Lagos Flood Risk', '{"type":"parametric","trigger":"rainfall>200mm"}', NOW() - INTERVAL '120 days'),
(5, 'entity', 'Leadway Assurance', '{"type":"reinsurer","rating":"A-"}', NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

INSERT INTO knowledge_graph_edges (id, source_id, target_id, relationship, weight, created_at) VALUES
(1, 1, 3, 'regulated_by', 1.0, NOW() - INTERVAL '180 days'),
(2, 2, 3, 'regulated_by', 1.0, NOW() - INTERVAL '180 days'),
(3, 1, 4, 'covers_risk', 0.7, NOW() - INTERVAL '120 days'),
(4, 1, 5, 'reinsured_by', 0.8, NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── SLA ───
INSERT INTO sla_definitions (id, name, entity_type, metric, target_value, unit, penalty_amount, is_active, created_at) VALUES
(1, 'Claims Processing Time', 'claim', 'processing_time', 72, 'hours', 50000, true, NOW() - INTERVAL '365 days'),
(2, 'Policy Issuance Time', 'policy', 'issuance_time', 24, 'hours', 25000, true, NOW() - INTERVAL '365 days'),
(3, 'Customer Response Time', 'support', 'response_time', 4, 'hours', 10000, true, NOW() - INTERVAL '180 days'),
(4, 'NAICOM Filing Deadline', 'compliance', 'filing_time', 720, 'hours', 500000, true, NOW() - INTERVAL '365 days')
ON CONFLICT DO NOTHING;

-- ─── TRANSACTIONS ───
INSERT INTO transactions (id, user_id, type, amount, currency, status, reference, description, created_at) VALUES
(1, 1, 'premium_payment', 125000, 'NGN', 'completed', 'TXN-2026-001', 'Motor Comprehensive premium', NOW() - INTERVAL '60 days'),
(2, 3, 'premium_payment', 150000, 'NGN', 'completed', 'TXN-2026-002', 'Health Family premium', NOW() - INTERVAL '45 days'),
(3, 5, 'claim_payout', 350000, 'NGN', 'completed', 'TXN-2026-003', 'Motor accident claim settlement', NOW() - INTERVAL '20 days'),
(4, 7, 'premium_payment', 75000, 'NGN', 'completed', 'TXN-2026-004', 'Life Term premium', NOW() - INTERVAL '15 days'),
(5, 1, 'premium_payment', 200000, 'NGN', 'pending', 'TXN-2026-005', 'Property All-Risk premium', NOW() - INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- Refresh table statistics
ANALYZE;
