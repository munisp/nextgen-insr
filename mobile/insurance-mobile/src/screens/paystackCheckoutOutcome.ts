/**
 * paystackCheckoutOutcome.ts — 2026-10-06 (W10-B5)
 *
 * Tiny module-level outcome store bridging PaystackCheckoutScreen back to
 * the MemberCapturePanel that launched it.
 *
 * Design choice (why not route params): React Navigation route params are
 * documented as non-serializable when they carry callbacks, and a completion
 * callback passed through `navigation.navigate('PaystackCheckout', {…,
 * onComplete})` would break state persistence/deep-link serialization. The
 * established alternative — navigating back with merged params — couples the
 * checkout screen to the caller's route name (Bills vs Airtime), which this
 * shared checkout must not know. A module-scope store is the smallest honest
 * channel: the checkout screen is a singleton on the stack, exactly one
 * checkout can be in flight at a time, and the store is consumed
 * (read-then-cleared) by the panel's focus listener, so a stale outcome can
 * never double-fire a confirm. It is also directly test-friendly (no
 * navigation container needed to assert the recorded outcome).
 *
 * Safety contract: the outcome is UX-only. It auto-triggers the caller's
 * confirm mutation (server-side verifyTransaction decides paid/unpaid); it
 * NEVER credits anything client-side. 'cancelled' never confirms.
 */

export type CheckoutOutcome = 'completed' | 'cancelled';

export interface CheckoutOutcomeRecord {
  outcome: CheckoutOutcome;
  /** The initiation reference the outcome belongs to (fail-closed match). */
  reference: string;
}

let current: CheckoutOutcomeRecord | null = null;

export function setCheckoutOutcome(record: CheckoutOutcomeRecord): void {
  current = record;
}

/** Read WITHOUT clearing (the panel clears only after consuming a match). */
export function getCheckoutOutcome(): CheckoutOutcomeRecord | null {
  return current;
}

export function clearCheckoutOutcome(): void {
  current = null;
}
