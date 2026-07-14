-- InsurePortal Seed Data Fix — Corrects schema mismatches in seed-insurance-data.sql
-- Run this AFTER seed-insurance-data.sql to fill tables that had column name issues

-- Fix: agents table uses userId (FK) instead of name/email/phone direct columns
-- The agents table already has data from main seed if columns match; if not, insert with correct schema
INSERT INTO agents (id, "userId", "agentCode", region, tier, "commissionRate", status, "createdAt", "updatedAt") VALUES
(1, 1, 'AGT-LAG-001', 'Lagos', 'Gold', 0.12, 'active', NOW() - INTERVAL '2 years', NOW()),
(2, 2, 'AGT-ABJ-001', 'Abuja', 'Silver', 0.10, 'active', NOW() - INTERVAL '18 months', NOW()),
(3, 3, 'AGT-KAN-001', 'Kano', 'Gold', 0.12, 'active', NOW() - INTERVAL '20 months', NOW()),
(4, 4, 'AGT-PH-001', 'Rivers', 'Bronze', 0.08, 'active', NOW() - INTERVAL '8 months', NOW()),
(5, 5, 'AGT-IBD-001', 'Oyo', 'Platinum', 0.15, 'active', NOW() - INTERVAL '3 years', NOW()),
(6, 6, 'AGT-ENU-001', 'Enugu', 'Silver', 0.10, 'active', NOW() - INTERVAL '14 months', NOW())
ON CONFLICT (id) DO NOTHING;

-- Fix: documents table uses documentType/fileName/fileUrl instead of name/type/url
INSERT INTO documents (id, "userId", "entityType", "entityId", "documentType", "fileName", "fileUrl", "fileSize", "mimeType", status, "createdAt") VALUES
(1, 1, 'policy', 1, 'vehicle_registration', 'toyota_camry_reg.pdf', '/uploads/docs/toyota_camry_reg.pdf', 245760, 'application/pdf', 'verified', NOW() - INTERVAL '5 months'),
(2, 1, 'claim', 1, 'damage_photos', 'fender_damage_photos.zip', '/uploads/docs/fender_damage.zip', 5242880, 'application/zip', 'verified', NOW() - INTERVAL '3 months'),
(3, 2, 'policy', 5, 'medical_report', 'family_medical_report.pdf', '/uploads/docs/medical_report.pdf', 1048576, 'application/pdf', 'verified', NOW() - INTERVAL '6 months'),
(4, 9, 'policy', 8, 'property_valuation', 'vi_office_valuation.pdf', '/uploads/docs/vi_valuation.pdf', 3145728, 'application/pdf', 'verified', NOW() - INTERVAL '6 months'),
(5, 3, 'kyc', 0, 'national_id', 'nin_card_scan.jpg', '/uploads/docs/nin_card.jpg', 524288, 'image/jpeg', 'verified', NOW() - INTERVAL '11 months')
ON CONFLICT (id) DO NOTHING;

