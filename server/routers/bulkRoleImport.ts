import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

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
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Bulk role import is not implemented yet",
      });
    }),
  importRoles: protectedProcedure
    .input(z.object({
      assignments: z.array(z.object({ userId: z.number(), role: z.string(), scope: z.string().optional() })).min(1).max(5000),
      dryRun: z.boolean().default(false),
    }))
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Bulk role import is not implemented yet",
      });
    }),
  getImportHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Bulk role import history is not implemented yet",
      });
    }),
});
