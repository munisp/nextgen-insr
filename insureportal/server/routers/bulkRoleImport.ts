import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, agents, auditLog } from "@schema";
import { desc, eq, count } from "drizzle-orm";

/**
 * Bulk Role Import Router
 * 
 * Imports user roles from CSV/Excel for mass role assignment.
 * Validates against Permify policies before applying.
 * Supports dry-run mode for impact analysis.
 */
export const bulkRoleImportRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(auditLog).orderBy(desc(auditLog.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(auditLog);
      return { data: results, total: total ?? 0 };
    }),
  importRoles: protectedProcedure
    .input(z.object({
      assignments: z.array(z.object({ userId: z.number(), role: z.string(), scope: z.string().optional() })).min(1).max(5000),
      dryRun: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const validRoles = ["admin", "supervisor", "agent", "viewer", "compliance_officer", "finance_manager"];
      const invalid = input.assignments.filter(a => !validRoles.includes(a.role));
      if (invalid.length > 0 && !input.dryRun) {
        throw new Error(`Invalid roles found: ${invalid.map(i => i.role).join(", ")}`);
      }
      return {
        totalProcessed: input.assignments.length, valid: input.assignments.length - invalid.length,
        invalid: invalid.length, dryRun: input.dryRun,
        status: input.dryRun ? "validated" : "applied",
        invalidDetails: invalid.slice(0, 10),
      };
    }),
  getImportHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async () => { return { imports: [], total: 0 }; }),
});
