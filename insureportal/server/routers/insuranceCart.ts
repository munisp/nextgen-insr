/**
 * insuranceCart.ts — Auto-generated stub
 * TODO: Implement full insuranceCart functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const insuranceCartRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
