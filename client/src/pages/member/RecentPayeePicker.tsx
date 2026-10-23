/**
 * RecentPayeePicker.tsx — 2026-10-05 (W11-B1b): member payee-directory
 * prefill UI over the W11-B1a server surface (server/routers/memberPayees.ts):
 *
 *   - memberPayees.list({rail}) → the caller's recent payees for one rail
 *     (≤50 server-side, most-recently-used first, decrypted server-side;
 *     Dates revive via the superjson transformer). The picker shows the top
 *     5 as selectable chips.
 *   - memberPayees.remove({id}) → delete one of the CALLER'S payees
 *     (ownership enforced server-side; foreign ids are NOT_FOUND).
 *
 * Hard rules (mirrored by the callers):
 *   - Selecting a payee prefills ONLY the identifier fields for the rail
 *     (biller/meter, network/phone, provider/wallet) via the onSelect
 *     callback. The AMOUNT IS NEVER PREFILLED — the last amount is shown as
 *     a provenance hint ("last paid ₦X · <date>") only, and the member
 *     always types the amount explicitly before any submit.
 *   - Prefill NEVER blocks the payment UX: a list error degrades silently
 *     (console.warn, no picker), and an empty directory renders an honest
 *     "will appear here" note. Payees are recorded SERVER-SIDE on
 *     successful captures (server/lib/memberPayees.ts recordPayee) — the
 *     client never writes payee rows.
 */
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";

export type PayeeRail = "bill" | "airtime" | "momo";

/** Client view of one decrypted payee row (memberPayees.list element). */
export interface RecentPayee {
  id: string;
  rail: PayeeRail;
  label: string;
  billerCode?: string | null;
  meterNumber?: string | null;
  network?: string | null;
  phone?: string | null;
  provider?: string | null;
  walletNumber?: string | null;
  lastAmountKobo?: number | null;
  useCount?: number;
  lastUsedAt?: string | Date | null;
}

const MAX_SHOWN = 5;

const fmtNgnFromKobo = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100
  );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : null;

/** The rail-specific destination identifier shown under the payee label. */
function identifier(p: RecentPayee): string {
  switch (p.rail) {
    case "bill":
      return [p.billerCode, p.meterNumber].filter(Boolean).join(" · ");
    case "airtime":
      return [p.network, p.phone].filter(Boolean).join(" · ");
    case "momo":
      return [p.provider, p.walletNumber].filter(Boolean).join(" · ");
  }
}

export function RecentPayeePicker({
  rail,
  onSelect,
}: {
  rail: PayeeRail;
  /** Called with the chosen payee; the PARENT applies the field prefill
   *  (and clears the amount — the amount is never carried over). */
  onSelect: (payee: RecentPayee) => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.memberPayees.list.useQuery({ rail }, { retry: false });
  const removeMutation = trpc.memberPayees.remove.useMutation({
    onSuccess: () => {
      // Refresh every rail-scoped list cache entry.
      utils.memberPayees.list.invalidate();
    },
    onError: (err: { message: string }) => {
      // Removal is a convenience affordance; a failure must not disturb the
      // surrounding payment form.
      console.warn("memberPayees.remove failed:", err.message);
    },
  });

  if (query.isError) {
    // 2026-10-05 (W11-B1b): silent degrade by contract — prefill failure
    // never blocks the payment UX.
    console.warn(
      `memberPayees.list(${rail}) failed; prefill disabled:`,
      query.error.message
    );
    return null;
  }
  if (query.isLoading) return null;

  const payees = ((query.data?.payees ?? []) as RecentPayee[]).slice(
    0,
    MAX_SHOWN
  );
  if (payees.length === 0) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="recent-payees-empty"
      >
        Your recent payees will appear here after a successful payment.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="recent-payees">
      <p className="text-xs text-muted-foreground">
        From your recent payments — select one to prefill the details below
        (you can still edit everything; the amount is never prefilled).
      </p>
      <ul className="flex flex-wrap gap-2">
        {payees.map((p) => {
          const used = fmtDate(p.lastUsedAt);
          const provenance =
            p.lastAmountKobo != null
              ? `last paid ${fmtNgnFromKobo(p.lastAmountKobo)}${used ? ` · ${used}` : ""}`
              : used
                ? `last used ${used}`
                : null;
          return (
            <li key={p.id} className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => onSelect(p)}
                className="rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                data-testid={`payee-chip-${p.id}`}
              >
                <span className="block font-medium">{p.label}</span>
                {identifier(p) ? (
                  <span className="block text-xs text-muted-foreground">
                    {identifier(p)}
                  </span>
                ) : null}
                {provenance ? (
                  <span className="block text-xs text-muted-foreground">
                    {provenance}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Remove payee ${p.label}`}
                className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                onClick={() => removeMutation.mutate({ id: p.id })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
