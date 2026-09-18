/**
 * policyLifecycle.ts — Wave F2 insurance audit fixes (INS-1/8/9/23).
 *
 * Central, shared policy-lifecycle rules used by the tRPC routers AND the
 * Temporal journey activities so every claim-creation path enforces the same
 * period/waiting/grace semantics:
 *
 *   - lapse/expiry sweeper (INS-1): active→lapsed once endDate + gracePeriod
 *     has passed; lapsed→expired once the reinstatement window has closed.
 *   - incident-window validation (INS-2): startDate <= incidentDate <=
 *     min(endDate, now) — a policy period violation is a money leak.
 *   - waiting-period enforcement (INS-23): incidents before
 *     effectiveStart + waitingPeriodDays are rejected (fail-closed).
 *   - grace-period helpers (INS-8): claims filed while a policy is inside
 *     its grace window are filed under a grace hold; arrears are offset at
 *     settlement.
 *   - reinstatement rules (INS-9): arrears coverage, max lapse window,
 *     waiting-period reset.
 *
 * Grace/lapse state lives in the append-only `policy_lifecycle_states`
 * extension table (migration 0063).
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { insuranceProducts, policies, policyLifecycleStates } from "../../drizzle/schema";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type PolicyRow = typeof policies.$inferSelect;
type LifecycleRow = typeof policyLifecycleStates.$inferSelect;

export const DEFAULT_GRACE_PERIOD_DAYS = 30;
/** After this many days lapsed, a policy expires and can no longer be reinstated. */
export const MAX_REINSTATEMENT_LAPSE_DAYS = 90;
/** Cooling-off window measured from policy inception (startDate). */
export const COOLING_OFF_DAYS = 14;
/** SLA for re-adjudicating an appealed claim. */
export const APPEAL_SLA_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fetch the 1:1 lifecycle row for a policy, creating it with defaults if absent. */
export async function getOrInitLifecycle(db: Db, policyId: number): Promise<LifecycleRow> {
  const [existing] = await db
    .select()
    .from(policyLifecycleStates)
    .where(eq(policyLifecycleStates.policyId, policyId))
    .limit(1);
  if (existing) return existing;
  const inserted = await db
    .insert(policyLifecycleStates)
    .values({ policyId })
    .onConflictDoNothing({ target: policyLifecycleStates.policyId })
    .returning();
  if (inserted.length > 0) return inserted[0]!;
  const [row] = await db
    .select()
    .from(policyLifecycleStates)
    .where(eq(policyLifecycleStates.policyId, policyId))
    .limit(1);
  if (!row) throw new Error(`Failed to init lifecycle state for policy ${policyId}`);
  return row;
}

/** True when the policy is past endDate but still inside its grace window. */
export function isInGracePeriod(policy: PolicyRow, lifecycle: LifecycleRow, now = new Date()): boolean {
  if (!policy.endDate) return false;
  const graceDays = lifecycle.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
  const graceEnd = new Date(policy.endDate.getTime() + graceDays * DAY_MS);
  return now.getTime() > policy.endDate.getTime() && now.getTime() <= graceEnd.getTime();
}

/**
 * INS-2: validate the caller-supplied incident date against the policy period.
 * Returns an error message, or null when the incident date is acceptable.
 */
export function validateIncidentWindow(
  policy: Pick<PolicyRow, "startDate" | "endDate">,
  incidentDate: Date,
  now = new Date()
): string | null {
  if (Number.isNaN(incidentDate.getTime())) return "incidentDate is not a valid date";
  if (incidentDate.getTime() > now.getTime()) {
    return "incidentDate cannot be in the future";
  }
  if (policy.startDate && incidentDate.getTime() < policy.startDate.getTime()) {
    return `incidentDate ${incidentDate.toISOString()} is before policy startDate ${policy.startDate.toISOString()}`;
  }
  if (policy.endDate && incidentDate.getTime() > policy.endDate.getTime()) {
    return `incidentDate ${incidentDate.toISOString()} is after policy endDate ${policy.endDate.toISOString()}`;
  }
  return null;
}

/**
 * INS-23 (+INS-9 reset): the effective coverage start is the LATER of the
 * policy startDate and a reinstatement waiting-period reset. Incidents before
 * effectiveStart + waitingPeriodDays are not covered.
 */
export async function validateWaitingPeriod(
  db: Db,
  policy: PolicyRow,
  incidentDate: Date
): Promise<string | null> {
  const [product] = await db
    .select({ waitingPeriodDays: insuranceProducts.waitingPeriodDays })
    .from(insuranceProducts)
    .where(eq(insuranceProducts.id, policy.productId))
    .limit(1);
  const waitingDays = product?.waitingPeriodDays ?? 0;
  if (waitingDays <= 0) return null;
  const lifecycle = await getOrInitLifecycle(db, policy.id);
  const base = lifecycle.waitingPeriodResetAt ?? policy.startDate;
  if (!base) return null;
  const coveredFrom = new Date(base.getTime() + waitingDays * DAY_MS);
  if (incidentDate.getTime() < coveredFrom.getTime()) {
    return `incidentDate ${incidentDate.toISOString()} falls inside the ${waitingDays}-day waiting period (coverage from ${coveredFrom.toISOString()})`;
  }
  return null;
}

/**
 * INS-2/23 (orchestrator entry points): fetch the policy and enforce the
 * incident window + waiting period BEFORE a claims workflow is started.
 * Throws TRPCError-compatible plain Error messages; callers surface them.
 */
