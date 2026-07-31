-- Migration: 0044_database_indexes
-- Adds optimised indexes for all high-query tables
-- Covers: transactions, agents, claims, policies, fraud_alerts, customers,
--         audit_log, kyc_verifications, commissions, premiums, etc.

-- ─── Transactions ─────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_agent_created_idx" ON "transactions" ("agentId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_status_created_idx" ON "transactions" ("status", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_type_created_idx" ON "transactions" ("type", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_customer_created_idx" ON "transactions" ("customerId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_amount_idx" ON "transactions" (CAST("amount" AS NUMERIC));
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_ref_idx" ON "transactions" ("reference");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_tenant_created_idx" ON "transactions" ("tenantId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tx_tb_sync_idx" ON "transactions" ("tbSyncStatus") WHERE "tbSyncStatus" != 'synced';

-- ─── Agents ───────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_status_tier_idx" ON "agents" ("status", "tier");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_supervisor_idx" ON "agents" ("supervisorId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_tenant_idx" ON "agents" ("tenantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_phone_idx" ON "agents" ("phone");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_created_idx" ON "agents" ("createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_float_idx" ON "agents" (CAST("premiumReserve" AS NUMERIC));

-- ─── Claims ───────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_policy_idx" ON "claims" ("policyId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_status_created_idx" ON "claims" ("status", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_type_idx" ON "claims" ("claimType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_claimant_idx" ON "claims" ("claimantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_incident_idx" ON "claims" ("incidentDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_amount_idx" ON "claims" (CAST("claimedAmount" AS NUMERIC));

-- ─── Policies ─────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_customer_idx" ON "policies" ("customerId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_agent_idx" ON "policies" ("agentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_status_idx" ON "policies" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_product_idx" ON "policies" ("productId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_renewal_idx" ON "policies" ("renewalDate") WHERE "status" = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_end_date_idx" ON "policies" ("endDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_number_idx" ON "policies" ("policyNumber");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_tenant_idx" ON "policies" ("tenantId");

-- ─── Fraud Alerts ─────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fraud_tx_idx" ON "fraud_alerts" ("transactionId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fraud_agent_idx" ON "fraud_alerts" ("agentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fraud_score_idx" ON "fraud_alerts" ("fraudScore" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fraud_status_created_idx" ON "fraud_alerts" ("status", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fraud_severity_idx" ON "fraud_alerts" ("severity");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fraud_tenant_idx" ON "fraud_alerts" ("tenantId");

-- ─── Customers ────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_phone_idx" ON "customers" ("phone");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_email_idx" ON "customers" ("email");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_kyc_idx" ON "customers" ("kycStatus");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_agent_idx" ON "customers" ("agentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_tenant_idx" ON "customers" ("tenantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_created_idx" ON "customers" ("createdAt" DESC);

-- ─── Audit Log ────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_action_created_idx" ON "audit_log" ("action", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_user_created_idx" ON "audit_log" ("userId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_resource_idx" ON "audit_log" ("resource", "resourceId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_tenant_created_idx" ON "audit_log" ("tenantId", "createdAt" DESC);

-- ─── KYC Verifications ────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_customer_idx" ON "kyc_verifications" ("customerId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_status_idx" ON "kyc_verifications" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_agent_idx" ON "kyc_verifications" ("agentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kyc_created_idx" ON "kyc_verifications" ("createdAt" DESC);

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_role_idx" ON "users" ("role");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_tenant_idx" ON "users" ("tenantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_created_idx" ON "users" ("createdAt" DESC);

-- ─── GL Entries ───────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "gl_account_date_idx" ON "gl_entries" ("accountCode", "entryDate" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "gl_type_date_idx" ON "gl_entries" ("entryType", "entryDate" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "gl_tenant_date_idx" ON "gl_entries" ("tenantId", "entryDate" DESC);

-- ─── Compliance Checks ────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "compliance_entity_idx" ON "compliance_checks" ("entityType", "entityId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "compliance_status_idx" ON "compliance_checks" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "compliance_type_idx" ON "compliance_checks" ("checkType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "compliance_created_idx" ON "compliance_checks" ("createdAt" DESC);

-- ─── Policy Renewals ──────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "renewal_policy_idx" ON "policy_renewals" ("originalPolicyId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "renewal_status_due_idx" ON "policy_renewals" ("status", "renewalDueDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "renewal_auto_idx" ON "policy_renewals" ("isAutoRenewal") WHERE "isAutoRenewal" = true;

-- ─── Reinsurance ──────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reins_treaty_status_idx" ON "reinsurance_treaties" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reins_cession_treaty_idx" ON "reinsurance_cessions" ("treatyId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reins_cession_policy_idx" ON "reinsurance_cessions" ("policyId");

-- ─── Reversal Requests ────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reversal_agent_status_idx" ON "reversal_requests" ("agentId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reversal_status_created_idx" ON "reversal_requests" ("status", "id" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reversal_tx_idx" ON "reversal_requests" ("transactionId");

-- ─── Fluvio Event Log ─────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fluvio_topic_created_idx" ON "fluvio_event_log" ("topic", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "fluvio_status_idx" ON "fluvio_event_log" ("status");

-- ─── TigerBeetle Sync Log ─────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tb_sync_status_idx" ON "tiger_beetle_sync_log" ("syncStatus");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tb_sync_created_idx" ON "tiger_beetle_sync_log" ("createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tb_sync_entity_idx" ON "tiger_beetle_sync_log" ("entityType", "entityId");

-- ─── Platform Billing Ledger ──────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "billing_tenant_created_idx" ON "platform_billing_ledger" ("tenantId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "billing_type_idx" ON "platform_billing_ledger" ("entryType");
