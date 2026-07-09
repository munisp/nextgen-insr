CREATE TYPE "public"."ad_status" AS ENUM('draft', 'active', 'paused', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."commission_rule_type" AS ENUM('flat', 'percentage', 'tiered');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'suspended', 'pending_kyc', 'closed');--> statement-breakpoint
CREATE TYPE "public"."erp_sync_status" AS ENUM('pending', 'synced', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('in_stock', 'low_stock', 'out_of_stock', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."kyc_doc_type" AS ENUM('NIN', 'BVN_CARD', 'PASSPORT', 'DRIVERS_LICENCE', 'VOTER_CARD');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'liveness_passed', 'liveness_failed', 'document_passed', 'document_failed', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('active', 'expired', 'used', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('payment', 'invoice', 'subscription', 'donation');--> statement-breakpoint
CREATE TYPE "public"."qr_code_status" AS ENUM('active', 'expired', 'used', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."qr_code_type" AS ENUM('payment', 'agent_id', 'product', 'event', 'loyalty');--> statement-breakpoint
CREATE TYPE "public"."reversal_status" AS ENUM('pending', 'approved', 'rejected', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sim_status" AS ENUM('active', 'standby', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'trial', 'churned');--> statement-breakpoint
CREATE TYPE "public"."terminal_command" AS ENUM('reboot', 'lock', 'unlock', 'update_firmware', 'diagnostics', 'sync_config', 'wipe');--> statement-breakpoint
CREATE TYPE "public"."terminal_status" AS ENUM('active', 'inactive', 'maintenance', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."vat_rate_type" AS ENUM('standard', 'zero', 'exempt', 'reduced');--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"txType" "tx_type" NOT NULL,
	"ruleType" "commission_rule_type" DEFAULT 'percentage' NOT NULL,
	"value" numeric(10, 4) NOT NULL,
	"minAmount" numeric(15, 2),
	"maxAmount" numeric(15, 2),
	"tieredJson" json,
	"agentTier" "agent_tier",
	"isActive" boolean DEFAULT true NOT NULL,
	"effectiveFrom" timestamp DEFAULT now() NOT NULL,
	"effectiveTo" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"externalId" varchar(128),
	"firstName" varchar(64) NOT NULL,
	"lastName" varchar(64) NOT NULL,
	"email" varchar(320),
	"phone" varchar(20) NOT NULL,
	"bvn" varchar(11),
	"nin" varchar(11),
	"dateOfBirth" varchar(10),
	"address" text,
	"status" "customer_status" DEFAULT 'pending_kyc' NOT NULL,
	"kycLevel" integer DEFAULT 0 NOT NULL,
	"walletBalance" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"dailyLimit" numeric(15, 2) DEFAULT '50000.00' NOT NULL,
	"monthlyLimit" numeric(15, 2) DEFAULT '300000.00' NOT NULL,
	"preferredAgentId" integer,
	"keycloakSub" varchar(128),
	"passwordHash" varchar(256),
	"refreshToken" text,
	"lastLoginAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_externalId_unique" UNIQUE("externalId"),
	CONSTRAINT "customers_phone_unique" UNIQUE("phone"),
	CONSTRAINT "customers_keycloakSub_unique" UNIQUE("keycloakSub")
);
--> statement-breakpoint
CREATE TABLE "erp_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityType" varchar(64) NOT NULL,
	"entityId" varchar(64) NOT NULL,
	"erpDocType" varchar(64),
	"erpDocName" varchar(128),
	"status" "erp_sync_status" DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"payload" json,
	"syncedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"category" varchar(64),
	"description" text,
	"quantityOnHand" integer DEFAULT 0 NOT NULL,
	"quantityReserved" integer DEFAULT 0 NOT NULL,
	"reorderPoint" integer DEFAULT 10 NOT NULL,
	"unitCost" numeric(15, 2),
	"status" "inventory_status" DEFAULT 'in_stock' NOT NULL,
	"warehouseLocation" varchar(64),
	"supplierId" varchar(64),
	"lastRestockedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "kyc_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentId" integer NOT NULL,
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"livenessScore" numeric(5, 4),
	"livenessMethod" varchar(64),
	"livenessChallenge" varchar(128),
	"livenessPassed" boolean,
	"docType" "kyc_doc_type",
	"docExtractedName" varchar(256),
	"docExtractedDob" varchar(32),
	"docExtractedIdNumber" varchar(64),
	"docConfidence" numeric(5, 4),
	"docFraudIndicators" json,
	"livenessRaw" json,
	"ocrRaw" json,
	"complianceRecordId" varchar(64),
	"rejectionReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multi_sim_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"terminalId" integer NOT NULL,
	"simSlot" integer DEFAULT 1 NOT NULL,
	"carrier" varchar(64) NOT NULL,
	"iccid" varchar(22),
	"phoneNumber" varchar(20),
	"status" "sim_status" DEFAULT 'active' NOT NULL,
	"signalStrength" integer,
	"dataUsageMb" numeric(12, 2) DEFAULT '0',
	"failoverPriority" integer DEFAULT 1 NOT NULL,
	"lastCheckedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_agent_devicess" (
	"id" serial PRIMARY KEY NOT NULL,
	"serialNumber" varchar(64) NOT NULL,
	"model" varchar(64) DEFAULT 'PAX A920 MAX' NOT NULL,
	"firmwareVersion" varchar(32),
	"appVersion" varchar(32),
	"agentId" integer,
	"status" "terminal_status" DEFAULT 'active' NOT NULL,
	"lastHeartbeatAt" timestamp,
	"lastCommandAt" timestamp,
	"lastCommand" "terminal_command",
	"configJson" json,
	"groupId" integer,
	"locationLat" numeric(10, 7),
	"locationLng" numeric(10, 7),
	"simProfile" varchar(64),
	"enrollmentToken" varchar(128),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_agent_devicess_serialNumber_unique" UNIQUE("serialNumber")
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(256) NOT NULL,
	"type" "qr_code_type" DEFAULT 'payment' NOT NULL,
	"status" "qr_code_status" DEFAULT 'active' NOT NULL,
	"agentId" integer,
	"amount" numeric(15, 2),
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"description" text,
	"metadata" json,
	"expiresAt" timestamp,
	"usedAt" timestamp,
	"usedByCustomerId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "reversal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"transactionId" varchar(64) NOT NULL,
	"agentId" integer NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" "reversal_status" DEFAULT 'pending' NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNote" text,
	"tbReversalId" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"terminalId" integer NOT NULL,
	"technicianName" varchar(128),
	"issueDescription" text NOT NULL,
	"resolution" text,
	"partsReplaced" json,
	"serviceDate" timestamp DEFAULT now() NOT NULL,
	"nextServiceDate" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shareable_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"type" "link_type" DEFAULT 'payment' NOT NULL,
	"status" "link_status" DEFAULT 'active' NOT NULL,
	"agentId" integer NOT NULL,
	"amount" numeric(15, 2),
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"description" text,
	"metadata" json,
	"clickCount" integer DEFAULT 0 NOT NULL,
	"conversionCount" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shareable_links_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "software_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"releaseNotes" text,
	"downloadUrl" text NOT NULL,
	"checksum" varchar(128),
	"isForced" boolean DEFAULT false NOT NULL,
	"targetModels" json,
	"appliedCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_product_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"body" text,
	"imageUrl" text,
	"targetUrl" text,
	"agentId" integer,
	"status" "ad_status" DEFAULT 'draft' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"budget" numeric(12, 2),
	"spent" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"startsAt" timestamp,
	"endsAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"country" varchar(3) DEFAULT 'NGA' NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"planId" varchar(64),
	"agentCount" integer DEFAULT 0 NOT NULL,
	"terminalCount" integer DEFAULT 0 NOT NULL,
	"monthlyVolume" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"contactEmail" varchar(320),
	"contactPhone" varchar(20),
	"configJson" json,
	"keycloakRealmId" varchar(128),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "terminal_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"configJson" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vat_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"transactionId" varchar(64) NOT NULL,
	"agentId" integer NOT NULL,
	"taxableAmount" numeric(15, 2) NOT NULL,
	"vatAmount" numeric(15, 2) NOT NULL,
	"vatRate" numeric(5, 4) DEFAULT '0.075' NOT NULL,
	"rateType" "vat_rate_type" DEFAULT 'standard' NOT NULL,
	"tinNumber" varchar(32),
	"period" varchar(7) NOT NULL,
	"remittedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_openId_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "keycloakSub" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_preferredAgentId_agents_id_fk" FOREIGN KEY ("preferredAgentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multi_sim_profiles" ADD CONSTRAINT "multi_sim_profiles_terminalId_field_agent_devicess_id_fk" FOREIGN KEY ("terminalId") REFERENCES "public"."field_agent_devicess"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD CONSTRAINT "field_agent_devicess_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversal_requests" ADD CONSTRAINT "reversal_requests_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversal_requests" ADD CONSTRAINT "reversal_requests_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_terminalId_field_agent_devicess_id_fk" FOREIGN KEY ("terminalId") REFERENCES "public"."field_agent_devicess"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shareable_links" ADD CONSTRAINT "shareable_links_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_product_promotions" ADD CONSTRAINT "insurance_product_promotions_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_records" ADD CONSTRAINT "vat_records_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "openId";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_keycloakSub_unique" UNIQUE("keycloakSub");