export async function assertClaimIncidentValid(policyId: number, incidentDateRaw: string): Promise<void> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [policy] = await db.select().from(policies).where(eq(policies.id, policyId)).limit(1);
  if (!policy) throw new Error(`Policy ${policyId} not found`);
  const incidentDate = new Date(incidentDateRaw);
  const windowError = validateIncidentWindow(policy, incidentDate);
  if (windowError) throw new Error(`Policy ${policyId}: ${windowError}`);
  const waitingError = await validateWaitingPeriod(db, policy, incidentDate);
  if (waitingError) throw new Error(`Policy ${policyId}: ${waitingError}`);
}

/**
 * INS-1: lapse/expiry sweeper. Flips, atomically and idempotently:
 *   active  → lapsed  when now > endDate + gracePeriodDays
 *   lapsed  → expired when now > lapsedAt + MAX_REINSTATEMENT_LAPSE_DAYS
 *   active  → expired when the whole lapse window has already passed
 * Intended to be driven by a cron/Temporal schedule via the
 * `insuranceWorkflows.sweepPolicyLifecycle` procedure.
 */
export async function sweepPolicyLifecycle(db: Db, now = new Date()): Promise<{
  lapsed: number;
  expired: number;
}> {
  // Candidate active policies whose grace window has fully elapsed. Grace is
  // per-policy (lifecycle table, default 30 days when no row exists yet).
  const candidates = await db
    .select({
      id: policies.id,
      endDate: policies.endDate,
      annualPremium: policies.annualPremium,
      gracePeriodDays: policyLifecycleStates.gracePeriodDays,
    })
    .from(policies)
    .leftJoin(policyLifecycleStates, eq(policyLifecycleStates.policyId, policies.id))
    .where(and(eq(policies.status, "active"), isNotNull(policies.endDate)));

  let lapsed = 0;
  let expired = 0;
  for (const c of candidates) {
    if (!c.endDate) continue;
    const graceDays = c.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
    const lapseAt = c.endDate.getTime() + graceDays * DAY_MS;
    if (now.getTime() <= lapseAt) continue;
    const expiresAt = lapseAt + MAX_REINSTATEMENT_LAPSE_DAYS * DAY_MS;
    const toStatus = now.getTime() > expiresAt ? "expired" : "lapsed";
    const updated = await db
      .update(policies)
      .set({ status: toStatus, updatedAt: now })
      .where(and(eq(policies.id, c.id), eq(policies.status, "active")))
      .returning({ id: policies.id });
    if (updated.length === 0) continue; // lost a concurrent race — fine
    // Arrears: one unpaid annual premium is owed once the policy lapses.
    const arrears = String(Number(c.annualPremium ?? 0));
    await db
      .insert(policyLifecycleStates)
      .values({
        policyId: c.id,
        lapsedAt: now,
        expiredAt: toStatus === "expired" ? now : null,
        lastSweptAt: now,
        arrearsAmount: arrears,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: policyLifecycleStates.policyId,
        set: {
          lapsedAt: now,
          expiredAt: toStatus === "expired" ? now : null,
          lastSweptAt: now,
          // Keep any already-accrued arrears; only seed from annualPremium
          // when nothing has been recorded yet.
          arrearsAmount: sql`CASE WHEN ${policyLifecycleStates.arrearsAmount}::numeric > 0 THEN ${policyLifecycleStates.arrearsAmount} ELSE ${arrears} END`,
          updatedAt: now,
        },
      });
    if (toStatus === "expired") expired += 1; else lapsed += 1;
  }

  // Second pass: lapsed policies whose reinstatement window has closed.
  const lapsedRows = await db
    .select({ id: policies.id, lapsedAt: policyLifecycleStates.lapsedAt })
    .from(policies)
    .innerJoin(policyLifecycleStates, eq(policyLifecycleStates.policyId, policies.id))
    .where(and(eq(policies.status, "lapsed"), isNotNull(policyLifecycleStates.lapsedAt)));
  for (const r of lapsedRows) {
    if (!r.lapsedAt) continue;
    if (now.getTime() <= r.lapsedAt.getTime() + MAX_REINSTATEMENT_LAPSE_DAYS * DAY_MS) continue;
    const updated = await db
      .update(policies)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(policies.id, r.id), eq(policies.status, "lapsed")))
      .returning({ id: policies.id });
    if (updated.length === 0) continue;
    await db
      .update(policyLifecycleStates)
      .set({ expiredAt: now, lastSweptAt: now, updatedAt: now })
      .where(eq(policyLifecycleStates.policyId, r.id));
    expired += 1;
  }

  return { lapsed, expired };
}

/**
 * INS-9: reinstatement preconditions. Returns an error message or null.
 *   - policy must be lapsed (not expired/cancelled)
 *   - lapse window must not have exceeded MAX_REINSTATEMENT_LAPSE_DAYS
 *   - payment must cover recorded arrears in full
 */
export function validateReinstatement(
  policy: PolicyRow,
  lifecycle: LifecycleRow,
  amountPaid: number,
  now = new Date()
): string | null {
  if (policy.status !== "lapsed") {
    return `Policy status '${policy.status}' cannot be reinstated (only 'lapsed')`;
  }
  if (lifecycle.lapsedAt) {
    const deadline = lifecycle.lapsedAt.getTime() + MAX_REINSTATEMENT_LAPSE_DAYS * DAY_MS;
    if (now.getTime() > deadline) {
      return `Reinstatement window of ${MAX_REINSTATEMENT_LAPSE_DAYS} days has closed (lapsed at ${lifecycle.lapsedAt.toISOString()})`;
    }
  }
  const arrears = Number(lifecycle.arrearsAmount ?? 0);
  if (amountPaid < arrears) {
    return `Reinstatement payment ${amountPaid} does not cover arrears of ${arrears}`;
  }
  return null;
}
