CREATE TABLE "sim_orchestrator_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"terminalId" varchar(32) NOT NULL,
	"probeIntervalMs" integer DEFAULT 30000 NOT NULL,
	"relayEndpoint" varchar(256) DEFAULT 'https://api.insureportal.io/api/trpc/simOrchestrator.ingestProbe' NOT NULL,
	"apiKey" varchar(128) DEFAULT 'insureportal-sim-orchestrator-default-key' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_orchestrator_config_terminalId_unique" UNIQUE("terminalId")
);
--> statement-breakpoint
CREATE TABLE "sim_probe_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentCode" varchar(32) NOT NULL,
	"terminalId" varchar(32) NOT NULL,
	"slot" varchar(8) NOT NULL,
	"carrier" varchar(32) NOT NULL,
	"mccMnc" integer NOT NULL,
	"rssi" integer NOT NULL,
	"regStatus" integer NOT NULL,
	"latencyMs" integer NOT NULL,
	"packetLossX10" integer NOT NULL,
	"score" integer NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"latE6" integer,
	"lonE6" integer,
	"fwVersion" varchar(16),
	"probedAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sim_orchestrator_config_terminal_idx" ON "sim_orchestrator_config" USING btree ("terminalId");--> statement-breakpoint
CREATE INDEX "sim_probe_log_agent_probed_idx" ON "sim_probe_log" USING btree ("agentCode","probedAt");--> statement-breakpoint
CREATE INDEX "sim_probe_log_slot_probed_idx" ON "sim_probe_log" USING btree ("slot","probedAt");