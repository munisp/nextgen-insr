/**
 * insuranceCatalog.ts — Auto-generated stub
 * TODO: Implement full insuranceCatalog functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const insuranceCatalogRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
