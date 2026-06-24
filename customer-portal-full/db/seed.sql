-- InsurePortal Seed Data
-- Column names match server.cjs SQL queries exactly (camelCase where quoted)
-- Ensures data flows end-to-end: users → policies → claims → payments → notifications

BEGIN;

-- Users
INSERT INTO users (id, email, name, role, phone) VALUES
  (1, 'demo@insureportal.ng', 'Demo Admin', 'admin', '+2348001000000'),
  (2, 'adebayo.okonkwo@email.com', 'Adebayo Okonkwo', 'customer', '+2348012345001'),
  (3, 'fatima.ibrahim@email.com', 'Fatima Ibrahim', 'customer', '+2348012345002'),
  (4, 'chinedu.eze@email.com', 'Chinedu Eze', 'customer', '+2348012345003'),
  (5, 'amina.yusuf@email.com', 'Amina Yusuf', 'customer', '+2348012345004'),
  (6, 'obinna.nwosu@email.com', 'Obinna Nwosu', 'agent', '+2348012345005'),
  (7, 'grace.adeyemi@email.com', 'Grace Adeyemi', 'agent', '+2348012345006'),
  (8, 'emeka.obi@email.com', 'Emeka Obi', 'underwriter', '+2348012345007'),
  (9, 'ngozi.okeke@email.com', 'Ngozi Okeke', 'claims_officer', '+2348012345008'),
  (10, 'tunde.bakare@email.com', 'Tunde Bakare', 'finance', '+2348012345009')
ON CONFLICT (id) DO NOTHING;
SELECT setval('users_id_seq', 10, true);

INSERT INTO roles (id, name, permissions) VALUES
  (1, 'admin', '["all"]'::jsonb),
  (2, 'customer', '["view_policies","create_claims","view_dashboard"]'::jsonb),
  (3, 'agent', '["view_policies","create_policies","view_commissions"]'::jsonb),
  (4, 'underwriter', '["view_applications","approve_policies","assess_risk"]'::jsonb),
  (5, 'claims_officer', '["view_claims","process_claims","approve_payouts"]'::jsonb),
  (6, 'finance', '["view_financials","process_payments","reconcile"]'::jsonb)
ON CONFLICT (id) DO NOTHING;
SELECT setval('roles_id_seq', 6, true);

INSERT INTO user_roles ("userId", "roleId") VALUES
  (1, 1), (2, 2), (3, 2), (4, 2), (5, 2),
  (6, 3), (7, 3), (8, 4), (9, 5), (10, 6)
ON CONFLICT DO NOTHING;

-- KYC Profiles
INSERT INTO kyc_profiles ("userId", nin, bvn, phone, level, "kycLevel", status, "kycStatus", "ninVerified", "bvnVerified", "phoneVerified", "riskRating") VALUES
  (1, '12345678900', '22345678900', '+2348012345000', 3, 3, 'verified', 'verified', true, true, true, 'low'),
  (2, '12345678901', '22345678901', '+2348012345001', 3, 3, 'verified', 'verified', true, true, true, 'low'),
  (3, '12345678902', '22345678902', '+2348012345002', 3, 3, 'verified', 'verified', true, true, true, 'low'),
  (4, '12345678903', '22345678903', '+2348012345003', 2, 2, 'pending', 'pending', true, false, true, 'medium'),
  (5, '12345678904', '22345678904', '+2348012345004', 3, 3, 'verified', 'verified', true, true, true, 'low')
ON CONFLICT DO NOTHING;

-- Insurance Products
INSERT INTO insurance_products (id, name, code, category, description, status, premium, "minCoverage", "maxCoverage") VALUES
  (1, 'Motor Comprehensive', 'MOTOR-COMP', 'motor', 'Full comprehensive motor vehicle insurance', 'active', 45000.00, 500000.00, 50000000.00),
  (2, 'Motor Third Party', 'MOTOR-TP', 'motor', 'Third party motor insurance (NAICOM mandatory)', 'active', 15000.00, 1000000.00, 5000000.00),
  (3, 'Home Protection', 'HOME-PROT', 'property', 'Comprehensive home and contents insurance', 'active', 35000.00, 2000000.00, 100000000.00),
  (4, 'Health Individual', 'HEALTH-IND', 'health', 'Individual health insurance plan', 'active', 50000.00, 1000000.00, 10000000.00),
  (5, 'Health Family', 'HEALTH-FAM', 'health', 'Family health insurance covering up to 6 members', 'active', 120000.00, 2000000.00, 20000000.00),
  (6, 'Life Term', 'LIFE-TERM', 'life', 'Term life insurance with flexible tenure', 'active', 25000.00, 5000000.00, 500000000.00),
  (7, 'Travel Insurance', 'TRAVEL-INT', 'travel', 'International travel insurance', 'active', 15000.00, 1000000.00, 50000000.00),
  (8, 'SME Business', 'SME-BIZ', 'business', 'Small and medium enterprise insurance package', 'active', 75000.00, 5000000.00, 200000000.00),
  (9, 'Agricultural Crop', 'AGRI-CROP', 'agriculture', 'Crop insurance with index-based triggers', 'active', 20000.00, 500000.00, 10000000.00),
  (10, 'Marine Cargo', 'MARINE-CRG', 'marine', 'Marine cargo insurance for imports/exports', 'active', 100000.00, 10000000.00, 500000000.00),
  (11, 'Professional Indemnity', 'PROF-IND', 'liability', 'Professional indemnity for service providers', 'active', 60000.00, 5000000.00, 100000000.00),
  (12, 'Microinsurance Basic', 'MICRO-BSC', 'microinsurance', 'Basic microinsurance for low-income earners', 'active', 500.00, 50000.00, 500000.00)
ON CONFLICT (id) DO NOTHING;
SELECT setval('insurance_products_id_seq', 12, true);

-- Policies
INSERT INTO policies (id, "userId", product_id, "policyNumber", type, category, name, status, premium, gross, "sumAssured", "coverageAmount", "startDate", "endDate", "expiryDate") VALUES
  (1, 2, 1, 'POL-2026-0001', 'motor', 'comprehensive', 'Motor Comprehensive - Toyota Camry', 'Active', 85000.00, 85000.00, 15000000.00, 15000000.00, '2026-01-15', '2027-01-14', '2027-01-14'),
  (2, 2, 4, 'POL-2026-0002', 'health', 'individual', 'Health Individual Plan', 'Active', 65000.00, 65000.00, 5000000.00, 5000000.00, '2026-02-01', '2027-01-31', '2027-01-31'),
  (3, 3, 5, 'POL-2026-0003', 'health', 'family', 'Health Family Plan', 'Active', 150000.00, 150000.00, 15000000.00, 15000000.00, '2026-01-01', '2026-12-31', '2026-12-31'),
  (4, 3, 6, 'POL-2026-0004', 'life', 'term', 'Life Term 20yr', 'Active', 40000.00, 40000.00, 50000000.00, 50000000.00, '2026-03-01', '2046-02-28', '2046-02-28'),
  (5, 4, 2, 'POL-2026-0005', 'motor', 'third_party', 'Motor Third Party - Honda Accord', 'Active', 18000.00, 18000.00, 3000000.00, 3000000.00, '2026-04-01', '2027-03-31', '2027-03-31'),
  (6, 4, 3, 'POL-2026-0006', 'property', 'home', 'Home Protection - Lekki', 'Active', 55000.00, 55000.00, 35000000.00, 35000000.00, '2026-01-20', '2027-01-19', '2027-01-19'),
  (7, 5, 8, 'POL-2026-0007', 'business', 'sme', 'SME Package - Fashion Store', 'Active', 95000.00, 95000.00, 20000000.00, 20000000.00, '2026-05-01', '2027-04-30', '2027-04-30'),
  (8, 5, 7, 'POL-2026-0008', 'travel', 'international', 'Travel Insurance - Europe', 'Expired', 22000.00, 22000.00, 10000000.00, 10000000.00, '2026-01-10', '2026-02-10', '2026-02-10'),
  (9, 2, 9, 'POL-2026-0009', 'agriculture', 'crop', 'Crop Insurance - Maize Farm', 'Active', 30000.00, 30000.00, 2000000.00, 2000000.00, '2026-03-01', '2026-09-30', '2026-09-30'),
  (10, 3, 12, 'POL-2026-0010', 'microinsurance', 'basic', 'Microinsurance Basic', 'Active', 1200.00, 1200.00, 200000.00, 200000.00, '2026-06-01', '2027-05-31', '2027-05-31'),
  (11, 4, 11, 'POL-2026-0011', 'liability', 'professional', 'Professional Indemnity - Lawyer', 'Pending', 70000.00, 70000.00, 25000000.00, 25000000.00, '2026-07-01', '2027-06-30', '2027-06-30'),
  (12, 5, 10, 'POL-2026-0012', 'marine', 'cargo', 'Marine Cargo - Container Import', 'Active', 120000.00, 120000.00, 80000000.00, 80000000.00, '2026-06-01', '2026-08-31', '2026-08-31')
