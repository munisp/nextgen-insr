/**
 * ratingEngine.ts — Actuarial Wave stage A1 (2026-10-01, A1)
 *
 * Pure, table-driven premium resolver. All pricing inputs come from the
 * rating_tables / rating_factors rows (drizzle/schema.ts) — there are NO
 * hardcoded rate constants, fallback age bumps, or silent defaults anywhere
 * in this module. The only named constant is the NAICOM statutory stamp
 * duty rate, which is a regulatory levy, not a pricing fallback.
 *
 * STRICT FAIL-CLOSED POLICY (approved by the user, 2026-10-01): when no
 * active rating table covers the requested productCode/coverageClass, or a
 * required factor row is absent, this resolver throws RatingUnavailableError
 * and returns NO premium. A premium computed from a fabricated constant is
 * worse than no quote at all (regulatory mis-pricing risk); callers map the
 * error to tRPC PRECONDITION_FAILED. This decision is deliberate and must
 * not be relaxed without a new dated, approved comment.
 *
 * Resolution rules:
 *   1. Table selection: status='active', effectiveFrom <= now, and
 *      (effectiveTo IS NULL OR effectiveTo > now); a productCode match is
 *      preferred over a coverageClass match; among matches the latest
 *      effectiveFrom wins.
 *   2. Base premium = sumInsured * base rate (factor type 'base', key
 *      'rate' or 'default').
 *   3. Factors applied in sortOrder, all multiplicative:
 *        age_band        — key '40-49' style range match on age, else
 *                          'default'; absent band match → no factor applied
 *                          only if no rows of that type exist for the table
 *                          (a table that DEFINES age bands but has no match
 *                          and no 'default' fails closed).
 *        claims_loading  — key exact count '2', threshold '2+', else 'default'.
 *        ncd             — applied only when ncdEligible is true (discount).
 *        location        — key matches input location, else 'default'.
 *        telematics_cap  — NEVER invents a telematics factor; it only clamps
 *                          the externally computed telematicsFactor input
 *                          into [minClamp, maxClamp] before multiplication.
 *      minClamp/maxClamp on any factor clamp that factor's value.
 *   4. Min premium floor: optional 'base' factor with key 'min_premium'.
 *   5. Stamp duty: premium * 0.005, added on top.
 */
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { ratingFactors, ratingTables } from "../../drizzle/schema";
import type { getDb } from "../db";

export type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** NAICOM statutory stamp duty levy (0.5%) — a regulatory constant, never a pricing fallback. */
const STAMP_DUTY_RATE = 0.005;

export class RatingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatingUnavailableError";
  }
}

export interface ResolveRatingInput {
  productCode?: string;
  coverageClass?: string;
  sumInsured: number;
  age?: number;
  claimsCount?: number;
  ncdEligible?: boolean;
  location?: string;
  /** Externally computed telematics multiplier (policy-linked). Never computed here. */
  telematicsFactor?: number;
}

export interface AppliedFactor {
  factorType: string;
  factorKey: string;
  value: number;
}

export interface RatingResult {
  tableId: number;
  version: number;
  baseRate: number;
  basePremium: number;
  appliedFactors: AppliedFactor[];
  premiumBeforeFloor: number;
  minPremium: number | null;
  premiumAfterFloor: number;
  stampDuty: number;
  totalPayable: number;
}

function num(v: unknown): number {
  return Number(v);
}

/** Clamp a factor value into its optional [minClamp, maxClamp] band. */
function clamped(value: number, min: number | null, max: number | null): number {
  let v = value;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

function matchAgeBand(key: string, age: number): boolean {
  const m = /^(\d+)-(\d+)$/.exec(key);
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    return age >= lo && age <= hi;
  }
  const p = /^(\d+)\+$/.exec(key);
  if (p) return age >= Number(p[1]);
  return false;
}

function matchClaimsKey(key: string, count: number): boolean {
  const p = /^(\d+)\+$/.exec(key);
  if (p) return count >= Number(p[1]);
  return key === String(count);
}

function pickFactor(
  rows: { factorKey: string; value: unknown; minClamp: unknown; maxClamp: unknown }[],
  matcher: (key: string) => boolean
): { factorKey: string; value: unknown; minClamp: unknown; maxClamp: unknown } | undefined {
  return rows.find(r => matcher(r.factorKey)) ?? rows.find(r => r.factorKey === "default");
}

