/**
 * policyOrders.ts — Auto-generated stub
 * TODO: Implement full policyOrders functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const policyOrdersRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
