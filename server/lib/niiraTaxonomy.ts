/**
 * niiraTaxonomy.ts — 2026-10-02 (A2)
 *
 * Minimal NIIRA/NAICOM product-class taxonomy for insurance product creation
 * governance. Maps the EXISTING drizzle `coverage_type` pgEnum values
 * (drizzle/schema.ts coverageTypeEnum — do NOT extend here without a schema
 * change) to their NAICOM statutory class names. No new coverage types are
 * invented; unknown values are rejected fail-closed by `naicomClassFor`.
 *
 * Also hosts the productCode format contract used by product-creation
 * procedures: uppercase alphanumerics with hyphens, 4–32 chars
 * (schema column productCode varchar(32)).
 */
import { coverageTypeEnum } from "../../drizzle/schema";

export type CoverageType = (typeof coverageTypeEnum.enumValues)[number];

export const COVERAGE_TYPES: readonly string[] = coverageTypeEnum.enumValues;

/** NAICOM class name per coverage_type enum value (REAL mappings only). */
export const NAICOM_CLASS_BY_COVERAGE_TYPE: Record<CoverageType, string> = {
  life: "Life Assurance",
  health: "Health Insurance",
  motor: "Motor Insurance",
  property: "Property / Fire & General Business",
  liability: "General Liability",
  marine: "Marine Insurance",
  aviation: "Aviation Insurance",
  agriculture: "Agricultural Insurance",
  credit: "Credit / Bond & Suretyship",
  travel: "Travel Insurance",
  micro: "Microinsurance",
  group_life: "Group Life Assurance",
  annuity: "Annuity",
  pension: "Pension / Retirement (Annuity-backed)",
};

/**
 * Product code format: starts alphanumeric, then alphanumeric or hyphen,
 * total 4–32 chars, uppercase (e.g. "MQ-LIFE-001", "SMOKE-MOTOR-123").
 */
export const PRODUCT_CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

export function isValidProductCode(code: string): boolean {
  return PRODUCT_CODE_REGEX.test(code);
}

/** Fail-closed: unknown coverage types return null (callers reject). */
export function naicomClassFor(coverageType: string): string | null {
  return (
    NAICOM_CLASS_BY_COVERAGE_TYPE[
      coverageType as keyof typeof NAICOM_CLASS_BY_COVERAGE_TYPE
    ] ?? null
  );
}