ON CONFLICT (id) DO NOTHING;
SELECT setval('policies_id_seq', 12, true);

-- Claims
INSERT INTO claims (id, "policyId", "userId", "claimNumber", type, status, amount, description) VALUES
  (1, 1, 2, 'CLM-2026-0001', 'motor', 'Approved', 450000.00, 'Rear-end collision damage repair - Toyota Camry bumper and taillight'),
  (2, 2, 2, 'CLM-2026-0002', 'health', 'Under Review', 250000.00, 'Hospital admission for malaria treatment at Lagos General'),
  (3, 3, 3, 'CLM-2026-0003', 'health', 'Submitted', 180000.00, 'Dental procedure for child - orthodontic braces'),
  (4, 6, 4, 'CLM-2026-0004', 'property', 'Approved', 1500000.00, 'Water damage from burst pipe - kitchen and living room'),
  (5, 7, 5, 'CLM-2026-0005', 'business', 'Rejected', 800000.00, 'Stock damage claim - items not covered under policy terms'),
  (6, 9, 2, 'CLM-2026-0006', 'agriculture', 'Approved', 500000.00, 'Crop loss due to flooding - 2 hectares of maize affected'),
  (7, 1, 2, 'CLM-2026-0007', 'motor', 'Submitted', 120000.00, 'Windshield crack from road debris'),
  (8, 4, 3, 'CLM-2026-0008', 'life', 'Under Review', 50000000.00, 'Term life benefit claim - partial disability')
ON CONFLICT (id) DO NOTHING;
SELECT setval('claims_id_seq', 8, true);

-- Claims Payouts
INSERT INTO claims_payouts ("claimId", "claimNumber", amount, status, "paidAt") VALUES
  (1, 'CLM-2026-0001', 450000.00, 'paid', '2026-03-15'),
  (4, 'CLM-2026-0004', 1500000.00, 'paid', '2026-05-20'),
  (6, 'CLM-2026-0006', 500000.00, 'pending', NULL)
ON CONFLICT DO NOTHING;

-- Premium Collections
INSERT INTO premium_collections ("policyId", "policyNumber", amount, status, "paymentMethod", "collectionDate") VALUES
  (1, 'POL-2026-0001', 85000.00, 'collected', 'card', '2026-01-15'),
  (2, 'POL-2026-0002', 65000.00, 'collected', 'bank_transfer', '2026-02-01'),
  (3, 'POL-2026-0003', 150000.00, 'collected', 'card', '2026-01-01'),
  (4, 'POL-2026-0004', 40000.00, 'collected', 'card', '2026-03-01'),
  (5, 'POL-2026-0005', 18000.00, 'collected', 'mobile_money', '2026-04-01'),
  (6, 'POL-2026-0006', 55000.00, 'collected', 'bank_transfer', '2026-01-20'),
  (7, 'POL-2026-0007', 95000.00, 'collected', 'card', '2026-05-01'),
  (8, 'POL-2026-0008', 22000.00, 'collected', 'card', '2026-01-10'),
  (9, 'POL-2026-0009', 30000.00, 'collected', 'mobile_money', '2026-03-01'),
  (10, 'POL-2026-0010', 1200.00, 'collected', 'ussd', '2026-06-01'),
  (11, 'POL-2026-0011', 70000.00, 'pending', 'bank_transfer', NULL),
  (12, 'POL-2026-0012', 120000.00, 'collected', 'bank_transfer', '2026-06-01')
ON CONFLICT DO NOTHING;

-- Financial Transactions
INSERT INTO financial_transactions ("userId", type, amount, status, reference, description) VALUES
  (2, 'premium_payment', 85000.00, 'completed', 'TXN-2026-001', 'Premium payment for POL-2026-0001'),
  (2, 'premium_payment', 65000.00, 'completed', 'TXN-2026-002', 'Premium payment for POL-2026-0002'),
  (3, 'premium_payment', 150000.00, 'completed', 'TXN-2026-003', 'Premium payment for POL-2026-0003'),
  (3, 'premium_payment', 40000.00, 'completed', 'TXN-2026-004', 'Premium payment for POL-2026-0004'),
  (2, 'claim_payout', 450000.00, 'completed', 'TXN-2026-005', 'Claim payout for CLM-2026-0001'),
  (4, 'claim_payout', 1500000.00, 'completed', 'TXN-2026-006', 'Claim payout for CLM-2026-0004'),
  (4, 'premium_payment', 18000.00, 'completed', 'TXN-2026-007', 'Premium payment for POL-2026-0005'),
  (5, 'premium_payment', 95000.00, 'completed', 'TXN-2026-008', 'Premium payment for POL-2026-0007'),
  (2, 'claim_payout', 500000.00, 'pending', 'TXN-2026-009', 'Claim payout for CLM-2026-0006'),
  (5, 'premium_payment', 120000.00, 'completed', 'TXN-2026-010', 'Premium payment for POL-2026-0012')
ON CONFLICT DO NOTHING;

-- Payment Transactions
INSERT INTO payment_transactions ("userId", customer_email, amount, type, gateway, reference, status) VALUES
  (2, 'adebayo.okonkwo@email.com', 85000.00, 'premium', 'paystack', 'PAY-PS-001', 'success'),
  (3, 'fatima.ibrahim@email.com', 150000.00, 'premium', 'paystack', 'PAY-PS-002', 'success'),
  (4, 'chinedu.eze@email.com', 18000.00, 'premium', 'flutterwave', 'PAY-FW-001', 'success'),
  (5, 'amina.yusuf@email.com', 95000.00, 'premium', 'paystack', 'PAY-PS-003', 'success'),
  (2, 'adebayo.okonkwo@email.com', 450000.00, 'claim_payout', 'bank', 'PAY-BNK-001', 'success'),
  (4, 'chinedu.eze@email.com', 1500000.00, 'claim_payout', 'bank', 'PAY-BNK-002', 'success')
ON CONFLICT DO NOTHING;

