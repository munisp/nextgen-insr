// @ts-check
/**
 * MDM Router — Mobile Device Management for 54Link POS terminals
 *
 * Provides admin-only procedures for:
 *   - Device registry (enroll, list, get, update status)
 *   - Remote command dispatch (UPDATE, RECONFIG, RESTART, WIPE, PING)
 *   - Config push (JSON config to device)
 *   - OTA update trigger
 *   - Device heartbeat (called by mdm-agent on POS terminal)
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDb } from "../db";
import {
  devices,
  deviceCommands,
  agents,
  deviceCompliancePolicies,
  deviceComplianceViolations,
  mdmGeofenceViolations,
  geofenceZones,
  otaReleases,
  otaUpdateLog,
} from "../../drizzle/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getIO } from "../socketSingleton";
import { writeAuditLog } from "../db";

// =============================================================================
// NAVIGATION GUIDE — MDM Router (1,436 lines, 23 procedures)
// =============================================================================
// Mobile Device Management for 54Link POS terminals.
//
// ── Section Reference ────────────────────────────────────────────────────────
//  59. listDevices            — Enrolled devices list with agent info
// 107. getDevice              — Single device details
// 143. issueCommand           — Remote command (UPDATE, RECONFIG, RESTART, WIPE, PING)
// 202. pushConfig             — Push JSON config to device
// 247. triggerOtaUpdate       — Trigger OTA firmware update
// 318. stats                  — Device stats (online/offline/total)
// 348. heartbeat              — Device heartbeat (public, called by mdm-agent)
// 708. generateEnrollmentToken— Generate token for device enrollment
// 787. enrollWithToken        — Enroll device using token (public)
// 870. ackCommand             — Device acknowledges command
// 917. disableTerminal        — Disable a terminal
// 976. listPolicies           — Device compliance policies list
//1003. upsertPolicy           — Create/update compliance policy
//1073. listViolations         — Compliance violations list
//1112. acknowledgeViolation   — Acknowledge a violation
//1146. listGeofenceViolations — Geofence violation list
//1180. listOtaReleases        — OTA release list
//1207. createOtaRelease       — Create OTA release
//1240. publishOtaRelease      — Publish OTA release
//1261. archiveOtaRelease      — Archive OTA release
//1281. listOtaUpdateLog       — OTA update log list
//1316. recordOtaUpdate        — Record OTA update (public, called by agent)
//1385. enableTerminal         — Enable a terminal
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Admin guard ───────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});

// ── Helper: get DB or throw ─────────────────────────────────────────────────
async function requireDb() {
  const db = (await getDb())!;
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  return db!;
}

// ── MDM Router ────────────────────────────────────────────────────────────────
export const mdmRouter = router({
  // List all enrolled devices with agent info
  listDevices: adminProcedure
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .input(
      z.object({
        status: z
          .enum(["online", "offline", "updating", "error", "all"])
          .default("all"),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const whereClause =
          input.status !== "all" ? eq(devices.status, input.status) : undefined;
        const rows = await db
          .select({
            device: devices,
            agentCode: agents.agentCode,
            agentName: agents.name,
            agentLocation: agents.location,
          })
          .from(devices)
          .leftJoin(agents, eq(devices.agentId, agents.id))
          .where(whereClause)
          .orderBy(desc(devices.lastSeenAt))
          .limit(input.limit)
          .offset(input.offset);

        const countRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(devices)
          .where(whereClause);
        const total = countRows[0]?.count ?? 0;

        return { devices: rows, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get single device with recent commands
  getDevice: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const [row] = await db
          .select({
            device: devices,
            agentCode: agents.agentCode,
            agentName: agents.name,
          })
          .from(devices)
          .leftJoin(agents, eq(devices.agentId, agents.id))
          .where(eq(devices.id, input.id));

        if (!row) throw new TRPCError({ code: "NOT_FOUND" });

        const commands = await (await requireDb())
          .select()
          .from(deviceCommands)
          .where(eq(deviceCommands.deviceId, input.id))
          .orderBy(desc(deviceCommands.issuedAt))
          .limit(20);

        return { ...row, commands };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Issue a command to a device
  issueCommand: adminProcedure
    .input(
      z.object({
        deviceId: z.number(),
        command: z.enum([
          "UPDATE",
          "RECONFIG",
          "RESTART",
          "WIPE",
          "PING",
          "SCREENSHOT",
        ]),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        const [device] = await db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))
          .limit(100);
        if (!device)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Device not found",
          });

        const [cmd] = await db
          .insert(deviceCommands)
          .values({
            deviceId: input.deviceId,
            command: input.command,
            payload: input.payload ?? null,
            status: "pending",
            issuedBy: ctx.user.name ?? ctx.user.email ?? "admin",
          })
          .returning();

        if (input.command === "UPDATE") {
          await db
            .update(devices)
            .set({ status: "updating", updatedAt: new Date() })
            .where(eq(devices.id, input.deviceId));
        }

        return { commandId: cmd.id, status: "pending" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Push config to a device
  pushConfig: adminProcedure
    .input(
      z.object({
        deviceId: z.number(),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        const [device] = await db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))
          .limit(100);
        if (!device) throw new TRPCError({ code: "NOT_FOUND" });

        await db
          .update(devices)
          .set({ configJson: input.config, updatedAt: new Date() })
          .where(eq(devices.id, input.deviceId));

        const [cmd] = await db
          .insert(deviceCommands)
          .values({
            deviceId: input.deviceId,
            command: "RECONFIG",
            payload: input.config,
            status: "pending",
            issuedBy: ctx.user.name ?? "admin",
          })
          .returning();

        return { commandId: cmd.id, configUpdated: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Trigger OTA update on one or all devices
  triggerOtaUpdate: adminProcedure
    .input(
      z.object({
        deviceIds: z.array(z.number()).optional(), // empty = all online devices
        appVersion: z.string().min(1),
        downloadUrl: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        let targetDevices: (typeof devices.$inferSelect)[];

        if (input.deviceIds && input.deviceIds.length > 0) {
          targetDevices = await db
            .select()
            .from(devices)
            .where(
              sql`${devices.id} = ANY(ARRAY[${sql.join(
                input.deviceIds.map(id => sql`${id}`),
                sql`, `
              )}]::int[])`
            );
        } else {
          targetDevices = await db
            .select()
            .from(devices)
            .where(eq(devices.status, "online"));
        }

        if (targetDevices.length === 0)
          return { devicesTargeted: 0, commandsIssued: 0 };

        const commands = await db
          .insert(deviceCommands)
          .values(
            targetDevices.map(d => ({
              deviceId: d.id,
              command: "UPDATE" as const,
              payload: {
                appVersion: input.appVersion,
                downloadUrl: input.downloadUrl,
              },
              status: "pending" as const,
              issuedBy: ctx.user.name ?? "admin",
            }))
          )
          .returning();

        for (const d of targetDevices) {
          await db
            .update(devices)
            .set({ status: "updating", updatedAt: new Date() })
            .where(eq(devices.id, d.id));
        }

        return {
          devicesTargeted: targetDevices.length,
          commandsIssued: commands.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Device stats summary for Admin Panel overview
  stats: adminProcedure.input(z.object({})).query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        status: devices.status,
        count: sql<number>`count(*)::int`,
      })
      .from(devices)
      .groupBy(devices.status);

    const summary: Record<string, number> = {
      online: 0,
      offline: 0,
      updating: 0,
      error: 0,
    };
    for (const row of rows) {
      summary[row.status] = row.count;
    }
    // @ts-expect-error middleware type mismatch
    summary.total = Object.values(summary as any).reduce(
      (a: any, b: any) => a + b,
      0
    );
    return summary;
  }),

  // ── Called by mdm-agent on POS terminal ──────────────────────────────────

  // Heartbeat: device reports health, gets back pending commands
  heartbeat: publicProcedure
    .input(
      z.object({
        serialNumber: z.string().min(1),
        agentCode: z.string().min(1),
        model: z.string().optional(),
        osVersion: z.string().optional(),
        appVersion: z.string().optional(),
        firmwareVersion: z.string().optional(),
        ipAddress: z.string().optional(),
        // Telemetry: battery
        batteryLevel: z.number().min(0).max(100).optional(),
        batteryCharging: z.boolean().optional(),
        // Telemetry: WiFi
        wifiSsid: z.string().max(64).optional(),
        wifiRssi: z.number().optional(),
        wifiIpAddress: z.string().max(45).optional(),
        networkType: z.enum(["wifi", "4g", "3g", "2g", "offline"]).optional(),
        // Location (for geofence check)
        latE6: z.number().int().optional(),
        lonE6: z.number().int().optional(),
        // Screenshot result ack
        screenshotCommandId: z.number().int().optional(),
        screenshotUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        let [device] = await db
          .select()
          .from(devices)
          .where(eq(devices.serialNumber, input.serialNumber));

        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode));

        const telemetryFields = {
          batteryLevel: input.batteryLevel ?? null,
          batteryCharging: input.batteryCharging ?? false,
          wifiSsid: input.wifiSsid ?? null,
          wifiRssi: input.wifiRssi ?? null,
          wifiIpAddress: input.wifiIpAddress ?? null,
          networkType: input.networkType ?? null,
          ...(input.screenshotUrl
            ? {
                screenshotUrl: input.screenshotUrl,
                lastScreenshotAt: new Date(),
              }
            : {}),
        };

        if (!device) {
          if (!agent)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Agent not found",
            });
          [device] = await db
            .insert(devices)
            .values({
              agentId: agent.id,
              serialNumber: input.serialNumber,
              model: input.model ?? "Unknown",
              osVersion: input.osVersion,
              appVersion: input.appVersion,
              firmwareVersion: input.firmwareVersion,
              ipAddress: ctx.req?.ip ?? input.ipAddress,
              status: "online",
              lastSeenAt: new Date(),
              ...telemetryFields,
            })
            .returning();
        } else {
          await db
            .update(devices)
            .set({
              status: "online",
              osVersion: input.osVersion ?? device.osVersion,
              appVersion: input.appVersion ?? device.appVersion,
              firmwareVersion: input.firmwareVersion ?? device.firmwareVersion,
              ipAddress: ctx.req?.ip ?? input.ipAddress ?? device.ipAddress,
              lastSeenAt: new Date(),
              updatedAt: new Date(),
              ...telemetryFields,
            })
            .where(eq(devices.id, device.id));
        }

        // ── Screenshot command acknowledgement ──────────────────────────────────
        if (input.screenshotCommandId && input.screenshotUrl) {
          await db
            .update(deviceCommands)
            .set({
              status: "completed",
              completedAt: new Date(),
              result: { screenshotUrl: input.screenshotUrl },
            })
            .where(eq(deviceCommands.id, input.screenshotCommandId));
        }

        // ── Geofence check (circle + polygon) ───────────────────────────────────
        if (input.latE6 !== undefined && input.lonE6 !== undefined && device) {
          const zones = await db.select().from(geofenceZones).limit(50);
          const ptLat = input.latE6 / 1e6;
          const ptLon = input.lonE6 / 1e6;

          // Ray-casting point-in-polygon algorithm
          const pointInPolygon = (
            lat: number,
            lon: number,
            polygon: [number, number][]
          ): boolean => {
            let inside = false;
            for (
              let i = 0, j = polygon.length - 1;
              i < polygon.length;
              j = i++
            ) {
              const [yi, xi] = polygon[i];
              const [yj, xj] = polygon[j];
              if (
                yi > lon !== yj > lon &&
                lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi
              ) {
                inside = !inside;
              }
            }
            return inside;
          };

          for (const zone of zones) {
            let isOutside = false;
            let distM = 0;

            if (zone.type === "polygon" && zone.polygonJson) {
              // Polygon geofence: use ray-casting
              const polygon = zone.polygonJson as [number, number][];
              if (Array.isArray(polygon) && polygon.length >= 3) {
                isOutside = !pointInPolygon(ptLat, ptLon, polygon);
                if (isOutside) {
                  // Approximate distance to nearest edge
                  let minDist = Infinity;
                  for (const vertex of polygon) {
                    const dLat1 = (ptLat - vertex[0]) * 111320;
                    const dLon1 =
                      (ptLon - vertex[1]) *
                      111320 *
                      Math.cos((ptLat * Math.PI) / 180);
                    const d = Math.sqrt(dLat1 * dLat1 + dLon1 * dLon1);
                    if (d < minDist) minDist = d;
                  }
                  distM = minDist;
                }
              } else {
                continue; // Invalid polygon data, skip
              }
            } else {
              // Circle geofence (original logic)
              if (
                !zone.centerLat ||
                !(zone.centerLng ?? zone.longitude) ||
                !zone.radiusMeters
              )
                continue;
              const dLat = ptLat - Number(zone.centerLat);
              const dLon = ptLon - Number(zone.centerLng ?? zone.longitude);
              // Haversine approximation (flat earth for small distances)
              distM = Math.sqrt(
                Math.pow(dLat * 111320, 2) +
                  Math.pow(
                    dLon *
                      111320 *
                      Math.cos((Number(zone.centerLat) * Math.PI) / 180),
                    2
                  )
              );
              isOutside = distM > Number(zone.radiusMeters);
            }
            if (isOutside) {
              // Insert geofence violation (idempotent: skip if open violation exists)
              const existing = await db
                .select()
                .from(mdmGeofenceViolations)
                .where(
                  and(
                    eq(mdmGeofenceViolations.deviceId, device.id),
                    eq(mdmGeofenceViolations.zoneId, zone.id),
                    eq(mdmGeofenceViolations.status, "open")
                  )
                )
                .limit(1);
              if (existing.length === 0) {
                await db.insert(mdmGeofenceViolations).values({
                  deviceId: device.id,
                  serialNumber: input.serialNumber,
                  agentCode: input.agentCode,
                  zoneId: zone.id,
                  zoneName: zone.name,
                  violationType: "outside_zone",
                  latE6: input.latE6,
                  lonE6: input.lonE6,
                  distanceMeters: Math.round(distM),
                  status: "open",
                });
                // Emit real-time alert via Socket.IO
                const io = getIO();
                if (io) {
                  io.of("/admin").emit("mdm:geofence-violation", {
                    serialNumber: input.serialNumber,
                    agentCode: input.agentCode,
                    zoneName: zone.name,
                    distanceMeters: Math.round(distM),
                    detectedAt: new Date().toISOString(),
                  });
                }
              }
            }
          }
        }

        // ── Compliance check ────────────────────────────────────────────────────
        if (device) {
          const policies = await db
            .select()
            .from(deviceCompliancePolicies)
            .where(and(eq(deviceCompliancePolicies.enabled, true)))
            .limit(20);

          let overallStatus: "compliant" | "non_compliant" | "unknown" =
            "compliant";
          for (const policy of policies) {
            const rules = policy.rules as Record<string, unknown>;
            const violations: {
              type: string;
              details: Record<string, unknown>;
            }[] = [];

            if (
              rules.minBatteryLevel &&
              input.batteryLevel !== undefined &&
              input.batteryLevel < (rules.minBatteryLevel as number)
            ) {
              violations.push({
                type: "low_battery",
                details: {
                  actual: input.batteryLevel,
                  threshold: rules.minBatteryLevel,
                },
              });
            }
            if (rules.minAppVersion && input.appVersion) {
              const [maj, min] = (input.appVersion ?? "0.0.0")
                .split(".")
                .map(Number);
              const [rmaj, rmin] = ((rules.minAppVersion as string) ?? "0.0.0")
                .split(".")
                .map(Number);
              if (maj < rmaj || (maj === rmaj && min < rmin)) {
                violations.push({
                  type: "outdated_app",
                  details: {
                    actual: input.appVersion,
                    required: rules.minAppVersion,
                  },
                });
              }
            }
            if (
              rules.allowedNetworkTypes &&
              input.networkType &&
              !(rules.allowedNetworkTypes as string[]).includes(
                input.networkType
              )
            ) {
              violations.push({
                type: "disallowed_network",
                details: {
                  actual: input.networkType,
                  allowed: rules.allowedNetworkTypes,
                },
              });
            }

            for (const v of violations) {
              overallStatus = "non_compliant";
              const existing = await db
                .select()
                .from(deviceComplianceViolations)
                .where(
                  and(
                    eq(deviceComplianceViolations.deviceId, device.id),
                    eq(deviceComplianceViolations.policyId, policy.id),
                    eq(deviceComplianceViolations.violationType, v.type),
                    eq(deviceComplianceViolations.status, "open")
                  )
                )
                .limit(1);
              if (existing.length === 0) {
                await db.insert(deviceComplianceViolations).values({
                  deviceId: device.id,
                  policyId: policy.id,
                  serialNumber: input.serialNumber,
                  agentCode: input.agentCode,
                  violationType: v.type,
                  severity: policy.severity,
                  details: v.details,
                  status: "open",
                  enforcementAction: policy.enforcementAction ?? "notify",
                });
              }
            }
          }

          // Update device compliance status
          await db
            .update(devices)
            .set({
              complianceStatus: overallStatus,
              lastComplianceCheckAt: new Date(),
            })
            .where(eq(devices.id, device.id));
        }

        const pendingCommands = await db
          .select()
          .from(deviceCommands)
          .where(
            and(
              eq(deviceCommands.deviceId, device.id),
              eq(deviceCommands.status, "pending")
            )
          )
          .orderBy(deviceCommands.issuedAt)
          .limit(10);

        return {
          deviceId: device.id,
          configJson: device.configJson,
          pendingCommands: pendingCommands.map(
            (c: typeof deviceCommands.$inferSelect) => ({
              id: c.id,
              command: c.command,
              payload: c.payload,
            })
          ),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Generate a one-time enrollment QR token for a new device
  generateEnrollmentToken: adminProcedure
    .input(
      z.object({
        agentCode: z.string().min(1),
        serialNumber: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(100);
        if (!agent)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });

        const token = randomBytes(24).toString("hex"); // 48-char hex token
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Store enrollment token on existing device record, or pre-register a new device record
        const serial =
          input.serialNumber ?? `PENDING-${agent.agentCode}-${Date.now()}`;
        const existing = await db
          .select()
          .from(devices)
          .where(eq(devices.serialNumber, serial));

        if (existing.length > 0) {
          await db
            .update(devices)
            .set({
              enrollmentToken: token,
              enrollmentExpiresAt: expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(devices.serialNumber, serial));
        } else {
          await db.insert(devices).values({
            agentId: agent.id,
            serialNumber: serial,
            model: "Pending Enrollment",
            status: "offline",
            enrollmentToken: token,
            enrollmentExpiresAt: expiresAt,
          });
        }

        // QR payload: JSON with token + API base URL
        const qrPayload = JSON.stringify({
          action: "enroll",
          token,
          agentCode: input.agentCode,
          serial,
          apiBase: "/api/trpc",
        });

        return {
          token,
          expiresAt,
          qrPayload,
          agentCode: input.agentCode,
          serial,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Called by installer --enroll-token flag to complete device enrollment
  enrollWithToken: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        agentCode: z.string().min(1),
        serialNumber: z.string().min(1),
        model: z.string().optional(),
        osVersion: z.string().optional(),
        appVersion: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        const now = new Date();

        // Find device by token
        const allDevices = await db.select().from(devices).limit(100);
        const device = allDevices.find(
          d =>
            d.enrollmentToken === input.token &&
            d.enrollmentExpiresAt &&
            d.enrollmentExpiresAt > now
        );

        if (!device) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid or expired enrollment token",
          });
        }

        // Verify agent code matches
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode))
          .limit(100);
        if (!agent || agent.id !== device.agentId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Agent code mismatch",
          });
        }

        // Generate a persistent device token for transaction signing
        const persistentToken = `DT-${device.id}-${crypto.randomUUID().toUpperCase()}-${randomBytes(8).toString("hex").toUpperCase()}`;

        // Complete enrollment
        await db
          .update(devices)
          .set({
            serialNumber: input.serialNumber,
            model: input.model ?? device.model,
            osVersion: input.osVersion,
            appVersion: input.appVersion,
            status: "online",
            enrollmentToken: null,
            enrollmentExpiresAt: null,
            enrolledAt: now,
            lastSeenAt: now,
            updatedAt: now,
            deviceToken: persistentToken,
          })
          .where(eq(devices.id, device.id));

        return {
          deviceId: device.id,
          enrolled: true,
          agentCode: input.agentCode,
          deviceToken: persistentToken,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Acknowledge command execution result
  ackCommand: protectedProcedure
    .input(
      z.object({
        commandId: z.number(),
        status: z.enum(["acknowledged", "completed", "failed"]),
        errorMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        await db
          .update(deviceCommands)
          .set({
            status: input.status,
            acknowledgedAt:
              input.status === "acknowledged" ? new Date() : undefined,
            completedAt: input.status === "completed" ? new Date() : undefined,
            errorMessage: input.errorMessage,
          })
          .where(eq(deviceCommands.id, input.commandId));

        if (input.status === "completed") {
          const [cmd] = await db
            .select()
            .from(deviceCommands)
            .where(eq(deviceCommands.id, input.commandId));
          if (cmd?.command === "UPDATE") {
            await db
              .update(devices)
              .set({ status: "online", updatedAt: new Date() })
              .where(eq(devices.id, cmd.deviceId));
          }
        }

        return { ok: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Remote POS Kill-Switch: Disable Terminal ──────────────────────────────
  disableTerminal: adminProcedure
    .input(
      z.object({
        agentCode: z.string(),
        reason: z.string().min(5, "Reason must be at least 5 characters"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.agentCode, input.agentCode));
        if (!agent)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        await db
          .update(agents)
          .set({
            terminalEnabled: false,
            terminalDisabledReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(agents.agentCode, input.agentCode));
        const io = getIO();
        if (io) {
          io.of("/terminal")
            .to(`agent:${input.agentCode}`)
            .emit("terminal:kill-switch", {
              reason: input.reason,
              disabledBy: ctx.user.name ?? ctx.user.keycloakSub,
              disabledAt: new Date().toISOString(),
            });
        }
        await writeAuditLog({
          agentId: agent.id,
          agentCode: input.agentCode,
          action: "TERMINAL_DISABLED",
          resource: "agent",
          resourceId: String(agent.id),
          status: "success",
          metadata: { reason: input.reason, disabledBy: ctx.user.keycloakSub },
        });
        return { ok: true, agentCode: input.agentCode, terminalEnabled: false };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Compliance Policy Management ─────────────────────────────────────────

  listPolicies: adminProcedure
    .input(
      z
        .object({
          tenantId: z.number().int().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const rows = await db
          .select()
          .from(deviceCompliancePolicies)
          .orderBy(desc(deviceCompliancePolicies.createdAt))
          .limit(100);
        return rows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  upsertPolicy: adminProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        tenantId: z.number().int().optional(),
        rules: z.object({
          minAppVersion: z.string().optional(),
          minOsVersion: z.string().optional(),
          requirePin: z.boolean().optional(),
          minBatteryLevel: z.number().min(0).max(100).optional(),
          geofenceRequired: z.boolean().optional(),
          allowedNetworkTypes: z
            .array(z.enum(["wifi", "4g", "3g", "2g", "offline"]))
            .optional(),
          maxInactiveHours: z.number().min(1).optional(),
        }),
        severity: z
          .enum(["low", "medium", "high", "critical"])
          .default("medium"),
        enabled: z.boolean().default(true),
        enforcementAction: z
          .enum(["notify", "restrict", "wipe"])
          .default("notify"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        if (input.id) {
          await db
            .update(deviceCompliancePolicies)
            .set({
              name: input.name,
              description: input.description,
              rules: input.rules,
              severity: input.severity,
              enabled: input.enabled,
              enforcementAction: input.enforcementAction,
              updatedAt: new Date(),
            })
            .where(eq(deviceCompliancePolicies.id, input.id));
          return { id: input.id, action: "updated" };
        } else {
          const [row] = await db
            .insert(deviceCompliancePolicies)
            .values({
              name: input.name,
              description: input.description,
              tenantId: input.tenantId,
              rules: input.rules,
              severity: input.severity,
              enabled: input.enabled,
              enforcementAction: input.enforcementAction,
              createdBy: ctx.user.name ?? ctx.user.keycloakSub,
            })
            .returning();
          return { id: row.id, action: "created" };
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

  listViolations: adminProcedure
    .input(
      z.object({
        deviceId: z.number().int().optional(),
        status: z
          .enum(["open", "acknowledged", "resolved", "suppressed", "all"])
          .default("open"),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const conditions = [];
        if (input.deviceId)
          conditions.push(
            eq(deviceComplianceViolations.deviceId, input.deviceId)
          );
        if (input.status !== "all")
          conditions.push(eq(deviceComplianceViolations.status, input.status));
        const rows = await db
          .select()
          .from(deviceComplianceViolations)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(deviceComplianceViolations.detectedAt))
          .limit(input.limit)
          .offset(input.offset);
        return rows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  acknowledgeViolation: adminProcedure
    .input(
      z.object({
        violationId: z.number().int(),
        action: z.enum(["acknowledge", "resolve", "suppress"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = await requireDb();
        const statusMap = {
          acknowledge: "acknowledged",
          resolve: "resolved",
          suppress: "suppressed",
        } as const;
        await db
          .update(deviceComplianceViolations)
          .set({
            status: statusMap[input.action],
            resolvedAt: new Date(),
            resolvedBy: ctx.user.name ?? ctx.user.keycloakSub,
          })
          .where(eq(deviceComplianceViolations.id, input.violationId));
        return { ok: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  listGeofenceViolations: adminProcedure
    .input(
      z.object({
        deviceId: z.number().int().optional(),
        status: z.enum(["open", "resolved", "all"]).default("open"),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const conditions = [];
        if (input.deviceId)
          conditions.push(eq(mdmGeofenceViolations.deviceId, input.deviceId));
        if (input.status !== "all")
          conditions.push(eq(mdmGeofenceViolations.status, input.status));
        const rows = await db
          .select()
          .from(mdmGeofenceViolations)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mdmGeofenceViolations.detectedAt))
          .limit(input.limit);
        return rows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── OTA Releases CRUD ─────────────────────────────────────────────────────────
  listOtaReleases: adminProcedure
    .input(
      z.object({ limit: z.number().default(50), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const [items, [{ total }]] = await Promise.all([
          db
            .select()
            .from(otaReleases)
            .orderBy(desc(otaReleases.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          db.select({ total: count() }).from(otaReleases),
        ]);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  createOtaRelease: adminProcedure
    .input(
      z.object({
        version: z.string().min(1).max(32),
        releaseNotes: z.string().optional(),
        s3Key: z.string().min(1),
        downloadUrl: z.string().url(),
        checksum: z.string().min(1),
        fileSize: z.number().int().positive(),
        isForced: z.boolean().default(false),
        rolloutPercent: z.number().min(1).max(100).default(100),
        targetModels: z.array(z.string()).default([]),
        minCurrentVersion: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        const [row] = await db
          .insert(otaReleases)
          .values({ ...input, status: "draft" })
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

  publishOtaRelease: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        const [row] = await db
          .update(otaReleases)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(otaReleases.id, input.id))
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

  archiveOtaRelease: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        await db
          .update(otaReleases)
          .set({ status: "archived" })
          .where(eq(otaReleases.id, input.id));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  listOtaUpdateLog: adminProcedure
    .input(
      z.object({
        deviceId: z.number().optional(),
        releaseId: z.number().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = await requireDb();
        const conditions = [];
        if (input.deviceId)
          conditions.push(eq(otaUpdateLog.deviceId, input.deviceId));
        if (input.releaseId)
          conditions.push(eq(otaUpdateLog.releaseId, input.releaseId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        return db
          .select()
          .from(otaUpdateLog)
          .where(where)
          .orderBy(desc(otaUpdateLog.startedAt))
          .limit(input.limit)
          .offset(input.offset);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  recordOtaUpdate: publicProcedure
    .input(
      z.object({
        deviceId: z.number(),
        releaseId: z.number(),
        toVersion: z.string(),
        fromVersion: z.string().optional(),
        status: z.enum([
          "pending",
          "downloading",
          "installing",
          "success",
          "failed",
        ]),
        errorMessage: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await requireDb();
        const existing = await db
          .select({ id: otaUpdateLog.id })
          .from(otaUpdateLog)
          .where(
            and(
              eq(otaUpdateLog.deviceId, input.deviceId),
              eq(otaUpdateLog.releaseId, input.releaseId)
            )
          )
          .limit(1);
        if (existing.length > 0) {
          const completedAt = ["success", "failed"].includes(input.status)
            ? new Date()
            : undefined;
          const [row] = await db
            .update(otaUpdateLog)
            .set({
              status: input.status,
              errorMessage: input.errorMessage,
              completedAt,
            })
            .where(eq(otaUpdateLog.id, existing[0].id))
            .returning();
          return row;
        }
        const [row] = await db
          .insert(otaUpdateLog)
          .values({
            deviceId: input.deviceId,
            releaseId: input.releaseId,
            toVersion: input.toVersion,
            fromVersion: input.fromVersion,
            status: input.status,
            errorMessage: input.errorMessage,
            startedAt: new Date(),
          })
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

  // ── Remote POS Kill-Switch: Enable Terminal ───────────────────────────────────────
  enableTerminal: adminProcedure
    .input(
      z.object({
        agentCode: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
      const db = await requireDb();
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.agentCode, input.agentCode));
      if (!agent)
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      await db
        .update(agents)
        .set({
          terminalEnabled: true,
          terminalDisabledReason: null,
          updatedAt: new Date(),
        })
        .where(eq(agents.agentCode, input.agentCode));
      const io = getIO();
      if (io) {
        io.of("/terminal")
          .to(`agent:${input.agentCode}`)
          .emit("terminal:kill-switch-lift", {
            enabledBy: ctx.user.name ?? ctx.user.keycloakSub,
            enabledAt: new Date().toISOString(),
          });
      }
      await writeAuditLog({
        agentId: agent.id,
        agentCode: input.agentCode,
        action: "TERMINAL_ENABLED",
        resource: "agent",
        resourceId: String(agent.id),
        status: "success",
        metadata: { enabledBy: ctx.user.keycloakSub },
      });
      return { ok: true, agentCode: input.agentCode, terminalEnabled: true };
    }),
});
