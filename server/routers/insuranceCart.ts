/**
 * insuranceCart.ts — Auto-generated stub (ported from insureportal, C3
 * consolidate/insureportal-merge 2026-11-28).
 *
 * DECON scope correction (2026-11-28): insureportal's real cart impl lived in
 * the REMOVE-class ./ecommerceCart.ts (generic retail cart — DECON REMOVE per
 * classification.md §A/line 772) and is NOT ported. This KEEP-class
 * insurance-core namespace is backed only by ip's stub. The stub's fabricated
 * empty-cart return is converted to fail-loud NOT_IMPLEMENTED per root F-12
 * convention (fail-loud beats fabricated) — no caller exists post-DECON (the
 * consuming Ecommerce pages are REMOVE-class).
 */
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const insuranceCartRouter = router({
  list: protectedProcedure.query(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message:
        "insuranceCart.list: no delivered cart store on this platform (post-DECON stub)",
    });
  }),
});
