/**
 * journeyTriggerPolicy.ts — N-wave (2026-09-19)
 *
 * Shared sanitization policy for the GENERIC journey triggers
 * (insuranceJourneyOrchestrator.ts / insuranceJourneyOrchestratorV2.ts) and
 * the workflow-start boundary.
 *
 * Two trust rules, both fail-closed:
 *
 *  1. Staff/settlement context is NEVER caller-supplied. The generic trigger
 *     accepts an open `z.record` payload, so it must strip staff-context and
 *     settlement-destination fields for ALL journey types and compute
 *     `initiatedByStaff` SERVER-SIDE from the session role. (J03 itself is
 *     refused by the generic triggers — only the dedicated triggerJ03 paths
 *     may start it.)
 *
 *  2. Tenant identity for the Permify tenant check is NEVER caller-supplied.
 *     `buildTenantContext` (journey-tenant-guard.ts) consumes only the
 *     server-injected `authenticatedTenantId` / `authenticatedUserRole`
 *     fields; those are attached at the workflow-start boundary from the
 *     authenticated session (ctx.user) after stripping any caller-forged
 *     copies via `stripForgedTrustedFields`.
 */

/** Fields stripped from generic-trigger caller input for ALL journey types. */
export const GENERIC_TRIGGER_STRIPPED_FIELDS = [
  "staffContext",
  "beneficiaryAccount",
  "beneficiaryBank",
  "tenantId",
  "userRole",
] as const;

/**
 * Trusted journey-input fields derived exclusively from the authenticated
 * session and injected server-side at workflow start. Any caller-supplied
 * copies are forged and must be stripped before the session-derived values
 * are attached.
 */
export const CALLER_FORGED_JOURNEY_FIELDS = [
  "triggeredBy",
  "authenticatedTenantId",
  "authenticatedUserRole",
] as const;

/**
 * Sanitize generic-trigger caller input: staff/settlement/tenant-identity
 * fields are removed and `initiatedByStaff` is overwritten with the
 * server-computed value (from the session role — never the payload).
 */
export function sanitizeGenericJourneyInput(
  input: Record<string, unknown>,
  initiatedByStaff: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input, initiatedByStaff };
  for (const f of GENERIC_TRIGGER_STRIPPED_FIELDS) delete out[f];
  return out;
}

/**
 * Strip caller-forged trusted fields from any journey input before the
 * session-derived values are attached at the workflow-start boundary
 * (defense in depth behind the zod schemas / generic-trigger sanitization).
 */
export function stripForgedTrustedFields(input: unknown): Record<string, unknown> {
  const out = { ...(input as Record<string, unknown>) };
  for (const f of CALLER_FORGED_JOURNEY_FIELDS) delete out[f];
  return out;
}
