/**
 * memberFundsIntent.tsx — 2026-10-04 (W10-B4a)
 *
 * Shared client discipline for the W10-B2 member funds mutations
 * (memberBillPayments.pay/confirmPay, memberAirtime.vend/confirmVend,
 * memberMobileMoney.cashIn/confirmCashIn — server/lib/memberFunds.ts):
 *
 *   1. Idempotency-key stability per USER INTENT. The server binds the key
 *      to a payload hash of the intent (biller+customer+amount, …) and
 *      rejects a key reused with a different payload (CONFLICT). So the
 *      client keeps ONE key per draft, persisted in sessionStorage keyed by
 *      a fingerprint of the exact funds-relevant fields: the same draft
 *      always sends the same key (safe retry after a network failure), any
 *      edit to the draft mints a NEW key, and a terminal outcome retires
 *      the key so a fresh attempt starts clean. The key format matches the
 *      server zod boundary /^[A-Za-z0-9_-]{8,20}$/ (a UUID is 36 chars and
 *      would be REJECTED — do not use crypto.randomUUID here).
 *
 *   2. Honest tri-state confirmation rendering. confirm* NEVER returns a
 *      synchronous "delivered": the truthful states are submitted (pending
 *      fulfillment), failed + failed_refund_pending (loud), and
 *      unknown_outcome (held pending). <MemberCapturePanel> renders exactly
 *      those, verbatim, and never a fabricated success.
 *
 * Boundary mock note: tests stub ONLY @/lib/trpc; this module's sessionStorage
 * and crypto are the real browser APIs (happy-dom provides both).
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KEY_PREFIX = "member-funds-idem:";
const KEY_RE = /^[A-Za-z0-9_-]{8,20}$/;

/** In-memory fallback when sessionStorage is unavailable (private mode). */
const memoryKeys = new Map<string, { fingerprint: string; key: string }>();

/** 15 random bytes → 20 base64url chars (matches the server key regex). */
function generateKey(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const key = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return KEY_RE.test(key) ? key : key.replace(/[^A-Za-z0-9_-]/g, "x");
}

/**
 * The stable idempotency key for one funds intent draft. `scope` isolates
 * the journeys (bill pay / vend / cash-in); `fingerprint` MUST be a
 * canonical serialization of exactly the fields the server payload-hash
 * binds (e.g. JSON.stringify({biller, customerNumber, meterType, amountNGN})).
 */
export function intentIdempotencyKey(
  scope: string,
  fingerprint: string
): string {
  const storeKey = `${KEY_PREFIX}${scope}`;
  try {
    const raw = sessionStorage.getItem(storeKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { fingerprint?: string; key?: string };
      if (
        parsed.fingerprint === fingerprint &&
        typeof parsed.key === "string" &&
        KEY_RE.test(parsed.key)
      ) {
        return parsed.key;
      }
    }
    const key = generateKey();
    sessionStorage.setItem(storeKey, JSON.stringify({ fingerprint, key }));
    return key;
  } catch {
    const mem = memoryKeys.get(storeKey);
    if (mem && mem.fingerprint === fingerprint) return mem.key;
    const key = generateKey();
    memoryKeys.set(storeKey, { fingerprint, key });
    return key;
  }
}

/**
 * Retire a draft's key after a TERMINAL outcome (status "success" or
 * "failed" from a confirm* response): the next identical draft is a NEW
 * user intent and must not replay the old reference.
 */
export function retireIntentKey(scope: string): void {
  memoryKeys.delete(`${KEY_PREFIX}${scope}`);
  try {
    sessionStorage.removeItem(`${KEY_PREFIX}${scope}`);
  } catch {
    /* sessionStorage unavailable — memory fallback already cleared */
  }
}

/** True when a confirm* response reached a terminal state. */
export function isTerminalConfirmation(c: { status: string }): boolean {
  return c.status === "success" || c.status === "failed";
}

export interface CaptureConfirmationView {
  reference: string;
  status: string;
  providerStatus: string;
  captureStatus?: string;
  amount?: string;
  currency?: string;
  failureReason?: string | null;
  refundStatus?: string | null;
  resolution?: string;
  idempotent?: boolean;
}

