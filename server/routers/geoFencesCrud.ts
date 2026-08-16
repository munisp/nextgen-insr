// Sprint 87: Polygon validation, overlap detection, agent assignment
import { TRPCError } from "@trpc/server";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";

import { geoFences } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

function isValidPolygon(coords: number[][]): boolean {
  if (coords.length < 3) return false;
  return coords.every(
    c =>
      c.length === 2 && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90
  );
}

function isPointInPolygon(
  point: [number, number],
  polygon: number[][]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export const geoFencesRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(geoFences)
          .orderBy(desc(geoFences.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(geoFences)
          .limit(100);
        return { items: rows, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(geoFences)
          .where(eq(geoFences.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Geo-fence not found",
          });
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
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3),
        coordinates: z.array(z.array(z.number()).length(2)).min(3),
        radius: z.number().optional(),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!isValidPolygon(input.coordinates))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid polygon — need at least 3 points with valid lat/lng",
          });
        const [row] = await db
          .insert(geoFences)
          .values({
            name: input.name,
            coordinates: JSON.stringify(input.coordinates),
            radius: input.radius,
            isActive: input.isActive,
          } as any)
          .returning();
        return { ...row, vertexCount: input.coordinates.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  checkPoint: protectedProcedure
    .input(z.object({ lat: z.number(), lng: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const fences = await db
          .select()
          .from(geoFences)
          .where(eq(geoFences.isActive, true))
          .limit(100);
        const matches = fences.filter((f: any) => {
          try {
            const coords = JSON.parse(f.coordinates);
            return isPointInPolygon([input.lng, input.lat], coords);
          } catch {
            return false;
          }
        });
        return {
          point: { lat: input.lat, lng: input.lng },
          matchingFences: matches.map((f: any) => ({ id: f.id, name: f.name })),
          isInsideAnyFence: matches.length > 0,
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
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db.delete(geoFences).where(eq(geoFences.id, input.id));
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
});
