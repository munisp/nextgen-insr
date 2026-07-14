/**
 * insuranceServiceFleet.ts — Auto-generated stub
 * TODO: Implement full insuranceServiceFleet functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const insuranceServiceFleetRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