-- Agents & Commissions
INSERT INTO agents (id, "userId", "agentCode", name, "agencyName", region, status, "commissionRate") VALUES
  (1, 6, 'AGT-001', 'Obinna Nwosu', 'Obinna Nwosu Insurance Agency', 'Lagos', 'active', 0.10),
  (2, 7, 'AGT-002', 'Grace Adeyemi', 'Adeyemi Financial Services', 'Abuja', 'active', 0.12)
ON CONFLICT (id) DO NOTHING;
SELECT setval('agents_id_seq', 2, true);

INSERT INTO agent_commissions ("agentId", "policyId", amount, "commissionAmount", rate, status) VALUES
  (1, 1, 8500.00, 8500.00, 0.10, 'paid'),
  (1, 2, 6500.00, 6500.00, 0.10, 'paid'),
  (1, 5, 1800.00, 1800.00, 0.10, 'pending'),
  (2, 3, 18000.00, 18000.00, 0.12, 'paid'),
  (2, 4, 4800.00, 4800.00, 0.12, 'paid'),
  (2, 7, 11400.00, 11400.00, 0.12, 'pending')
ON CONFLICT DO NOTHING;

-- Customers
INSERT INTO customers (id, "userId", customer_code, full_name, phone, status, segment, lifetime_value) VALUES
  (1, 2, 'CUST-001', 'Adebayo Okonkwo', '+2348012345001', 'active', 'premium', 680000.00),
  (2, 3, 'CUST-002', 'Fatima Ibrahim', '+2348012345002', 'active', 'premium', 381200.00),
  (3, 4, 'CUST-003', 'Chinedu Eze', '+2348012345003', 'active', 'standard', 143000.00),
  (4, 5, 'CUST-004', 'Amina Yusuf', '+2348012345004', 'active', 'premium', 332000.00)
ON CONFLICT (id) DO NOTHING;
SELECT setval('customers_id_seq', 4, true);

INSERT INTO family_members (customer_id, "memberName", name, relationship, "dateOfBirth", is_dependent) VALUES
  (2, 'Ahmad Ibrahim', 'Ahmad Ibrahim', 'spouse', '1990-05-15', false),
  (2, 'Aisha Ibrahim', 'Aisha Ibrahim', 'child', '2015-09-20', true),
  (2, 'Hassan Ibrahim', 'Hassan Ibrahim', 'child', '2018-03-12', true)
ON CONFLICT DO NOTHING;

-- Notifications
INSERT INTO notifications ("userId", type, title, description) VALUES
  (2, 'claim', 'Claim CLM-2026-0001 Approved', 'Your motor claim has been approved. Payout of ₦450,000 is being processed.'),
  (2, 'policy', 'Policy Renewal Reminder', 'Your Motor Comprehensive policy POL-2026-0001 expires on Jan 14, 2027.'),
  (3, 'claim', 'New Claim Submitted', 'Your dental claim CLM-2026-0003 has been received and is under review.'),
  (4, 'claim', 'Claim CLM-2026-0004 Approved', 'Your property claim has been approved. Payout of ₦1,500,000 processed.'),
  (5, 'claim', 'Claim CLM-2026-0005 Rejected', 'Your business claim was rejected. Please review the policy terms.'),
  (1, 'system', 'System Update', 'InsurePortal v2.2.0 deployed with enhanced security features.'),
  (2, 'payment', 'Payment Received', 'Premium payment of ₦85,000 received for POL-2026-0001.'),
  (6, 'commission', 'Commission Earned', 'You earned ₦8,500 commission on policy POL-2026-0001.')
ON CONFLICT DO NOTHING;

-- Reinsurance
INSERT INTO reinsurance_treaties (id, name, "treatyName", treaty_type, "treatyType", reinsurer, retention, "retentionLimit", "coverLimit", "commissionRate", "effectiveDate", "expiryDate", status) VALUES
  (1, 'Quota Share 2026', 'Quota Share 2026', 'quota_share', 'quota_share', 'Africa Re', 5000000.00, 5000000.00, 50000000.00, 0.25, '2026-01-01', '2026-12-31', 'active'),
  (2, 'Surplus Treaty 2026', 'Surplus Treaty 2026', 'surplus', 'surplus', 'Munich Re', 10000000.00, 10000000.00, 100000000.00, 0.20, '2026-01-01', '2026-12-31', 'active'),
  (3, 'Catastrophe XL', 'Catastrophe XL', 'excess_of_loss', 'excess_of_loss', 'Swiss Re', 20000000.00, 20000000.00, 200000000.00, 0.15, '2026-01-01', '2026-12-31', 'active')
ON CONFLICT (id) DO NOTHING;
SELECT setval('reinsurance_treaties_id_seq', 3, true);

INSERT INTO reinsurance_cessions ("treatyId", "policyId", ceded_premium, ceded_liability, status) VALUES
  (1, 1, 21250.00, 3750000.00, 'active'),
  (1, 3, 37500.00, 3750000.00, 'active'),
  (2, 6, 27500.00, 17500000.00, 'active'),
  (2, 12, 60000.00, 40000000.00, 'active'),
  (3, 7, 47500.00, 10000000.00, 'active')
ON CONFLICT DO NOTHING;

-- IFRS 17 Data
INSERT INTO ifrs17_contract_groups (id, group_code, group_name, measurement_model, is_onerous, reporting_period) VALUES
  (1, 'GRP-MOTOR', 'Motor Insurance Group', 'GMM', false, '2026-Q2'),
  (2, 'GRP-HEALTH', 'Health Insurance Group', 'PAA', false, '2026-Q2'),
  (3, 'GRP-LIFE', 'Life Insurance Group', 'GMM', false, '2026-Q2'),
  (4, 'GRP-PROP', 'Property Insurance Group', 'PAA', false, '2026-Q2'),
  (5, 'GRP-MICRO', 'Microinsurance Group', 'PAA', true, '2026-Q2')
ON CONFLICT (id) DO NOTHING;
SELECT setval('ifrs17_contract_groups_id_seq', 5, true);

INSERT INTO ifrs17_contracts (contract_group, measurement_model, reporting_period, premium_allocated, claims_incurred, risk_adjustment, csm_balance) VALUES
  (1, 'GMM', '2026-Q2', 188000.00, 570000.00, 18800.00, 45000.00),
  (2, 'PAA', '2026-Q2', 215000.00, 430000.00, 21500.00, 0.00),
  (3, 'GMM', '2026-Q2', 40000.00, 50000000.00, 4000.00, 120000.00),
  (4, 'PAA', '2026-Q2', 55000.00, 1500000.00, 5500.00, 0.00),
  (5, 'PAA', '2026-Q2', 1200.00, 0.00, 120.00, 0.00)
ON CONFLICT DO NOTHING;

INSERT INTO ifrs17_csm_rollforward (group_code, reporting_period, opening_csm, new_business, changes_estimate, finance_effect, recognized, closing_csm, loss_component) VALUES
  ('GRP-MOTOR', '2026-Q2', 50000.00, 15000.00, -5000.00, 2000.00, -17000.00, 45000.00, 0.00),
  ('GRP-LIFE', '2026-Q2', 100000.00, 30000.00, -10000.00, 8000.00, -8000.00, 120000.00, 0.00),
  ('GRP-MICRO', '2026-Q2', 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 500.00)
ON CONFLICT DO NOTHING;

