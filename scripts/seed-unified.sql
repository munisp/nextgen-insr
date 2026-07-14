-- NextGen Insurance Platform — Unified Seed Script
-- Covers core tables with realistic Nigerian insurance data
-- Run: psql $DATABASE_URL -f scripts/seed-unified.sql

-- Enable pgcrypto for PII encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. CORE: Users & KYC
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO users (id, name, email, role, "passwordHash", phone, "createdAt", "updatedAt")
VALUES
  (1, 'Adebayo Ogunlesi', 'adebayo@insureportal.ng', 'admin', '$2a$12$LJ3P3jvG5qYqp0M5r5NuEeqjK9FwVqH3z0bXjK4rFw2P8nX4PqW.K', '+2348012345601', NOW(), NOW()),
  (2, 'Chioma Nwosu', 'chioma@insureportal.ng', 'user', '$2a$12$LJ3P3jvG5qYqp0M5r5NuEeqjK9FwVqH3z0bXjK4rFw2P8nX4PqW.K', '+2348012345602', NOW(), NOW()),
  (3, 'Ibrahim Musa', 'ibrahim@insureportal.ng', 'user', '$2a$12$LJ3P3jvG5qYqp0M5r5NuEeqjK9FwVqH3z0bXjK4rFw2P8nX4PqW.K', '+2348012345603', NOW(), NOW()),
  (4, 'Funke Akindele', 'funke@insureportal.ng', 'user', '$2a$12$LJ3P3jvG5qYqp0M5r5NuEeqjK9FwVqH3z0bXjK4rFw2P8nX4PqW.K', '+2348012345604', NOW(), NOW()),
  (5, 'Emeka Okafor', 'emeka@insureportal.ng', 'supervisor', '$2a$12$LJ3P3jvG5qYqp0M5r5NuEeqjK9FwVqH3z0bXjK4rFw2P8nX4PqW.K', '+2348012345605', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- KYC profiles with SHA-256 hashed BVN/NIN
INSERT INTO kyc_profiles (id, "userId", "kycLevel", "kycStatus", "bvnVerified", "ninVerified", "phoneVerified", "addressVerified", "idDocVerified", "facialMatchScore", "riskRating", "pepStatus", "sanctionsCheck", bvn, nin, "dateOfBirth", occupation, "annualIncome", "sourceOfFunds", "lastVerificationDate", "nextReviewDate", "createdAt", "updatedAt")
VALUES
  (1, 1, 3, 'verified', true, true, true, true, true, 98.50, 'low', false, false, encode(digest('22212345601','sha256'),'hex'), encode(digest('10012345601','sha256'),'hex'), '1985-03-15', 'Insurance Executive', 25000000, 'Employment', NOW() - interval '30 days', NOW() + interval '335 days', NOW(), NOW()),
  (2, 2, 2, 'verified', true, true, true, false, false, 92.30, 'standard', false, false, encode(digest('22212345602','sha256'),'hex'), encode(digest('10012345602','sha256'),'hex'), '1990-07-22', 'Software Engineer', 15000000, 'Employment', NOW() - interval '60 days', NOW() + interval '670 days', NOW(), NOW()),
  (3, 3, 1, 'in_progress', true, false, true, false, false, NULL, 'standard', false, false, encode(digest('22212345603','sha256'),'hex'), NULL, '1988-11-10', 'Insurance Agent', 5000000, 'Commission', NOW() - interval '90 days', NULL, NOW(), NOW()),
  (4, 4, 0, 'pending', false, false, false, false, false, NULL, 'unscreened', false, false, NULL, NULL, '1995-01-30', NULL, NULL, NULL, NULL, NULL, NOW(), NOW()),
  (5, 5, 3, 'verified', true, true, true, true, true, 96.70, 'low', false, false, encode(digest('22212345605','sha256'),'hex'), encode(digest('10012345605','sha256'),'hex'), '1982-09-05', 'Insurance Broker', 30000000, 'Business', NOW() - interval '15 days', NOW() + interval '350 days', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET bvn = EXCLUDED.bvn, nin = EXCLUDED.nin;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. INSURANCE PRODUCTS
-- ══════════════════════════════════════════════════════════════════════════════
-- Columns: id, code, name, category, subCategory, description, coverageType, minPremium, maxPremium, minSumAssured, maxSumAssured, minAge, maxAge, minTerm, maxTerm, termUnit, requiredDocuments, requiredKycLevel, naicomClass, naicomApprovalRef, benefits, exclusions, ratingFactors, isCompulsory, status, effectiveDate, expiryDate, createdAt, updatedAt

INSERT INTO insurance_products (id, code, name, category, "subCategory", description, "coverageType", "minPremium", "maxPremium", "minSumAssured", "maxSumAssured", "minAge", "maxAge", "minTerm", "maxTerm", "termUnit", "requiredDocuments", "requiredKycLevel", "naicomClass", "naicomApprovalRef", benefits, exclusions, "ratingFactors", "isCompulsory", status, "effectiveDate", "expiryDate", "createdAt", "updatedAt")
VALUES
  (1, 'MOT-COMP', 'Motor Comprehensive Plus', 'Motor', 'Comprehensive', 'Full comprehensive motor insurance with roadside assistance', 'comprehensive', 45000, 500000, 1000000, 10000000, 18, 70, 12, 12, 'months', '["vehicle_papers","drivers_license"]', 1, 'motor', 'NAICOM/MOT/2026/001', '["collision","theft","third_party","roadside"]', '["racing","commercial_use_without_endorsement"]', '["vehicle_value","driver_age","claims_history"]', true, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (2, 'HLT-BASIC', 'Basic Health Shield', 'Health', 'Individual', 'Essential health coverage for individuals and families', 'indemnity', 35000, 250000, 500000, 5000000, 0, 65, 12, 12, 'months', '["medical_report"]', 1, 'health', 'NAICOM/HLT/2026/002', '["hospitalization","surgery","outpatient"]', '["pre_existing_conditions_first_year","cosmetic"]', '["age","bmi","smoking_status"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (3, 'LIF-TERM', 'Term Life Assurance', 'Life', 'Term', 'Term life assurance with critical illness rider', 'sum_assured', 50000, 1000000, 5000000, 100000000, 18, 65, 60, 360, 'months', '["medical_report","id_document"]', 2, 'life', 'NAICOM/LIF/2026/003', '["death_benefit","critical_illness","disability"]', '["suicide_first_two_years","war","hazardous_sports"]', '["age","health","occupation","sum_assured"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (4, 'PRO-HOME', 'Home Property Guard', 'Property', 'Residential', 'Comprehensive residential property insurance', 'replacement', 25000, 200000, 2000000, 50000000, 18, 99, 12, 12, 'months', '["property_valuation","ownership_proof"]', 2, 'property', 'NAICOM/PRO/2026/004', '["fire","flood","burglary","natural_disaster"]', '["war","nuclear","wear_and_tear"]', '["property_value","location","construction_type"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (5, 'TRV-INTL', 'International Travel Cover', 'Travel', 'International', 'Comprehensive international travel insurance', 'indemnity', 15000, 100000, 500000, 10000000, 0, 80, 1, 365, 'days', '["passport","ticket"]', 1, 'travel', 'NAICOM/TRV/2026/005', '["medical_emergency","trip_cancellation","luggage","evacuation"]', '["pre_existing_conditions","extreme_sports"]', '["destination","duration","age"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (6, 'AGR-CROP', 'Crop Insurance Shield', 'Agriculture', 'Crop', 'Parametric crop insurance with weather triggers', 'parametric', 10000, 500000, 200000, 20000000, 18, 75, 3, 12, 'months', '["farm_registration","crop_plan"]', 1, 'agriculture', 'NAICOM/AGR/2026/006', '["drought","flood","pest","fire"]', '["negligence","illegal_crops"]', '["crop_type","acreage","region","historical_yield"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (7, 'MAR-CARGO', 'Marine Cargo Cover', 'Marine', 'Cargo', 'Marine cargo insurance for goods in transit', 'indemnity', 50000, 2000000, 5000000, 500000000, 18, 99, 1, 365, 'days', '["bill_of_lading","invoice","packing_list"]', 2, 'marine', 'NAICOM/MAR/2026/007', '["loss","damage","jettison","general_average"]', '["inherent_vice","delay","war"]', '["cargo_value","route","vessel_age"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (8, 'BIZ-LIAB', 'Business Liability Shield', 'Business', 'Liability', 'Professional and general liability for businesses', 'indemnity', 100000, 5000000, 10000000, 1000000000, 18, 99, 12, 12, 'months', '["cac_registration","financial_statements"]', 3, 'liability', 'NAICOM/BIZ/2026/008', '["professional_liability","general_liability","product_liability"]', '["criminal_acts","pollution","asbestos"]', '["revenue","industry","claims_history","employee_count"]', false, 'active', NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. POLICIES
-- ══════════════════════════════════════════════════════════════════════════════
-- Columns: id, userId, policyNumber, name, type, premium, status, startDate, expiryDate, sumAssured, coverageDetails, createdAt, updatedAt

INSERT INTO policies (id, "userId", "policyNumber", name, type, premium, status, "startDate", "expiryDate", "sumAssured", "coverageDetails", "createdAt", "updatedAt")
VALUES
  (1, 1, 'POL-2026-00001', 'Motor Comprehensive Plus', 'Auto', 85000, 'Active', NOW() - interval '6 months', NOW() + interval '6 months', 5000000, '{"vehicle":"Toyota Camry 2023","plate":"LAG-234AB"}', NOW(), NOW()),
  (2, 1, 'POL-2026-00002', 'Basic Health Shield', 'Health', 120000, 'Active', NOW() - interval '3 months', NOW() + interval '9 months', 2000000, '{"plan":"family","members":4}', NOW(), NOW()),
  (3, 1, 'POL-2026-00003', 'Term Life Assurance', 'Life', 350000, 'Active', NOW() - interval '1 year', NOW() + interval '19 years', 50000000, '{"beneficiary":"Chioma Ogunlesi","relationship":"spouse"}', NOW(), NOW()),
  (4, 2, 'POL-2026-00004', 'Home Property Guard', 'Property', 65000, 'Active', NOW() - interval '4 months', NOW() + interval '8 months', 15000000, '{"address":"12 Banana Island Road, Lagos","type":"duplex"}', NOW(), NOW()),
  (5, 2, 'POL-2026-00005', 'International Travel Cover', 'Health', 45000, 'Expired', NOW() - interval '8 months', NOW() - interval '2 months', 3000000, '{"destination":"UK","duration":"14 days"}', NOW(), NOW()),
  (6, 3, 'POL-2026-00006', 'Motor Comprehensive Plus', 'Auto', 55000, 'Active', NOW() - interval '2 months', NOW() + interval '10 months', 3000000, '{"vehicle":"Honda Accord 2022","plate":"ABJ-789CD"}', NOW(), NOW()),
  (7, 3, 'POL-2026-00007', 'Crop Insurance Shield', 'Agricultural', 200000, 'Active', NOW() - interval '1 month', NOW() + interval '5 months', 10000000, '{"farm":"Kano Rice Farm","hectares":50}', NOW(), NOW()),
  (8, 5, 'POL-2026-00008', 'Marine Cargo Cover', 'Property', 750000, 'Active', NOW() - interval '1 month', NOW() + interval '11 months', 100000000, '{"cargo":"Electronics","route":"Lagos-Rotterdam"}', NOW(), NOW()),
  (9, 5, 'POL-2026-00009', 'Business Liability Shield', 'Property', 1500000, 'Active', NOW() - interval '5 months', NOW() + interval '7 months', 500000000, '{"business":"Okafor Insurance Brokers","employees":25}', NOW(), NOW()),
  (10, 1, 'POL-2026-00010', 'Basic Health Shield', 'Health', 95000, 'Expired', NOW() - interval '14 months', NOW() - interval '2 months', 1500000, '{"plan":"individual"}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. CLAIMS
-- ══════════════════════════════════════════════════════════════════════════════
-- Columns: id, userId, policyId, claimNumber, amount, status, incidentDate, description, fraudScore, adjudicatorId, settlementAmount, createdAt, updatedAt

INSERT INTO claims (id, "userId", "policyId", "claimNumber", amount, status, "incidentDate", description, "fraudScore", "adjudicatorId", "settlementAmount", "createdAt", "updatedAt")
VALUES
  (1, 1, 1, 'CLM-2026-00001', 350000, 'Approved', NOW() - interval '45 days', 'Motor accident on Lekki-Epe Expressway — rear-end collision, bumper and taillight damage', 0.12, 1, 320000, NOW() - interval '45 days', NOW()),
  (2, 1, 2, 'CLM-2026-00002', 180000, 'Submitted', NOW() - interval '10 days', 'Hospital admission for malaria treatment — 3 days at Lagos University Teaching Hospital', 0.05, NULL, NULL, NOW() - interval '10 days', NOW()),
  (3, 2, 4, 'CLM-2026-00003', 1200000, 'Under Review', NOW() - interval '20 days', 'Flood damage to ground floor — furnishings and electrical systems destroyed during Lagos rainy season', 0.08, 1, NULL, NOW() - interval '20 days', NOW()),
  (4, 3, 6, 'CLM-2026-00004', 250000, 'Rejected', NOW() - interval '60 days', 'Windscreen replacement — stone chip damage on Third Mainland Bridge', 0.45, 1, 0, NOW() - interval '60 days', NOW()),
  (5, 5, 8, 'CLM-2026-00005', 5000000, 'Approved', NOW() - interval '30 days', 'Cargo damage during transit — 20% of electronics shipment water damaged in Lagos port', 0.03, 1, 4800000, NOW() - interval '30 days', NOW())
ON CONFLICT (id) DO NOTHING;

-- Claim evidence
INSERT INTO claim_evidence (id, "userId", "claimId", "evidenceType", "fileName", "fileUrl", description, status, "createdAt")
VALUES
  (1, 1, 1, 'photo', 'accident-front.jpg', '/uploads/claims/1/accident-front.jpg', 'Front view of vehicle damage', 'verified', NOW() - interval '44 days'),
  (2, 1, 1, 'photo', 'accident-rear.jpg', '/uploads/claims/1/accident-rear.jpg', 'Rear view showing bumper damage', 'verified', NOW() - interval '44 days'),
  (3, 1, 1, 'document', 'police-report.pdf', '/uploads/claims/1/police-report.pdf', 'Police accident report', 'verified', NOW() - interval '43 days'),
  (4, 1, 2, 'document', 'hospital-receipt.pdf', '/uploads/claims/2/hospital-receipt.pdf', 'LUTH admission receipt', 'pending', NOW() - interval '9 days'),
  (5, 2, 3, 'photo', 'flood-damage-1.jpg', '/uploads/claims/3/flood-damage-1.jpg', 'Ground floor flood damage', 'pending', NOW() - interval '19 days')
ON CONFLICT (id) DO NOTHING;

-- Claims payouts
INSERT INTO claims_payouts (id, "claimId", "beneficiaryName", "bankName", "accountNumber", amount, status, "approvedBy", "approvedAt", "paidAt", "paymentRef", "createdAt")
VALUES
  (1, 1, 'Adebayo Ogunlesi', 'First Bank of Nigeria', '2012345678', 320000, 'paid', 1, NOW() - interval '35 days', NOW() - interval '33 days', 'PAY-CLM-2026-00001', NOW() - interval '35 days'),
  (2, 5, 'Emeka Okafor', 'Zenith Bank', '1098765432', 4800000, 'paid', 1, NOW() - interval '20 days', NOW() - interval '18 days', 'PAY-CLM-2026-00005', NOW() - interval '20 days')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. AGENTS & COMMISSIONS
-- ══════════════════════════════════════════════════════════════════════════════
-- agents: id, userId, agentCode, licenseNumber, agencyName, region, tier, commissionRate, totalPoliciesSold, totalPremiumCollected, status, createdAt, updatedAt, role

INSERT INTO agents (id, "userId", "agentCode", "licenseNumber", "agencyName", region, tier, "commissionRate", "totalPoliciesSold", "totalPremiumCollected", status, "createdAt", "updatedAt", role)
VALUES
  (1, 3, 'AGT-001', 'NAICOM/AGT/2026/001', 'Musa Insurance Agency', 'North-West', 'Gold', 0.1500, 150, 45000000, 'active', NOW(), NOW(), 'agent'),
  (2, 5, 'AGT-002', 'NAICOM/BRK/2026/001', 'Okafor Insurance Brokers', 'South-East', 'Platinum', 0.1800, 320, 120000000, 'active', NOW(), NOW(), 'broker'),
  (3, 1, 'AGT-003', 'NAICOM/AGT/2026/003', 'Ogunlesi Financial Services', 'South-West', 'Silver', 0.1200, 85, 22000000, 'active', NOW(), NOW(), 'agent'),
  (4, 2, 'AGT-004', 'NAICOM/AGT/2026/004', 'Nwosu Digital Insurance', 'South-South', 'Bronze', 0.1000, 45, 8000000, 'active', NOW(), NOW(), 'agent'),
  (5, 4, 'AGT-005', 'NAICOM/AGT/2026/005', 'Akindele Insurance Hub', 'South-West', 'Silver', 0.1200, 60, 15000000, 'active', NOW(), NOW(), 'agent')
ON CONFLICT (id) DO NOTHING;

-- commission_rules: id, name, txType, ruleType, value, minAmount, maxAmount, tieredJson, agentTier, isActive, effectiveFrom, effectiveTo, createdAt, updatedAt
INSERT INTO commission_rules (id, name, "txType", "ruleType", value, "minAmount", "maxAmount", "tieredJson", "agentTier", "isActive", "effectiveFrom", "effectiveTo", "createdAt", "updatedAt")
VALUES
  (1, 'Motor Standard Commission', 'Insurance', 'percentage', 15.0000, 10000, 1000000, NULL, 'Silver', true, NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (2, 'Health Premium Commission', 'Insurance', 'percentage', 12.0000, 20000, 500000, NULL, 'Bronze', true, NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (3, 'Life Assurance Commission', 'Insurance', 'percentage', 20.0000, 50000, 5000000, NULL, 'Gold', true, NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW()),
  (4, 'Tiered Motor Commission', 'Insurance', 'tiered', 0.0000, NULL, NULL, '[{"from":0,"to":100000,"rate":10},{"from":100001,"to":500000,"rate":15},{"from":500001,"to":null,"rate":18}]', 'Platinum', true, NOW() - interval '1 year', NOW() + interval '1 year', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- agent_commissions: id, agentId, policyId, commissionAmount, commissionRate, status, paidAt, createdAt
INSERT INTO agent_commissions (id, "agentId", "policyId", "commissionAmount", "commissionRate", status, "paidAt", "createdAt")
VALUES
  (1, 1, 6, 8250.00, 0.1500, 'paid', NOW() - interval '50 days', NOW() - interval '55 days'),
  (2, 1, 7, 30000.00, 0.1500, 'pending', NULL, NOW() - interval '25 days'),
  (3, 2, 8, 135000.00, 0.1800, 'paid', NOW() - interval '20 days', NOW() - interval '25 days'),
  (4, 2, 9, 270000.00, 0.1800, 'paid', NOW() - interval '10 days', NOW() - interval '15 days'),
  (5, 3, 1, 10200.00, 0.1200, 'pending', NULL, NOW() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. PAYMENT TRANSACTIONS
-- ══════════════════════════════════════════════════════════════════════════════
-- payment_transactions: id, gateway, reference, amount, currency, type, status, metadata, customer_email, created_at

INSERT INTO payment_transactions (id, gateway, reference, amount, currency, type, status, metadata, customer_email, created_at)
VALUES
  (1, 'paystack', 'PAY-PS-2026-001', 85000, 'NGN', 'premium', 'success', '{"policyId":1,"channel":"card"}', 'adebayo@insureportal.ng', NOW() - interval '6 months'),
  (2, 'paystack', 'PAY-PS-2026-002', 120000, 'NGN', 'premium', 'success', '{"policyId":2,"channel":"bank_transfer"}', 'adebayo@insureportal.ng', NOW() - interval '3 months'),
  (3, 'flutterwave', 'PAY-FW-2026-001', 350000, 'NGN', 'premium', 'success', '{"policyId":3,"channel":"ussd"}', 'adebayo@insureportal.ng', NOW() - interval '1 year'),
  (4, 'paystack', 'PAY-PS-2026-003', 65000, 'NGN', 'premium', 'success', '{"policyId":4,"channel":"card"}', 'chioma@insureportal.ng', NOW() - interval '4 months'),
  (5, 'flutterwave', 'PAY-FW-2026-002', 55000, 'NGN', 'premium', 'success', '{"policyId":6,"channel":"bank_transfer"}', 'ibrahim@insureportal.ng', NOW() - interval '2 months'),
  (6, 'paystack', 'PAY-PS-2026-004', 750000, 'NGN', 'premium', 'success', '{"policyId":8,"channel":"card"}', 'emeka@insureportal.ng', NOW() - interval '1 month'),
  (7, 'paystack', 'PAY-PS-2026-005', 320000, 'NGN', 'claim_payout', 'success', '{"claimId":1,"channel":"bank_transfer"}', 'adebayo@insureportal.ng', NOW() - interval '33 days'),
  (8, 'flutterwave', 'PAY-FW-2026-003', 4800000, 'NGN', 'claim_payout', 'success', '{"claimId":5,"channel":"bank_transfer"}', 'emeka@insureportal.ng', NOW() - interval '18 days')
ON CONFLICT (id) DO NOTHING;

-- premium_collections: id, policyId, customerId, amount, paymentMethod, paymentRef, paymentGateway, transactionId, status, collectionDate, dueDate, receiptNumber, narration, createdAt
INSERT INTO premium_collections (id, "policyId", "customerId", amount, "paymentMethod", "paymentRef", "paymentGateway", "transactionId", status, "collectionDate", "dueDate", "receiptNumber", narration, "createdAt")
VALUES
  (1, 1, 1, 85000, 'card', 'PAY-PS-2026-001', 'paystack', 1, 'completed', NOW() - interval '6 months', NOW() - interval '6 months', 'RCT-2026-00001', 'Motor premium — Toyota Camry', NOW()),
  (2, 2, 1, 120000, 'bank_transfer', 'PAY-PS-2026-002', 'paystack', 2, 'completed', NOW() - interval '3 months', NOW() - interval '3 months', 'RCT-2026-00002', 'Health premium — Family plan', NOW()),
  (3, 6, 3, 55000, 'bank_transfer', 'PAY-FW-2026-002', 'flutterwave', 5, 'completed', NOW() - interval '2 months', NOW() - interval '2 months', 'RCT-2026-00003', 'Motor premium — Honda Accord', NOW()),
  (4, 8, 5, 750000, 'card', 'PAY-PS-2026-004', 'paystack', 6, 'completed', NOW() - interval '1 month', NOW() - interval '1 month', 'RCT-2026-00004', 'Marine cargo premium', NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. UNDERWRITING
-- ══════════════════════════════════════════════════════════════════════════════
-- underwriting_rules: id, productType, ruleName, ruleType, conditions, action, priority, isActive, naicomRef, createdAt, updatedAt

INSERT INTO underwriting_rules (id, "productType", "ruleName", "ruleType", conditions, action, priority, "isActive", "naicomRef", "createdAt", "updatedAt")
VALUES
  (1, 'Motor', 'Vehicle Age Limit', 'eligibility', '{"max_vehicle_age":15}', '{"action":"reject"}', 1, true, 'NAICOM/UW/MOT/001', NOW(), NOW()),
  (2, 'Motor', 'High Value Vehicle Extra Docs', 'limit', '{"min_value":5000000}', '{"action":"require_additional_docs"}', 2, true, 'NAICOM/UW/MOT/002', NOW(), NOW()),
  (3, 'Health', 'Age-Based Premium Loading', 'pricing', '{"age_brackets":[{"min":50,"max":65,"loading":25}]}', '{"action":"apply_loading","loading":25}', 3, true, 'NAICOM/UW/HLT/001', NOW(), NOW()),
  (4, 'Life', 'Smoker Premium Surcharge', 'pricing', '{"smoker_surcharge":50}', '{"action":"apply_surcharge","surcharge":50}', 2, true, 'NAICOM/UW/LIF/001', NOW(), NOW()),
  (5, 'Life', 'Sum Assured Medical Exam', 'limit', '{"min_sum_assured":10000000}', '{"action":"require_medical_exam"}', 1, true, 'NAICOM/UW/LIF/002', NOW(), NOW()),
  (6, 'Property', 'Flood Zone Risk', 'pricing', '{"flood_zone_loading":35}', '{"action":"apply_loading","loading":35}', 2, true, 'NAICOM/UW/PRO/001', NOW(), NOW()),
  (7, 'Marine', 'Vessel Age Restriction', 'eligibility', '{"max_vessel_age":25}', '{"action":"reject"}', 1, true, 'NAICOM/UW/MAR/001', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- underwriting_decisions: id, applicationId, customerId, productType, decision, riskScore, riskCategory, premiumLoading, exclusions, conditions, rulesApplied, underwriterId, notes, decisionDate, createdAt
INSERT INTO underwriting_decisions (id, "applicationId", "customerId", "productType", decision, "riskScore", "riskCategory", "premiumLoading", exclusions, conditions, "rulesApplied", "underwriterId", notes, "decisionDate", "createdAt")
VALUES
  (1, 1, 1, 'Motor', 'auto_approved', 25.00, 'low', 0, '[]', '["annual_inspection"]', '[1]', 1, 'Standard risk — clean driving record', NOW() - interval '7 months', NOW()),
  (2, 2, 1, 'Health', 'auto_approved', 15.00, 'low', 0, '["cosmetic_surgery"]', '[]', '[3]', 1, 'Healthy applicant — no pre-existing conditions', NOW() - interval '4 months', NOW()),
  (3, 3, 1, 'Life', 'auto_approved', 30.00, 'standard', 0, '[]', '["biennial_health_check"]', '[4,5]', 1, 'Non-smoker, medical exam clear', NOW() - interval '13 months', NOW()),
  (4, 4, 2, 'Property', 'referred', 45.00, 'moderate', 15.00, '[]', '["flood_barrier_required","annual_property_inspection"]', '[6]', 1, 'Property in flood-prone area — loading applied', NOW() - interval '5 months', NOW()),
  (5, 6, 3, 'Motor', 'auto_approved', 35.00, 'standard', 5.00, '[]', '[]', '[1]', 1, 'Minor claims history — small loading', NOW() - interval '3 months', NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. REINSURANCE
-- ══════════════════════════════════════════════════════════════════════════════
-- reinsurance_treaties: id, userId, treatyName, treatyType, reinsurer, reinsurerShare, retentionLimit, coverLimit, commissionRate, effectiveDate, expiryDate, status, linesOfBusiness, createdAt, updatedAt

INSERT INTO reinsurance_treaties (id, "userId", "treatyName", "treatyType", reinsurer, "reinsurerShare", "retentionLimit", "coverLimit", "commissionRate", "effectiveDate", "expiryDate", status, "linesOfBusiness", "createdAt", "updatedAt")
VALUES
  (1, 1, 'Motor Quota Share 2026', 'quota_share', 'Africa Re', 0.3000, 3500000, 10000000, 0.3200, NOW() - interval '1 year', NOW() + interval '1 year', 'active', '{"Motor"}', NOW(), NOW()),
  (2, 1, 'Property Surplus Treaty', 'surplus', 'Munich Re', 0.5000, 15000000, 100000000, 0.2800, NOW() - interval '1 year', NOW() + interval '1 year', 'active', '{"Property","Fire"}', NOW(), NOW()),
  (3, 1, 'Marine Facultative Cover', 'facultative', 'Swiss Re', 0.6000, 50000000, 500000000, 0.2500, NOW() - interval '6 months', NOW() + interval '6 months', 'active', '{"Marine"}', NOW(), NOW()),
  (4, 1, 'Life XoL Treaty', 'excess_of_loss', 'Continental Re', 0.4000, 20000000, 100000000, 0.3500, NOW() - interval '1 year', NOW() + interval '1 year', 'active', '{"Life"}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- reinsurance_cessions: id, treatyId, policyId, cedingAmount, retainedAmount, reinsurerPremium, status, cessionDate, createdAt
INSERT INTO reinsurance_cessions (id, "treatyId", "policyId", "cedingAmount", "retainedAmount", "reinsurerPremium", status, "cessionDate", "createdAt")
VALUES
  (1, 1, 1, 25500, 59500, 8160, 'active', NOW() - interval '6 months', NOW()),
  (2, 2, 4, 32500, 32500, 9100, 'active', NOW() - interval '4 months', NOW()),
  (3, 3, 8, 450000, 300000, 112500, 'active', NOW() - interval '1 month', NOW()),
  (4, 4, 3, 140000, 210000, 49000, 'active', NOW() - interval '1 year', NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. NAICOM REGULATORY
-- ══════════════════════════════════════════════════════════════════════════════
-- naicom_returns: id, returnType, reportingPeriod, dueDate, submissionDate, status, dataPayload, validationErrors, submissionRef, naicomAckRef, createdAt
INSERT INTO naicom_returns (id, "returnType", "reportingPeriod", "dueDate", "submissionDate", status, "dataPayload", "validationErrors", "submissionRef", "naicomAckRef", "createdAt")
VALUES
  (1, 'quarterly_financials', 'Q1 2026', '2026-04-30', '2026-04-28', 'accepted', '{"gross_premium":45000000,"net_premium":31500000,"claims_paid":5120000}', '[]', 'NR-2026-Q1-001', 'NAICOM-ACK-2026-001', NOW() - interval '2 months'),
  (2, 'claims_register', 'Q1 2026', '2026-04-30', '2026-04-29', 'accepted', '{"total_claims":45,"approved":32,"rejected":8,"pending":5}', '[]', 'NR-2026-Q1-002', 'NAICOM-ACK-2026-002', NOW() - interval '2 months'),
  (3, 'solvency_report', 'Q1 2026', '2026-04-30', NULL, 'pending', '{}', '[]', NULL, NULL, NOW()),
  (4, 'reinsurance_report', 'Q1 2026', '2026-04-30', '2026-04-30', 'under_review', '{"total_cessions":4,"total_ceded":648000}', '["missing_treaty_ref_for_item_3"]', 'NR-2026-Q1-004', NULL, NOW() - interval '1 month')
ON CONFLICT (id) DO NOTHING;

-- naicom_financial_reports: id, report_type, period, status, data, validation_errors, submitted_at, created_at, updated_at
INSERT INTO naicom_financial_reports (id, report_type, period, status, data, validation_errors, submitted_at, created_at, updated_at)
VALUES
  (1, 'balance_sheet', 'Q1 2026', 'submitted', '{"total_assets":500000000,"total_liabilities":320000000}', '[]', NOW() - interval '2 months', NOW(), NOW()),
  (2, 'income_statement', 'Q1 2026', 'submitted', '{"gross_premium_income":45000000,"net_claims":5120000,"operating_expenses":12000000}', '[]', NOW() - interval '2 months', NOW(), NOW()),
  (3, 'solvency_margin', 'Q1 2026', 'draft', '{"required_margin":100000000,"available_margin":180000000,"ratio":1.8}', '[]', NULL, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. NOTIFICATIONS
-- ══════════════════════════════════════════════════════════════════════════════
-- notifications: id, userId, title, message, type, channel, isRead, readAt, createdAt

INSERT INTO notifications (id, "userId", title, message, type, channel, "isRead", "readAt", "createdAt")
VALUES
  (1, 1, 'Claim Approved', 'Your motor claim CLM-2026-00001 has been approved for N320,000', 'claim', 'in_app', true, NOW() - interval '30 days', NOW() - interval '35 days'),
  (2, 1, 'Policy Renewal Reminder', 'Your Motor Comprehensive Plus policy expires in 6 months. Renew now to maintain coverage.', 'policy', 'in_app', false, NULL, NOW() - interval '5 days'),
  (3, 1, 'Premium Payment Received', 'Payment of N120,000 received for Basic Health Shield policy', 'payment', 'in_app', true, NOW() - interval '85 days', NOW() - interval '90 days'),
  (4, 2, 'Claim Under Review', 'Your property claim CLM-2026-00003 is under review by our adjudicator', 'claim', 'in_app', false, NULL, NOW() - interval '18 days'),
  (5, 2, 'KYC Upgrade Available', 'Complete NIN verification to upgrade to Tier 2 and increase your daily transaction limit to N5,000,000', 'kyc', 'in_app', false, NULL, NOW() - interval '3 days'),
  (6, 3, 'Commission Earned', 'Commission of N8,250 earned on policy POL-2026-00006', 'commission', 'in_app', true, NOW() - interval '50 days', NOW() - interval '55 days'),
  (7, 5, 'Large Claim Settled', 'Marine cargo claim CLM-2026-00005 settled for N4,800,000', 'claim', 'in_app', true, NOW() - interval '16 days', NOW() - interval '18 days'),
  (8, 1, 'Compliance Alert', 'Q1 2026 solvency report due by April 30, 2026', 'compliance', 'in_app', false, NULL, NOW() - interval '7 days')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. IFRS 17
-- ══════════════════════════════════════════════════════════════════════════════
-- ifrs17_contract_groups: id, group_code, group_name, measurement_model, portfolio, cohort_year, is_onerous, transition_approach, inception_date, coverage_period_months, created_at
INSERT INTO ifrs17_contract_groups (id, group_code, group_name, measurement_model, portfolio, cohort_year, is_onerous, transition_approach, inception_date, coverage_period_months, created_at)
VALUES
  (1, 'CG-MOT-2026', 'Motor Portfolio 2026', 'PAA', 'motor', 2026, false, 'full_retrospective', NOW() - interval '6 months', 12, NOW()),
  (2, 'CG-HLT-2026', 'Health Portfolio 2026', 'PAA', 'health', 2026, false, 'full_retrospective', NOW() - interval '4 months', 12, NOW()),
  (3, 'CG-LIF-2026', 'Life Portfolio 2026', 'GMM', 'life', 2026, false, 'modified_retrospective', NOW() - interval '12 months', 240, NOW())
ON CONFLICT (id) DO NOTHING;

-- ifrs17_discount_curves: id, curve_name, currency, effective_date, term_months, spot_rate, forward_rate, source, created_at
INSERT INTO ifrs17_discount_curves (id, curve_name, currency, effective_date, term_months, spot_rate, forward_rate, source, created_at)
VALUES
  (1, 'NGN Risk-Free Curve', 'NGN', NOW(), 12, 14.50, 14.80, 'CBN', NOW()),
  (2, 'NGN Risk-Free Curve', 'NGN', NOW(), 24, 15.00, 15.50, 'CBN', NOW()),
  (3, 'NGN Risk-Free Curve', 'NGN', NOW(), 60, 15.75, 16.20, 'CBN', NOW()),
  (4, 'NGN Risk-Free Curve', 'NGN', NOW(), 120, 16.25, 16.80, 'CBN', NOW())
ON CONFLICT (id) DO NOTHING;

-- ifrs17_csm_rollforward: id, group_code, reporting_period, opening_csm, new_contracts, interest_accretion, changes_in_estimates, experience_adjustments, fx_movements, csm_release, closing_csm, loss_component, coverage_units_total, coverage_units_recognized, created_at
INSERT INTO ifrs17_csm_rollforward (id, group_code, reporting_period, opening_csm, new_contracts, interest_accretion, changes_in_estimates, experience_adjustments, fx_movements, csm_release, closing_csm, loss_component, coverage_units_total, coverage_units_recognized, created_at)
VALUES
  (1, 'CG-MOT-2026', 'Q1 2026', 0, 15000000, 543750, -200000, 150000, 0, -2500000, 12993750, 0, 12, 3, NOW()),
  (2, 'CG-HLT-2026', 'Q1 2026', 0, 8000000, 290000, -100000, 80000, 0, -1200000, 7070000, 0, 12, 3, NOW()),
  (3, 'CG-LIF-2026', 'Q1 2026', 0, 50000000, 2500000, -500000, 300000, 0, -625000, 51675000, 0, 240, 3, NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 12. COMPLIANCE & AUDIT
-- ══════════════════════════════════════════════════════════════════════════════
-- compliance_reports: id, periodStart, periodEnd, totalAlerts, highAlerts, mediumAlerts, lowAlerts, escalatedAlerts, resolvedAlerts, reportType, period, status, createdAt
INSERT INTO compliance_reports (id, "periodStart", "periodEnd", "totalAlerts", "highAlerts", "mediumAlerts", "lowAlerts", "escalatedAlerts", "resolvedAlerts", "reportType", period, status, "createdAt")
VALUES
  (1, NOW() - interval '3 months', NOW(), 45, 5, 15, 25, 3, 38, 'quarterly', 'Q1 2026', 'completed', NOW()),
  (2, NOW() - interval '6 months', NOW() - interval '3 months', 62, 8, 22, 32, 5, 55, 'quarterly', 'Q4 2025', 'completed', NOW() - interval '3 months'),
  (3, NOW() - interval '1 month', NOW(), 18, 2, 6, 10, 1, 12, 'monthly', 'May 2026', 'in_progress', NOW())
ON CONFLICT (id) DO NOTHING;

-- audit_trail: id, userId, action, entityType, entityId, oldValues, newValues, ipAddress, userAgent, createdAt
INSERT INTO audit_trail (id, "userId", action, "entityType", "entityId", "oldValues", "newValues", "ipAddress", "userAgent", "createdAt")
VALUES
  (1, 1, 'policy.create', 'policy', '1', NULL, '{"policyNumber":"POL-2026-00001","type":"Motor","premium":85000}', '197.210.54.1', 'Mozilla/5.0', NOW() - interval '6 months'),
  (2, 1, 'claim.submit', 'claim', '1', NULL, '{"claimNumber":"CLM-2026-00001","amount":350000}', '197.210.54.1', 'InsurePortal/2.5.0', NOW() - interval '45 days'),
  (3, 1, 'claim.approve', 'claim', '1', '{"status":"Submitted"}', '{"status":"Approved","settlementAmount":320000}', '197.210.54.1', 'Mozilla/5.0', NOW() - interval '35 days'),
  (4, 2, 'kyc.verifyBVN', 'kyc', '2', '{"bvnVerified":false}', '{"bvnVerified":true}', '102.89.23.45', 'InsurePortal/2.5.0', NOW() - interval '90 days'),
  (5, 5, 'claim.settle', 'claim', '5', '{"status":"Approved"}', '{"status":"Settled","amount":4800000}', '105.112.67.89', 'Mozilla/5.0', NOW() - interval '18 days')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 13. WALLETS & FINANCIAL
-- ══════════════════════════════════════════════════════════════════════════════
-- wallets: id, user_id, balance, currency, status, created_at
INSERT INTO wallets (id, user_id, balance, currency, status, created_at)
VALUES
  (4, 4, 0, 'NGN', 'pending_kyc', NOW() - interval '2 months'),
  (5, 5, 500000, 'NGN', 'active', NOW() - interval '6 months')
ON CONFLICT (id) DO NOTHING;

-- wallet_transactions: id, user_id, type, amount, balance_after, reference, status, narration, created_at
INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, status, narration, created_at)
VALUES
  (1, 1, 'credit', 500000, 500000, 'TOP-2026-001', 'completed', 'Wallet top-up via Paystack', NOW() - interval '6 months'),
  (2, 1, 'debit', 85000, 415000, 'POL-PAY-001', 'completed', 'Motor premium payment', NOW() - interval '6 months'),
  (3, 1, 'debit', 120000, 295000, 'POL-PAY-002', 'completed', 'Health premium payment', NOW() - interval '3 months'),
  (4, 1, 'credit', 320000, 615000, 'CLM-PAY-001', 'completed', 'Claim settlement received', NOW() - interval '33 days'),
  (5, 1, 'debit', 365000, 250000, 'POL-PAY-003', 'completed', 'Life premium payment', NOW() - interval '20 days'),
  (6, 2, 'credit', 150000, 150000, 'TOP-2026-002', 'completed', 'Wallet top-up via Flutterwave', NOW() - interval '5 months'),
  (7, 2, 'debit', 65000, 85000, 'POL-PAY-004', 'completed', 'Property premium payment', NOW() - interval '4 months'),
  (8, 3, 'credit', 200000, 200000, 'TOP-2026-003', 'completed', 'Wallet top-up via bank transfer', NOW() - interval '4 months'),
  (9, 3, 'debit', 55000, 145000, 'POL-PAY-005', 'completed', 'Motor premium payment', NOW() - interval '2 months'),
  (10, 5, 'credit', 1000000, 1000000, 'TOP-2026-004', 'completed', 'Wallet top-up via Paystack', NOW() - interval '6 months')
ON CONFLICT (id) DO NOTHING;

-- financial_transactions: id, transactionType, entityType, entityId, debitAccount, creditAccount, amount, currency, description, transactionDate, createdAt
INSERT INTO financial_transactions (id, "transactionType", "entityType", "entityId", "debitAccount", "creditAccount", amount, currency, description, "transactionDate", "createdAt")
VALUES
  (1, 'premium_collection', 'policy', 1, 'cash_at_bank', 'unearned_premium', 85000, 'NGN', 'Motor premium collected', NOW() - interval '6 months', NOW()),
  (2, 'claim_payment', 'claim', 1, 'claims_expense', 'cash_at_bank', 320000, 'NGN', 'Motor claim settlement', NOW() - interval '33 days', NOW()),
  (3, 'commission_payment', 'agent', 1, 'commission_expense', 'cash_at_bank', 8250, 'NGN', 'Agent commission — motor policy', NOW() - interval '50 days', NOW()),
  (4, 'reinsurance_premium', 'treaty', 1, 'reinsurance_payable', 'cash_at_bank', 8160, 'NGN', 'Reinsurance premium ceded — motor', NOW() - interval '6 months', NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 14. CUSTOMERS
-- ══════════════════════════════════════════════════════════════════════════════
-- customers: id, externalId, firstName, lastName, email, phone, bvn, nin, dateOfBirth, address, status, kycLevel, walletBalance, dailyLimit, monthlyLimit, createdAt, updatedAt

INSERT INTO customers (id, "externalId", "firstName", "lastName", email, phone, bvn, nin, "dateOfBirth", address, status, "kycLevel", "walletBalance", "dailyLimit", "monthlyLimit", "createdAt", "updatedAt")
VALUES
  (1, 'CUST-001', 'Adebayo', 'Ogunlesi', 'adebayo@insureportal.ng', '+2348012345601', '22212345601', '10012345601', '1985-03-15', '15 Victoria Island, Lagos', 'active', 3, 250000, 999999999, 999999999, NOW(), NOW()),
  (2, 'CUST-002', 'Chioma', 'Nwosu', 'chioma@insureportal.ng', '+2348012345602', '22212345602', '10012345602', '1990-07-22', '8 Wuse II, Abuja', 'active', 2, 85000, 5000000, 50000000, NOW(), NOW()),
  (3, 'CUST-003', 'Ibrahim', 'Musa', 'ibrahim@insureportal.ng', '+2348012345603', '22212345603', NULL, '1988-11-10', '22 Nassarawa Rd, Kano', 'active', 1, 150000, 300000, 5000000, NOW(), NOW()),
  (4, 'CUST-004', 'Funke', 'Akindele', 'funke@insureportal.ng', '+2348012345604', NULL, NULL, '1995-01-30', NULL, 'pending_kyc', 0, 0, 0, 0, NOW(), NOW()),
  (5, 'CUST-005', 'Emeka', 'Okafor', 'emeka@insureportal.ng', '+2348012345605', '22212345605', '10012345605', '1982-09-05', '5 GRA, Enugu', 'active', 3, 500000, 999999999, 999999999, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 15. LOYALTY
-- ══════════════════════════════════════════════════════════════════════════════
-- loyalty_points: id, userId, points, tier, totalEarned, totalRedeemed, updatedAt
INSERT INTO loyalty_points (id, "userId", points, tier, "totalEarned", "totalRedeemed", "updatedAt")
VALUES
  (1, 1, 15000, 'Gold', 18500, 3500, NOW()),
  (2, 2, 5200, 'Silver', 6000, 800, NOW()),
  (3, 3, 3100, 'Bronze', 3100, 0, NOW()),
  (4, 5, 28000, 'Platinum', 35000, 7000, NOW())
ON CONFLICT (id) DO NOTHING;

-- loyalty_transactions: id, userId, points, transactionType, description, referenceId, createdAt
INSERT INTO loyalty_transactions (id, "userId", points, "transactionType", description, "referenceId", "createdAt")
VALUES
  (1, 1, 1000, 'earn', 'Premium payment bonus', 'POL-2026-00001', NOW() - interval '6 months'),
  (2, 1, 500, 'earn', 'Referral bonus — Chioma Nwosu', 'REF-001', NOW() - interval '5 months'),
  (3, 1, -1500, 'redeem', 'Premium discount applied', 'POL-2026-00002', NOW() - interval '3 months'),
  (4, 2, 800, 'earn', 'Premium payment bonus', 'POL-2026-00004', NOW() - interval '4 months'),
  (5, 5, 5000, 'earn', 'High-value policy bonus', 'POL-2026-00008', NOW() - interval '1 month')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 16. TRAINING
-- ══════════════════════════════════════════════════════════════════════════════
-- training_courses: id, title, description, category, content_type, content_url, duration_minutes, passing_score, is_mandatory, is_active, version, created_by, created_at
INSERT INTO training_courses (id, title, description, category, content_type, content_url, duration_minutes, passing_score, is_mandatory, is_active, version, created_by, created_at)
VALUES
  (1, 'Motor Insurance Fundamentals', 'Comprehensive training on Nigerian motor insurance regulations and practices', 'product', 'video', '/training/motor-fundamentals.mp4', 120, 70, true, true, 1, 1, NOW()),
  (2, 'KYC/AML Compliance', 'Anti-money laundering and know-your-customer procedures per CBN guidelines', 'compliance', 'interactive', '/training/kyc-aml.html', 90, 80, true, true, 1, 1, NOW()),
  (3, 'Claims Adjudication Best Practices', 'How to assess, investigate, and adjudicate insurance claims', 'operations', 'video', '/training/claims-adjudication.mp4', 150, 75, false, true, 1, 1, NOW()),
  (4, 'NAICOM Regulatory Framework', 'Understanding NAICOM regulations, returns, and compliance requirements', 'regulatory', 'document', '/training/naicom-framework.pdf', 60, 65, true, true, 1, 1, NOW()),
  (5, 'Sales Techniques for Insurance Agents', 'Effective insurance sales strategies for the Nigerian market', 'sales', 'video', '/training/sales-techniques.mp4', 90, 60, false, true, 1, 1, NOW())
ON CONFLICT (id) DO NOTHING;

-- training_enrollments: id, course_id, agent_id, status, progress, score, started_at, completed_at, certificate_url, expires_at, created_at
INSERT INTO training_enrollments (id, course_id, agent_id, status, progress, score, started_at, completed_at, certificate_url, expires_at, created_at)
VALUES
  (1, 1, 1, 'completed', 100, 92, NOW() - interval '3 months', NOW() - interval '2 months', '/certs/AGT-001-MOTOR.pdf', NOW() + interval '10 months', NOW()),
  (2, 2, 1, 'completed', 100, 88, NOW() - interval '4 months', NOW() - interval '3 months', '/certs/AGT-001-KYC.pdf', NOW() + interval '9 months', NOW()),
  (3, 1, 2, 'completed', 100, 95, NOW() - interval '5 months', NOW() - interval '4 months', '/certs/AGT-002-MOTOR.pdf', NOW() + interval '8 months', NOW()),
  (4, 3, 1, 'in_progress', 65, NULL, NOW() - interval '2 weeks', NULL, NULL, NULL, NOW()),
  (5, 5, 4, 'enrolled', 0, NULL, NULL, NULL, NULL, NULL, NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 17. TAKAFUL (Islamic Insurance)
-- ══════════════════════════════════════════════════════════════════════════════
-- takaful_pools: id, name, pool_type, total_contributions, member_count, surplus_distributed, wakala_fee_pct, status, created_at
INSERT INTO takaful_pools (id, name, pool_type, total_contributions, member_count, surplus_distributed, wakala_fee_pct, status, created_at)
VALUES
  (1, 'Takaful Motor Pool', 'general', 12500000, 150, 2000000, 25.00, 'active', NOW() - interval '1 year'),
  (2, 'Family Takaful Fund', 'family', 8000000, 85, 1200000, 20.00, 'active', NOW() - interval '10 months'),
  (3, 'Takaful Health Pool', 'general', 6500000, 120, 800000, 22.00, 'active', NOW() - interval '8 months')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 18. FRAUD
-- ══════════════════════════════════════════════════════════════════════════════
-- fraud_alerts: id, userId, alertId, severity, entityType, entityId, message, resolved, createdAt
INSERT INTO fraud_alerts (id, "userId", "alertId", severity, "entityType", "entityId", message, resolved, "createdAt")
VALUES
  (1, 3, 'FRA-2026-001', 'high', 'claim', '4', 'Multiple claims from same location within 30 days — possible staging', false, NOW() - interval '55 days'),
  (2, 1, 'FRA-2026-002', 'medium', 'policy', '1', 'Policy purchased 48 hours before claim submission — short-term risk', true, NOW() - interval '40 days'),
  (3, 2, 'FRA-2026-003', 'low', 'claim', '3', 'Claim amount exceeds typical range for property type by 200%', false, NOW() - interval '15 days'),
  (4, 5, 'FRA-2026-004', 'critical', 'claim', '5', 'Beneficiary account flagged by EFCC watchlist — manual review required', false, NOW() - interval '25 days')
ON CONFLICT (id) DO NOTHING;

-- fraud_scores: id, userId, scoreId, entityType, entityId, score, riskLevel, decision, confidence, processingTime, topFactors, matchedRules, createdAt
INSERT INTO fraud_scores (id, "userId", "scoreId", "entityType", "entityId", score, "riskLevel", decision, confidence, "processingTime", "topFactors", "matchedRules", "createdAt")
VALUES
  (1, 3, 'FS-2026-001', 'claim', '4', 0.78, 'high', 'flag', 0.92, 145, '{"short_policy_age","multiple_claims","same_witness"}', '{"rule_001","rule_005"}', NOW() - interval '55 days'),
  (2, 1, 'FS-2026-002', 'claim', '1', 0.12, 'low', 'allow', 0.95, 89, '{"clean_history","consistent_details"}', '{}', NOW() - interval '45 days'),
  (3, 5, 'FS-2026-003', 'claim', '5', 0.03, 'low', 'allow', 0.98, 120, '{"established_customer","documented_loss"}', '{}', NOW() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 19. SME & GROUP LIFE
-- ══════════════════════════════════════════════════════════════════════════════
-- sme_policies: id, userId, productId, businessName, businessType, annualPremium, coverageAmount, status, createdAt, updatedAt
INSERT INTO sme_policies (id, "userId", "productId", "businessName", "businessType", "annualPremium", "coverageAmount", status, "createdAt", "updatedAt")
VALUES
  (1, 5, 8, 'Okafor Insurance Brokers', 'Insurance', 1500000, 500000000, 'active', NOW(), NOW()),
  (2, 1, 8, 'Ogunlesi Financial Services', 'Financial', 800000, 200000000, 'active', NOW(), NOW()),
  (3, 3, 8, 'Musa Trading Company', 'Trading', 450000, 100000000, 'active', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- group_life_schemes: id, userId, schemeName, employerName, employerId, schemeType, totalMembers, totalSumAssured, annualPremium, status, renewalDate, createdAt, updatedAt
INSERT INTO group_life_schemes (id, "userId", "schemeName", "employerName", "employerId", "schemeType", "totalMembers", "totalSumAssured", "annualPremium", status, "renewalDate", "createdAt", "updatedAt")
VALUES
  (1, 1, 'Dangote Group Life', 'Dangote Industries', 'DANG-001', 'group_life', 5000, 2500000000.00, 125000000, 'active', NOW() + interval '6 months', NOW(), NOW()),
  (2, 5, 'GTBank Staff Cover', 'Guaranty Trust Bank', 'GTB-001', 'group_life', 8000, 4000000000.00, 200000000, 'active', NOW() + interval '3 months', NOW(), NOW()),
  (3, 1, 'MTN Staff Scheme', 'MTN Nigeria', 'MTN-001', 'group_life', 3000, 1500000000.00, 75000000, 'active', NOW() + interval '9 months', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 20. API KEYS & PARTNERS
-- ══════════════════════════════════════════════════════════════════════════════
-- api_keys: id, keyHash, keyPrefix, name, description, userId, tenantId, status, scopes, rateLimit, lastUsedAt, expiresAt, createdAt
INSERT INTO api_keys (id, "keyHash", "keyPrefix", name, description, "userId", "tenantId", status, scopes, "rateLimit", "lastUsedAt", "expiresAt", "createdAt")
VALUES
  (1, encode(digest('test-api-key-001','sha256'),'hex'), 'ipk_test_', 'Development API Key', 'For local development and testing', 1, NULL, 'active', '["read","write"]', 1000, NOW() - interval '1 hour', NOW() + interval '1 year', NOW()),
  (2, encode(digest('partner-key-kuda','sha256'),'hex'), 'ipk_prod_', 'Kuda Bank Integration', 'Bancassurance partner API access', 1, NULL, 'active', '["products.read","quotes.create","policies.create"]', 500, NOW() - interval '2 hours', NOW() + interval '6 months', NOW()),
  (3, encode(digest('partner-key-opay','sha256'),'hex'), 'ipk_prod_', 'OPay Integration', 'Embedded insurance partner', 1, NULL, 'active', '["products.read","quotes.create"]', 300, NOW() - interval '5 hours', NOW() + interval '6 months', NOW())
ON CONFLICT (id) DO NOTHING;

-- bancassurance_partners: id, bankName, bankCode, commissionRate, products, status, apiEndpoint, createdAt, updatedAt
INSERT INTO bancassurance_partners (id, "bankName", "bankCode", "commissionRate", products, status, "apiEndpoint", "createdAt", "updatedAt")
VALUES
  (1, 'Kuda Microfinance Bank', 'KUD', 0.1200, '{"Motor","Health","Travel"}', 'active', 'https://api.kuda.com/v2/insurance', NOW(), NOW()),
  (2, 'OPay', 'OPY', 0.1000, '{"Motor","Travel"}', 'active', 'https://api.opayweb.com/insurance', NOW(), NOW()),
  (3, 'PalmPay', 'PLP', 0.1000, '{"Motor","Health"}', 'pending', 'https://api.palmpay.com/v1/insurance', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 21. COMMUNICATION & SETTINGS
-- ══════════════════════════════════════════════════════════════════════════════
-- communication_preferences: id, user_id, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, telegram_enabled, frequency, language, quiet_hours_start, quiet_hours_end, updated_at
INSERT INTO communication_preferences (id, user_id, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, telegram_enabled, frequency, language, quiet_hours_start, quiet_hours_end, updated_at)
VALUES
  (1, 1, true, true, true, true, false, 'immediate', 'en', '22:00', '07:00', NOW()),
  (2, 2, true, true, true, false, false, 'daily_digest', 'en', '23:00', '06:00', NOW()),
  (3, 3, true, true, false, true, false, 'immediate', 'ha', '21:00', '06:00', NOW()),
  (4, 4, true, false, false, false, false, 'weekly_digest', 'en', NULL, NULL, NOW()),
  (5, 5, true, true, true, true, true, 'immediate', 'en', '00:00', '06:00', NOW())
ON CONFLICT (id) DO NOTHING;

-- platform_settings: id, key, value, description, updatedBy, updatedAt
INSERT INTO platform_settings (id, key, value, description, "updatedBy", "updatedAt")
VALUES
  (1, 'kyc.auto_approve_tier1', 'true', 'Auto-approve Tier 1 KYC when BVN validates', 1, NOW()),
  (2, 'kyc.max_verification_attempts', '3', 'Maximum BVN/NIN verification attempts per 24 hours', 1, NOW()),
  (3, 'payment.default_gateway', 'paystack', 'Default payment gateway for premium collection', 1, NOW()),
  (4, 'claims.auto_approve_threshold', '100000', 'Auto-approve claims below this amount (Naira)', 1, NOW()),
  (5, 'claims.fraud_score_threshold', '0.7', 'Flag claims with fraud score above this threshold', 1, NOW()),
  (6, 'naicom.quarterly_deadline_reminder_days', '30', 'Days before NAICOM deadline to send reminder', 1, NOW()),
  (7, 'wallet.daily_limit_tier0', '0', 'Daily wallet limit for unverified users', 1, NOW()),
  (8, 'wallet.daily_limit_tier1', '300000', 'Daily wallet limit for Tier 1 KYC', 1, NOW()),
  (9, 'wallet.daily_limit_tier2', '5000000', 'Daily wallet limit for Tier 2 KYC', 1, NOW()),
  (10, 'wallet.daily_limit_tier3', '999999999', 'Daily wallet limit for Tier 3 KYC', 1, NOW())
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 22. KYC EVENT TRACKING
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO kyc_events (user_id, event_type, trigger_source, previous_status, new_status, metadata, created_at)
VALUES
  (1, 'bvn_verified', 'signup', NULL, 'tier1', '{"bvnPrefix":"2221***"}', NOW() - interval '6 months'),
  (1, 'nin_verified', 'manual', 'tier1', 'tier2', '{"ninPrefix":"1001***"}', NOW() - interval '5 months'),
  (1, 'full_kyc_completed', 'manual', 'tier2', 'tier3', '{"facialMatch":98.5}', NOW() - interval '4 months'),
  (2, 'bvn_verified', 'signup', NULL, 'tier1', '{"bvnPrefix":"2221***"}', NOW() - interval '4 months'),
  (2, 'nin_verified', 'policy_purchase', 'tier1', 'tier2', '{"ninPrefix":"1001***","triggerPolicy":"POL-2026-00004"}', NOW() - interval '3 months'),
  (3, 'bvn_verified', 'signup', NULL, 'tier1', '{"bvnPrefix":"2221***"}', NOW() - interval '3 months'),
  (4, 'signup_initiated', 'signup', NULL, 'tier0', '{}', NOW() - interval '2 months');

-- ══════════════════════════════════════════════════════════════════════════════
-- SEQUENCE RESET (ensure next inserts don't conflict)
-- ══════════════════════════════════════════════════════════════════════════════
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id),0) FROM users));
SELECT setval('kyc_profiles_id_seq', (SELECT COALESCE(MAX(id),0) FROM kyc_profiles));
SELECT setval('insurance_products_id_seq', (SELECT COALESCE(MAX(id),0) FROM insurance_products));
SELECT setval('policies_id_seq', (SELECT COALESCE(MAX(id),0) FROM policies));
SELECT setval('claims_id_seq', (SELECT COALESCE(MAX(id),0) FROM claims));
SELECT setval('agents_id_seq', GREATEST((SELECT COALESCE(MAX(id),1) FROM agents), 1));
SELECT setval('notifications_id_seq', (SELECT COALESCE(MAX(id),0) FROM notifications));
SELECT setval('wallets_id_seq', (SELECT COALESCE(MAX(id),0) FROM wallets));

-- Run ANALYZE to update query planner statistics
ANALYZE;
