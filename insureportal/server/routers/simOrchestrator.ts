/**
 * simOrchestrator.ts — Auto-generated stub
 * TODO: Implement full simOrchestrator functionality
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";

export const simOrchestratorRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),
});