export async function resolveRating(
  db: DrizzleDb,
  input: ResolveRatingInput
): Promise<RatingResult> {
  if (!input.productCode && !input.coverageClass) {
    throw new RatingUnavailableError(
      "resolveRating requires productCode or coverageClass"
    );
  }
  if (!(input.sumInsured > 0)) {
    throw new RatingUnavailableError("sumInsured must be positive");
  }

  const now = new Date();
  const active = await db
    .select()
    .from(ratingTables)
    .where(
      and(
        eq(ratingTables.status, "active"),
        lte(ratingTables.effectiveFrom, now),
        or(isNull(ratingTables.effectiveTo), gt(ratingTables.effectiveTo, now)),
        input.productCode
          ? or(
              eq(ratingTables.productCode, input.productCode),
              input.coverageClass
                ? eq(ratingTables.coverageClass, input.coverageClass)
                : undefined
            )
          : eq(ratingTables.coverageClass, input.coverageClass!)
      )
    );

  // productCode match preferred over class match; then latest effectiveFrom.
  const candidates = [...active].sort((a, b) => {
    const aProd = input.productCode && a.productCode === input.productCode ? 1 : 0;
    const bProd = input.productCode && b.productCode === input.productCode ? 1 : 0;
    if (aProd !== bProd) return bProd - aProd;
    return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
  });
  const table = candidates[0];
  if (!table) {
    throw new RatingUnavailableError(
      `No active rating table for productCode=${input.productCode ?? "∅"} coverageClass=${input.coverageClass ?? "∅"} — fail-closed, no fallback rates (2026-10-01, A1)`
    );
  }

  const factors = await db
    .select()
    .from(ratingFactors)
    .where(eq(ratingFactors.tableId, table.id))
    .orderBy(asc(ratingFactors.sortOrder));

  const baseRateRow = pickFactor(
    factors.filter(f => f.factorType === "base" && (f.factorKey === "rate" || f.factorKey === "default")),
    () => true
  );
  if (!baseRateRow) {
    throw new RatingUnavailableError(
      `Rating table ${table.id} has no base rate factor — fail-closed`
    );
  }
  const baseRate = num(baseRateRow.value);
  let premium = input.sumInsured * baseRate;
  const applied: AppliedFactor[] = [];

  // Apply exactly one row per multiplicative type, honoring sortOrder across types.
  const appliedTypes = new Set<string>();
  for (const f of factors) {
    if (f.factorType === "base" || f.factorType === "telematics_cap") continue;
    if (appliedTypes.has(f.factorType)) continue;
    const min = f.minClamp == null ? null : num(f.minClamp);
    const max = f.maxClamp == null ? null : num(f.maxClamp);

    let applies = false;
    if (f.factorType === "age_band") {
      if (input.age != null) {
        if (matchAgeBand(f.factorKey, input.age)) {
          applies = true;
        } else if (
          f.factorKey === "default" &&
          !factors.some(
            o =>
              o.factorType === "age_band" &&
              o.factorKey !== "default" &&
              matchAgeBand(o.factorKey, input.age!)
          )
        ) {
          applies = true;
        }
      }
      // fail-closed: table defines age bands, age given, nothing matches and no default
      const bandRows = factors.filter(o => o.factorType === "age_band");
      if (
        !applies &&
        input.age != null &&
        bandRows.length > 0 &&
        !bandRows.some(o => matchAgeBand(o.factorKey, input.age!)) &&
        !bandRows.some(o => o.factorKey === "default")
      ) {
        throw new RatingUnavailableError(
          `Rating table ${table.id} defines age bands but none match age=${input.age} and no 'default' band exists — fail-closed`
        );
      }
    } else if (f.factorType === "claims_loading") {
      if (input.claimsCount != null) {
        const rows = factors.filter(o => o.factorType === "claims_loading");
        const chosen = pickFactor(rows, k => matchClaimsKey(k, input.claimsCount!));
        applies = chosen?.id === f.id;
      }
    } else if (f.factorType === "ncd") {
      applies = input.ncdEligible === true && f.factorKey === "default";
    } else if (f.factorType === "location") {
      if (input.location != null) {
        const rows = factors.filter(o => o.factorType === "location");
        const chosen = pickFactor(rows, k => k === input.location);
        applies = chosen?.id === f.id;
      }
    }

    if (applies) {
      const value = clamped(num(f.value), min, max);
      premium *= value;
      applied.push({ factorType: f.factorType, factorKey: f.factorKey, value });
      appliedTypes.add(f.factorType);
    }
  }

  // Telematics cap: clamps ONLY the externally supplied telematicsFactor.
  const capRow = factors.find(f => f.factorType === "telematics_cap");
  if (capRow && input.telematicsFactor != null) {
    const min = capRow.minClamp == null ? null : num(capRow.minClamp);
    const max = capRow.maxClamp == null ? null : num(capRow.maxClamp);
    const value = clamped(input.telematicsFactor, min, max);
    premium *= value;
    applied.push({ factorType: "telematics_cap", factorKey: capRow.factorKey, value });
  }

  const premiumBeforeFloor = premium;

  const minPremiumRow = factors.find(
    f => f.factorType === "base" && f.factorKey === "min_premium"
  );
  const minPremium = minPremiumRow ? num(minPremiumRow.value) : null;
  const premiumAfterFloor =
    minPremium != null ? Math.max(premium, minPremium) : premium;

  const stampDuty = premiumAfterFloor * STAMP_DUTY_RATE;
  const totalPayable = premiumAfterFloor + stampDuty;

  return {
    tableId: table.id,
    version: table.version,
    baseRate,
    basePremium: input.sumInsured * baseRate,
    appliedFactors: applied,
    premiumBeforeFloor,
    minPremium,
    premiumAfterFloor,
    stampDuty,
    totalPayable,
  };
}