-- Fix: analytics_events uses properties (jsonb) instead of eventData
INSERT INTO analytics_events (id, "userId", "eventType", "entityType", "entityId", properties, "sessionId", "ipAddress", "createdAt") VALUES
(1, 1, 'policy_viewed', 'policy', 1, '{"page": "policy_detail", "duration_ms": 45000}', 'sess-001', '102.89.23.45', NOW() - INTERVAL '2 days'),
(2, 2, 'claim_submitted', 'claim', 1, '{"amount": 250000, "type": "auto_damage"}', 'sess-002', '105.112.78.90', NOW() - INTERVAL '3 days'),
(3, 9, 'payment_completed', 'payment', 1, '{"amount": 350000, "method": "bank_transfer"}', 'sess-003', '41.58.12.34', NOW() - INTERVAL '1 day'),
(4, 4, 'policy_renewed', 'policy', 6, '{"old_premium": 25000, "new_premium": 22500}', 'sess-004', '197.210.45.67', NOW() - INTERVAL '4 days'),
(5, 1, 'dashboard_accessed', 'system', 0, '{"widgets_loaded": 8, "load_time_ms": 1200}', 'sess-005', '102.89.23.45', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- Fix: fraud_alerts uses alertId/severity/entityType/entityId instead of transactionId
INSERT INTO fraud_alerts (id, "userId", "alertId", severity, "entityType", "entityId", message, resolved, "createdAt") VALUES
(1, 8, 'FRD-2026-001', 'high', 'claim', 3, 'Multiple claims from same IP within 24 hours', false, NOW() - INTERVAL '2 days'),
(2, 11, 'FRD-2026-002', 'critical', 'kyc', 11, 'BVN mismatch detected during verification', false, NOW() - INTERVAL '1 week'),
(3, 5, 'FRD-2026-003', 'medium', 'payment', 5, 'Unusual payment pattern: 3 large transactions in 1 hour', true, NOW() - INTERVAL '2 weeks'),
(4, 1, 'FRD-2026-004', 'low', 'policy', 2, 'Policy modification within 48h of claim submission', true, NOW() - INTERVAL '1 month'),
(5, 9, 'FRD-2026-005', 'high', 'claim', 5, 'Claim amount exceeds average by 400% for this policy type', false, NOW() - INTERVAL '3 days')
ON CONFLICT (id) DO NOTHING;

-- Fix: bancassurance_partners uses bankName/bankCode instead of partnerName
INSERT INTO bancassurance_partners (id, "bankName", "bankCode", "commissionRate", products, status, "apiEndpoint", "createdAt", "updatedAt") VALUES
(1, 'First Bank of Nigeria', 'FBN', 0.08, ARRAY['Motor','Health','Life'], 'active', 'https://api.firstbanknigeria.com/insurance', NOW() - INTERVAL '2 years', NOW()),
(2, 'Zenith Bank', 'ZEN', 0.10, ARRAY['Motor','Property','Health'], 'active', 'https://api.zenithbank.com/insurance', NOW() - INTERVAL '18 months', NOW()),
(3, 'GTBank', 'GTB', 0.09, ARRAY['Motor','Life','Travel'], 'active', 'https://api.gtbank.com/insurance', NOW() - INTERVAL '1 year', NOW()),
(4, 'Access Bank', 'ACC', 0.07, ARRAY['Motor','Health'], 'active', 'https://api.accessbankplc.com/insurance', NOW() - INTERVAL '8 months', NOW())
ON CONFLICT (id) DO NOTHING;

-- Fix: bancassurance_offers uses partnerId/offerType instead of productName
INSERT INTO bancassurance_offers (id, "userId", "partnerId", "offerType", premium, "sumAssured", status, "expiresAt", "createdAt") VALUES
(1, 1, 1, 'Motor Third Party', 22000, 5000000, 'accepted', NOW() + INTERVAL '30 days', NOW() - INTERVAL '2 months'),
(2, 2, 2, 'Health Basic', 28000, 3000000, 'pending', NOW() + INTERVAL '14 days', NOW() - INTERVAL '1 week'),
(3, 4, 3, 'Travel Insurance', 15000, 2000000, 'accepted', NOW() + INTERVAL '7 days', NOW() - INTERVAL '3 weeks'),
(4, 9, 1, 'Commercial Property', 380000, 300000000, 'pending', NOW() + INTERVAL '21 days', NOW() - INTERVAL '5 days')
ON CONFLICT (id) DO NOTHING;

-- Fix: customer_feedback uses message instead of comment
INSERT INTO customer_feedback (id, "userId", "feedbackType", subject, message, rating, status, "ticketId", "createdAt", "updatedAt") VALUES
(1, 1, 'suggestion', 'Mobile app improvement', 'The mobile app should support biometric login for faster access', 4, 'resolved', 'TKT-2026-001', NOW() - INTERVAL '2 months', NOW()),
(2, 2, 'complaint', 'Claim processing delay', 'My motor claim has been pending for 15 days with no update', 2, 'in_progress', 'TKT-2026-002', NOW() - INTERVAL '1 week', NOW()),
(3, 4, 'praise', 'Great agent service', 'Agent Comfort in Rivers was extremely helpful with my health policy', 5, 'resolved', 'TKT-2026-003', NOW() - INTERVAL '3 weeks', NOW()),
(4, 9, 'suggestion', 'API documentation', 'Would be great to have OpenAPI docs for the partner integration endpoints', 4, 'open', 'TKT-2026-004', NOW() - INTERVAL '4 days', NOW()),
(5, 3, 'complaint', 'Premium calculation error', 'My premium was calculated at ₦45K but the quote said ₦38K', 1, 'escalated', 'TKT-2026-005', NOW() - INTERVAL '2 days', NOW())
ON CONFLICT (id) DO NOTHING;

-- Fix: audit_trail uses entityType/entityId instead of entity
INSERT INTO audit_trail (id, "userId", action, "entityType", "entityId", "oldValues", "newValues", "ipAddress", "userAgent", "createdAt") VALUES
(1, 1, 'policy_created', 'policy', 1, NULL, '{"policyNumber":"POL-2026-MTR-00001","premium":25000}', '102.89.23.45', 'Mozilla/5.0 InsurePortal/1.0', NOW() - INTERVAL '5 months'),
(2, 2, 'claim_submitted', 'claim', 1, NULL, '{"amount":250000,"type":"auto_damage"}', '105.112.78.90', 'Mozilla/5.0 InsurePortal/1.0', NOW() - INTERVAL '3 months'),
(3, 1, 'kyc_upgraded', 'customer', 1, '{"kycLevel":2}', '{"kycLevel":3}', '102.89.23.45', 'Mozilla/5.0 InsurePortal/1.0', NOW() - INTERVAL '4 months'),
(4, 5, 'payment_processed', 'payment', 1, '{"status":"pending"}', '{"status":"completed","amount":25000}', '197.210.45.67', 'InsurePortal-Agent-App/2.0', NOW() - INTERVAL '2 months'),
(5, 1, 'policy_renewed', 'policy', 10, '{"status":"expired"}', '{"status":"active","premium":120000}', '102.89.23.45', 'Mozilla/5.0 InsurePortal/1.0', NOW() - INTERVAL '1 month')
ON CONFLICT (id) DO NOTHING;

-- Fix: dynamic_pricing_history uses basePremium/adjustedPremium instead of previousRate
INSERT INTO dynamic_pricing_history (id, "userId", "productType", "basePremium", "adjustedPremium", "riskScore", "quoteId", "createdAt") VALUES
(1, 1, 'Motor', 25000, 22500, 0.35, 'QUO-2026-001', NOW() - INTERVAL '5 months'),
(2, 2, 'Health', 85000, 78000, 0.28, 'QUO-2026-002', NOW() - INTERVAL '6 months'),
(3, 9, 'Property', 350000, 380000, 0.72, 'QUO-2026-003', NOW() - INTERVAL '6 months'),
(4, 4, 'Health', 25000, 23500, 0.22, 'QUO-2026-004', NOW() - INTERVAL '4 months'),
(5, 3, 'Property', 45000, 48000, 0.55, 'QUO-2026-005', NOW() - INTERVAL '7 months')
ON CONFLICT (id) DO NOTHING;

-- Fix: emergency_incidents uses incidentType instead of type
INSERT INTO emergency_incidents (id, "userId", "incidentType", latitude, longitude, description, status, "emergencyServices", "createdAt") VALUES
(1, 1, 'vehicle_accident', 6.4541, 3.3947, 'Rear-end collision on Lekki-Epe Expressway', 'resolved', ARRAY['Police','Ambulance'], NOW() - INTERVAL '3 months'),
(2, 4, 'medical_emergency', 4.8156, 7.0498, 'Medical emergency during policy site visit in Port Harcourt', 'resolved', ARRAY['Ambulance'], NOW() - INTERVAL '2 months'),
(3, 9, 'fire_incident', 6.4281, 3.4219, 'Small fire in Victoria Island office kitchen', 'resolved', ARRAY['Fire Service'], NOW() - INTERVAL '1 month'),
(4, 3, 'flood_damage', 10.5105, 7.4165, 'Flooding damaged ground floor of Kaduna property', 'in_progress', ARRAY['Property Assessor'], NOW() - INTERVAL '2 weeks'),
(5, 8, 'theft_report', 12.0022, 8.5920, 'Mobile phone and documents stolen in Kano market', 'open', ARRAY['Police'], NOW() - INTERVAL '3 days')
ON CONFLICT (id) DO NOTHING;

-- Fix: microinsurance_policies uses productId/productName instead of policyNumber
INSERT INTO microinsurance_policies (id, "userId", "productId", "productName", premium, coverage, duration, status, "expiresAt", "createdAt") VALUES
(1, 8, 'MIC-CROP-001', 'Crop Shield - Maize', 3500, 150000, 180, 'active', NOW() + INTERVAL '5 months', NOW() - INTERVAL '1 month'),
(2, 13, 'MIC-CROP-002', 'Crop Shield - Rice', 4200, 200000, 180, 'active', NOW() + INTERVAL '4 months', NOW() - INTERVAL '2 months'),
(3, 15, 'MIC-LIVE-001', 'Livestock Guard - Cattle', 6000, 350000, 365, 'active', NOW() + INTERVAL '9 months', NOW() - INTERVAL '3 months'),
(4, 7, 'MIC-PERS-001', 'Personal Accident Cover', 1500, 500000, 365, 'active', NOW() + INTERVAL '10 months', NOW() - INTERVAL '2 months'),
(5, 5, 'MIC-WEATH-001', 'Weather Index Insurance', 2800, 100000, 180, 'expired', NOW() - INTERVAL '1 month', NOW() - INTERVAL '7 months')
ON CONFLICT (id) DO NOTHING;

-- Fix: sme_policies uses businessName/businessType instead of policyNumber
INSERT INTO sme_policies (id, "userId", "productId", "businessName", "businessType", "annualPremium", "coverageAmount", status, "createdAt", "updatedAt") VALUES
(1, 9, 'SME-COM-001', 'Obasanjo Trading Ltd', 'Import/Export', 280000, 50000000, 'active', NOW() - INTERVAL '8 months', NOW()),
(2, 14, 'SME-PRO-001', 'Williams & Associates Law Firm', 'Professional Services', 150000, 25000000, 'active', NOW() - INTERVAL '6 months', NOW()),
(3, 12, 'SME-RET-001', 'Adesanya Fashion House', 'Retail', 85000, 10000000, 'active', NOW() - INTERVAL '4 months', NOW()),
(4, 4, 'SME-MFG-001', 'Uchenna Plastics Manufacturing', 'Manufacturing', 450000, 100000000, 'active', NOW() - INTERVAL '10 months', NOW()),
(5, 1, 'SME-TEC-001', 'InsureTech Solutions', 'Technology', 120000, 20000000, 'active', NOW() - INTERVAL '3 months', NOW())
ON CONFLICT (id) DO NOTHING;

-- Fix: reinsurance_cessions uses cedingAmount/retainedAmount/reinsurerPremium instead of cededPremium
INSERT INTO reinsurance_cessions (id, "treatyId", "policyId", "cedingAmount", "retainedAmount", "reinsurerPremium", status, "cessionDate", "createdAt") VALUES
(1, 1, 12, 12000000, 3000000, 10800000, 'accepted', NOW() - INTERVAL '6 months', NOW() - INTERVAL '6 months'),
(2, 1, 8, 280000, 70000, 252000, 'accepted', NOW() - INTERVAL '6 months', NOW() - INTERVAL '6 months'),
(3, 2, 10, 96000, 24000, 86400, 'pending', NOW() - INTERVAL '1 month', NOW() - INTERVAL '1 month'),
(4, 2, 11, 200000, 50000, 180000, 'accepted', NOW() - INTERVAL '2 months', NOW() - INTERVAL '2 months'),
(5, 3, 7, 2000000, 500000, 1800000, 'accepted', NOW() - INTERVAL '2 months', NOW() - INTERVAL '2 months')
ON CONFLICT (id) DO NOTHING;

-- Fix: family_members uses memberName instead of name
INSERT INTO family_members (id, "userId", "memberName", relationship, "dateOfBirth", gender, "coveredPolicyId", status, "createdAt") VALUES
(1, 1, 'Kemi Ogundimu', 'Spouse', '1987-06-20', 'Female', 10, 'active', NOW() - INTERVAL '12 months'),
(2, 1, 'Tunde Ogundimu', 'Child', '2015-03-10', 'Male', 10, 'active', NOW() - INTERVAL '12 months'),
(3, 2, 'Emeka Nnamdi', 'Spouse', '1988-11-15', 'Male', 5, 'active', NOW() - INTERVAL '6 months'),
(4, 2, 'Ada Nnamdi', 'Child', '2018-08-22', 'Female', 5, 'active', NOW() - INTERVAL '6 months'),
(5, 2, 'Obinna Nnamdi', 'Child', '2020-02-14', 'Male', 5, 'active', NOW() - INTERVAL '6 months'),
(6, 9, 'Funke Obasanjo', 'Spouse', '1978-04-18', 'Female', 10, 'active', NOW() - INTERVAL '20 months'),
(7, 10, 'Chukwuma Eze', 'Spouse', '1991-09-03', 'Male', 7, 'active', NOW() - INTERVAL '2 months')
ON CONFLICT (id) DO NOTHING;

-- Fix: premium_risk_factors uses tableId instead of rateTableId
INSERT INTO premium_risk_factors (id, "tableId", name, category, weight, "minValue", "maxValue", "createdAt", "updatedAt") VALUES
(1, 1, 'Driver Age', 'demographic', 0.25, 18, 80, NOW(), NOW()),
(2, 1, 'Vehicle Year', 'asset', 0.20, 2000, 2026, NOW(), NOW()),
(3, 1, 'Claims History', 'behavioral', 0.30, 0, 10, NOW(), NOW()),
(4, 1, 'Location Risk', 'geographic', 0.15, 1, 5, NOW(), NOW()),
(5, 1, 'Coverage Level', 'product', 0.10, 1, 3, NOW(), NOW()),
(6, 2, 'Age', 'demographic', 0.30, 0, 100, NOW(), NOW()),
(7, 2, 'BMI', 'health', 0.20, 15, 45, NOW(), NOW()),
(8, 2, 'Pre-existing Conditions', 'health', 0.25, 0, 5, NOW(), NOW()),
(9, 2, 'Smoking Status', 'behavioral', 0.15, 0, 1, NOW(), NOW()),
(10, 2, 'Family History', 'genetic', 0.10, 0, 3, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Fix: claim_evidence uses evidenceType/fileName/fileUrl instead of fileType
INSERT INTO claim_evidence (id, "userId", "claimId", "evidenceType", "fileName", "fileUrl", description, status, "createdAt") VALUES
(1, 1, 1, 'photo', 'fender_damage_1.jpg', '/uploads/evidence/fender_1.jpg', 'Front fender damage from collision', 'verified', NOW() - INTERVAL '3 months'),
(2, 1, 1, 'photo', 'fender_damage_2.jpg', '/uploads/evidence/fender_2.jpg', 'Side view showing paint scratch', 'verified', NOW() - INTERVAL '3 months'),
(3, 1, 1, 'document', 'police_report.pdf', '/uploads/evidence/police_report.pdf', 'Official police report #LG-2026-45678', 'verified', NOW() - INTERVAL '3 months'),
(4, 2, 2, 'photo', 'flood_damage_1.jpg', '/uploads/evidence/flood_1.jpg', 'Water level marks on ground floor walls', 'pending', NOW() - INTERVAL '2 months'),
(5, 2, 2, 'document', 'property_assessment.pdf', '/uploads/evidence/assessment.pdf', 'Independent property damage assessment', 'pending', NOW() - INTERVAL '2 months')
ON CONFLICT (id) DO NOTHING;

-- Verify: count rows in key tables
SELECT 'users' as tbl, count(*) as rows FROM users
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'agents', count(*) FROM agents
UNION ALL SELECT 'policies', count(*) FROM policies
UNION ALL SELECT 'claims', count(*) FROM claims
UNION ALL SELECT 'documents', count(*) FROM documents
UNION ALL SELECT 'fraud_alerts', count(*) FROM fraud_alerts
UNION ALL SELECT 'analytics_events', count(*) FROM analytics_events
UNION ALL SELECT 'audit_trail', count(*) FROM audit_trail
UNION ALL SELECT 'customer_feedback', count(*) FROM customer_feedback
UNION ALL SELECT 'family_members', count(*) FROM family_members
UNION ALL SELECT 'premium_risk_factors', count(*) FROM premium_risk_factors
UNION ALL SELECT 'microinsurance_policies', count(*) FROM microinsurance_policies
UNION ALL SELECT 'sme_policies', count(*) FROM sme_policies
ORDER BY tbl;
