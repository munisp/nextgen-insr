/**
 * NextActionsPanel.tsx — 2026-10-24 (W11-B3b): Phase 3 member-intelligence
 * client surface over the W11-B3a server router (server/routers/
 * memberInsights.ts → memberInsights.nextBestActions). Renders the TOP 3
 * ranked, server-explained suggestions on the member portal shell
 * (MemberLayout — there is no separate MemberDashboard page; the portal
 * shell IS the member dashboard surface, so the panel renders below the
 * header on every /member/* page).
 *
 * Discipline:
 *   - Suggestions ONLY: each row renders the server's `explain` text
 *     verbatim plus a CTA link into the relevant existing flow. NOTHING
 *     here performs an action — the CTA is plain navigation (wouter Link).
 *   - Empty → the panel is HIDDEN entirely. Error → silent degrade
 *     (console.warn only; suggestions never block the portal).
 *   - Dismissal is CLIENT-LOCAL by contract (W11-B3a added no server
 *     accept/dismiss tables): "Dismiss" is session-scoped (sessionStorage),
 *     "Don't show again" is a localStorage flag — documented as device-local
 *     only, not a server-side preference.
 *   - Instrumentation (W11-B2c uxTrack): recommendation_accepted on CTA
 *     click, recommendation_dismissed on session dismiss,
 *     recommendation_dismissed_forever on the localStorage flag. Metadata
 *     carries the action TYPE only (never payload values).
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { trackEvent } from "@/lib/uxTrack";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { X } from "lucide-react";

/** 2026-10-24 (W11-B3b): instrumentation flow name for this surface. */
const UX_FLOW = "member-insights";

/** Client view of one memberInsights.nextBestActions element (the server
 *  serializes Dates via superjson; only the fields used here are typed). */
export interface InsightActionView {
  type:
    | "policy_renewal_due"
    | "failed_refund_pending"
    | "recurring_bill_due"
    | "kyc_incomplete";
  priority: number;
  explain: string;
  payload: Record<string, unknown>;
}

const MAX_SHOWN = 3;

/**
 * 2026-10-26 (W13-B, verify-w11b3b Finding 2): DISPLAY-ONLY fallback mirror
 * of the canonical server priority map in server/lib/memberInsights.ts
 * (nextBestActionsFor: policy_renewal_due 100 / failed_refund_pending 90 /
 * recurring_bill_due 70 / kyc_incomplete 40). The SERVER remains the source
 * of truth — it sorts priority desc, ties by type asc; this client-side
 * stable sort only protects the top-3 render if a response ever arrives
 * unsorted. Do NOT "fix" ranking here; change the server map instead.
 */
const TYPE_PRIORITY_FALLBACK: Record<InsightActionView["type"], number> = {
  policy_renewal_due: 100,
  failed_refund_pending: 90,
  recurring_bill_due: 70,
  kyc_incomplete: 40,
};

/** Defensive stable re-sort (Array.prototype.sort is stable per ES2019):
 *  effective priority desc, ties by type asc — mirrors the server order. */
function sortByPriority(actions: InsightActionView[]): InsightActionView[] {
  const effective = (a: InsightActionView) =>
    a.priority ?? TYPE_PRIORITY_FALLBACK[a.type] ?? 0;
  return [...actions].sort((a, b) =>
    effective(b) !== effective(a)
      ? effective(b) - effective(a)
      : a.type.localeCompare(b.type)
  );
}

/** sessionStorage key: action keys dismissed for THIS browser session. */
const SESSION_DISMISS_KEY = "nba-dismissed-session";
/** localStorage key: action keys dismissed "forever" (device-local only —
 *  W11-B3a ships no server-side dismissal state; documented honestly). */
const FOREVER_DISMISS_KEY = "nba-dismissed-forever";

