-- InsurePortal PostgreSQL Schema
-- Column names match server.cjs SQL queries exactly (camelCase where quoted)
BEGIN;

-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(320) UNIQUE NOT NULL,
  name TEXT,
  "displayName" TEXT,
  "passwordHash" VARCHAR(256),
  role VARCHAR(32) DEFAULT 'customer',
  phone VARCHAR(20),
  avatar TEXT,
  "totpSecret" VARCHAR(64),
  "totpEnabled" BOOLEAN DEFAULT false,
  "lastSignedIn" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,
  "roleName" VARCHAR(64),
  "roleId" INTEGER,
  permissions JSONB DEFAULT '[]'::jsonb,
  "isSystem" BOOLEAN DEFAULT false,
  "assignedAt" TIMESTAMP,
  "userId" INTEGER,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "roleId" INTEGER,
  "roleName" VARCHAR(64),
  permissions JSONB DEFAULT '[]'::jsonb,
  "assignedAt" TIMESTAMP DEFAULT NOW(),
  "assignedBy" INTEGER
);

CREATE TABLE IF NOT EXISTS password_resets (
  "userId" INTEGER PRIMARY KEY,
  token VARCHAR(10) NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- KYC/KYB
CREATE TABLE IF NOT EXISTS kyc_profiles (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  nin VARCHAR(11),
  bvn VARCHAR(11),
  phone VARCHAR(20),
  level INTEGER DEFAULT 0,
  "kycLevel" INTEGER DEFAULT 0,
  "kycStatus" VARCHAR(32) DEFAULT 'pending',
  status VARCHAR(32) DEFAULT 'pending',
  "ninVerified" BOOLEAN DEFAULT false,
  "bvnVerified" BOOLEAN DEFAULT false,
  "phoneVerified" BOOLEAN DEFAULT false,
  "riskRating" VARCHAR(16),
  "lastVerificationDate" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  document_type VARCHAR(64),
  document_url TEXT,
  status VARCHAR(32) DEFAULT 'pending',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyb_profiles (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  company_name VARCHAR(256),
  rc_number VARCHAR(32),
  tin VARCHAR(32),
  status VARCHAR(32) DEFAULT 'pending',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Insurance Products
CREATE TABLE IF NOT EXISTS insurance_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(32) UNIQUE,
  category VARCHAR(64),
  "subCategory" VARCHAR(64),
  "coverageType" VARCHAR(64),
  description TEXT,
  status VARCHAR(32) DEFAULT 'active',
  premium NUMERIC(12,2),
  "minPremium" NUMERIC(12,2),
  "maxPremium" NUMERIC(12,2),
  "minSumAssured" NUMERIC(14,2),
  "maxSumAssured" NUMERIC(14,2),
  "minCoverage" NUMERIC(14,2),
  "maxCoverage" NUMERIC(14,2),
  "minAge" INTEGER,
  "maxAge" INTEGER,
  "naicomClass" VARCHAR(32),
  "isCompulsory" BOOLEAN DEFAULT false,
  "requiredKycLevel" INTEGER DEFAULT 1,
  "ratingFactors" JSONB DEFAULT '[]'::jsonb,
  "effectiveDate" TIMESTAMP DEFAULT NOW(),
  value NUMERIC(14,2),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Policies
CREATE TABLE IF NOT EXISTS policies (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "customerId" INTEGER,
  "customerName" VARCHAR(256),
  product_id INTEGER,
  "policyNumber" VARCHAR(32) UNIQUE,
  "policyId" INTEGER,
  "policyType" VARCHAR(64),
  type VARCHAR(64),
  category VARCHAR(64),
  name VARCHAR(128),
  description TEXT,
  status VARCHAR(32) DEFAULT 'active',
  premium NUMERIC(12,2),
  gross NUMERIC(14,2),
  "sumAssured" NUMERIC(14,2),
  "coverageAmount" NUMERIC(14,2),
  "coverageDetails" JSONB DEFAULT '{}'::jsonb,
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  "expiryDate" TIMESTAMP,
  "renewalDate" TIMESTAMP,
  "autoRenew" BOOLEAN DEFAULT false,
  "paymentMethod" VARCHAR(32),
  "paymentGateway" VARCHAR(32),
  "agencyName" VARCHAR(128),
  "lossRatio" NUMERIC(8,4),
  "claimNumber" VARCHAR(32),
  "claimsAmount" NUMERIC(14,2),
  "filedDate" TIMESTAMP,
  "coveredPolicyId" INTEGER,
  "collectionDate" TIMESTAMP,
  "receiptNumber" VARCHAR(32),
  "dueDate" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Applications
CREATE TABLE IF NOT EXISTS insurance_applications (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "applicationId" VARCHAR(32),
  "applicationNumber" VARCHAR(32),
  product_id INTEGER,
  "productType" VARCHAR(64),
  "personalInfo" JSONB DEFAULT '{}'::jsonb,
  "riskInfo" JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(32) DEFAULT 'pending',
  data JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Claims
CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  "policyId" INTEGER,
  "userId" INTEGER,
  "claimId" INTEGER,
  "claimNumber" VARCHAR(32) UNIQUE,
  "policyNumber" VARCHAR(32),
  "policyType" VARCHAR(64),
  type VARCHAR(64),
  status VARCHAR(32) DEFAULT 'submitted',
  amount NUMERIC(14,2),
  "claimsAmount" NUMERIC(14,2),
  description TEXT,
  evidence JSONB DEFAULT '[]'::jsonb,
  "fraudScore" NUMERIC(6,2),
  "lossRatio" NUMERIC(8,4),
  "approvedBy" VARCHAR(128),
  "approvedAt" TIMESTAMP,
  "paidAt" TIMESTAMP,
  "filedDate" TIMESTAMP,
  "paymentRef" VARCHAR(64),
  "bankName" VARCHAR(128),
  "accountNumber" VARCHAR(20),
  "beneficiaryName" VARCHAR(256),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claims_payouts (
  id SERIAL PRIMARY KEY,
  "claimId" INTEGER,
  "claimNumber" VARCHAR(32),
  amount NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'pending',
  "paymentRef" VARCHAR(64),
  "bankName" VARCHAR(128),
  "accountNumber" VARCHAR(20),
  "beneficiaryName" VARCHAR(256),
  "approvedBy" VARCHAR(128),
  "approvedAt" TIMESTAMP,
  "paidAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  id SERIAL PRIMARY KEY,
  "claimId" INTEGER,
  "userId" INTEGER,
  "evidenceType" VARCHAR(32),
  "fileName" VARCHAR(256),
  "fileUrl" TEXT,
  description TEXT,
  "uploadDate" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claim_routing_rules (
  id SERIAL PRIMARY KEY,
  claim_type VARCHAR(64),
  threshold_amount NUMERIC(14,2),
  "targetTeam" VARCHAR(64),
  priority INTEGER DEFAULT 0,
  "isActive" BOOLEAN DEFAULT true
);

-- Financial
CREATE TABLE IF NOT EXISTS financial_transactions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "transactionType" VARCHAR(64),
  type VARCHAR(64),
  amount NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'pending',
  reference VARCHAR(64),
  description TEXT,
  "entityType" VARCHAR(64),
  "entityId" INTEGER,
  "debitAccount" VARCHAR(32),
  "creditAccount" VARCHAR(32),
  "transactionDate" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  customer_email VARCHAR(320),
  amount NUMERIC(14,2),
  type VARCHAR(64),
  gateway VARCHAR(32),
  reference VARCHAR(64),
  status VARCHAR(32) DEFAULT 'pending',
  metadata JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER UNIQUE,
  balance NUMERIC(14,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'NGN',
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  type VARCHAR(32),
  amount NUMERIC(14,2),
  narration TEXT,
  reference VARCHAR(64),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS general_ledger (
  id SERIAL PRIMARY KEY,
  account_code VARCHAR(32),
  account_name VARCHAR(128),
  debit NUMERIC(14,2) DEFAULT 0,
  credit NUMERIC(14,2) DEFAULT 0,
  description TEXT,
  reference VARCHAR(64),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS currency_rates (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(3),
  "from" VARCHAR(3),
  "to" VARCHAR(3),
  rate NUMERIC(12,6),
  "lastUpdated" TIMESTAMP DEFAULT NOW()
);

-- Premium
CREATE TABLE IF NOT EXISTS premium_collections (
  id SERIAL PRIMARY KEY,
  "policyId" INTEGER,
  "policyNumber" VARCHAR(32),
  "customerId" INTEGER,
  amount NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'collected',
  "paymentMethod" VARCHAR(32),
  "paymentGateway" VARCHAR(32),
  "paymentRef" VARCHAR(64),
  "receiptNumber" VARCHAR(32),
  "transactionId" VARCHAR(64),
  "collectionDate" TIMESTAMP DEFAULT NOW(),
  "dueDate" TIMESTAMP,
  narration TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS premium_rate_tables (
  id SERIAL PRIMARY KEY,
  "tableId" VARCHAR(32),
  "tableName" VARCHAR(128),
  "productType" VARCHAR(32),
  age_band VARCHAR(16),
  "baseRate" NUMERIC(10,4),
  risk_factor NUMERIC(6,4) DEFAULT 1.0,
  "effectiveDate" TIMESTAMP DEFAULT NOW(),
  "expiryDate" TIMESTAMP,
  "userId" INTEGER,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS premium_risk_factors (
  id SERIAL PRIMARY KEY,
  "tableId" VARCHAR(32),
  "tableName" VARCHAR(128),
  "productType" VARCHAR(32),
  factor_name VARCHAR(64),
  factor_type VARCHAR(32),
  weight NUMERIC(6,4),
  "minValue" NUMERIC(12,4),
  "maxValue" NUMERIC(12,4),
  description TEXT
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "agentId" INTEGER,
  "agentCode" VARCHAR(32) UNIQUE,
  "agentName" VARCHAR(128),
  name VARCHAR(128),
  region VARCHAR(64),
  "agencyName" VARCHAR(128),
  status VARCHAR(32) DEFAULT 'active',
  "commissionRate" NUMERIC(6,4) DEFAULT 0.10,
  "commissionAmount" NUMERIC(14,2) DEFAULT 0,
  "policiesSold" INTEGER DEFAULT 0,
  "totalPoliciesSold" INTEGER DEFAULT 0,
  "totalPremiumCollected" NUMERIC(14,2) DEFAULT 0,
  "claimsProcessed" INTEGER DEFAULT 0,
  "escalationLimit" NUMERIC(14,2),
  "policyId" INTEGER,
  "paidAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_commissions (
  id SERIAL PRIMARY KEY,
  "agentId" INTEGER,
  "agentName" VARCHAR(128),
  "agencyName" VARCHAR(128),
  "policyId" INTEGER,
  amount NUMERIC(14,2),
  "commissionAmount" NUMERIC(14,2),
  rate NUMERIC(6,4),
  status VARCHAR(32) DEFAULT 'pending',
  "paidAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "customerId" VARCHAR(32),
  "customerName" VARCHAR(256),
  customer_code VARCHAR(32) UNIQUE,
  full_name VARCHAR(256),
  phone VARCHAR(20),
  address TEXT,
  status VARCHAR(32) DEFAULT 'active',
  segment VARCHAR(32),
  "policyNumber" VARCHAR(32),
  "walletBalance" NUMERIC(14,2) DEFAULT 0,
  lifetime_value NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_members (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER,
  "userId" INTEGER,
  "memberName" VARCHAR(128),
  name VARCHAR(128),
  relationship VARCHAR(32),
  "dateOfBirth" DATE,
  "coveredPolicyId" INTEGER,
  "policyNumber" VARCHAR(32),
  "sumAssured" NUMERIC(14,2),
  is_dependent BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS customer_feedback (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "feedbackType" VARCHAR(32),
  type VARCHAR(32),
  rating INTEGER,
  comment TEXT,
  status VARCHAR(32) DEFAULT 'new',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  "referrerId" INTEGER,
  "referredEmail" VARCHAR(320),
  referral_code VARCHAR(16),
  status VARCHAR(32) DEFAULT 'pending',
  "rewardAmount" NUMERIC(10,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS communication_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE,
  email_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  whatsapp_enabled BOOLEAN DEFAULT false,
  telegram_enabled BOOLEAN DEFAULT false,
  frequency VARCHAR(16) DEFAULT 'instant',
  language VARCHAR(8) DEFAULT 'en'
);

-- Reinsurance
CREATE TABLE IF NOT EXISTS reinsurance_treaties (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  "treatyId" VARCHAR(32),
  "treatyName" VARCHAR(128),
  "treatyType" VARCHAR(32),
  treaty_type VARCHAR(32),
  reinsurer VARCHAR(128),
  retention NUMERIC(14,2),
  "retentionLimit" NUMERIC(14,2),
  "coverLimit" NUMERIC(14,2),
  "reinsurerShare" NUMERIC(6,4),
  "commissionRate" NUMERIC(6,4),
  "linesOfBusiness" JSONB DEFAULT '[]'::jsonb,
  "effectiveDate" TIMESTAMP,
  "expiryDate" TIMESTAMP,
  "cedingAmount" NUMERIC(14,2),
  "cessionDate" TIMESTAMP,
  "policyId" INTEGER,
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reinsurance_cessions (
  id SERIAL PRIMARY KEY,
  "treatyId" INTEGER,
  "treatyName" VARCHAR(128),
  "treatyType" VARCHAR(32),
  "policyId" INTEGER,
  ceded_premium NUMERIC(14,2),
  "cedingAmount" NUMERIC(14,2),
  "reinsurerPremium" NUMERIC(14,2),
  "retainedAmount" NUMERIC(14,2),
  ceded_liability NUMERIC(14,2),
  "cessionDate" TIMESTAMP DEFAULT NOW(),
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reinsurance_claims_recovery (
  id SERIAL PRIMARY KEY,
  treaty_id INTEGER,
  "treatyName" VARCHAR(128),
  claim_id INTEGER,
  claim_amount NUMERIC(14,2),
  recoverable_amount NUMERIC(14,2),
  recovery_ref VARCHAR(32),
  status VARCHAR(32) DEFAULT 'pending',
  notified_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reinsurance_bordereaux (
  id SERIAL PRIMARY KEY,
  treaty_id INTEGER,
  "treatyName" VARCHAR(128),
  period VARCHAR(16),
  type VARCHAR(32),
  total_amount NUMERIC(14,2),
  line_items JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(32) DEFAULT 'draft',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reinsurance_facultative (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER,
  risk_description TEXT,
  sum_assured NUMERIC(14,2),
  placement_status VARCHAR(32) DEFAULT 'pending',
  valid_from TIMESTAMP,
  valid_to TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reinsurance_settlements (
  id SERIAL PRIMARY KEY,
  treaty_id INTEGER,
  "treatyName" VARCHAR(128),
  settlement_type VARCHAR(32),
  amount NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'pending',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- IFRS 17
CREATE TABLE IF NOT EXISTS ifrs17_contract_groups (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(32) UNIQUE,
  group_name VARCHAR(128),
  measurement_model VARCHAR(32),
  is_onerous BOOLEAN DEFAULT false,
  reporting_period VARCHAR(16),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs17_contracts (
  id SERIAL PRIMARY KEY,
  contract_group INTEGER,
  measurement_model VARCHAR(32),
  reporting_period VARCHAR(16),
  premium_allocated NUMERIC(14,2) DEFAULT 0,
  claims_incurred NUMERIC(14,2) DEFAULT 0,
  risk_adjustment NUMERIC(14,2) DEFAULT 0,
  csm_balance NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs17_csm_rollforward (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(32),
  reporting_period VARCHAR(16),
  opening_csm NUMERIC(14,2) DEFAULT 0,
  new_business NUMERIC(14,2) DEFAULT 0,
  changes_estimate NUMERIC(14,2) DEFAULT 0,
  finance_effect NUMERIC(14,2) DEFAULT 0,
  recognized NUMERIC(14,2) DEFAULT 0,
  closing_csm NUMERIC(14,2) DEFAULT 0,
  loss_component NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs17_pnl (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(32),
  group_name VARCHAR(128),
  reporting_period VARCHAR(16),
  insurance_revenue NUMERIC(14,2) DEFAULT 0,
  insurance_service_expense NUMERIC(14,2) DEFAULT 0,
  insurance_service_result NUMERIC(14,2) DEFAULT 0,
  insurance_finance_expense NUMERIC(14,2) DEFAULT 0,
  investment_income NUMERIC(14,2) DEFAULT 0,
  net_financial_result NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs17_cashflow_scenarios (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(32),
  scenario_name VARCHAR(64),
  discount_rate NUMERIC(8,4),
  projected_inflows NUMERIC(14,2),
  projected_outflows NUMERIC(14,2),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs17_discount_curves (
  id SERIAL PRIMARY KEY,
  curve_name VARCHAR(64),
  effective_date TIMESTAMP,
  term_years INTEGER,
  spot_rate NUMERIC(8,6),
  forward_rate NUMERIC(8,6)
);

CREATE TABLE IF NOT EXISTS ifrs17_reinsurance_held (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(32),
  group_name VARCHAR(128),
  measurement_model VARCHAR(32),
  reporting_period VARCHAR(16),
  premium_ceded NUMERIC(14,2) DEFAULT 0,
  claims_recovered NUMERIC(14,2) DEFAULT 0,
  csm_reinsurance NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ifrs17_transition (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(32),
  group_name VARCHAR(128),
  measurement_model VARCHAR(32),
  transition_adjustment NUMERIC(14,2) DEFAULT 0,
  equity_impact NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Actuarial
CREATE TABLE IF NOT EXISTS actuarial_calculations (
  id SERIAL PRIMARY KEY,
  "calculationType" VARCHAR(64),
  model_type VARCHAR(64),
  "policyType" VARCHAR(64),
  "inputParams" JSONB DEFAULT '{}'::jsonb,
  parameters JSONB DEFAULT '{}'::jsonb,
  result JSONB DEFAULT '{}'::jsonb,
  "lastRun" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcmc_simulations (
  id SERIAL PRIMARY KEY,
  simulation_id VARCHAR(64) UNIQUE,
  model_type VARCHAR(64),
  iterations INTEGER,
  "burnIn" INTEGER,
  converged BOOLEAN DEFAULT false,
  "rHat" NUMERIC(8,4),
  "effectiveSampleSize" INTEGER,
  "posteriorMeans" JSONB DEFAULT '{}'::jsonb,
  "credibleIntervals" JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- NAICOM
CREATE TABLE IF NOT EXISTS naicom_filings (
  id SERIAL PRIMARY KEY,
  "filingType" VARCHAR(64),
  "filingRef" VARCHAR(32),
  reference_number VARCHAR(32),
  reporting_period VARCHAR(16),
  status VARCHAR(32) DEFAULT 'draft',
  "submittedAt" TIMESTAMP,
  "submissionDate" TIMESTAMP,
  "dueDate" TIMESTAMP,
  data JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naicom_financial_reports (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(64),
  period VARCHAR(16),
  status VARCHAR(32) DEFAULT 'draft',
  data JSONB DEFAULT '{}'::jsonb,
  validation_errors JSONB DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naicom_reporting_schedule (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(64),
  frequency VARCHAR(16),
  due_date TIMESTAMP,
  status VARCHAR(32) DEFAULT 'pending',
  circular_ref VARCHAR(32),
  penalty_amount NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naicom_automated_reports (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(64),
  report_code VARCHAR(32),
  period VARCHAR(16),
  status VARCHAR(32) DEFAULT 'pending',
  due_date TIMESTAMP,
  data JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naicom_data_exchange (
  id SERIAL PRIMARY KEY,
  direction VARCHAR(16),
  data_type VARCHAR(64),
  naicom_ref VARCHAR(32),
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(32) DEFAULT 'pending',
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naicom_returns (
  id SERIAL PRIMARY KEY,
  "returnType" VARCHAR(64),
  "reportingPeriod" VARCHAR(16),
  "submissionDate" TIMESTAMP,
  "submissionRef" VARCHAR(32),
  "naicomAckRef" VARCHAR(32),
  "dueDate" TIMESTAMP,
  data JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(32) DEFAULT 'draft',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naicom_penalties (
  id SERIAL PRIMARY KEY,
  filing_id INTEGER,
  penalty_type VARCHAR(64),
  amount NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS niira_registrations (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER,
  "registrationId" VARCHAR(32),
  class_code VARCHAR(16),
  "complianceScore" NUMERIC(6,2),
  "compulsoryProducts" JSONB DEFAULT '[]'::jsonb,
  "lastRenewal" TIMESTAMP,
  "nextRenewal" TIMESTAMP,
  status VARCHAR(32) DEFAULT 'pending',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS niira_insurance_classes (
  id SERIAL PRIMARY KEY,
  class_code VARCHAR(16) UNIQUE,
  class_name VARCHAR(128),
  category VARCHAR(64),
  "applicableTo" JSONB DEFAULT '[]'::jsonb,
  "minPremium" NUMERIC(12,2),
  description TEXT
);

-- Compliance
CREATE TABLE IF NOT EXISTS compliance_reports (
  id SERIAL PRIMARY KEY,
  "reportType" VARCHAR(64),
  period VARCHAR(16),
  status VARCHAR(32) DEFAULT 'draft',
  "totalAlerts" INTEGER DEFAULT 0,
  "highAlerts" INTEGER DEFAULT 0,
  "mediumAlerts" INTEGER DEFAULT 0,
  "lowAlerts" INTEGER DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_filings (
  id SERIAL PRIMARY KEY,
  filing_type VARCHAR(64),
  reference_number VARCHAR(32),
  reporting_period VARCHAR(16),
  submitted_to VARCHAR(64),
  total_transactions INTEGER DEFAULT 0,
  total_amount NUMERIC(14,2) DEFAULT 0,
  status VARCHAR(32) DEFAULT 'draft',
  submitted_at TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Fraud
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id SERIAL PRIMARY KEY,
  "alertId" VARCHAR(32),
  "entityType" VARCHAR(32),
  "entityId" INTEGER,
  alert_type VARCHAR(64),
  severity VARCHAR(16),
  score NUMERIC(6,2),
  details JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(32) DEFAULT 'open',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_score_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  score INTEGER,
  factors JSONB DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS score_improvement_tips (
  id SERIAL PRIMARY KEY,
  category VARCHAR(32),
  suggestion TEXT,
  impact VARCHAR(16),
  priority INTEGER DEFAULT 0
);

-- Underwriting
CREATE TABLE IF NOT EXISTS underwriting_rules (
  id SERIAL PRIMARY KEY,
  "productType" VARCHAR(32),
  "ruleName" VARCHAR(128),
  "ruleType" VARCHAR(32),
  conditions JSONB DEFAULT '{}'::jsonb,
  action TEXT,
  "isActive" BOOLEAN DEFAULT true,
  "naicomRef" VARCHAR(32),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS underwriting_decisions (
  id SERIAL PRIMARY KEY,
  "applicationId" INTEGER,
  "customerId" INTEGER,
  "productType" VARCHAR(64),
  decision VARCHAR(32),
  "riskScore" NUMERIC(6,2),
  "riskCategory" VARCHAR(32),
  "premiumLoading" NUMERIC(6,4),
  "rulesApplied" JSONB DEFAULT '[]'::jsonb,
  "decisionDate" TIMESTAMP DEFAULT NOW(),
  decided_by VARCHAR(64),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Approval Workflows
CREATE TABLE IF NOT EXISTS approval_chains (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  entity_type VARCHAR(64),
  threshold_amount NUMERIC(14,2),
  steps JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  chain_id INTEGER,
  entity_type VARCHAR(64),
  entity_id INTEGER,
  submitted_by INTEGER,
  current_step INTEGER DEFAULT 1,
  status VARCHAR(32) DEFAULT 'pending',
  notes TEXT,
  history JSONB DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Workflows
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  entity_type VARCHAR(64),
  states JSONB DEFAULT '[]'::jsonb,
  transitions JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER,
  entity_type VARCHAR(64),
  entity_id INTEGER,
  current_state VARCHAR(64),
  assigned_to INTEGER,
  history JSONB DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  type VARCHAR(32),
  title VARCHAR(256),
  description TEXT,
  "isRead" BOOLEAN DEFAULT false,
  "readAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20),
  direction VARCHAR(8),
  message_type VARCHAR(16),
  message TEXT,
  status VARCHAR(16) DEFAULT 'sent',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  query TEXT,
  response TEXT,
  message TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chatbot_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(64) UNIQUE,
  config_value JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS voice_config (
  id SERIAL PRIMARY KEY,
  language_code VARCHAR(8),
  language_name VARCHAR(32),
  capabilities JSONB DEFAULT '[]'::jsonb,
  is_enabled BOOLEAN DEFAULT true
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "entityType" VARCHAR(64),
  entity_id INTEGER,
  "documentType" VARCHAR(64),
  "fileName" VARCHAR(256),
  "fileSize" INTEGER,
  "fileUrl" TEXT,
  status VARCHAR(32) DEFAULT 'active',
  "uploadedAt" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Audit
CREATE TABLE IF NOT EXISTS audit_trail (
  id SERIAL PRIMARY KEY,
  action VARCHAR(128),
  "entityType" VARCHAR(64),
  "entityId" INTEGER,
  "userId" INTEGER,
  details JSONB DEFAULT '{}'::jsonb,
  "oldValues" JSONB,
  "newValues" JSONB,
  "ipAddress" VARCHAR(45),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- System
CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(128) UNIQUE,
  value TEXT,
  category VARCHAR(64),
  description TEXT,
  updated_by INTEGER,
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_metrics (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(64),
  metric_type VARCHAR(32),
  value NUMERIC(12,4),
  unit VARCHAR(16),
  threshold_warning NUMERIC(12,4),
  threshold_critical NUMERIC(12,4),
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS db_scaling_metrics (
  id SERIAL PRIMARY KEY,
  metric_type VARCHAR(32),
  value NUMERIC(12,4),
  "currentValue" NUMERIC(12,4),
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- ERP
CREATE TABLE IF NOT EXISTS erp_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(64) UNIQUE,
  "erpType" VARCHAR(32),
  "baseUrl" TEXT,
  "apiKey" VARCHAR(128),
  "syncEnabled" BOOLEAN DEFAULT false,
  "syncIntervalMinutes" INTEGER DEFAULT 60,
  "syncTransactions" BOOLEAN DEFAULT true,
  "syncInventory" BOOLEAN DEFAULT false,
  "syncAgents" BOOLEAN DEFAULT false,
  "fieldMappings" JSONB DEFAULT '{}'::jsonb,
  "lastSyncAt" TIMESTAMP,
  "lastSyncStatus" VARCHAR(32),
  "lastSyncCount" INTEGER,
  "lastSyncError" TEXT,
  config_value JSONB DEFAULT '{}'::jsonb,
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erpnext_transactions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  transaction_type VARCHAR(64),
  "erpDocType" VARCHAR(64),
  "erpDocId" VARCHAR(64),
  "localEntityType" VARCHAR(64),
  "localEntity" VARCHAR(64),
  "localEntityId" INTEGER,
  "localId" INTEGER,
  reference VARCHAR(64),
  amount NUMERIC(14,2),
  "syncStatus" VARCHAR(32) DEFAULT 'synced',
  "errorMessage" TEXT,
  status VARCHAR(32) DEFAULT 'synced',
  data JSONB DEFAULT '{}'::jsonb,
  "lastSyncAt" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_batches (
  id SERIAL PRIMARY KEY,
  batch_reference VARCHAR(32) UNIQUE,
  source_type VARCHAR(32),
  type VARCHAR(32),
  total_records INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  unmatched_count INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  total_amount NUMERIC(14,2) DEFAULT 0,
  status VARCHAR(32) DEFAULT 'pending',
  processed_at TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Bancassurance
CREATE TABLE IF NOT EXISTS bancassurance_partners (
  id SERIAL PRIMARY KEY,
  bank_name VARCHAR(128),
  "bankName" VARCHAR(128),
  "bankCode" VARCHAR(32),
  "partnerId" VARCHAR(32),
  partner_code VARCHAR(32),
  "integrationType" VARCHAR(32),
  integration_type VARCHAR(32),
  "offerId" VARCHAR(32),
  "offerType" VARCHAR(32),
  "sumAssured" NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active',
  "lastSync" TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bancassurance_offers (
  id SERIAL PRIMARY KEY,
  "partnerId" INTEGER,
  "bankCode" VARCHAR(32),
  "bankName" VARCHAR(128),
  "offerId" VARCHAR(32),
  "offerType" VARCHAR(32),
  product_name VARCHAR(128),
  premium NUMERIC(12,2),
  "sumAssured" NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embedded_partners (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  "partnerName" VARCHAR(128),
  type VARCHAR(32),
  "integrationType" VARCHAR(32),
  integration_type VARCHAR(32),
  status VARCHAR(32) DEFAULT 'active',
  total_policies INTEGER DEFAULT 0,
  monthly_revenue NUMERIC(14,2) DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embedded_distribution (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER,
  "partnerName" VARCHAR(128),
  "channelName" VARCHAR(128),
  product_id INTEGER,
  "productTypes" JSONB DEFAULT '[]'::jsonb,
  "integrationType" VARCHAR(32),
  "commissionRate" NUMERIC(6,4),
  "apiVersion" VARCHAR(16),
  "monthlyPolicies" INTEGER DEFAULT 0,
  "monthlyPremium" NUMERIC(14,2) DEFAULT 0,
  channel VARCHAR(32),
  status VARCHAR(32) DEFAULT 'active'
);

-- Specialized Insurance
CREATE TABLE IF NOT EXISTS microinsurance_policies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  product_type VARCHAR(64),
  premium NUMERIC(10,2),
  coverage NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS takaful_pools (
  id SERIAL PRIMARY KEY,
  "poolName" VARCHAR(128),
  pool_name VARCHAR(128),
  "totalContributions" NUMERIC(14,2) DEFAULT 0,
  total_claims NUMERIC(14,2) DEFAULT 0,
  surplus NUMERIC(14,2) DEFAULT 0,
  "surplusDistributed" NUMERIC(14,2) DEFAULT 0,
  "wakalaFee" NUMERIC(6,4) DEFAULT 0,
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS takaful_sharia_principles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  category VARCHAR(32),
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS agricultural_schemes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  crop_type VARCHAR(64),
  region VARCHAR(64),
  coverage_type VARCHAR(32),
  "adminBody" VARCHAR(128),
  "enrollmentCount" INTEGER DEFAULT 0,
  "maxPayout" NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS agricultural_trigger_events (
  id SERIAL PRIMARY KEY,
  scheme_id INTEGER,
  event_type VARCHAR(32),
  threshold NUMERIC(10,4),
  "dataSource" VARCHAR(64),
  "affectedPolicies" INTEGER DEFAULT 0,
  "totalExposure" NUMERIC(14,2),
  "payoutAmount" NUMERIC(14,2),
  "payoutTriggered" BOOLEAN DEFAULT false,
  triggered BOOLEAN DEFAULT false,
  triggered_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agricultural_underwriting_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  description TEXT,
  factor VARCHAR(32),
  weight NUMERIC(6,4),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS ndvi_readings (
  id SERIAL PRIMARY KEY,
  region VARCHAR(64),
  satellite VARCHAR(32),
  ndvi_value NUMERIC(6,4),
  ndvi NUMERIC(6,4),
  reading_date TIMESTAMP,
  status VARCHAR(32) DEFAULT 'normal'
);

CREATE TABLE IF NOT EXISTS parametric_triggers (
  id SERIAL PRIMARY KEY,
  trigger_type VARCHAR(32),
  region VARCHAR(64),
  threshold NUMERIC(10,4),
  current_value NUMERIC(10,4),
  "affectedPolicies" INTEGER DEFAULT 0,
  triggered BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS sme_policies (
  id SERIAL PRIMARY KEY,
  "businessName" VARCHAR(256),
  "businessType" VARCHAR(64),
  "coverageAmount" NUMERIC(14,2),
  "annualPremium" NUMERIC(14,2),
  policy_type VARCHAR(64),
  premium NUMERIC(14,2),
  coverage NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS gig_coverage_policies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  "planId" VARCHAR(32),
  "planName" VARCHAR(128),
  platform VARCHAR(64),
  "coverageType" VARCHAR(32),
  status VARCHAR(32) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS p2p_pools (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  "poolName" VARCHAR(128),
  "memberCount" INTEGER DEFAULT 0,
  members INTEGER DEFAULT 0,
  "monthlyContribution" NUMERIC(14,2),
  "coveragePerMember" NUMERIC(14,2),
  "totalFund" NUMERIC(14,2) DEFAULT 0,
  total_fund NUMERIC(14,2) DEFAULT 0,
  status VARCHAR(32) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS geospatial_zones (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  risk_level VARCHAR(16),
  risk VARCHAR(16),
  polygon JSONB DEFAULT '[]'::jsonb,
  "lossRatio" NUMERIC(8,4),
  "affectedPolicies" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dynamic_pricing_history (
  id SERIAL PRIMARY KEY,
  product_id INTEGER,
  "productType" VARCHAR(64),
  "basePrice" NUMERIC(10,4),
  "basePremium" NUMERIC(10,4),
  "baseRate" NUMERIC(10,4),
  "adjustedRate" NUMERIC(10,4),
  "riskScore" NUMERIC(6,2),
  "effectiveDate" TIMESTAMP,
  reason TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Telco/PFA
CREATE TABLE IF NOT EXISTS telco_credit_scores (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20),
  provider VARCHAR(16),
  score INTEGER,
  data_points JSONB DEFAULT '{}'::jsonb,
  "lastUpdated" TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pfa_integration (
  id SERIAL PRIMARY KEY,
  pfa_name VARCHAR(128),
  "rsaPin" VARCHAR(32),
  "accountBalance" NUMERIC(14,2),
  "employeeContribution" NUMERIC(14,2),
  "employerContribution" NUMERIC(14,2),
  "totalContributions" NUMERIC(14,2),
  integration_type VARCHAR(32),
  "lastSync" TIMESTAMP,
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pfa_annuities (
  id SERIAL PRIMARY KEY,
  pfa_id INTEGER,
  user_id INTEGER,
  annuity_type VARCHAR(32),
  "monthlyPayout" NUMERIC(14,2),
  "lumpSum" NUMERIC(14,2),
  "startDate" TIMESTAMP,
  monthly_amount NUMERIC(14,2),
  status VARCHAR(32) DEFAULT 'active'
);

-- Telematics
CREATE TABLE IF NOT EXISTS telematics_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  "deviceId" VARCHAR(64) UNIQUE,
  "driverId" VARCHAR(32),
  "vehicleId" VARCHAR(32),
  device_type VARCHAR(32),
  "engineStatus" VARCHAR(16),
  "avgDailyKm" NUMERIC(10,2),
  "speedingEvents" INTEGER DEFAULT 0,
  "harshBraking" INTEGER DEFAULT 0,
  "nightDriving" NUMERIC(6,2) DEFAULT 0,
  "installDate" TIMESTAMP,
  "lastPing" TIMESTAMP,
  status VARCHAR(32) DEFAULT 'active',
  last_reading JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- USSD
CREATE TABLE IF NOT EXISTS ussd_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) UNIQUE,
  phone VARCHAR(20),
  menu_level INTEGER DEFAULT 0,
  current_input TEXT,
  response TEXT,
  status VARCHAR(16) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ussd_session_log (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64),
  phone VARCHAR(20),
  menu_level INTEGER,
  user_input TEXT,
  response TEXT,
  pin_verified BOOLEAN DEFAULT false,
  transaction_ref VARCHAR(32),
  status VARCHAR(16),
  expires_at TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ussd_analytics (
  id SERIAL PRIMARY KEY,
  metric_type VARCHAR(32),
  value NUMERIC(12,4),
  period VARCHAR(16),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Training & Gamification
CREATE TABLE IF NOT EXISTS training_courses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(256),
  description TEXT,
  category VARCHAR(64),
  duration_hours INTEGER,
  "readTime" INTEGER,
  is_active BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_enrollments (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER,
  course_id INTEGER,
  status VARCHAR(32) DEFAULT 'enrolled',
  progress INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS achievements (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  description TEXT,
  "pointsReward" INTEGER DEFAULT 0,
  badge_url TEXT,
  points INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  achievement_id INTEGER,
  "pointsReward" INTEGER DEFAULT 0,
  earned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gamification_levels (
  id SERIAL PRIMARY KEY,
  level_number INTEGER UNIQUE,
  name VARCHAR(64),
  min_points INTEGER,
  "pointsRequired" INTEGER,
  max_points INTEGER,
  benefits JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(32) UNIQUE,
  "minPoints" INTEGER,
  min_points INTEGER,
  "discountPct" NUMERIC(4,2),
  multiplier NUMERIC(4,2) DEFAULT 1.0,
  benefits JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER,
  activity VARCHAR(64),
  description TEXT,
  points INTEGER,
  tier VARCHAR(32),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- A/B Testing
CREATE TABLE IF NOT EXISTS ab_tests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  description TEXT,
  status VARCHAR(32) DEFAULT 'draft',
  variants JSONB DEFAULT '[]'::jsonb,
  variant_a TEXT,
  variant_b TEXT,
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ab_experiments (
  id SERIAL PRIMARY KEY,
  test_id INTEGER,
  variant VARCHAR(32),
  user_id INTEGER,
  "sampleSize" INTEGER DEFAULT 0,
  "trafficSplit" NUMERIC(4,2),
  "variantA" TEXT,
  "variantB" TEXT,
  "variantAConversion" NUMERIC(6,4),
  "variantBConversion" NUMERIC(6,4),
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  conversion BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insuretech_innovations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  category VARCHAR(64),
  description TEXT,
  "techStack" JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(32) DEFAULT 'research',
  adoption_pct NUMERIC(5,2) DEFAULT 0,
  "launchDate" TIMESTAMP
);

-- Health, Emergency, Savings
CREATE TABLE IF NOT EXISTS health_programs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128),
  program_type VARCHAR(32),
  "enrolledCount" INTEGER DEFAULT 0,
  "pointsReward" INTEGER DEFAULT 0,
  status VARCHAR(32) DEFAULT 'active',
  participants INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emergency_incidents (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "incidentType" VARCHAR(32),
  type VARCHAR(32),
  name VARCHAR(128),
  location TEXT,
  phone VARCHAR(20),
  contact_name VARCHAR(128),
  status VARCHAR(32) DEFAULT 'reported',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_plans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  name VARCHAR(128),
  "targetAmount" NUMERIC(14,2),
  "currentAmount" NUMERIC(14,2) DEFAULT 0,
  "interestRate" NUMERIC(6,4) DEFAULT 0,
  frequency VARCHAR(16),
  status VARCHAR(32) DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- DR & Backup
CREATE TABLE IF NOT EXISTS disaster_recovery_config (
  id SERIAL PRIMARY KEY,
  component VARCHAR(64),
  rto_hours INTEGER,
  rpo_hours INTEGER,
  replication_lag_seconds INTEGER DEFAULT 0,
  last_test_date TIMESTAMP,
  last_test_result VARCHAR(32),
  status VARCHAR(32) DEFAULT 'configured'
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_type VARCHAR(32),
  size_mb INTEGER,
  status VARCHAR(32) DEFAULT 'completed',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- ML/AI
CREATE TABLE IF NOT EXISTS insurance_radar_alerts (
  id SERIAL PRIMARY KEY,
  alert_type VARCHAR(64),
  severity VARCHAR(16),
  "actionRequired" TEXT,
  status VARCHAR(32) DEFAULT 'open',
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_security_audits (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(128),
  audit_date TIMESTAMP,
  overall_score NUMERIC(6,2),
  vulnerabilities_found INTEGER DEFAULT 0,
  vulnerabilities_patched INTEGER DEFAULT 0,
  encryption_status VARCHAR(32),
  inference_logging BOOLEAN DEFAULT false,
  recommendations JSONB DEFAULT '[]'::jsonb
);

-- Knowledge
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id SERIAL PRIMARY KEY,
  entity_name VARCHAR(128),
  entity_type VARCHAR(32),
  name VARCHAR(128),
  type VARCHAR(32),
  properties JSONB DEFAULT '{}'::jsonb,
  connections JSONB DEFAULT '[]'::jsonb,
  related_to JSONB DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Fund Flow Safety: Idempotency Keys (prevents duplicate fund movements)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(64) PRIMARY KEY,
  result JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

-- Fund Flow Safety: Fund Flow Events (Kafka event outbox pattern)
CREATE TABLE IF NOT EXISTS fund_flow_events (
  id SERIAL PRIMARY KEY,
  topic VARCHAR(128) NOT NULL,
  event_key VARCHAR(128),
  payload JSONB NOT NULL,
  status VARCHAR(16) DEFAULT 'pending',
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fund_events_status ON fund_flow_events (status) WHERE status = 'pending';

-- Fund Flow Safety: TigerBeetle Sync Outbox (ensures eventual consistency)
CREATE TABLE IF NOT EXISTS tigerbeetle_outbox (
  id SERIAL PRIMARY KEY,
  debit_account VARCHAR(128) NOT NULL,
  credit_account VARCHAR(128) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  ledger_id INTEGER DEFAULT 1,
  code INTEGER DEFAULT 0,
  trace_id VARCHAR(64),
  synced BOOLEAN DEFAULT false,
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tb_outbox_unsynced ON tigerbeetle_outbox (synced) WHERE synced = false;

-- Broker
CREATE TABLE IF NOT EXISTS broker_api_keys (
  id SERIAL PRIMARY KEY,
  broker_name VARCHAR(128),
  "apiKey" VARCHAR(64) UNIQUE,
  permissions JSONB DEFAULT '[]'::jsonb,
  "rateLimit" INTEGER DEFAULT 100,
  status VARCHAR(32) DEFAULT 'active',
  "expiresAt" TIMESTAMP,
  "lastUsed" TIMESTAMP,
  "lastUsedAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════
-- Persistence tables: eliminate in-memory state, persist to PostgreSQL
-- ═══════════════════════════════════════════════════════════════════════

-- User sessions (replaces in-memory sessions Map)
CREATE TABLE IF NOT EXISTS user_sessions (
  token VARCHAR(512) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

-- Token blacklist (replaces in-memory tokenBlacklist Set)
CREATE TABLE IF NOT EXISTS token_blacklist (
  token VARCHAR(512) PRIMARY KEY,
  blacklisted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist (expires_at);

-- Rate limiting (replaces in-memory rateLimits Map)
CREATE TABLE IF NOT EXISTS rate_limits (
  key VARCHAR(256) PRIMARY KEY,
  hits JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits (updated_at);

-- Request metrics (replaces in-memory metrics object)
CREATE TABLE IF NOT EXISTS request_metrics (
  id INTEGER PRIMARY KEY DEFAULT 1,
  requests BIGINT DEFAULT 0,
  errors BIGINT DEFAULT 0,
  latency_sum BIGINT DEFAULT 0,
  start_time TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO request_metrics (id, requests, errors, latency_sum) VALUES (1, 0, 0, 0) ON CONFLICT (id) DO NOTHING;

-- FX rates (replaces hardcoded rate constants)
CREATE TABLE IF NOT EXISTS fx_rates (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate NUMERIC(12,4) NOT NULL,
  source VARCHAR(64) DEFAULT 'manual',
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (from_currency, to_currency)
);
INSERT INTO fx_rates (from_currency, to_currency, rate, source) VALUES
  ('USD', 'NGN', 1550.0, 'cbn_reference'),
  ('GBP', 'NGN', 1960.0, 'cbn_reference'),
  ('EUR', 'NGN', 1680.0, 'cbn_reference'),
  ('GHS', 'NGN', 136.5, 'cbn_reference'),
  ('KES', 'NGN', 11.8, 'cbn_reference'),
  ('ZAR', 'NGN', 82.3, 'cbn_reference')
ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW();

-- Fraud velocity log (replaces Rust fraud-gate in-memory HashMap)
CREATE TABLE IF NOT EXISTS fraud_velocity_log (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  recipient VARCHAR(128),
  recorded_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fraud_velocity_user ON fraud_velocity_log (user_id, recorded_at);

COMMIT;
