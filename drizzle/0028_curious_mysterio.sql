CREATE TYPE "public"."cross_border_remittance_status" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('percentage', 'flat', 'tiered');--> statement-breakpoint
CREATE TYPE "public"."invite_code_status" AS ENUM('active', 'used', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invite_code_type" AS ENUM('one_time', 'multi_use');--> statement-breakpoint
CREATE TYPE "public"."tenant_user_role" AS ENUM('tenant_admin', 'tenant_operator', 'tenant_viewer');--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"type" "invite_code_type" DEFAULT 'one_time' NOT NULL,
	"status" "invite_code_status" DEFAULT 'active' NOT NULL,
	"maxUses" integer DEFAULT 1 NOT NULL,
	"usedCount" integer DEFAULT 0 NOT NULL,
	"createdBy" integer,
	"assignedTenantId" integer,
	"partnerName" varchar(128),
	"partnerEmail" varchar(320),
	"notes" text,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"logoUrl" text,
	"faviconUrl" text,
	"primaryColor" varchar(9) DEFAULT '#2563EB' NOT NULL,
	"secondaryColor" varchar(9) DEFAULT '#1E40AF' NOT NULL,
	"accentColor" varchar(9) DEFAULT '#F59E0B' NOT NULL,
	"backgroundColor" varchar(9) DEFAULT '#0F172A' NOT NULL,
	"textColor" varchar(9) DEFAULT '#F8FAFC' NOT NULL,
	"fontFamily" varchar(64) DEFAULT 'Inter' NOT NULL,
	"brandName" varchar(128),
	"tagline" varchar(256),
	"customDomain" varchar(256),
	"supportEmail" varchar(320),
	"supportPhone" varchar(20),
	"termsUrl" text,
	"privacyUrl" text,
	"customCss" text,
	"isLive" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_cross_border_remittances" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"sourceCountry" varchar(3) NOT NULL,
	"sourceCurrency" varchar(3) NOT NULL,
	"destinationCountry" varchar(3) NOT NULL,
	"destinationCurrency" varchar(3) NOT NULL,
	"status" "cross_border_remittance_status" DEFAULT 'active' NOT NULL,
	"minAmount" numeric(20, 2) DEFAULT '10.00' NOT NULL,
	"maxAmount" numeric(20, 2) DEFAULT '1000000.00' NOT NULL,
	"dailyLimit" numeric(20, 2) DEFAULT '5000000.00' NOT NULL,
	"estimatedDeliveryMinutes" integer DEFAULT 30 NOT NULL,
	"paymentMethods" json DEFAULT '["bank_transfer","mobile_money"]'::json,
	"deliveryMethods" json DEFAULT '["bank_deposit","mobile_wallet"]'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_fee_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"cross_border_remittanceId" integer,
	"txType" varchar(64) DEFAULT 'transfer' NOT NULL,
	"feeType" "fee_type" DEFAULT 'percentage' NOT NULL,
	"feeValue" numeric(10, 4) DEFAULT '1.5000' NOT NULL,
	"minFee" numeric(20, 2) DEFAULT '100.00' NOT NULL,
	"maxFee" numeric(20, 2) DEFAULT '50000.00' NOT NULL,
	"tieredRules" json,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"userId" integer,
	"email" varchar(320) NOT NULL,
	"name" varchar(128),
	"role" "tenant_user_role" DEFAULT 'tenant_viewer' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"invitedBy" integer,
	"invitedAt" timestamp DEFAULT now() NOT NULL,
	"acceptedAt" timestamp,
	"lastActiveAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_idx" ON "invite_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "invite_codes_status_idx" ON "invite_codes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invite_codes_createdBy_idx" ON "invite_codes" USING btree ("createdBy");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_branding_tenantId_idx" ON "tenant_branding" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tenant_cross_border_remittances_tenantId_idx" ON "tenant_cross_border_remittances" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tenant_cross_border_remittances_route_idx" ON "tenant_cross_border_remittances" USING btree ("sourceCountry","destinationCountry");--> statement-breakpoint
CREATE INDEX "tenant_fee_overrides_tenantId_idx" ON "tenant_fee_overrides" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tenant_fee_overrides_cross_border_remittanceId_idx" ON "tenant_fee_overrides" USING btree ("cross_border_remittanceId");--> statement-breakpoint
CREATE INDEX "tenant_users_tenantId_idx" ON "tenant_users" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "tenant_users_email_idx" ON "tenant_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "tenant_users_userId_idx" ON "tenant_users" USING btree ("userId");