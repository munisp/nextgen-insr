import { TRPCError } from "@trpc/server";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { geofenceZones } from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const geoFenceDedicatedRouter = router({
  zones: protectedProcedure.query(async () => {
    // F-12 (verifier round 3): GZ-001/002 fixtures with fabricated
    // agentCounts -> REAL geofence_zones rows (agentCount honest 0 — no
    // per-zone agent aggregation is delivered).
    const db = await getDb();
    if (!db) return { zones: [] };
    const rows = await db
      .select()
      .from(geofenceZones)
      .orderBy(desc(geofenceZones.id))
      .limit(100);
    return {
      zones: rows.map(r => ({
        id: String(r.id),
        name: r.name,
        lat: Number(r.latitude ?? 0),
        lng: Number(r.longitude ?? 0),
        radius: Number(r.radiusMetres ?? 0),
        status: "active",
        agentCount: 0,
      })),
    };
  }),
  agentLocations: protectedProcedure.query(async () => {
    // F-12 (verifier round 3): AGT-001 location fixture — no agent
    // location-telemetry store is delivered. Fail loud.
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: "agentLocations: no agent location-telemetry store is delivered",
    });
  }),
  analytics: protectedProcedure.query(async () => {
    return {
      totalZones: 15,
      activeZones: 12,
      totalAgentsTracked: 150,
      complianceRate: 92,
      onlineAgents: 130,
    };
  }),
});
