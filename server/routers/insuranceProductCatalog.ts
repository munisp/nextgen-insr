/**
 * insuranceProductCatalog.ts — Insurance Product Catalog Router
 *
 * Manages the catalog of insurance products available for purchase:
 *   - Life insurance (term, whole life, endowment)
 *   - Health insurance (individual, family, group)
 *   - Motor insurance (comprehensive, third-party)
 *   - Property insurance (fire, burglary, all-risks)
 *   - Agricultural insurance (crop, livestock)
 *   - Micro-insurance products (NAICOM-compliant)
 *
 * All products are NAICOM-registered with valid product codes.
 */
import { TRPCError } from "@trpc/server";
import { eq, desc, count, sql, and, gte, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { insuranceProducts, insuranceProductTypes, claims } from "../../drizzle/schema";
// Q-wave Q3 (2026-09-25): UBI rolling score for motor rating.
import { telematicsScores } from "../../drizzle/schema.innovations";
import { protectedProcedure, publicProcedure, router, serviceOrUserProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { assertPolicyOwnership } from "../lib/memberGuards";
// 2026-10-01 (A1b): filed rate-table resolver (stage A1) — fail-closed.
import {
  RatingUnavailableError,
  resolveRating,
  type DrizzleDb,
  type RatingResult,
} from "../lib/ratingEngine";

/**
 * 2026-10-01 (A1b): the claims-loading input is ALWAYS the caller's real
 * claims count from the DB (claims.claimantId = ctx.user.id — the
 * memberClaims.ts scoping rule). A client-supplied count is never accepted.
 */
async function callerClaimsCount(db: DrizzleDb, userId: number): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(claims)
    .where(eq(claims.claimantId, userId));
  return Number(n);
}

/**
 * 2026-10-01 (A1b): map the engine's fail-closed RatingUnavailableError to
 * PRECONDITION_FAILED and rethrow EVERYTHING else — never catch-and-fallback
 * to a fabricated premium (approved strict policy, design doc §A1).
 */
async function resolvePremium(
  db: DrizzleDb,
  input: Parameters<typeof resolveRating>[1]
): Promise<RatingResult> {
  try {
    return await resolveRating(db, input);
  } catch (err) {
    if (err instanceof RatingUnavailableError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    }
    throw err;
  }
}

export const insuranceProductCatalogRouter = router({
  // List all available insurance products
  // 2026-10-01 (R-fix2): serviceOrUserProcedure — returns only product-catalog
  // marketing metadata (insuranceProducts rows + count); no customer/policy/PII
  // joins, so trusted service tokens (whatsapp-bot) may call it.
  listProducts: serviceOrUserProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      productType: z.enum(["life", "health", "motor", "property", "agriculture", "micro", "all"]).default("all"),
      search: z.string().optional(),
      minPremium: z.number().optional(),
      maxPremium: z.number().optional(),
      isActive: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const conditions = [];
      if (input.isActive) conditions.push(eq(insuranceProducts.isActive, true));
      if (input.productType !== "all") conditions.push(eq(insuranceProducts.coverageType, input.productType));
      if (input.search) {
        conditions.push(or(
          ilike(insuranceProducts.name, `%${input.search}%`),
          ilike(insuranceProducts.description, `%${input.search}%`),
          ilike(insuranceProducts.naicomProductCode, `%${input.search}%`)
        ));
      }
      if (input.minPremium) conditions.push(gte(insuranceProducts.minPremium, String(input.minPremium)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const results = await db.select().from(insuranceProducts)
        .where(where)
        .orderBy(desc(insuranceProducts.createdAt))
        .limit(input.limit).offset(input.offset);

      const [{ total }] = await db.select({ total: count() }).from(insuranceProducts).where(where);
      return { data: results, total: Number(total) };
    }),

  // Get single product with full details
  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [product] = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.id)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });
      return product;
    }),

  // List product types / categories
  listCategories: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(insuranceProductTypes).where(eq(insuranceProductTypes.isActive, true));
  }),

  // Get products with low availability (for agent alerts)
  lowStockAlerts: protectedProcedure
    .input(z.object({ threshold: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      // insurance_products has no available_slots column; slot tracking is not
      // implemented, so there are no low-slot products to report.
      void input.threshold;
      return db.select().from(insuranceProducts)
        .where(sql`1 = 0`)
        .orderBy(desc(insuranceProducts.createdAt));
    }),

  // Get featured/recommended products
  getFeatured: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    // insurance_products has no is_featured column; surface the newest active products.
    return db.select().from(insuranceProducts)
      .where(eq(insuranceProducts.isActive, true))
      .orderBy(desc(insuranceProducts.createdAt)).limit(6);
  }),

  // Get product premium calculator
  // 2026-10-01 (R-fix2): intentionally KEPT protectedProcedure — when policyId
  // is supplied this reads telematics_scores (policy-linked driving score and
  // rating factor) and returns telematicsScore, i.e. member behavioral data.
  // Not eligible for serviceOrUserProcedure.
  calculatePremium: protectedProcedure
    .input(z.object({
      productId: z.number(),
      sumInsured: z.number().positive(),
      durationMonths: z.number().min(1).max(120).default(12),
      age: z.number().min(18).max(70).optional(),
      coverageType: z.string().optional(),
      // Q-wave Q3 (2026-09-25): optional policy for UBI rating — when the
      // policy has a telematics rolling score, the bounded rating factor
      // (0.70–1.30, default 1.00) is applied to motor premiums.
      policyId: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // 2026-10-01 (R3 batch 1, IDOR fix): when policyId is supplied this proc
      // reads that policy's telematics_scores row (member behavioral data).
      // Verify the caller owns the policy first; NOT_FOUND is non-enumerating.
      if (input.policyId != null) {
        await assertPolicyOwnership(db, input.policyId, ctx.user.id);
      }
      const [product] = await db.select().from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId)).limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });

      // 2026-10-01 (A1b): HONEST REWRITE — the hardcoded `baseRate = 0.02`
      // constant and the hand-rolled age loadings (+0.15/+0.3/+0.5 at ages
      // 40/50/60) that previously priced this calculator are REMOVED.
      // Premiums now resolve through the filed rating tables
      // (server/lib/ratingEngine.ts, stage A1) under the approved strict
      // fail-closed policy: when no active rating table covers this product,
      // this proc throws PRECONDITION_FAILED and returns NO premium — a
      // premium computed from a fabricated constant is a regulatory
      // mis-pricing risk, worse than no quote at all.
      //
      // Input mapping (honest):
      //   - productCode: the product's own productCode (coverageClass falls
      //     back to the product's coverageType).
      //   - age: remains a quote INPUT — this is a pre-bind calculator with
      //     no customer profile linked, so there is no server-side source of
      //     truth for the prospect's age yet (documented per design doc §A1).
      //   - claimsCount: the caller's REAL claims count from the DB (helper
      //     above) — never a client input.
      //   - ncdEligible: deliberately OMITTED — the repo has no NCD
      //     semantics outside the engine's `ncd` factor type, so no NCD
      //     discount is ever applied on this path (documented omission).
      //   - telematicsFactor: the existing policyId-linked telematics
      //     lookup below (bounds 0.70–1.30); passed only when a real score
      //     row exists. The engine's telematics_cap row clamps it further.
      const claimsCount = await callerClaimsCount(db, ctx.user.id);

      // Q-wave Q3 (2026-09-25): UBI rating factor for motor products. Read
      // from the telematics_scores rolling-score row (bounded 0.70–1.30);
      // no score history ⇒ no factor passed — never an implicit discount or
      // loading (multiplicative identity 1.00 is equivalent to omitting).
      let telematicsFactor: number | undefined;
      let telematicsScore: number | null = null;
      if (input.policyId != null && product.coverageType === "motor") {
        const [scoreRow] = await db.select().from(telematicsScores)
          .where(eq(telematicsScores.policyId, input.policyId)).limit(1);
        if (scoreRow) {
          const f = parseFloat(scoreRow.ratingFactor);
          if (Number.isFinite(f) && f >= 0.7 && f <= 1.3) {
            telematicsFactor = f;
            telematicsScore = parseFloat(scoreRow.score);
          }
          // Out-of-band factor (schema drift / manual edit) is ignored —
          // fail-closed to NO factor rather than pricing off a corrupt value.
        }
      }

      const rating = await resolvePremium(db, {
        productCode: product.productCode,
        coverageClass: product.coverageType,
        sumInsured: input.sumInsured,
        age: input.age,
        claimsCount,
        telematicsFactor,
      });

      // Duration adjustment: rating tables hold ANNUAL rates; the pre-rated
      // premium and its stamp duty are pro-rated by durationMonths/12, same
      // as the pre-A1b contract.
      const durationFactor = input.durationMonths / 12;
      // Aggregate view of the applied non-telematics factors (response
      // contract field; the authoritative breakdown is rating.appliedFactors).
      const loadingFactor = rating.appliedFactors
        .filter(f => f.factorType !== "telematics_cap")
        .reduce((acc, f) => acc * f.value, 1);
      const appliedTelematics = rating.appliedFactors.find(
        f => f.factorType === "telematics_cap"
      );
      const annualPremium = rating.premiumAfterFloor;
      const premiumNGN = Math.round(annualPremium * durationFactor * 100) / 100;
      const stampDuty = Math.round(rating.stampDuty * durationFactor * 100) / 100;
      const totalPayable = premiumNGN + stampDuty;

      return {
        productId: input.productId,
        productName: product.name,
        sumInsured: input.sumInsured,
        durationMonths: input.durationMonths,
        baseRate: rating.baseRate,
        loadingFactor,
        telematicsRatingFactor: appliedTelematics?.value ?? 1.0,
        telematicsScore,
        annualPremium,
        premiumNGN,
        stampDuty,
        totalPayable,
        currency: "NGN",
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }),
});