function readKeySet(storage: Storage, key: string): Set<string> {
  try {
    const raw = storage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter(v => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function addToKeySet(storage: Storage, key: string, actionKey: string): void {
  try {
    const set = readKeySet(storage, key);
    set.add(actionKey);
    storage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* storage unavailable (private mode) — dismissal is best-effort UX */
  }
}

/** Stable per-action identity for dismissal: type + the primary opaque ref
 *  (policyId / transactionId / naturalKey). Never member-typed text. */
export function insightActionKey(a: InsightActionView): string {
  const ref =
    a.payload.policyId ?? a.payload.transactionId ?? a.payload.naturalKey ?? "";
  return `${a.type}:${String(ref)}`;
}

/** CTA destination per action type — navigation only, into existing flows.
 *  2026-10-26 (W13-B verifier advisory): FAIL-CLOSED on an UNKNOWN future
 *  action type — returns null so the panel hides the row rather than
 *  crashing the portal shell or rendering a dead-clickable suggestion. */
export function insightCta(
  a: InsightActionView
): { href: string; label: string } | null {
  switch (a.type) {
    case "policy_renewal_due": {
      const policyId = a.payload.policyId;
      return {
        href: policyId != null
          ? `/member/renewals?policyId=${encodeURIComponent(String(policyId))}`
          : "/member/renewals",
        label: "Review renewal",
      };
    }
    case "failed_refund_pending":
      return { href: "/member/disputes", label: "View payment issue" };
    case "recurring_bill_due":
      // The RecentPayeePicker on the destination page lists the member's
      // recent payees for that rail (prefill flow, W11-B1b) — the server
      // payload carries only the blind-indexed naturalKey (HMAC), never raw
      // identifiers, so deep preselection is impossible client-side BY
      // DESIGN; the CTA lands on the rail page where the picker surfaces
      // that payee.
      return {
        href: a.payload.rail === "airtime" ? "/member/airtime" : "/member/bills",
        label: "Pay now",
      };
    case "kyc_incomplete":
      return { href: "/member/identity", label: "Complete KYC" };
    default:
      return null;
  }
}

export function NextActionsPanel() {
  const query = trpc.memberInsights.nextBestActions.useQuery(undefined, {
    retry: false,
  });
  // Bump to re-render after a local dismissal write.
  const [, setDismissVersion] = useState(0);

  if (query.isError) {
    // Silent degrade by contract: a suggestions failure never blocks the
    // portal and never renders an error box on the shell.
    console.warn(
      "memberInsights.nextBestActions failed; panel hidden:",
      query.error.message
    );
    return null;
  }
  if (query.isLoading) return null;

  const all = (query.data?.actions ?? []) as InsightActionView[];
  if (all.length === 0) return null;

  let sessionDismissed: Set<string>;
  let foreverDismissed: Set<string>;
  try {
    sessionDismissed = readKeySet(sessionStorage, SESSION_DISMISS_KEY);
    foreverDismissed = readKeySet(localStorage, FOREVER_DISMISS_KEY);
  } catch {
    sessionDismissed = new Set();
    foreverDismissed = new Set();
  }
  const visible = sortByPriority(all)
    .filter(a => {
      // Unroutable (unknown future type) → hidden, not dead-clickable.
      if (!insightCta(a)) return false;
      const k = insightActionKey(a);
      return !sessionDismissed.has(k) && !foreverDismissed.has(k);
    })
    .slice(0, MAX_SHOWN);
  if (visible.length === 0) return null;

  const onAccept = (a: InsightActionView) => {
    trackEvent(UX_FLOW, "recommendation_accepted", {
      metadata: { action: a.type },
    });
  };
  const onDismiss = (a: InsightActionView) => {
    addToKeySet(sessionStorage, SESSION_DISMISS_KEY, insightActionKey(a));
    trackEvent(UX_FLOW, "recommendation_dismissed", {
      metadata: { action: a.type },
    });
    setDismissVersion(v => v + 1);
  };
  const onDismissForever = (a: InsightActionView) => {
    addToKeySet(localStorage, FOREVER_DISMISS_KEY, insightActionKey(a));
    trackEvent(UX_FLOW, "recommendation_dismissed_forever", {
      metadata: { action: a.type },
    });
    setDismissVersion(v => v + 1);
  };

  return (
    <Card data-testid="next-actions">
      <CardHeader>
        <CardTitle>Suggested next steps</CardTitle>
        <CardDescription>
          Based on your account activity — nothing happens automatically; you
          choose what to do.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {visible.map(a => {
            const cta = insightCta(a);
            if (!cta) return null; // unreachable — filtered above; satisfies TS
            return (
              <li
                key={insightActionKey(a)}
                className="flex flex-col gap-2 border rounded-md p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`nba-${a.type}`}
              >
                <p className="text-sm">{a.explain}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <Button asChild size="sm">
                    <Link href={cta.href} onClick={() => onAccept(a)}>
                      {cta.label}
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Dismiss suggestion ${a.type}`}
                    onClick={() => onDismiss(a)}
                  >
                    Dismiss
                  </Button>
                  <button
                    type="button"
                    aria-label={`Never show suggestion ${a.type} again`}
                    title="Don't show again (this device)"
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                    onClick={() => onDismissForever(a)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