INSERT INTO ifrs17_pnl (group_code, group_name, reporting_period, insurance_revenue, insurance_service_expense, insurance_service_result, insurance_finance_expense, investment_income, net_financial_result) VALUES
  ('GRP-MOTOR', 'Motor Insurance Group', '2026-Q2', 188000.00, -135000.00, 53000.00, -8000.00, 12000.00, 4000.00),
  ('GRP-HEALTH', 'Health Insurance Group', '2026-Q2', 215000.00, -180000.00, 35000.00, -5000.00, 8000.00, 3000.00),
  ('GRP-LIFE', 'Life Insurance Group', '2026-Q2', 40000.00, -25000.00, 15000.00, -3000.00, 15000.00, 12000.00),
  ('GRP-PROP', 'Property Insurance Group', '2026-Q2', 55000.00, -42000.00, 13000.00, -2000.00, 5000.00, 3000.00)
ON CONFLICT DO NOTHING;

-- Actuarial
INSERT INTO actuarial_calculations ("calculationType", model_type, parameters, result) VALUES
  ('Loss Ratio', 'loss_ratio', '{"product":"motor","period":"2026-Q2"}', '62.3'),
  ('Solvency Margin', 'solvency', '{"method":"rbc"}', '185'),
  ('Reserve', 'reserve', '{"method":"chain_ladder","triangle":"paid"}', '{"ibnr":2500000,"ultimate":8500000}'),
  ('Pricing', 'pricing', '{"product":"health","age_band":"30-39"}', '{"pure_premium":42000,"loaded_premium":65000}')
ON CONFLICT DO NOTHING;

INSERT INTO mcmc_simulations (simulation_id, model_type, iterations, "burnIn", converged, "rHat", "effectiveSampleSize", "posteriorMeans", "credibleIntervals") VALUES
  ('SIM-001', 'bayesian_loss_reserve', 50000, 10000, true, 1.02, 4500, '{"mu":2500000,"sigma":350000}', '{"lower":1850000,"upper":3200000}'),
  ('SIM-002', 'bayesian_pricing', 100000, 20000, true, 1.01, 8500, '{"base_rate":0.045,"risk_load":0.012}', '{"lower":0.038,"upper":0.055}')
ON CONFLICT DO NOTHING;

