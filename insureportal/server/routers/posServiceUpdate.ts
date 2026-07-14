/**
 * posServiceUpdate.ts — Auto-generated stub
 * TODO: Implement full posServiceUpdate functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const posServiceUpdateRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
