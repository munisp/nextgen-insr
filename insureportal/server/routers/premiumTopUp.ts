/**
 * premiumTopUp.ts — Auto-generated stub
 * TODO: Implement full premiumTopUp functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const premiumTopUpRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
