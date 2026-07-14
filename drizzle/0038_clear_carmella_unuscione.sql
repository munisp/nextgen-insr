CREATE TYPE IF NOT EXISTS "public"."billing_model_type" AS ENUM('revenue_share', 'subscription', 'hybrid');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_reconciliation_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_period" varchar(20) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"billing_model" "billing_model_type" NOT NULL,
	"status" "reconciliation_status" DEFAULT 'pending' NOT NULL,
	"projected_transactions" integer,
	"projected_gross_volume" numeric(18, 2),
	"projected_platform_revenue" numeric(15, 2),
	"projected_client_revenue" numeric(15, 2),
	"projected_agents" integer,
	"projected_tx_per_agent" numeric(8, 2),
	"actual_transactions" integer,
	"actual_gross_volume" numeric(18, 2),
	"actual_platform_revenue" numeric(15, 2),
	"actual_client_revenue" numeric(15, 2),
	"actual_agents" integer,
	"actual_tx_per_agent" numeric(8, 2),
	"revenue_variance_pct" numeric(8, 2),
	"volume_variance_pct" numeric(8, 2),
	"agent_variance_pct" numeric(8, 2),
	"insights" json,
	"generated_by" varchar(64) DEFAULT 'billing-reconciliation-engine',
	"approved_by" varchar(64),
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_revenue_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_type" varchar(10) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"gross_volume" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"total_fees" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_client_revenue" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_platform_revenue" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_agent_commissions" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_switch_fees" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_aggregator_fees" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"breakdown_by_type" json,
	"breakdown_by_region" json,
	"active_agents" integer DEFAULT 0 NOT NULL,
	"active_field_agent_devicess" integer DEFAULT 0 NOT NULL,
	"avg_tx_per_agent" numeric(8, 2) DEFAULT '0.00',
	"period_opex_estimate" numeric(15, 2) DEFAULT '0.00',
	"net_platform_profit" numeric(15, 2) DEFAULT '0.00',
	"billing_model" "billing_model_type" DEFAULT 'revenue_share' NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"data_source_hash" varchar(64)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_billing_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"transaction_ref" varchar(64) NOT NULL,
	"transaction_type" varchar(32) NOT NULL,
	"agent_id" integer NOT NULL,
	"field_agent_devices_id" integer,
	"gross_amount" numeric(15, 2) NOT NULL,
	"gross_fee" numeric(12, 2) NOT NULL,
	"agent_commission" numeric(12, 2) NOT NULL,
	"switch_fee" numeric(12, 2) NOT NULL,
	"aggregator_fee" numeric(12, 2) NOT NULL,
	"platform_net_fee" numeric(12, 2) NOT NULL,
	"billing_model" "billing_model_type" DEFAULT 'revenue_share' NOT NULL,
	"client_revenue" numeric(12, 2) NOT NULL,
	"platform_revenue" numeric(12, 2) NOT NULL,
	"revenue_share_pct" numeric(5, 2),
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"region" varchar(32),
	"carrier" varchar(32),
	"tigerbeetle_transfer_id" varchar(64),
	"kafka_offset" varchar(64),
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "brr_period_idx" ON "billing_reconciliation_reports" USING btree ("report_period");--> statement-breakpoint
CREATE INDEX "brr_status_idx" ON "billing_reconciliation_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "brr_billing_model_idx" ON "billing_reconciliation_reports" USING btree ("billing_model");--> statement-breakpoint
CREATE INDEX "brp_period_type_idx" ON "billing_revenue_periods" USING btree ("period_type");--> statement-breakpoint
CREATE INDEX "brp_period_start_idx" ON "billing_revenue_periods" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "brp_composite_idx" ON "billing_revenue_periods" USING btree ("period_type","period_start","billing_model");--> statement-breakpoint
CREATE INDEX "pbl_tx_ref_idx" ON "platform_billing_ledger" USING btree ("transaction_ref");--> statement-breakpoint
CREATE INDEX "pbl_agent_idx" ON "platform_billing_ledger" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "pbl_processed_at_idx" ON "platform_billing_ledger" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "pbl_billing_model_idx" ON "platform_billing_ledger" USING btree ("billing_model");--> statement-breakpoint
CREATE INDEX "pbl_region_idx" ON "platform_billing_ledger" USING btree ("region");