import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { eq, count, and, sql } from "drizzle-orm";
import { geofenceZones } from "@schema";
import { TRPCError } from "@trpc/server";

export const geoFencingRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { zones: [], total: 0 };
      const zones = await db.select().from(geofenceZones).limit(input.limit);
      const [tot] = await db.select({ value: count() }).from(geofenceZones);
      return { zones, total: Number(tot.value) };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { id: input.id, name: "", coordinates: [], active: true };
      const [zone] = await db
        .select()
        .from(geofenceZones)
        .where(eq(geofenceZones.id, Number(input.id)))
        .limit(1);
      if (!zone)
        throw new TRPCError({ code: "NOT_FOUND", message: "Zone not found" });
      return {
        id: String(zone.id),
        name: zone.name,
        coordinates: zone.polygonJson ?? [],
        active: zone.isActive,
        type: zone.type,
        lat: zone.centerLat ? Number(zone.centerLat) : undefined,
        lng: zone.centerLng ? Number(zone.centerLng) : undefined,
        radiusMeters: zone.radiusMeters,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        coordinates: z.array(z.object({ lat: z.number(), lng: z.number() })),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { id: "zone-1", name: input.name, created: true };
      const [zone] = await db
        .insert(geofenceZones)
        .values({
          name: input.name,
          type: "polygon",
          polygonJson: input.coordinates,
          isActive: true,
        })
        .returning();
      return { id: String(zone.id), name: zone.name, created: true };
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { id: input.id, active: input.active, updated: true };
      await db
        .update(geofenceZones)
        .set({ isActive: input.active, updatedAt: new Date() })
        .where(eq(geofenceZones.id, Number(input.id)));
      return { id: input.id, active: input.active, updated: true };
    }),

  checkPoint: protectedProcedure
    .input(z.object({ lat: z.number(), lng: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { inZone: false, zones: [] };
      const activeZones = await db
        .select()
        .from(geofenceZones)
        .where(eq(geofenceZones.isActive, true));
      const matched = activeZones.filter((zone: any) => {
        if (zone.centerLat && zone.centerLng && zone.radiusMeters) {
          const dist = haversineKm(
            input.lat,
            input.lng,
            Number(zone.centerLat),
            Number(zone.centerLng)
          );
          return dist * 1000 <= zone.radiusMeters;
        }
        return false;
      });
      return {
        inZone: matched.length > 0,
        zones: matched.map((z: any) => ({
          id: String(z.id),
          name: z.name,
        })),
      };
    }),

  getStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalZones: 0, activeZones: 0, totalChecks: 0 };
    const [total] = await db.select({ value: count() }).from(geofenceZones);
    const [active] = await db
      .select({ value: count() })
      .from(geofenceZones)
      .where(eq(geofenceZones.isActive, true));
    return {
      totalZones: Number(total.value),
      activeZones: Number(active.value),
      totalChecks: 0,
    };
  }),

  createZone: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        lat: z.number(),
        lng: z.number(),
        radiusKm: z.number(),
        type: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        return {
          id: `zone-${Date.now()}`,
          name: input.name,
          createdAt: new Date().toISOString(),
        };
      const [zone] = await db
        .insert(geofenceZones)
        .values({
          name: input.name,
          type: input.type ?? "circle",
          centerLat: String(input.lat),
          centerLng: String(input.lng),
          radiusMeters: Math.round(input.radiusKm * 1000),
          isActive: true,
        })
        .returning();
      return {
        id: String(zone.id),
        name: zone.name,
        createdAt: zone.createdAt.toISOString(),
      };
    }),

  deleteZone: protectedProcedure
    .input(z.object({ zoneId: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: true, zoneId: input.zoneId };
      await db
        .delete(geofenceZones)
        .where(eq(geofenceZones.id, Number(input.zoneId)));
      return { success: true, zoneId: input.zoneId };
    }),

  listZones: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { zones: [], total: 0 };
    const zones = await db.select().from(geofenceZones);
    return {
      zones: zones.map((z: any) => ({
        id: String(z.id),
        name: z.name,
        lat: z.centerLat ? Number(z.centerLat) : 0,
        lng: z.centerLng ? Number(z.centerLng) : 0,
        radiusKm: z.radiusMeters ? z.radiusMeters / 1000 : 0,
        type: z.type,
        active: z.isActive,
      })),
      total: zones.length,
    };
  }),
});

/** Haversine distance in km between two lat/lng points */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
