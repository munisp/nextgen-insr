/**
 * policyOrders.ts — Auto-generated stub (ported from insureportal, C3
 * consolidate/insureportal-merge 2026-11-28).
 *
 * DECON scope correction (2026-11-28): insureportal's real orders impl lived
 * in the REMOVE-class ./ecommerceOrders.ts (generic retail orders — DECON
 * REMOVE) and is NOT ported. This KEEP-class insurance-core namespace is
 * backed only by ip's stub, converted to fail-loud NOT_IMPLEMENTED per root
 * F-12 convention (fail-loud beats fabricated) — no caller exists post-DECON.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const policyOrdersRouter = router({
  list: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "policyOrders.list: no delivered orders store on this platform (post-DECON stub)",
    });
  }),
});
