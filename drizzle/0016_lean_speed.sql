CREATE TYPE "public"."api_key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."credit_application_status" AS ENUM('pending', 'approved', 'rejected', 'disbursed', 'repaid', 'defaulted');--> statement-breakpoint
CREATE TYPE "public"."credit_rating" AS ENUM('AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'D', 'N/A');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."fido2_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."merchant_category" AS ENUM('retail', 'food_beverage', 'health', 'education', 'transport', 'utilities', 'government', 'other');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('pending', 'active', 'suspended', 'closed');--> statement-breakpoint
ALTER TYPE "public"."ad_status" ADD VALUE 'completed' BEFORE 'expired';--> statement-breakpoint
ALTER TYPE "public"."link_status" ADD VALUE 'paused' BEFORE 'used';--> statement-breakpoint
ALTER TYPE "public"."link_status" ADD VALUE 'deleted' BEFORE 'used';--> statement-breakpoint
ALTER TYPE "public"."link_type" ADD VALUE 'collection' BEFORE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."link_type" ADD VALUE 'profile' BEFORE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."qr_code_type" ADD VALUE 'profile' BEFORE 'agent_id';--> statement-breakpoint
ALTER TYPE "public"."qr_code_type" ADD VALUE 'collection' BEFORE 'agent_id';--> statement-breakpoint
ALTER TYPE "public"."reversal_status" ADD VALUE 'processed' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."sim_status" ADD VALUE 'inactive' BEFORE 'standby';--> statement-breakpoint
ALTER TYPE "public"."sim_status" ADD VALUE 'suspended' BEFORE 'standby';--> statement-breakpoint
CREATE TABLE "api_key_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"apiKeyId" integer NOT NULL,
	"endpoint" varchar(256) NOT NULL,
	"method" varchar(8) NOT NULL,
	"statusCode" integer NOT NULL,
	"responseMs" integer,
	"ipAddress" varchar(45),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"keyHash" varchar(128) NOT NULL,
	"keyPrefix" varchar(12) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"userId" integer NOT NULL,
	"tenantId" integer,
	"status" "api_key_status" DEFAULT 'active' NOT NULL,
	"scopes" json DEFAULT '[]'::json,
	"rateLimit" integer DEFAULT 1000 NOT NULL,
	"lastUsedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	CONSTRAINT "api_keys_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentId" integer NOT NULL,
	"requestedAmount" numeric(15, 2) NOT NULL,
	"approvedAmount" numeric(15, 2),
	"interestRate" numeric(5, 4) DEFAULT '0.05',
	"termDays" integer DEFAULT 30 NOT NULL,
	"status" "credit_application_status" DEFAULT 'pending' NOT NULL,
	"scoreAtApplication" integer,
	"reviewedBy" varchar(64),
	"reviewNote" text,
	"reviewedAt" timestamp,
	"disbursedAt" timestamp,
	"dueAt" timestamp,
	"repaidAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_score_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentId" integer NOT NULL,
	"score" integer NOT NULL,
	"rating" "credit_rating" NOT NULL,
	"factors" json DEFAULT '{}'::json,
	"computedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_rights_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestType" varchar(32) NOT NULL,
	"requesterId" integer,
	"requesterType" varchar(32) NOT NULL,
	"requesterEmail" varchar(320) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"exportFileUrl" text,
	"processedBy" varchar(64),
	"processedAt" timestamp,
	"notes" text,
	"tenantId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"toAddress" varchar(320) NOT NULL,
	"toName" varchar(128),
	"subject" varchar(256) NOT NULL,
	"templateName" varchar(64) NOT NULL,
	"templateData" json DEFAULT '{}'::json,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"sentAt" timestamp,
	"errorMessage" text,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"tenantId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fido2_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenge" varchar(128) NOT NULL,
	"userId" integer,
	"agentId" integer,
	"type" varchar(32) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fido2_challenges_challenge_unique" UNIQUE("challenge")
);
--> statement-breakpoint
CREATE TABLE "fido2_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"agentId" integer,
	"credentialId" text NOT NULL,
	"publicKey" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"deviceType" varchar(64),
	"transports" json DEFAULT '[]'::json,
	"status" "fido2_status" DEFAULT 'active' NOT NULL,
	"lastUsedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fido2_credentials_credentialId_unique" UNIQUE("credentialId")
);
--> statement-breakpoint
CREATE TABLE "merchant_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchantId" integer NOT NULL,
	"period" varchar(10) NOT NULL,
	"grossAmount" numeric(15, 2) NOT NULL,
	"feeAmount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"netAmount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"settledAt" timestamp,
	"bankRef" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchantCode" varchar(32) NOT NULL,
	"businessName" varchar(128) NOT NULL,
	"ownerName" varchar(128) NOT NULL,
	"email" varchar(320),
	"phone" varchar(20) NOT NULL,
	"address" text,
	"category" "merchant_category" DEFAULT 'retail' NOT NULL,
	"status" "merchant_status" DEFAULT 'pending' NOT NULL,
	"rcNumber" varchar(32),
	"tinNumber" varchar(32),
	"settlementAccountNumber" varchar(20),
	"settlementBankCode" varchar(10),
	"settlementBankName" varchar(64),
	"walletBalance" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"totalVolume" numeric(20, 2) DEFAULT '0.00' NOT NULL,
	"totalTransactions" integer DEFAULT 0 NOT NULL,
	"preferredAgentId" integer,
	"keycloakSub" varchar(128),
	"passwordHash" varchar(256),
	"deletedAt" timestamp,
	"tenantId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_merchantCode_unique" UNIQUE("merchantCode"),
	CONSTRAINT "merchants_keycloakSub_unique" UNIQUE("keycloakSub")
);
--> statement-breakpoint
CREATE TABLE "ota_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"releaseNotes" text,
	"s3Key" text NOT NULL,
	"downloadUrl" text NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"fileSize" integer NOT NULL,
	"isForced" boolean DEFAULT false NOT NULL,
	"rolloutPercent" integer DEFAULT 100 NOT NULL,
	"targetModels" json DEFAULT '[]'::json,
	"minCurrentVersion" varchar(32),
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"publishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ota_releases_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "ota_update_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"deviceId" integer NOT NULL,
	"releaseId" integer NOT NULL,
	"fromVersion" varchar(32),
	"toVersion" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"integrationName" varchar(64) NOT NULL,
	"secret" varchar(256) NOT NULL,
	"algorithm" varchar(32) DEFAULT 'sha256' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastRotatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_secrets_integrationName_unique" UNIQUE("integrationName")
);
--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP CONSTRAINT "field_agent_devicess_agentId_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "commission_rules" ALTER COLUMN "ruleType" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "commission_rules" ALTER COLUMN "ruleType" SET DEFAULT 'percentage'::text;--> statement-breakpoint
DROP TYPE "public"."commission_rule_type";--> statement-breakpoint
CREATE TYPE "public"."commission_rule_type" AS ENUM('percentage', 'flat', 'tiered');--> statement-breakpoint
ALTER TABLE "commission_rules" ALTER COLUMN "ruleType" SET DEFAULT 'percentage'::"public"."commission_rule_type";--> statement-breakpoint
ALTER TABLE "commission_rules" ALTER COLUMN "ruleType" SET DATA TYPE "public"."commission_rule_type" USING "ruleType"::"public"."commission_rule_type";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DEFAULT 'pending_kyc'::text;--> statement-breakpoint
DROP TYPE "public"."customer_status";--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('pending_kyc', 'active', 'suspended', 'blacklisted');--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DEFAULT 'pending_kyc'::"public"."customer_status";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" SET DATA TYPE "public"."customer_status" USING "status"::"public"."customer_status";--> statement-breakpoint
ALTER TABLE "qr_codes" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "qr_codes" ALTER COLUMN "status" SET DEFAULT 'active'::text;--> statement-breakpoint
DROP TYPE "public"."qr_code_status";--> statement-breakpoint
CREATE TYPE "public"."qr_code_status" AS ENUM('active', 'used', 'expired', 'revoked');--> statement-breakpoint
ALTER TABLE "qr_codes" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."qr_code_status";--> statement-breakpoint
ALTER TABLE "qr_codes" ALTER COLUMN "status" SET DATA TYPE "public"."qr_code_status" USING "status"::"public"."qr_code_status";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DEFAULT 'trial'::text;--> statement-breakpoint
DROP TYPE "public"."tenant_status";--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('trial', 'active', 'suspended', 'churned');--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DEFAULT 'trial'::"public"."tenant_status";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DATA TYPE "public"."tenant_status" USING "status"::"public"."tenant_status";--> statement-breakpoint
ALTER TABLE "vat_records" ALTER COLUMN "rateType" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "vat_records" ALTER COLUMN "rateType" SET DEFAULT 'standard'::text;--> statement-breakpoint
DROP TYPE "public"."vat_rate_type";--> statement-breakpoint
CREATE TYPE "public"."vat_rate_type" AS ENUM('standard', 'zero', 'exempt');--> statement-breakpoint
ALTER TABLE "vat_records" ALTER COLUMN "rateType" SET DEFAULT 'standard'::"public"."vat_rate_type";--> statement-breakpoint
ALTER TABLE "vat_records" ALTER COLUMN "rateType" SET DATA TYPE "public"."vat_rate_type" USING "rateType"::"public"."vat_rate_type";--> statement-breakpoint
ALTER TABLE "compliance_reports" ALTER COLUMN "periodStart" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_reports" ALTER COLUMN "periodEnd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_reports" ALTER COLUMN "generatedBy" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "compliance_reports" ALTER COLUMN "generatedBy" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_commands" ALTER COLUMN "command" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "device_commands" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "device_commands" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "device_commands" ALTER COLUMN "issuedAt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ALTER COLUMN "agentId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ALTER COLUMN "withinZone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ALTER COLUMN "reportedAt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "agentId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "enrolledAt" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "enrollmentToken" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "dispute_messages" ALTER COLUMN "authorName" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispute_messages" ALTER COLUMN "authorRole" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "dispute_messages" ALTER COLUMN "authorRole" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dispute_messages" ALTER COLUMN "message" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "transactionId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "transactionRef" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "geofence_zones" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "geofence_zones" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "geofence_zones" ALTER COLUMN "radiusMetres" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ALTER COLUMN "agentId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "kyc_sessions" ALTER COLUMN "livenessScore" SET DATA TYPE numeric(5, 2);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ALTER COLUMN "docType" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "mqtt_bridge_config" ALTER COLUMN "brokerUrl" SET DEFAULT 'mqtt://broker.insureportal.io:1883';--> statement-breakpoint
ALTER TABLE "platform_settings" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ALTER COLUMN "status" SET DEFAULT 'unassigned';--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ALTER COLUMN "lastCommand" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "supervisor_agents" ALTER COLUMN "supervisorUserId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "creditScore" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "creditLimit" numeric(15, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "creditRating" "credit_rating" DEFAULT 'N/A';--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "reportType" varchar(64) DEFAULT 'compliance';--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "period" varchar(32) DEFAULT '';--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "status" varchar(32) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "fileUrl" text;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "summary" json;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD COLUMN "updatedAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "device_commands" ADD COLUMN "executedAt" timestamp;--> statement-breakpoint
ALTER TABLE "device_commands" ADD COLUMN "result" json;--> statement-breakpoint
ALTER TABLE "device_commands" ADD COLUMN "createdAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "altitude" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "speed" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "heading" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "source" varchar(32) DEFAULT 'gps';--> statement-breakpoint
ALTER TABLE "device_locations" ADD COLUMN "createdAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "imei" varchar(20);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "simIccid" varchar(22);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "lastLocation" json;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "createdAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD COLUMN "senderType" varchar(32);--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD COLUMN "senderName" varchar(128);--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD COLUMN "attachmentUrl" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "type" varchar(64) DEFAULT 'general';--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "priority" varchar(16) DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "description" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "assignedTo" varchar(64);--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "float_topup_requests" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "geofence_zones" ADD COLUMN "type" varchar(32) DEFAULT 'circle' NOT NULL;--> statement-breakpoint
ALTER TABLE "geofence_zones" ADD COLUMN "centerLat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "geofence_zones" ADD COLUMN "centerLng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "geofence_zones" ADD COLUMN "radiusMeters" integer;--> statement-breakpoint
ALTER TABLE "geofence_zones" ADD COLUMN "polygonJson" json;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "customerId" integer;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "sessionRef" varchar(64) DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "type" varchar(32) DEFAULT 'agent_onboarding' NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "bvn" varchar(11);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "nin" varchar(11);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "selfieUrl" text;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "idDocUrl" text;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "idDocType" varchar(32);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "idDocNumber" varchar(64);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "matchScore" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "reviewedBy" varchar(64);--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "reviewNote" text;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "reviewedAt" timestamp;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "expiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "otp_tokens" ADD COLUMN "purpose" varchar(32) DEFAULT 'pin_reset' NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_tokens" ADD COLUMN "usedAt" timestamp;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "osVersion" varchar(32);--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "imei" varchar(20);--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "simIccid" varchar(22);--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "lastSeenAt" timestamp;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "lastLocation" json;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "field_agent_devicess" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "supervisor_agents" ADD COLUMN "supervisorId" integer;--> statement-breakpoint
ALTER TABLE "supervisor_agents" ADD COLUMN "removedAt" timestamp;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "webhookSecret" varchar(128);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "idempotencyKey" varchar(64);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency" varchar(8) DEFAULT 'NGN' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfaEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfaEnforcedAt" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "velocity_limits" ADD COLUMN "dailyTxLimit" numeric(15, 2) DEFAULT '500000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "velocity_limits" ADD COLUMN "singleTxLimit" numeric(15, 2) DEFAULT '100000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "velocity_limits" ADD COLUMN "hourlyTxCount" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "velocity_limits" ADD COLUMN "dailyTxCount" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_apiKeyId_api_keys_id_fk" FOREIGN KEY ("apiKeyId") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_score_history" ADD CONSTRAINT "credit_score_history_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fido2_challenges" ADD CONSTRAINT "fido2_challenges_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fido2_challenges" ADD CONSTRAINT "fido2_challenges_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fido2_credentials" ADD CONSTRAINT "fido2_credentials_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fido2_credentials" ADD CONSTRAINT "fido2_credentials_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_preferredAgentId_agents_id_fk" FOREIGN KEY ("preferredAgentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ota_update_log" ADD CONSTRAINT "ota_update_log_deviceId_devices_id_fk" FOREIGN KEY ("deviceId") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ota_update_log" ADD CONSTRAINT "ota_update_log_releaseId_ota_releases_id_fk" FOREIGN KEY ("releaseId") REFERENCES "public"."ota_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apiusage_apiKeyId_createdAt_idx" ON "api_key_usage" USING btree ("apiKeyId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "apikeys_keyHash_idx" ON "api_keys" USING btree ("keyHash");--> statement-breakpoint
CREATE INDEX "apikeys_userId_idx" ON "api_keys" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "apikeys_status_idx" ON "api_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_app_agentId_status_idx" ON "credit_applications" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "credit_agentId_computedAt_idx" ON "credit_score_history" USING btree ("agentId","computedAt");--> statement-breakpoint
CREATE INDEX "ddr_status_createdAt_idx" ON "data_rights_requests" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "email_status_createdAt_idx" ON "email_queue" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "fido2ch_challenge_idx" ON "fido2_challenges" USING btree ("challenge");--> statement-breakpoint
CREATE INDEX "fido2ch_expiresAt_idx" ON "fido2_challenges" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "fido2_credentialId_idx" ON "fido2_credentials" USING btree ("credentialId");--> statement-breakpoint
CREATE INDEX "fido2_userId_idx" ON "fido2_credentials" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "fido2_agentId_idx" ON "fido2_credentials" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "ms_merchantId_period_idx" ON "merchant_settlements" USING btree ("merchantId","period");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_merchantCode_idx" ON "merchants" USING btree ("merchantCode");--> statement-breakpoint
CREATE INDEX "merchants_status_idx" ON "merchants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "merchants_tenantId_idx" ON "merchants" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "merchants_deletedAt_idx" ON "merchants" USING btree ("deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ota_version_idx" ON "ota_releases" USING btree ("version");--> statement-breakpoint
CREATE INDEX "ota_status_idx" ON "ota_releases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ota_log_deviceId_idx" ON "ota_update_log" USING btree ("deviceId");--> statement-breakpoint
CREATE INDEX "ota_log_releaseId_idx" ON "ota_update_log" USING btree ("releaseId");--> statement-breakpoint
CREATE INDEX "agz_agentId_idx" ON "agent_geofence_zones" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_agentCode_idx" ON "agents" USING btree ("agentCode");--> statement-breakpoint
CREATE INDEX "agents_isActive_idx" ON "agents" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "agents_deletedAt_idx" ON "agents" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "agents_tenantId_idx" ON "agents" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "agents_tier_idx" ON "agents" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "analytics_metricName_bucket_idx" ON "analytics_metrics" USING btree ("metricName","bucketMinute");--> statement-breakpoint
CREATE INDEX "audit_agentId_createdAt_idx" ON "audit_log" USING btree ("agentId","createdAt");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_tenantId_idx" ON "audit_log" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "chat_msg_sessionId_idx" ON "chat_messages" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "chat_agentId_status_idx" ON "chat_sessions" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "compliance_tenantId_period_idx" ON "compliance_reports" USING btree ("tenantId","period");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customers_tenantId_idx" ON "customers" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "customers_deletedAt_idx" ON "customers" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "cmd_deviceId_status_idx" ON "device_commands" USING btree ("deviceId","status");--> statement-breakpoint
CREATE INDEX "dloc_deviceId_createdAt_idx" ON "device_locations" USING btree ("deviceId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_serialNumber_idx" ON "devices" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "devices_agentId_idx" ON "devices" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "devices_status_idx" ON "devices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "devices_tenantId_idx" ON "devices" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "dispute_msg_disputeId_idx" ON "dispute_messages" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "dispute_agentId_status_idx" ON "disputes" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "dispute_tenantId_idx" ON "disputes" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "erp_status_nextRetry_idx" ON "erp_sync_log" USING btree ("status","nextRetryAt");--> statement-breakpoint
CREATE INDEX "erp_entityType_idx" ON "erp_sync_log" USING btree ("entityType");--> statement-breakpoint
CREATE INDEX "topup_agentId_status_idx" ON "float_topup_requests" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "topup_tenantId_idx" ON "float_topup_requests" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "fraud_agentId_idx" ON "fraud_alerts" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "fraud_status_createdAt_idx" ON "fraud_alerts" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "fraud_severity_idx" ON "fraud_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "fraud_tenantId_idx" ON "fraud_alerts" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "kyc_agentId_status_idx" ON "kyc_sessions" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "kyc_customerId_idx" ON "kyc_sessions" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "kyc_tenantId_idx" ON "kyc_sessions" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "loyalty_agentId_idx" ON "loyalty_history" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "otp_agentId_idx" ON "otp_tokens" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "otp_expiresAt_idx" ON "otp_tokens" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_serialNumber_idx" ON "field_agent_devicess" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "pos_agentId_idx" ON "field_agent_devicess" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "pos_status_idx" ON "field_agent_devicess" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pos_tenantId_idx" ON "field_agent_devicess" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "qr_agentId_status_idx" ON "qr_codes" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "qr_expiresAt_idx" ON "qr_codes" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "reversal_agentId_status_idx" ON "reversal_requests" USING btree ("agentId","status");--> statement-breakpoint
CREATE INDEX "svc_terminalId_idx" ON "service_records" USING btree ("terminalId");--> statement-breakpoint
CREATE INDEX "links_agentId_idx" ON "shareable_links" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "links_slug_idx" ON "shareable_links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "supv_supervisorId_idx" ON "supervisor_agents" USING btree ("supervisorId");--> statement-breakpoint
CREATE INDEX "supv_agentId_idx" ON "supervisor_agents" USING btree ("agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tx_agentId_createdAt_idx" ON "transactions" USING btree ("agentId","createdAt");--> statement-breakpoint
CREATE INDEX "tx_status_createdAt_idx" ON "transactions" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_ref_idx" ON "transactions" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_idempotencyKey_idx" ON "transactions" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "tx_deletedAt_idx" ON "transactions" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "tx_tenantId_idx" ON "transactions" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tx_type_createdAt_idx" ON "transactions" USING btree ("type","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "users_keycloakSub_idx" ON "users" USING btree ("keycloakSub");--> statement-breakpoint
CREATE INDEX "users_tenantId_idx" ON "users" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "vat_agentId_period_idx" ON "vat_records" USING btree ("agentId","period");--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP COLUMN "lastHeartbeatAt";--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP COLUMN "locationLat";--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP COLUMN "locationLng";--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP COLUMN "simProfile";--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP COLUMN "enrollmentToken";--> statement-breakpoint
ALTER TABLE "field_agent_devicess" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "kyc_sessions" ADD CONSTRAINT "kyc_sessions_sessionRef_unique" UNIQUE("sessionRef");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_idempotencyKey_unique" UNIQUE("idempotencyKey");--> statement-breakpoint
DROP TYPE "public"."command_status";--> statement-breakpoint
DROP TYPE "public"."device_command";--> statement-breakpoint
DROP TYPE "public"."device_status";--> statement-breakpoint
DROP TYPE "public"."dispute_author_role";--> statement-breakpoint
DROP TYPE "public"."dispute_status";--> statement-breakpoint
DROP TYPE "public"."kyc_doc_type";--> statement-breakpoint
DROP TYPE "public"."kyc_status";--> statement-breakpoint
DROP TYPE "public"."terminal_command";--> statement-breakpoint
DROP TYPE "public"."terminal_status";