/**
 * MemberWallet.tsx — /member/wallet (W7-B7, 2026-10-03)
 *
 * Wired to the REAL wallet router (server/routers/customerWalletSystem.ts):
 *   - customerWalletSystem.getBalance      (settled Cash In − Cash Out only)
 *   - customerWalletSystem.getTransactions (full history, ALL statuses —
 *     failed/pending rows are shown honestly, never hidden)
 *
 * Authz verified (W7-B7): every procedure resolves the owner server-side via
 * customers.keycloakSub = String(ctx.user.id) (resolveSessionCustomer); no
 * client-supplied customerId is accepted, so the surface is member-safe.
 *
 * TOP-UP UI DELIBERATELY OMITTED (2026-10-03, W7-B7):
 * customerWalletSystem.topUp is fail-closed — it refuses to credit unless a
 * `railReference` pointing at an ALREADY-SETTLED inbound rail row (written by
 * the payment-rail webhook/reconciliation path, never by the member) is
 * supplied. There is no member-initiable rail-payment initiation endpoint for
 * wallet funding in the monolith, so any client "Top up" button would be a
 * fabricated initiation that can only fail with PRECONDITION_FAILED. Instead
 * we show an honest note directing the member to the premium payment flow.
 * Revisit when a real wallet-funding checkout exists.
 */
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmt = (n: number, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(n);

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "success":
      return "default" as const;
    case "pending":
      return "secondary" as const;
    default:
      return "destructive" as const;
  }
}

export default function MemberWallet() {
  const balanceQuery = trpc.customerWalletSystem.getBalance.useQuery(
    undefined,
    { retry: false }
  );
  const txQuery = trpc.customerWalletSystem.getTransactions.useQuery(
    { limit: 50 },
    { retry: false }
  );

  const balance = balanceQuery.data;
  const transactions = txQuery.data?.transactions ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Wallet Balance"
          description="Only settled funds count — pending or failed transactions never enter your balance."
        >
          {balanceQuery.isLoading ? (
            <MemberLoading label="Loading wallet balance" />
          ) : balanceQuery.isError ? (
            <MemberError message={balanceQuery.error.message} />
          ) : (
            <p className="text-3xl font-bold" data-testid="wallet-balance">
              {fmt(balance?.balance ?? 0, balance?.currency ?? "NGN")}
            </p>
          )}
        </MemberSection>

        <MemberSection
          title="Transactions"
          description="Full wallet history, newest first — including failed and pending attempts."
        >
          {txQuery.isLoading ? (
            <MemberLoading label="Loading wallet transactions" />
          ) : txQuery.isError ? (
            <MemberError message={txQuery.error.message} />
          ) : transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no wallet transactions yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-mono text-xs">
                      {tx.ref ?? `#${tx.id}`}
                    </TableCell>
                    <TableCell>{tx.type ?? "—"}</TableCell>
                    <TableCell>
                      {fmt(Number(tx.amount ?? 0), tx.currency ?? "NGN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(tx.status)}>
                        {tx.status ?? "unknown"}
                      </Badge>
                      {tx.failureReason ? (
                        <span className="block text-xs text-muted-foreground mt-1">
                          {tx.failureReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{fmtDate(tx.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        {/* 2026-10-03 (W7-B7): honest note in place of a top-up button —
            see header comment for why no initiation UI exists. */}
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          Wallet top-up is not available in this portal yet. Wallet credit is
          only applied after a verified, settled payment through the payment
          gateway — to fund your account, use the premium payment flow on the
          Payments page or contact support.
        </p>
      </div>
    </MemberLayout>
  );
}
