// TypeScript enabled — Sprint 96 security audit
/**
 * lagosDate.ts — OPS-7: business dates in Africa/Lagos.
 *
 * Settlement cut-off is configured as 22:00 Africa/Lagos (seed.mjs), but the
 * codebase historically sliced `new Date().toISOString()` — a UTC date —
 * which mis-attributes settlements/audit rows between 23:00 and 00:00 Lagos
 * time (and any day boundary generally). Africa/Lagos is UTC+1 year-round
 * (no DST), so the Lagos calendar date is authoritative for business
 * artifacts (settlement dates, settlement IDs/workflowIds, audit resource
 * IDs). UTC timestamps remain stored alongside for absolute ordering.
 */

export const BUSINESS_TIMEZONE = "Africa/Lagos";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Business calendar date (YYYY-MM-DD) in Africa/Lagos for `d` (default: now). */
export function lagosDateString(d: Date = new Date()): string {
  return fmt.format(d);
}

/**
 * Business month (YYYY-MM) in Africa/Lagos — replaces the UTC-based
 * `toISOString().slice(0, 7)` reporting-period pattern.
 */
export function lagosMonthString(d: Date = new Date()): string {
  return lagosDateString(d).slice(0, 7);
}