const fmt = (n: number, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(n);

/**
 * Honest tri-state render of a confirm* response (2026-10-04, W10-B4a).
 * Never claims delivery/success unless the server says status:"success".
 */
export function CaptureOutcome({
  confirmation,
  label,
}: {
  confirmation: CaptureConfirmationView;
  label: string;
}) {
  const c = confirmation;
  if (c.status === "failed") {
    return (
      <p
        role="alert"
        data-testid="capture-outcome"
        className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
      >
        <strong>
          Your payment was captured but the {label} FAILED.
        </strong>{" "}
        {c.failureReason ? <>Reason: {c.failureReason}. </> : null}
        Refund status:{" "}
        <Badge variant="destructive">
          {c.refundStatus ?? "failed_refund_pending"}
        </Badge>{" "}
        — the captured funds are queued for refund; support can trace
        reference <span className="font-mono">{c.reference}</span>.
      </p>
    );
  }
  if (c.status === "success") {
    return (
      <p
        role="status"
        data-testid="capture-outcome"
        className="text-sm border rounded-md p-3"
      >
        The provider confirmed your {label} as completed (reference{" "}
        <span className="font-mono">{c.reference}</span>).
      </p>
    );
  }
  if (c.providerStatus === "unknown_outcome") {
    return (
      <p
        role="status"
        data-testid="capture-outcome"
        className="text-sm border rounded-md p-3"
      >
        Your payment was captured, but the {label} outcome is{" "}
        <Badge variant="secondary">unknown</Badge> — the provider did not
        confirm or reject it. The request is held pending and will be
        resolved by a status check; do NOT pay again. Reference:{" "}
        <span className="font-mono">{c.reference}</span>.
      </p>
    );
  }
  // Remaining truthful state: submitted / pending fulfillment.
  return (
    <p
      role="status"
      data-testid="capture-outcome"
      className="text-sm border rounded-md p-3"
    >
      Payment captured — your {label} was{" "}
      <Badge variant="secondary">{c.providerStatus || "submitted"}</Badge> and
      is pending fulfillment. It has NOT been delivered yet. Reference:{" "}
      <span className="font-mono">{c.reference}</span>.
    </p>
  );
}

export interface CaptureInitiationView {
  reference: string;
  authorizationUrl: string;
  amount?: string;
  currency?: string;
  idempotent?: boolean;
}

/**
 * The two-phase capture panel shared by bill pay / airtime vend / cash-in
 * (2026-10-04, W10-B4a): real reference + Paystack authorizationUrl handoff
 * (same target=_blank link pattern as MemberPayments), then an explicit
 * "I've paid — verify" confirm that renders the tri-state outcome.
 */
export function MemberCapturePanel({
  initiation,
  label,
  confirming,
  confirmation,
  confirmError,
  onVerify,
}: {
  initiation: CaptureInitiationView;
  label: string;
  confirming: boolean;
  confirmation: CaptureConfirmationView | null;
  confirmError: string | null;
  onVerify: () => void;
}) {
  return (
    <div className="text-sm border rounded-md p-3 space-y-2">
      <p>
        Payment initiated. Reference:{" "}
        <span className="font-mono">{initiation.reference}</span>
        {initiation.amount != null
          ? ` — ${fmt(Number(initiation.amount), initiation.currency ?? "NGN")}`
          : ""}
        {initiation.idempotent
          ? " (same payment resumed — no duplicate charge)"
          : ""}
      </p>
      <div className="flex gap-2">
        <Button asChild size="sm">
          <a
            href={initiation.authorizationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Complete payment
          </a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={confirming}
          onClick={onVerify}
        >
          {confirming ? "Verifying…" : "I've paid — verify"}
        </Button>
      </div>
      {confirmation ? (
        <CaptureOutcome confirmation={confirmation} label={label} />
      ) : null}
      {confirmError ? (
        <p role="alert" className="text-sm text-destructive">
          Verification failed: {confirmError}
        </p>
      ) : null}
    </div>
  );
}
