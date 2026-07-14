import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { eq, desc, and, sql, count } from "drizzle-orm";
import {
  agents,
  geofenceZones,
  agentGeofenceZones,
  auditLog,
} from "@schema";
import { TRPCError } from "@trpc/server";

export const agentTerritoryMgmtRouter = router({
  listTerritories: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(geofenceZones)
          .orderBy(desc(geofenceZones.createdAt))
          .limit(input?.limit ?? 50);
        return { territories: rows, total: rows.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getTerritory: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [zone] = await db
          .select()
          .from(geofenceZones)
          .where(eq(geofenceZones.id, input.id))
          .limit(1);
        if (!zone) return null;
        const assignments = await db
          .select()
          .from(agentGeofenceZones)
          .where(eq(agentGeofenceZones.zoneId, input.id))
          .limit(100);
        return { ...zone, assignedAgents: assignments.length, assignments };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  assignAgent: protectedProcedure
    .input(z.object({ agentId: z.number(), zoneId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .insert(agentGeofenceZones)
          .values({ agentId: input.agentId, zoneId: input.zoneId });
        await db.insert(auditLog).values({
          action: "territory_agent_assigned",
          resource: "geofence_zones",
          resourceId: String(input.zoneId),
          status: "success",
          metadata: { agentId: input.agentId },
        });
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
  unassignAgent: protectedProcedure
    .input(z.object({ agentId: z.number(), zoneId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(agentGeofenceZones)
          .where(
            and(
              eq(agentGeofenceZones.agentId, input.agentId),
              eq(agentGeofenceZones.zoneId, input.zoneId)
            )
          );
        await db.insert(auditLog).values({
          action: "territory_agent_unassigned",
          resource: "geofence_zones",
          resourceId: String(input.zoneId),
          status: "success",
          metadata: { agentId: input.agentId },
        });
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
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    const [totalZones] = await db
      .select({ value: count() })
      .from(geofenceZones)
      .limit(100);
    const [totalAssignments] = await db
      .select({ value: count() })
      .from(agentGeofenceZones)
      .limit(100);
    return {
      totalTerritories: Number(totalZones.value),
      totalAssignments: Number(totalAssignments.value),
    };
  }),
});
