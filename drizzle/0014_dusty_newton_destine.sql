CREATE TYPE "public"."mqtt_qos" AS ENUM('0', '1', '2');--> statement-breakpoint
CREATE TABLE "mqtt_bridge_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) DEFAULT 'POS MQTT Bridge' NOT NULL,
	"brokerUrl" text DEFAULT 'mqtt://localhost:1883' NOT NULL,
	"port" integer DEFAULT 1883 NOT NULL,
	"useTls" boolean DEFAULT false NOT NULL,
	"username" varchar(128) DEFAULT '',
	"password" text DEFAULT '',
	"clientId" varchar(128) DEFAULT 'insureportal-fluvio-bridge',
	"topicMappings" json DEFAULT '[]'::json,
	"qos" "mqtt_qos" DEFAULT '1' NOT NULL,
	"keepAliveSeconds" integer DEFAULT 60 NOT NULL,
	"reconnectDelayMs" integer DEFAULT 5000 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"lastTestAt" timestamp,
	"lastTestStatus" varchar(32) DEFAULT 'never',
	"lastTestError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
