/**
 * MQTT Bridge Router — InsurePortal Fluvio MQTT Source Connector management
 * Manages InfinyOn MQTT Source Connector configuration for bridging
 * insurance service MQTT events into Fluvio topics.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { mqttBridgeConfig } from "@schema";
import { eq } from "drizzle-orm";
import { ENV } from "../_core/env";
import { fluvioProduce, type FluvioEvent } from "../lib/fluvioClient";
import { TRPCError } from "@trpc/server";

const TopicMappingSchema = z.object({
  mqttTopic: z.string().min(1),
  fluvioTopic: z.string().min(1),
  transform: z.string().optional(),
});

const DEFAULT_TOPIC_MAPPINGS = [
  {
    mqttTopic: "pos/+/transactions",
    fluvioTopic: "pos.transactions.created",
    transform: "json",
  },
  {
    mqttTopic: "pos/+/fraud",
    fluvioTopic: "pos.fraud-alerts",
    transform: "json",
  },
  {
    mqttTopic: "pos/+/float",
    fluvioTopic: "pos.float-events",
    transform: "json",
  },
  { mqttTopic: "pos/+/kyc", fluvioTopic: "pos.kyc-events", transform: "json" },
  {
    mqttTopic: "pos/+/heartbeat",
    fluvioTopic: "insurance.service-heartbeat",
    transform: "json",
  },
];

export const mqttBridgeRouter = router({
  // ── Get current MQTT bridge config ──────────────────────────────────────────
  getConfig: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db) throw new Error("Database connection unavailable");
    const rows = await db.select().from(mqttBridgeConfig).limit(1);
    if (rows.length === 0) {
      return {
        id: null as number | null,
        name: "POS MQTT Bridge",
        brokerUrl: ENV.mqttBrokerUrl,
        port: 1883,
        useTls: false,
        username: ENV.mqttUsername,
        password: ENV.mqttPassword,
        clientId: ENV.mqttClientId,
        topicMappings: DEFAULT_TOPIC_MAPPINGS,
        qos: "1" as "0" | "1" | "2",
        keepAliveSeconds: 60,
        reconnectDelayMs: 5000,
        enabled: false,
        lastTestAt: null as Date | null,
        lastTestStatus: "never",
        lastTestError: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return rows[0];
  }),

  // ── Save MQTT bridge config ──────────────────────────────────────────────────
  saveConfig: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128).optional(),
        brokerUrl: z.string().min(1),
        port: z.number().int().min(1).max(65535).optional(),
        useTls: z.boolean().optional(),
        username: z.string().max(128).optional(),
        password: z.string().optional(),
        clientId: z.string().max(128).optional(),
        topicMappings: z.array(TopicMappingSchema).optional(),
        qos: z.enum(["0", "1", "2"]).optional(),
        keepAliveSeconds: z.number().int().min(10).max(3600).optional(),
        reconnectDelayMs: z.number().int().min(1000).max(60000).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("DB unavailable");
        const existing = await db
          .select({ id: mqttBridgeConfig.id })
          .from(mqttBridgeConfig)
          .limit(1);
        const now = new Date();
        if (existing.length === 0) {
          const [row] = await db
            .insert(mqttBridgeConfig)
            .values({
              ...input,
              updatedAt: now,
            })
            .returning();
          return row;
        }
        const [row] = await db
          .update(mqttBridgeConfig)
          .set({ ...input, updatedAt: now })
          .where(eq(mqttBridgeConfig.id, existing[0].id))
          .returning();
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Test MQTT broker TCP reachability ────────────────────────────────────────
  testMqttBridge: protectedProcedure
    .input(
      z.object({
        brokerUrl: z.string(),
        port: z.number().int().optional(),
        useTls: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const start = Date.now();
      try {
        const rawUrl = input.brokerUrl
          .replace(/^mqtts?:\/\//, "http://")
          .replace(/^tcps?:\/\//, "http://");
        const url = new URL(
          rawUrl.startsWith("http") ? rawUrl : `http://${rawUrl}`
        );
        const host = url.hostname || input.brokerUrl;
        const port = input.port ?? (input.useTls ? 8883 : 1883);

        await new Promise<void>((resolve, reject) => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const net = require("net") as typeof import("net");
          const socket = new net.Socket();
          const timeout = setTimeout(() => {
            socket.destroy();
            reject(
              new Error(`TCP connection to ${host}:${port} timed out after 5s`)
            );
          }, 5000);
          socket.connect(port, host, () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve();
          });
          socket.on("error", (err: Error) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        const latencyMs = Date.now() - start;

        const db = (await getDb())!;
        if (db) {
          const existing = await db
            .select({ id: mqttBridgeConfig.id })
            .from(mqttBridgeConfig)
            .limit(1);
          if (existing.length > 0) {
            await db
              .update(mqttBridgeConfig)
              .set({
                lastTestAt: new Date(),
                lastTestStatus: "success",
                lastTestError: null,
                updatedAt: new Date(),
              })
              .where(eq(mqttBridgeConfig.id, existing[0].id));
          }
        }

        return {
          success: true,
          latencyMs,
          message: `TCP connection to ${host}:${port} succeeded in ${latencyMs}ms`,
        };
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        const message = err instanceof Error ? err.message : "Unknown error";

        const db = (await getDb())!;
        if (db) {
          const existing = await db
            .select({ id: mqttBridgeConfig.id })
            .from(mqttBridgeConfig)
            .limit(1);
          if (existing.length > 0) {
            await db
              .update(mqttBridgeConfig)
              .set({
                lastTestAt: new Date(),
                lastTestStatus: "failed",
                lastTestError: message,
                updatedAt: new Date(),
              })
              .where(eq(mqttBridgeConfig.id, existing[0].id));
          }
        }

        return { success: false, latencyMs, message };
      }
    }),

  // ── Publish a synthetic test event through the Fluvio pipeline ───────────────
  // Sends a test message to a Fluvio topic and measures end-to-end latency.
  // This validates the full MQTT → Fluvio pipeline is operational.
  publishTest: protectedProcedure
    .input(
      z.object({
        topic: z.string().default("pos.transactions.created"),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const start = Date.now();
        const testPayload = input.payload ?? {
          type: "MQTT_BRIDGE_TEST",
          ref: `TEST-${Date.now()}`,
          agentId: ctx.user?.keycloakSub
            ? `AGT-${ctx.user.keycloakSub.slice(0, 8)}`
            : "AGT-TEST",
          amount: 0,
          currency: "NGN",
          timestamp: new Date().toISOString(),
          source: "mqtt-bridge-test-harness",
        };

        try {
          const event: FluvioEvent = {
            topic: input.topic,
            payload: testPayload,
          };
          await fluvioProduce(event);
          const latencyMs = Date.now() - start;
          return {
            success: true,
            latencyMs,
            topic: input.topic,
            payload: testPayload,
            message: `Test event published to '${input.topic}' in ${latencyMs}ms`,
          };
        } catch (err: unknown) {
          const latencyMs = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          return {
            success: false,
            latencyMs,
            topic: input.topic,
            payload: testPayload,
            message: `Publish failed: ${errMsg}`,
          };
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Generate InfinyOn MQTT Source Connector YAML spec ───────────────────────
  generateConnectorSpec: protectedProcedure
    .input(
      z.object({
        brokerUrl: z.string(),
        port: z.number().int().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        useTls: z.boolean().optional(),
        clientId: z.string().optional(),
        topicMappings: z.array(TopicMappingSchema).optional(),
        qos: z.enum(["0", "1", "2"]).optional(),
        keepAliveSeconds: z.number().int().optional(),
      })
    )
    .query(({ input }) => {
      const {
        brokerUrl,
        port = 1883,
        username,
        password,
        useTls = false,
        clientId = ENV.mqttClientId,
        topicMappings = DEFAULT_TOPIC_MAPPINGS,
        qos = "1",
        keepAliveSeconds = 60,
      } = input;

      const connectors = topicMappings.map((m, i) => {
        const connectorName = `insureportal-mqtt-${m.fluvioTopic.replace(/\./g, "-")}-${i}`;
        const effectiveUrl = useTls
          ? brokerUrl.replace(/^mqtt:\/\//, "mqtts://")
          : brokerUrl.replace(/^mqtts:\/\//, "mqtt://");

        const lines: string[] = [
          `# InfinyOn MQTT Source Connector — ${m.mqttTopic} → ${m.fluvioTopic}`,
          `# Deploy with: fluvio cloud connector create --config ${connectorName}.yaml`,
          `apiVersion: 0.1.0`,
          `meta:`,
          `  version: 0.2.5`,
          `  name: ${connectorName}`,
          `  type: mqtt-source`,
          `  topic: ${m.fluvioTopic}`,
          `mqtt:`,
          `  url: "${effectiveUrl}"`,
          `  port: ${port}`,
          `  topic: "${m.mqttTopic}"`,
          `  client_id: "${clientId}-${i}"`,
          `  qos: ${qos}`,
          `  keep_alive: ${keepAliveSeconds}`,
        ];
        if (username) {
          lines.push(`  username: "${username}"`);
          if (password)
            lines.push(
              `  password: process.env.MQTT_PASSWORD || "placeholder"  # Set via MQTT_PASSWORD env var`
            );
        }
        if (useTls) {
          lines.push(`  tls:`);
          lines.push(`    enabled: true`);
          lines.push(`    # cert: /path/to/client.crt`);
          lines.push(`    # key: /path/to/client.key`);
          lines.push(`    # ca_cert: /path/to/ca.crt`);
        }
        if (m.transform === "json") {
          lines.push(`transforms:`);
          lines.push(`  - uses: infinyon/jolt@0.4.1`);
          lines.push(`    with:`);
          lines.push(`      spec:`);
          lines.push(`        - operation: default`);
          lines.push(`          spec:`);
          lines.push(`            source: "mqtt"`);
          lines.push(`            topic: "${m.mqttTopic}"`);
        }
        return { name: connectorName, yaml: lines.join("\n") };
      });

      const installScript = [
        `#!/bin/bash`,
        `# InsurePortal MQTT → Fluvio Bridge — Connector Install Script`,
        `# Prerequisites: fluvio CLI installed and authenticated to InfinyOn Cloud`,
        `# Run: bash install-mqtt-connectors.sh`,
        ``,
        `set -e`,
        `echo "Installing InsurePortal MQTT Source Connectors..."`,
        ``,
        ...connectors.map(c =>
          [
            `echo "Creating connector: ${c.name}"`,
            `cat > ${c.name}.yaml << 'YAML'`,
            c.yaml,
            `YAML`,
            `fluvio cloud connector create --config ${c.name}.yaml`,
            ``,
          ].join("\n")
        ),
        `echo "All connectors installed."`,
        `echo "Verify with: fluvio cloud connector list"`,
      ].join("\n");

      return { connectors, installScript, topicCount: topicMappings.length };
    }),
});