-- NAICOM Regulatory
INSERT INTO naicom_filings ("filingType", "filingRef", reporting_period, status, "submittedAt") VALUES
  ('quarterly_return', 'NAICOM-QR-2026-Q1', '2026-Q1', 'Approved', '2026-04-15'),
  ('annual_return', 'NAICOM-AR-2025', '2025', 'Approved', '2026-03-31'),
  ('quarterly_return', 'NAICOM-QR-2026-Q2', '2026-Q2', 'draft', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO naicom_financial_reports (report_type, period, status, data) VALUES
  ('balance_sheet', '2026-Q1', 'submitted', '{"total_assets":850000000,"total_liabilities":420000000,"equity":430000000}'),
  ('income_statement', '2026-Q1', 'submitted', '{"gross_premium":125000000,"net_premium":95000000,"claims_paid":62000000}'),
  ('solvency_margin', '2026-Q1', 'submitted', '{"available_capital":430000000,"required_capital":210000000,"solvency_ratio":2.05}')
ON CONFLICT DO NOTHING;

INSERT INTO naicom_reporting_schedule (report_type, frequency, due_date, status, circular_ref, penalty_amount) VALUES
  ('quarterly_return', 'quarterly', '2026-07-31', 'pending', 'NAICOM/CIR/2026/01', 500000.00),
  ('annual_return', 'annual', '2027-03-31', 'pending', 'NAICOM/CIR/2025/12', 2000000.00),
  ('risk_based_capital', 'semi_annual', '2026-09-30', 'pending', 'NAICOM/CIR/2026/03', 1000000.00)
ON CONFLICT DO NOTHING;

INSERT INTO naicom_returns ("returnType", "reportingPeriod", "submissionDate", "submissionRef", "naicomAckRef", "dueDate", status) VALUES
  ('quarterly', '2026-Q1', '2026-04-15', 'QR-2026-Q1', 'NAI-ACK-001', '2026-04-30', 'submitted'),
  ('annual', '2025', '2026-03-31', 'AR-2025', 'NAI-ACK-002', '2026-03-31', 'submitted')
ON CONFLICT DO NOTHING;

-- Compliance
INSERT INTO compliance_filings (filing_type, reference_number, reporting_period, submitted_to, total_transactions, total_amount, status, submitted_at) VALUES
  ('aml_ctr', 'CTR-2026-001', '2026-Q1', 'NFIU', 15, 45000000.00, 'submitted', '2026-04-10'),
  ('aml_str', 'STR-2026-001', '2026-Q1', 'NFIU', 2, 8500000.00, 'submitted', '2026-04-05')
ON CONFLICT DO NOTHING;

INSERT INTO compliance_reports ("reportType", period, status, "totalAlerts", "highAlerts", "mediumAlerts", "lowAlerts") VALUES
  ('aml', '2026-Q1', 'completed', 15, 2, 5, 8),
  ('fraud', '2026-Q1', 'completed', 8, 1, 3, 4)
ON CONFLICT DO NOTHING;

-- Approval Workflows
INSERT INTO approval_chains (id, name, entity_type, threshold_amount, steps, is_active) VALUES
  (1, 'Claim Approval - Standard', 'claim', 500000.00, '[{"step":1,"role":"claims_officer","action":"review"},{"step":2,"role":"manager","action":"approve"}]', true),
  (2, 'Claim Approval - High Value', 'claim', 5000000.00, '[{"step":1,"role":"claims_officer","action":"review"},{"step":2,"role":"manager","action":"review"},{"step":3,"role":"director","action":"approve"}]', true),
  (3, 'Policy Issuance', 'policy', 0, '[{"step":1,"role":"underwriter","action":"assess"},{"step":2,"role":"manager","action":"approve"}]', true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('approval_chains_id_seq', 3, true);

INSERT INTO approval_requests (chain_id, entity_type, entity_id, submitted_by, current_step, status, notes, submitted_at, completed_at) VALUES
  (1, 'claim', 1, 2, 2, 'approved', 'Standard motor claim - approved', '2026-03-01', '2026-03-10'),
  (2, 'claim', 4, 4, 3, 'approved', 'High value property claim', '2026-05-01', '2026-05-15'),
  (1, 'claim', 2, 2, 1, 'pending', 'Health claim under review', '2026-06-01', NULL),
  (1, 'claim', 3, 3, 1, 'pending', 'Dental claim submitted', '2026-06-05', NULL)
ON CONFLICT DO NOTHING;

-- Workflow Definitions
INSERT INTO workflow_definitions (id, name, entity_type, states, transitions, is_active) VALUES
  (1, 'Claims Processing', 'claim', '["submitted","under_review","approved","rejected","paid","closed"]', '[{"from":"submitted","to":"under_review","trigger":"assign"}]', true),
  (2, 'Policy Lifecycle', 'policy', '["draft","pending_approval","active","expired","cancelled","renewed"]', '[{"from":"draft","to":"pending_approval","trigger":"submit"}]', true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('workflow_definitions_id_seq', 2, true);

INSERT INTO workflow_instances (workflow_id, entity_type, entity_id, current_state, assigned_to, history) VALUES
  (1, 'claim', 1, 'paid', 9, '[{"state":"submitted","at":"2026-03-01"},{"state":"paid","at":"2026-03-15"}]'),
  (1, 'claim', 2, 'under_review', 9, '[{"state":"submitted","at":"2026-06-01"}]'),
  (1, 'claim', 3, 'submitted', NULL, '[{"state":"submitted","at":"2026-06-05"}]'),
  (2, 'policy', 1, 'active', NULL, '[{"state":"draft","at":"2026-01-10"},{"state":"active","at":"2026-01-15"}]')
ON CONFLICT DO NOTHING;

-- Audit Trail
INSERT INTO audit_trail (action, "entityType", "entityId", "userId", details) VALUES
  ('create', 'policy', 1, 6, '{"policy_number":"POL-2026-0001"}'),
  ('create', 'claim', 1, 2, '{"claim_number":"CLM-2026-0001","amount":450000}'),
  ('approve', 'claim', 1, 9, '{"approved_amount":450000}'),
  ('payout', 'claim', 1, 10, '{"reference":"PAY-BNK-001","amount":450000}'),
  ('login', 'user', 1, 1, '{"ip":"192.168.1.1","method":"password"}')
ON CONFLICT DO NOTHING;

-- Underwriting
INSERT INTO underwriting_rules ("productType", "ruleName", "ruleType", conditions, action, "isActive") VALUES
  ('Motor', 'Motor Age Eligibility', 'eligibility', '{"min_age":18,"max_age":70}', '{"reason":"Applicant age outside acceptable range"}', true),
  ('Motor', 'No Tracker Loading', 'pricing', '{"has_tracker":false}', '{"loading_pct":15}', true),
  ('Motor', 'Young Driver Loading', 'pricing', '{"driver_age_under":25}', '{"loading_pct":20}', true),
  ('Motor', 'No Claims Discount', 'pricing', '{"claims_free_years_min":1}', '{"discount_pct_per_year":5,"max_discount":60}', true),
  ('Motor', 'Fleet Discount', 'pricing', '{"fleet_size_min":5}', '{"discount_pct":10}', true),
  ('Motor', 'Vehicle Age Limit', 'eligibility', '{"max_vehicle_age":15}', '{"reason":"Vehicle exceeds maximum age"}', true),
  ('Life', 'Life Age Eligibility', 'eligibility', '{"min_age":18,"max_age":75}', '{"reason":"Applicant age outside acceptable range"}', true),
  ('Life', 'Smoker Loading', 'pricing', '{"is_smoker":true}', '{"loading_pct":35}', true),
  ('Life', 'Hazardous Occupation', 'pricing', '{"occupation_class":"hazardous"}', '{"loading_pct":40}', true),
  ('Life', 'Medical Exam Required', 'eligibility', '{"sum_assured_threshold":10000000}', '{"reason":"Medical exam required for high sum assured"}', true),
  ('Life', 'Income Multiple Limit', 'limit', '{"income_multiple_max":15}', '{"reason":"Sum assured limited to 15x annual income"}', true),
  ('Health', 'Health Age Eligibility', 'eligibility', '{"min_age":0,"max_age":80}', '{"reason":"Applicant age outside acceptable range"}', true),
  ('Health', 'Pre-existing Condition Loading', 'pricing', '{"has_pre_existing":true}', '{"loading_pct":30,"reason":"Pre-existing condition exclusion period: 24 months"}', true),
  ('Property', 'Wooden Construction Loading', 'pricing', '{"construction":"wooden"}', '{"loading_pct":25}', true),
  ('Property', 'Fire Protection Discount', 'pricing', '{"has_fire_alarm":true,"has_sprinkler":true}', '{"discount_pct":15}', true),
  ('All', 'Sum Assured Cap', 'limit', '{"income_multiple_max":20}', '{"reason":"Sum assured limited to 20x annual income"}', true)
ON CONFLICT DO NOTHING;

INSERT INTO underwriting_decisions ("applicationId", "customerId", "productType", decision, "riskScore", "riskCategory", "premiumLoading", "rulesApplied") VALUES
  (1, 2, 'motor', 'approved', 35.50, 'low', 0.00, '["Age Restriction"]'),
  (2, 3, 'health', 'approved', 42.00, 'medium', 0.10, '["Pre-existing Conditions"]')
ON CONFLICT DO NOTHING;

-- Premium Rate Tables
INSERT INTO premium_rate_tables ("productType", age_band, "baseRate", risk_factor, "effectiveDate") VALUES
  ('motor', '18-25', 0.0550, 1.40, '2026-01-01'),
  ('motor', '26-35', 0.0450, 1.00, '2026-01-01'),
  ('motor', '36-50', 0.0400, 0.90, '2026-01-01'),
  ('health', '18-25', 0.0350, 0.80, '2026-01-01'),
  ('health', '26-35', 0.0420, 1.00, '2026-01-01'),
  ('health', '36-50', 0.0550, 1.20, '2026-01-01'),
  ('life', '26-35', 0.0250, 1.00, '2026-01-01'),
  ('life', '36-50', 0.0350, 1.30, '2026-01-01')
ON CONFLICT DO NOTHING;

-- System Settings
INSERT INTO system_settings (key, value, category, description, updated_by) VALUES
  ('maintenance_mode', 'false', 'system', 'Enable/disable maintenance mode', 1),
  ('default_currency', 'NGN', 'finance', 'Default currency for transactions', 1),
  ('max_claim_auto_approve', '500000', 'claims', 'Maximum claim amount for auto-approval', 1),
  ('kyc_verification_provider', 'smile_identity', 'kyc', 'Third-party KYC verification provider', 1),
  ('notification_channels', '["email","sms","push"]', 'notifications', 'Enabled notification channels', 1)
ON CONFLICT DO NOTHING;

-- Bancassurance & Embedded Partners
INSERT INTO bancassurance_partners (id, bank_name, "bankName", "bankCode", partner_code, integration_type, status) VALUES
  (1, 'First Bank of Nigeria', 'First Bank of Nigeria', 'FBN', 'FBN-001', 'api', 'active'),
  (2, 'GTBank', 'GTBank', 'GTB', 'GTB-001', 'api', 'active'),
  (3, 'Access Bank', 'Access Bank', 'ACC', 'ACC-001', 'webhook', 'active')
ON CONFLICT (id) DO NOTHING;
SELECT setval('bancassurance_partners_id_seq', 3, true);

INSERT INTO embedded_partners (id, name, "partnerName", type, integration_type, status, total_policies, monthly_revenue) VALUES
  (1, 'Jumia', 'Jumia', 'ecommerce', 'api', 'active', 450, 2500000.00),
  (2, 'Bolt', 'Bolt', 'ride_hailing', 'webhook', 'active', 1200, 6000000.00),
  (3, 'Kuda Bank', 'Kuda Bank', 'neobank', 'api', 'active', 800, 4200000.00)
ON CONFLICT (id) DO NOTHING;
SELECT setval('embedded_partners_id_seq', 3, true);

INSERT INTO embedded_distribution (partner_id, "partnerName", "channelName", "productTypes", "integrationType", "commissionRate", "apiVersion", "monthlyPolicies", "monthlyPremium", channel, status) VALUES
  (1, 'Jumia', 'Jumia Marketplace', '["travel","gadget"]', 'api', 0.15, 'v2', 150, 1200000.00, 'marketplace', 'active'),
  (2, 'Bolt', 'Bolt Rides', '["motor","personal_accident"]', 'webhook', 0.08, 'v1', 1200, 6000000.00, 'ride_hailing', 'active'),
  (3, 'Kuda Bank', 'Kuda App', '["savings","life"]', 'api', 0.12, 'v2', 800, 4200000.00, 'neobank', 'active')
ON CONFLICT DO NOTHING;

-- Fraud & Risk
INSERT INTO fraud_alerts ("alertId", "entityType", "entityId", alert_type, severity, score, details, status) VALUES
  ('FRD-001', 'claim', 5, 'duplicate_claim', 'high', 85.50, '{"reason":"Similar claim submitted 30 days ago"}', 'investigating'),
  ('FRD-002', 'claim', 8, 'high_value', 'medium', 62.30, '{"reason":"Claim amount exceeds 100x annual premium"}', 'open'),
  ('FRD-003', 'user', 4, 'velocity', 'low', 35.00, '{"reason":"Multiple policy applications in 24 hours"}', 'resolved')
ON CONFLICT DO NOTHING;

INSERT INTO score_improvement_tips (category, suggestion, impact, priority) VALUES
  ('claims', 'Maintain a claims-free record for at least 1 year', 'high', 1),
  ('payment', 'Set up automatic premium payments', 'medium', 2),
  ('coverage', 'Bundle multiple insurance products', 'medium', 3),
  ('loyalty', 'Refer friends and family to earn bonus points', 'low', 4)
ON CONFLICT DO NOTHING;

-- Training & Gamification
INSERT INTO training_courses (id, title, description, category, duration_hours, is_active) VALUES
  (1, 'Insurance Fundamentals', 'Core insurance concepts and terminology', 'foundation', 8, true),
  (2, 'Motor Claims Processing', 'How to assess and process motor claims', 'claims', 4, true),
  (3, 'Sales Techniques', 'Effective insurance sales strategies', 'sales', 6, true),
  (4, 'NAICOM Compliance', 'Regulatory compliance for insurance agents', 'compliance', 3, true)
ON CONFLICT (id) DO NOTHING;
SELECT setval('training_courses_id_seq', 4, true);

INSERT INTO training_enrollments (agent_id, course_id, status, progress, started_at) VALUES
  (1, 1, 'completed', 100, '2026-01-10'),
  (1, 2, 'in_progress', 60, '2026-05-01'),
  (2, 1, 'completed', 100, '2026-02-01'),
  (2, 3, 'in_progress', 45, '2026-04-15')
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_tiers (name, "minPoints", min_points, multiplier, benefits) VALUES
  ('Bronze', 0, 0, 1.0, '["Basic support","Monthly newsletter"]'),
  ('Silver', 1000, 1000, 1.5, '["Priority support","5% premium discount"]'),
  ('Gold', 5000, 5000, 2.0, '["Dedicated manager","10% premium discount"]'),
  ('Platinum', 15000, 15000, 3.0, '["VIP service","15% premium discount"]')
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_rewards (customer_id, activity, description, points, tier) VALUES
  (1, 'policy_purchase', 'Motor Comprehensive purchase', 850, 'Silver'),
  (1, 'claims_free_year', 'No claims in 2025', 500, 'Silver'),
  (2, 'policy_purchase', 'Health Family purchase', 1500, 'Gold'),
  (2, 'referral', 'Referred a new customer', 200, 'Gold')
ON CONFLICT DO NOTHING;

INSERT INTO achievements (id, name, description, "pointsReward", points) VALUES
  (1, 'First Policy', 'Purchased your first insurance policy', 100, 100),
  (2, 'Claims Free Year', 'Maintained zero claims for a full year', 500, 500),
  (3, 'Referral Champion', 'Referred 5 or more friends', 250, 250)
ON CONFLICT (id) DO NOTHING;
SELECT setval('achievements_id_seq', 3, true);

-- Disaster Recovery
INSERT INTO disaster_recovery_config (component, rto_hours, rpo_hours, replication_lag_seconds, last_test_date, last_test_result, status) VALUES
  ('database', 1, 0, 2, '2026-06-01', 'passed', 'configured'),
  ('application', 2, 1, 0, '2026-06-01', 'passed', 'configured'),
  ('storage', 4, 2, 5, '2026-05-15', 'passed', 'configured'),
  ('network', 1, 0, 0, '2026-06-01', 'passed', 'configured')
ON CONFLICT DO NOTHING;

-- ERP
INSERT INTO erpnext_transactions (transaction_type, reference, amount, status, data) VALUES
  ('journal_entry', 'JE-2026-001', 85000.00, 'synced', '{"debit":"Premium Receivable","credit":"Premium Income"}'),
  ('journal_entry', 'JE-2026-002', 450000.00, 'synced', '{"debit":"Claims Expense","credit":"Claims Payable"}'),
  ('payment_entry', 'PE-2026-001', 85000.00, 'synced', '{"party":"Adebayo Okonkwo","type":"Receive"}')
ON CONFLICT DO NOTHING;

INSERT INTO reconciliation_batches (batch_reference, source_type, type, total_records, matched_count, unmatched_count, discrepancy_count, total_amount, status, processed_at) VALUES
  ('REC-2026-001', 'paystack', 'premium', 25, 24, 1, 1, 3250000.00, 'completed', '2026-06-01'),
  ('REC-2026-002', 'bank', 'claim_payout', 8, 8, 0, 0, 2450000.00, 'completed', '2026-06-05')
ON CONFLICT DO NOTHING;

-- Communication
INSERT INTO communication_preferences (user_id, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, frequency, language) VALUES
  (2, true, true, true, true, 'instant', 'en'),
  (3, true, true, false, true, 'daily', 'en'),
  (4, true, false, true, false, 'weekly', 'en'),
  (5, true, true, true, true, 'instant', 'en')
ON CONFLICT DO NOTHING;

INSERT INTO whatsapp_messages (phone, direction, message_type, message, status) VALUES
  ('+2348012345001', 'outbound', 'text', 'Your claim CLM-2026-0001 has been approved.', 'delivered'),
  ('+2348012345002', 'outbound', 'text', 'Premium reminder for Health Family policy.', 'delivered')
ON CONFLICT DO NOTHING;

-- Knowledge Graph
INSERT INTO knowledge_entities (entity_name, entity_type, properties, connections) VALUES
  ('Motor Insurance', 'product_category', '{"risk_class":"A","regulatory":"mandatory"}', '[{"target":"NAICOM","relation":"regulated_by"}]'),
  ('NAICOM', 'regulator', '{"jurisdiction":"Nigeria","type":"insurance"}', '[{"target":"Motor Insurance","relation":"regulates"}]')
ON CONFLICT DO NOTHING;

-- Innovation & A/B Testing
INSERT INTO insuretech_innovations (name, category, description, status, adoption_pct) VALUES
  ('AI Claims Assessment', 'claims', 'Automated claims assessment using computer vision', 'pilot', 15.00),
  ('Parametric Insurance', 'product', 'Index-based insurance triggered by weather data', 'active', 25.00),
  ('Telematics UBI', 'motor', 'Usage-based insurance using telematics data', 'research', 5.00)
ON CONFLICT DO NOTHING;

INSERT INTO ab_tests (name, description, status, variants, "startDate", "endDate") VALUES
  ('Checkout Flow v2', 'Test simplified checkout vs current', 'active', '[{"name":"control","weight":0.5},{"name":"simplified","weight":0.5}]', '2026-06-01', '2026-07-01'),
  ('Premium Display', 'Monthly vs annual premium display', 'completed', '[{"name":"monthly","weight":0.5},{"name":"annual","weight":0.5}]', '2026-04-01', '2026-05-01')
ON CONFLICT DO NOTHING;

-- Agricultural Insurance
INSERT INTO agricultural_schemes (name, crop_type, region, coverage_type, "adminBody", "enrollmentCount", "maxPayout", status) VALUES
  ('NIRSAL Anchor Borrower', 'maize', 'North Central', 'index_based', 'NIRSAL', 2500, 10000000.00, 'active'),
  ('CACS Scheme', 'rice', 'North West', 'area_yield', 'CBN', 1800, 5000000.00, 'active'),
  ('Private Crop Insurance', 'cassava', 'South West', 'indemnity', 'Private', 500, 2000000.00, 'active')
ON CONFLICT DO NOTHING;

INSERT INTO agricultural_underwriting_rules (name, description, factor, weight, is_active) VALUES
  ('Rainfall Index', 'Based on seasonal rainfall deviation', 'weather', 0.35, true),
  ('NDVI Threshold', 'Vegetation index below trigger', 'satellite', 0.30, true),
  ('Soil Quality', 'Soil composition and fertility', 'soil', 0.20, true)
ON CONFLICT DO NOTHING;

INSERT INTO ndvi_readings (region, satellite, ndvi_value, ndvi, reading_date, status) VALUES
  ('North Central', 'Sentinel-2', 0.65, 0.65, '2026-06-01', 'normal'),
  ('North West', 'Sentinel-2', 0.45, 0.45, '2026-06-01', 'warning'),
  ('South West', 'Landsat-8', 0.72, 0.72, '2026-06-01', 'normal'),
  ('North East', 'Sentinel-2', 0.30, 0.30, '2026-06-01', 'critical')
ON CONFLICT DO NOTHING;

-- Takaful
INSERT INTO takaful_sharia_principles (name, category, description) VALUES
  ('Tabarru', 'contribution', 'Participants donate to a common fund for mutual help'),
  ('Wakalah', 'management', 'The operator manages the fund as an agent for a fee'),
  ('Mudharabah', 'investment', 'Profit-sharing between participants and operator')
ON CONFLICT DO NOTHING;

INSERT INTO takaful_pools ("poolName", pool_name, "totalContributions", total_claims, surplus, "surplusDistributed", "wakalaFee", status) VALUES
  ('Family Takaful Pool', 'Family Takaful Pool', 15000000.00, 8000000.00, 7000000.00, 3500000.00, 0.10, 'active'),
  ('General Takaful Pool', 'General Takaful Pool', 25000000.00, 18000000.00, 7000000.00, 2000000.00, 0.12, 'active')
ON CONFLICT DO NOTHING;

-- Specialized
INSERT INTO microinsurance_policies (user_id, product_type, premium, coverage, status) VALUES
  (2, 'life_basic', 500.00, 200000.00, 'active'),
  (4, 'health_basic', 750.00, 150000.00, 'active')
ON CONFLICT DO NOTHING;

INSERT INTO sme_policies ("businessName", "businessType", "coverageAmount", "annualPremium", policy_type, premium, coverage, status) VALUES
  ('Nkechi Fashion Store', 'retail', 20000000.00, 95000.00, 'sme', 95000.00, 20000000.00, 'active'),
  ('Lagos Tech Hub', 'technology', 50000000.00, 180000.00, 'sme', 180000.00, 50000000.00, 'active')
ON CONFLICT DO NOTHING;

INSERT INTO p2p_pools (name, "poolName", "memberCount", members, "monthlyContribution", "coveragePerMember", "totalFund", total_fund, status) VALUES
  ('Friends & Family Pool', 'Friends & Family Pool', 12, 12, 5000.00, 500000.00, 60000.00, 60000.00, 'active'),
  ('Market Women Pool', 'Market Women Pool', 25, 25, 2000.00, 200000.00, 50000.00, 50000.00, 'active')
ON CONFLICT DO NOTHING;

INSERT INTO gig_coverage_policies (user_id, "planId", "planName", platform, "coverageType", status) VALUES
  (2, 'GIG-001', 'Ride Hailing Protection', 'Bolt', 'personal_accident', 'active'),
  (5, 'GIG-002', 'Delivery Rider Cover', 'Gokada', 'health', 'active')
ON CONFLICT DO NOTHING;

-- Geospatial & Performance
INSERT INTO geospatial_zones (name, risk_level, risk, polygon, "lossRatio", "affectedPolicies") VALUES
  ('Lagos Island', 'medium', 'medium', '[[6.4541,3.3947]]', 0.55, 45),
  ('Victoria Island', 'low', 'low', '[[6.4281,3.4127]]', 0.35, 30),
  ('Mainland Lagos', 'high', 'high', '[[6.4900,3.3500]]', 0.72, 80)
ON CONFLICT DO NOTHING;

INSERT INTO dynamic_pricing_history (product_id, "productType", "basePrice", "basePremium", "baseRate", "adjustedRate", "riskScore", "effectiveDate", reason) VALUES
  (1, 'motor', 45000.00, 45000.00, 0.045, 0.052, 65.00, '2026-06-01', 'High loss ratio in motor segment'),
  (4, 'health', 50000.00, 50000.00, 0.050, 0.048, 42.00, '2026-06-01', 'Improved claims experience')
ON CONFLICT DO NOTHING;

INSERT INTO performance_metrics (service_name, metric_type, value, unit, threshold_warning, threshold_critical) VALUES
  ('customer-portal', 'response_time', 45.00, 'ms', 200.00, 500.00),
  ('customer-portal', 'error_rate', 0.12, 'percent', 1.00, 5.00),
  ('database', 'query_time', 8.50, 'ms', 50.00, 100.00),
  ('database', 'connection_count', 15.00, 'count', 80.00, 95.00)
ON CONFLICT DO NOTHING;

-- Wallets & Savings
INSERT INTO wallets ("userId", balance, currency) VALUES
  (2, 125000.00, 'NGN'),
  (3, 85000.00, 'NGN'),
  (4, 50000.00, 'NGN'),
  (5, 200000.00, 'NGN')
ON CONFLICT DO NOTHING;

INSERT INTO savings_plans (user_id, name, "targetAmount", "currentAmount", "interestRate", frequency, status) VALUES
  (2, 'Emergency Fund', 1000000.00, 350000.00, 0.08, 'monthly', 'active'),
  (3, 'Premium Reserve', 500000.00, 180000.00, 0.06, 'monthly', 'active'),
  (5, 'Business Insurance Fund', 2000000.00, 750000.00, 0.10, 'weekly', 'active')
ON CONFLICT DO NOTHING;

-- Telematics
INSERT INTO telematics_devices (user_id, "deviceId", "driverId", "vehicleId", device_type, "engineStatus", "avgDailyKm", "speedingEvents", "harshBraking", "nightDriving", "installDate", "lastPing", status) VALUES
  (2, 'TEL-001', 'DRV-002', 'VEH-001', 'obd2', 'running', 45.50, 3, 5, 12.50, '2026-01-15', '2026-06-12', 'active'),
  (4, 'TEL-002', 'DRV-004', 'VEH-002', 'dashcam', 'parked', 32.00, 1, 2, 8.00, '2026-04-01', '2026-06-12', 'active')
ON CONFLICT DO NOTHING;

-- PFA
INSERT INTO pfa_integration (pfa_name, "rsaPin", "accountBalance", "employeeContribution", "employerContribution", "totalContributions", integration_type, "lastSync", status) VALUES
  ('ARM Pension', 'RSA-001-234567', 5500000.00, 2200000.00, 3300000.00, 5500000.00, 'api', '2026-06-01', 'active'),
  ('Stanbic IBTC Pension', 'RSA-002-345678', 3200000.00, 1200000.00, 2000000.00, 3200000.00, 'api', '2026-06-01', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO pfa_annuities (pfa_id, user_id, annuity_type, "monthlyPayout", "lumpSum", "startDate", monthly_amount, status) VALUES
  (1, 2, 'programmed', 150000.00, 0.00, '2026-01-01', 150000.00, 'active')
ON CONFLICT DO NOTHING;

-- Telco Credit Scores
INSERT INTO telco_credit_scores (phone, provider, score, data_points, "lastUpdated") VALUES
  ('+2348012345001', 'MTN', 720, '{"call_frequency":85,"data_usage":92,"payment_history":95}', '2026-06-01'),
  ('+2348012345003', 'Airtel', 580, '{"call_frequency":60,"data_usage":45,"payment_history":65}', '2026-06-01')
ON CONFLICT DO NOTHING;

-- NIIRA
INSERT INTO niira_registrations (policy_id, "registrationId", class_code, "complianceScore", "compulsoryProducts", "lastRenewal", "nextRenewal", status) VALUES
  (1, 'NIIRA-REG-001', 'MC', 95.00, '["motor_third_party"]', '2026-01-15', '2027-01-14', 'active'),
  (5, 'NIIRA-REG-002', 'MT', 88.00, '["motor_third_party"]', '2026-04-01', '2027-03-31', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO niira_insurance_classes (class_code, class_name, category, "applicableTo", "minPremium", description) VALUES
  ('MC', 'Motor Comprehensive', 'motor', '["private_vehicle","commercial_vehicle"]', 15000.00, 'Comprehensive motor vehicle insurance'),
  ('MT', 'Motor Third Party', 'motor', '["private_vehicle","commercial_vehicle"]', 5000.00, 'Third party only motor insurance')
ON CONFLICT DO NOTHING;

-- USSD
INSERT INTO ussd_sessions (session_id, phone, menu_level, current_input, response, status) VALUES
  ('USSD-001', '+2348012345001', 0, '', 'Welcome to InsurePortal. 1. Check Balance 2. Buy Insurance', 'completed'),
  ('USSD-002', '+2348012345003', 2, '1', 'Your policies: 1. Motor Third Party 2. Home Protection', 'active')
ON CONFLICT DO NOTHING;

-- Documents
INSERT INTO documents ("userId", "entityType", entity_id, "documentType", "fileName", "fileSize", status) VALUES
  (2, 'claim', 1, 'photo', 'damage_photo_1.jpg', 2048000, 'active'),
  (2, 'policy', 1, 'certificate', 'policy_cert_POL-2026-0001.pdf', 512000, 'active'),
  (3, 'kyc', 3, 'id_card', 'national_id.jpg', 1024000, 'active')
ON CONFLICT DO NOTHING;

-- Broker API Keys
INSERT INTO broker_api_keys (broker_name, "apiKey", permissions, "rateLimit", status) VALUES
  ('Leadway Brokers', 'brk_live_leadway_001', '["quote","bind","claims"]', 100, 'active'),
  ('AIICO Partners', 'brk_live_aiico_001', '["quote","bind"]', 50, 'active')
ON CONFLICT DO NOTHING;

-- Parametric Triggers
INSERT INTO parametric_triggers (trigger_type, region, threshold, current_value, "affectedPolicies", triggered) VALUES
  ('rainfall', 'North Central', 200.00, 180.00, 45, false),
  ('temperature', 'North East', 42.00, 44.50, 12, true),
  ('flood_level', 'South South', 3.50, 2.80, 30, false)
ON CONFLICT DO NOTHING;

-- Agricultural Trigger Events
INSERT INTO agricultural_trigger_events (scheme_id, event_type, threshold, "dataSource", "affectedPolicies", "totalExposure", "payoutAmount", "payoutTriggered") VALUES
  (1, 'drought', 0.40, 'satellite_ndvi', 150, 25000000.00, 5000000.00, false),
  (2, 'flood', 3.00, 'river_gauge', 80, 12000000.00, 3000000.00, true)
ON CONFLICT DO NOTHING;

-- Emergency
INSERT INTO emergency_incidents ("userId", "incidentType", type, name, location, status) VALUES
  (2, 'accident', 'motor', 'Motor accident on Third Mainland Bridge', 'Third Mainland Bridge, Lagos', 'resolved'),
  (5, 'fire', 'property', 'Shop fire incident', 'Balogun Market, Lagos', 'reported')
ON CONFLICT DO NOTHING;

-- Referrals
INSERT INTO referrals ("referrerId", "referredEmail", referral_code, status, "rewardAmount") VALUES
  (2, 'friend1@email.com', 'REF-ADE-001', 'completed', 1000.00),
  (3, 'friend2@email.com', 'REF-FAT-001', 'pending', 0.00),
  (5, 'friend3@email.com', 'REF-AMI-001', 'completed', 1000.00)
ON CONFLICT DO NOTHING;

-- Customer Feedback
INSERT INTO customer_feedback ("userId", "feedbackType", type, rating, comment, status) VALUES
  (2, 'service', 'service', 5, 'Excellent claims processing experience', 'reviewed'),
  (3, 'product', 'product', 4, 'Good health coverage options', 'reviewed'),
  (4, 'complaint', 'complaint', 2, 'Slow KYC verification process', 'open')
ON CONFLICT DO NOTHING;

-- Currency Rates
INSERT INTO currency_rates (from_currency, "from", "to", rate, "lastUpdated") VALUES
  ('NGN', 'NGN', 'USD', 0.00065, '2026-06-12'),
  ('NGN', 'NGN', 'GBP', 0.00052, '2026-06-12'),
  ('USD', 'USD', 'NGN', 1540.00, '2026-06-12')
ON CONFLICT DO NOTHING;

-- Health Programs
INSERT INTO health_programs (name, program_type, "enrolledCount", "pointsReward", status, participants) VALUES
  ('Walk & Earn', 'fitness', 450, 10, 'active', 450),
  ('Health Screening', 'preventive', 200, 50, 'active', 200)
ON CONFLICT DO NOTHING;

-- ERP Config
INSERT INTO erp_config (id, config_key, "erpType", "baseUrl", "apiKey", "syncEnabled", "syncIntervalMinutes", "syncTransactions", "syncInventory", "syncAgents") VALUES
  (1, 'erpnext', 'ERPNext', 'https://erp.insureportal.ng', 'erp-api-key-demo', true, 15, true, true, true)
ON CONFLICT (id) DO NOTHING;

-- AB Experiments
INSERT INTO ab_experiments (id, test_id, variant, "sampleSize", "trafficSplit", "variantA", "variantB", "variantAConversion", "variantBConversion", "startDate", "endDate") VALUES
  (1, 1001, 'A', 5000, 50, 'Original Checkout', 'Streamlined Checkout', 3.2, 4.1, '2026-05-01', '2026-06-01'),
  (2, 1002, 'B', 3000, 50, 'Monthly Display', 'Annual Display', 2.8, 3.5, '2026-06-01', '2026-07-01')
ON CONFLICT (id) DO NOTHING;

-- Fix sequences after explicit-id inserts (prevents duplicate key errors)
DO $$
DECLARE
    r RECORD;
    max_val BIGINT;
BEGIN
    FOR r IN
        SELECT c.table_name, pg_get_serial_sequence(c.table_name, 'id') as seq_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = 'public'
        WHERE c.column_name = 'id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND pg_get_serial_sequence(c.table_name, 'id') IS NOT NULL
    LOOP
        BEGIN
            EXECUTE format('SELECT COALESCE(MAX(id), 1) FROM %I', r.table_name) INTO max_val;
            PERFORM setval(r.seq_name, max_val);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END $$;

COMMIT;
