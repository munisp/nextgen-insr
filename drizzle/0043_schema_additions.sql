-- Migration: 0043_schema_additions
-- Adds missing tables referenced in routers but absent from schema.ts
-- Tables: insurance_categories, insurance_inventory, insurance_carts,
--         insurance_cart_items, policy_orders, insurance_order_items,
--         pos_terminals, claims_payments, commissions, premiums,
--         service_nodes, underwriting_applications, marketplace_ads

-- ─── Insurance Categories ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "insurance_categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(128) NOT NULL,
  "slug" varchar(128) NOT NULL,
  "description" text,
  "parentId" integer,
  "iconUrl" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "sortOrder" integer DEFAULT 0,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ins_cat_slug_idx" ON "insurance_categories" ("slug");
CREATE INDEX IF NOT EXISTS "ins_cat_tenant_idx" ON "insurance_categories" ("tenantId");
CREATE INDEX IF NOT EXISTS "ins_cat_active_idx" ON "insurance_categories" ("isActive");

-- ─── Insurance Inventory ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "insurance_inventory" (
  "id" serial PRIMARY KEY NOT NULL,
  "productId" integer NOT NULL,
  "sku" varchar(64) NOT NULL,
  "quantityAvailable" integer DEFAULT 0 NOT NULL,
  "quantityReserved" integer DEFAULT 0 NOT NULL,
  "reorderPoint" integer DEFAULT 10,
  "maxStock" integer DEFAULT 1000,
  "tenantId" varchar(64),
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ins_inv_sku_idx" ON "insurance_inventory" ("sku");
CREATE INDEX IF NOT EXISTS "ins_inv_product_idx" ON "insurance_inventory" ("productId");
CREATE INDEX IF NOT EXISTS "ins_inv_tenant_idx" ON "insurance_inventory" ("tenantId");

-- ─── Insurance Carts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "insurance_carts" (
  "id" serial PRIMARY KEY NOT NULL,
  "customerId" integer,
  "agentId" integer,
  "sessionId" varchar(128),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "totalAmount" numeric(15, 2) DEFAULT '0',
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "tenantId" varchar(64),
  "expiresAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ins_cart_customer_idx" ON "insurance_carts" ("customerId");
CREATE INDEX IF NOT EXISTS "ins_cart_agent_idx" ON "insurance_carts" ("agentId");
CREATE INDEX IF NOT EXISTS "ins_cart_session_idx" ON "insurance_carts" ("sessionId");
CREATE INDEX IF NOT EXISTS "ins_cart_status_idx" ON "insurance_carts" ("status");
CREATE INDEX IF NOT EXISTS "ins_cart_tenant_idx" ON "insurance_carts" ("tenantId");

-- ─── Insurance Cart Items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "insurance_cart_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "cartId" integer NOT NULL,
  "productId" integer NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unitPrice" numeric(15, 2) NOT NULL,
  "totalPrice" numeric(15, 2) NOT NULL,
  "coveragePeriodMonths" integer DEFAULT 12,
  "beneficiaryData" jsonb,
  "addedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ins_cart_item_cart_idx" ON "insurance_cart_items" ("cartId");
CREATE INDEX IF NOT EXISTS "ins_cart_item_product_idx" ON "insurance_cart_items" ("productId");

-- ─── Policy Orders ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "policy_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "orderRef" varchar(64) NOT NULL,
  "customerId" integer,
  "agentId" integer,
  "cartId" integer,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "totalAmount" numeric(15, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "paymentMethod" varchar(64),
  "paymentRef" varchar(128),
  "paymentStatus" varchar(32) DEFAULT 'pending',
  "tbTransferId" varchar(128),
  "notes" text,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pol_order_ref_idx" ON "policy_orders" ("orderRef");
CREATE INDEX IF NOT EXISTS "pol_order_customer_idx" ON "policy_orders" ("customerId");
CREATE INDEX IF NOT EXISTS "pol_order_agent_idx" ON "policy_orders" ("agentId");
CREATE INDEX IF NOT EXISTS "pol_order_status_idx" ON "policy_orders" ("status");
CREATE INDEX IF NOT EXISTS "pol_order_created_idx" ON "policy_orders" ("createdAt");
CREATE INDEX IF NOT EXISTS "pol_order_tenant_idx" ON "policy_orders" ("tenantId");

-- ─── Insurance Order Items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "insurance_order_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "orderId" integer NOT NULL,
  "productId" integer NOT NULL,
  "policyId" integer,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unitPrice" numeric(15, 2) NOT NULL,
  "totalPrice" numeric(15, 2) NOT NULL,
  "coveragePeriodMonths" integer DEFAULT 12,
  "startDate" timestamp,
  "endDate" timestamp,
  "beneficiaryData" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ins_order_item_order_idx" ON "insurance_order_items" ("orderId");
CREATE INDEX IF NOT EXISTS "ins_order_item_product_idx" ON "insurance_order_items" ("productId");
CREATE INDEX IF NOT EXISTS "ins_order_item_policy_idx" ON "insurance_order_items" ("policyId");

-- ─── POS Terminals ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pos_terminals" (
  "id" serial PRIMARY KEY NOT NULL,
  "terminalId" varchar(64) NOT NULL,
  "agentId" integer,
  "serialNumber" varchar(128) NOT NULL,
  "model" varchar(128),
  "manufacturer" varchar(128),
  "firmwareVersion" varchar(64),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "lastHeartbeat" timestamp,
  "ipAddress" varchar(64),
  "location" jsonb,
  "groupId" integer,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pos_terminal_id_idx" ON "pos_terminals" ("terminalId");
CREATE INDEX IF NOT EXISTS "pos_agent_idx" ON "pos_terminals" ("agentId");
CREATE INDEX IF NOT EXISTS "pos_status_idx" ON "pos_terminals" ("status");
CREATE INDEX IF NOT EXISTS "pos_tenant_idx" ON "pos_terminals" ("tenantId");
CREATE INDEX IF NOT EXISTS "pos_heartbeat_idx" ON "pos_terminals" ("lastHeartbeat");

-- ─── Claims Payments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "claims_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "claimId" integer NOT NULL,
  "paymentRef" varchar(128) NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "paymentMethod" varchar(64) NOT NULL,
  "beneficiaryName" varchar(256),
  "beneficiaryAccount" varchar(64),
  "beneficiaryBank" varchar(128),
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "tbTransferId" varchar(128),
  "processedAt" timestamp,
  "failureReason" text,
  "approvedBy" integer,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "claims_pay_ref_idx" ON "claims_payments" ("paymentRef");
CREATE INDEX IF NOT EXISTS "claims_pay_claim_idx" ON "claims_payments" ("claimId");
CREATE INDEX IF NOT EXISTS "claims_pay_status_idx" ON "claims_payments" ("status");
CREATE INDEX IF NOT EXISTS "claims_pay_tenant_idx" ON "claims_payments" ("tenantId");
CREATE INDEX IF NOT EXISTS "claims_pay_created_idx" ON "claims_payments" ("createdAt");

-- ─── Commissions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "commissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "agentId" integer NOT NULL,
  "transactionId" integer,
  "policyId" integer,
  "commissionType" varchar(64) NOT NULL,
  "grossAmount" numeric(15, 2) NOT NULL,
  "taxAmount" numeric(15, 2) DEFAULT '0',
  "netAmount" numeric(15, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "payoutId" integer,
  "tbTransferId" varchar(128),
  "periodStart" timestamp,
  "periodEnd" timestamp,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "comm_agent_created_idx" ON "commissions" ("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "comm_status_idx" ON "commissions" ("status");
CREATE INDEX IF NOT EXISTS "comm_tx_idx" ON "commissions" ("transactionId");
CREATE INDEX IF NOT EXISTS "comm_tenant_idx" ON "commissions" ("tenantId");
CREATE INDEX IF NOT EXISTS "comm_payout_idx" ON "commissions" ("payoutId");

-- ─── Premiums ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "premiums" (
  "id" serial PRIMARY KEY NOT NULL,
  "policyId" integer NOT NULL,
  "customerId" integer,
  "agentId" integer,
  "premiumRef" varchar(128) NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'NGN' NOT NULL,
  "dueDate" timestamp NOT NULL,
  "paidDate" timestamp,
  "status" varchar(32) DEFAULT 'due' NOT NULL,
  "paymentMethod" varchar(64),
  "paymentRef" varchar(128),
  "tbTransferId" varchar(128),
  "gracePeriodDays" integer DEFAULT 30,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "premium_ref_idx" ON "premiums" ("premiumRef");
CREATE INDEX IF NOT EXISTS "premium_policy_idx" ON "premiums" ("policyId");
CREATE INDEX IF NOT EXISTS "premium_status_due_idx" ON "premiums" ("status", "dueDate");
CREATE INDEX IF NOT EXISTS "premium_agent_idx" ON "premiums" ("agentId");
CREATE INDEX IF NOT EXISTS "premium_tenant_idx" ON "premiums" ("tenantId");

-- ─── Service Nodes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "service_nodes" (
  "id" serial PRIMARY KEY NOT NULL,
  "serviceName" varchar(128) NOT NULL,
  "serviceId" varchar(128) NOT NULL,
  "host" varchar(256) NOT NULL,
  "port" integer NOT NULL,
  "protocol" varchar(16) DEFAULT 'http' NOT NULL,
  "status" varchar(32) DEFAULT 'healthy' NOT NULL,
  "version" varchar(32),
  "region" varchar(64),
  "tags" jsonb,
  "healthCheckUrl" text,
  "lastHealthCheck" timestamp,
  "consecutiveFailures" integer DEFAULT 0,
  "metadata" jsonb,
  "registeredAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "svc_node_id_idx" ON "service_nodes" ("serviceId");
CREATE INDEX IF NOT EXISTS "svc_node_name_status_idx" ON "service_nodes" ("serviceName", "status");
CREATE INDEX IF NOT EXISTS "svc_node_region_idx" ON "service_nodes" ("region");

-- ─── Underwriting Applications ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "underwriting_applications" (
  "id" serial PRIMARY KEY NOT NULL,
  "applicationRef" varchar(128) NOT NULL,
  "customerId" integer,
  "agentId" integer,
  "productId" integer NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "riskScore" numeric(5, 2),
  "riskCategory" varchar(32),
  "sumInsured" numeric(15, 2),
  "proposedPremium" numeric(15, 2),
  "finalPremium" numeric(15, 2),
  "loadingPct" numeric(5, 2) DEFAULT '0',
  "exclusions" jsonb,
  "conditions" jsonb,
  "underwriterNotes" text,
  "underwriterId" integer,
  "reviewedAt" timestamp,
  "decisionAt" timestamp,
  "applicationData" jsonb,
  "aiRiskAssessment" jsonb,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uw_app_ref_idx" ON "underwriting_applications" ("applicationRef");
CREATE INDEX IF NOT EXISTS "uw_app_customer_idx" ON "underwriting_applications" ("customerId");
CREATE INDEX IF NOT EXISTS "uw_app_status_idx" ON "underwriting_applications" ("status");
CREATE INDEX IF NOT EXISTS "uw_app_product_idx" ON "underwriting_applications" ("productId");
CREATE INDEX IF NOT EXISTS "uw_app_risk_idx" ON "underwriting_applications" ("riskCategory");
CREATE INDEX IF NOT EXISTS "uw_app_tenant_idx" ON "underwriting_applications" ("tenantId");
CREATE INDEX IF NOT EXISTS "uw_app_created_idx" ON "underwriting_applications" ("createdAt");

-- ─── Marketplace Ads ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketplace_ads" (
  "id" serial PRIMARY KEY NOT NULL,
  "adRef" varchar(64) NOT NULL,
  "title" varchar(256) NOT NULL,
  "description" text,
  "imageUrl" text,
  "targetUrl" text,
  "advertiserName" varchar(256),
  "adType" varchar(32) DEFAULT 'banner' NOT NULL,
  "placement" varchar(64),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "startDate" timestamp,
  "endDate" timestamp,
  "impressions" integer DEFAULT 0,
  "clicks" integer DEFAULT 0,
  "budget" numeric(15, 2),
  "spent" numeric(15, 2) DEFAULT '0',
  "targetAudience" jsonb,
  "tenantId" varchar(64),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_ad_ref_idx" ON "marketplace_ads" ("adRef");
CREATE INDEX IF NOT EXISTS "mkt_ad_status_idx" ON "marketplace_ads" ("status");
CREATE INDEX IF NOT EXISTS "mkt_ad_placement_idx" ON "marketplace_ads" ("placement");
CREATE INDEX IF NOT EXISTS "mkt_ad_tenant_idx" ON "marketplace_ads" ("tenantId");
CREATE INDEX IF NOT EXISTS "mkt_ad_date_idx" ON "marketplace_ads" ("startDate", "endDate");
