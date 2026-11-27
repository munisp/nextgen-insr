/**
 * featureFlag.ts — W34-D (2026-11-28): `actuaryEngine` feature-flag gate for
 * the actuary engine portal pages (design Appendix K Phase 1: portal pages
 * land behind the flag until the Go pricing service, W34-B, is live).
 *
 * Build/deploy-time flag via Vite env (the portal has no runtime client-side
 * flag service; tenantFeatureToggle is a tenant-preference mechanism, not a
 * rollout gate). Default OFF — pages render an honest disabled state.
 */
export function isActuaryEngineEnabled(): boolean {
  return import.meta.env.VITE_ACTUARY_ENGINE === "true";
}

/** The 22 registered product-line codes (design Appendix J). Mirrors
 *  actProductLineEnum in drizzle/schema.ts — registry rows are seeded data,
 *  this list is only the picker's vocabulary, never a hard-coded engine
 *  dispatch table. */
export const ACTUARY_PRODUCT_LINES = [
  "group_life",
  "whole_life",
  "health",
  "micro",
  "parametric_crop",
  "takaful",
  "motor",
  "fire_property",
  "marine_hull",
  "marine_cargo",
  "oil_gas",
  "agri_multi_peril",
  "livestock",
  "term_life",
  "funeral",
  "annuity",
  "credit_life",
  "hmo_health",
  "engineering_car",
  "bonds_surety",
  "liability",
  "git",
] as const;
