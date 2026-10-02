/**
 * MemberSavings.tsx — /member/savings (W7-B7, 2026-10-03)
 *
 * Wired to the REAL member savings router (server/routers/memberSavings.ts):
 *   - memberSavings.mySummary      (settled-only balance + totals)
 *   - memberSavings.myAccount      ({ account } | { account: null })
 *   - memberSavings.myTransactions (paginated history, ALL statuses)
 *   - memberSavings.openMyAccount  (member-safe account opening; identity is
 *     taken from the session server-side — the form sends only phone/email/
 *     bvn/nin/address per the zod schema, and a Tier 2+ opening is gated by
 *     the fail-closed KYC enforcement service)
 *
 * CONTRIBUTE/WITHDRAW UI DELIBERATELY OMITTED (2026-10-03, W7-B7): no
 * member-safe deposit/withdraw mutation exists (savingsProducts.deposit /
 * withdraw are caller-scoped-IDOR fabricated-funds paths, fail-closed by
 * design). Funding happens through the rail-verified wallet; an honest note
 * is shown instead.
 *
 * Honest states only: loading skeletons, empty state, error card.
 */
import { useState } from "react";

import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

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

function OpenAccountForm({ onOpened }: { onOpened: () => void }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const openMutation = trpc.memberSavings.openMyAccount.useMutation({
    onSuccess: () => {
      setFormError(null);
      onOpened();
    },
    onError: (err: { message: string }) => setFormError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (phone.trim().length < 7) {
      setFormError("Enter a valid phone number (at least 7 digits).");
      return;
    }
    // zod-exact input: optional fields are omitted entirely when blank so the
    // server schema (email(), bvn/nin length 11) is never tripped by "".
    openMutation.mutate({
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(bvn.trim() ? { bvn: bvn.trim() } : {}),
      ...(nin.trim() ? { nin: nin.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <p className="text-sm text-muted-foreground">
        You do not have a savings account yet. Open one below — your name is
        taken from your signed-in profile, and supplying a BVN or NIN requires
        live KYC verification.
      </p>
      {formError && (
        <p
          role="alert"
          className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
        >
          Account could not be opened: {formError}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="savings-phone">Phone number</Label>
        <Input
          id="savings-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="08012345678"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="savings-email">Email (optional)</Label>
        <Input
          id="savings-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="savings-bvn">BVN (optional, 11 digits)</Label>
        <Input
          id="savings-bvn"
          value={bvn}
          onChange={(e) => setBvn(e.target.value)}
          maxLength={11}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="savings-nin">NIN (optional, 11 digits)</Label>
        <Input
          id="savings-nin"
          value={nin}
          onChange={(e) => setNin(e.target.value)}
          maxLength={11}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="savings-address">Address (optional)</Label>
        <Input
          id="savings-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={openMutation.isPending}>
        {openMutation.isPending ? "Opening…" : "Open savings account"}
      </Button>
    </form>
  );
}

export default function MemberSavings() {
  const accountQuery = trpc.memberSavings.myAccount.useQuery(undefined, {
    retry: false,
  });
  const hasAccount = !!accountQuery.data?.account;

  const summaryQuery = trpc.memberSavings.mySummary.useQuery(undefined, {
    retry: false,
    // Without an account there is no caller scope — the summary procs
    // (honestly) throw NOT_FOUND; only run them once an account exists.
    enabled: hasAccount,
  });
  const txQuery = trpc.memberSavings.myTransactions.useQuery(
    { limit: 20, offset: 0 },
    { retry: false, enabled: hasAccount }
  );

  const summary = summaryQuery.data;
  const transactions = txQuery.data?.transactions ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Savings Account"
          description="Your member savings account, resolved from your signed-in profile."
        >
          {accountQuery.isLoading ? (
            <MemberLoading label="Loading savings account" />
          ) : accountQuery.isError ? (
            <MemberError message={accountQuery.error.message} />
          ) : !hasAccount ? (
            <OpenAccountForm
              onOpened={() => {
                accountQuery.refetch();
                summaryQuery.refetch();
                txQuery.refetch();
              }}
            />
          ) : (
            <div className="text-sm space-y-1">
              <p className="font-medium">
                {accountQuery.data!.account!.firstName}{" "}
                {accountQuery.data!.account!.lastName}
              </p>
              <p className="text-muted-foreground">
                Status: <Badge variant="secondary">{accountQuery.data!.account!.status ?? "unknown"}</Badge>{" "}
                KYC level: {accountQuery.data!.account!.kycLevel ?? "—"}
              </p>
              <p className="text-muted-foreground">
                Opened {fmtDate(accountQuery.data!.account!.createdAt)}
              </p>
            </div>
          )}
        </MemberSection>

        {hasAccount && (
          <>
            <MemberSection
              title="Savings Summary"
              description="Settled funds only — pending or failed transactions never enter the balance."
            >
              {summaryQuery.isLoading ? (
                <MemberLoading label="Loading savings summary" />
              ) : summaryQuery.isError ? (
                <MemberError message={summaryQuery.error.message} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Balance</p>
                    <p className="text-2xl font-bold" data-testid="savings-balance">
                      {fmt(summary?.balance ?? 0, summary?.currency ?? "NGN")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total in</p>
                    <p className="text-lg">{fmt(summary?.totalIn ?? 0, summary?.currency ?? "NGN")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total out</p>
                    <p className="text-lg">{fmt(summary?.totalOut ?? 0, summary?.currency ?? "NGN")}</p>
                  </div>
                </div>
              )}
            </MemberSection>

            <MemberSection
              title="Savings Transactions"
              description="Newest first — including failed and pending attempts."
            >
              {txQuery.isLoading ? (
                <MemberLoading label="Loading savings transactions" />
              ) : txQuery.isError ? (
                <MemberError message={txQuery.error.message} />
              ) : transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  You have no savings transactions yet.
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

            {/* 2026-10-03 (W7-B7): honest note — no member-safe
                contribute/withdraw mutation exists; see header comment. */}
            <p className="text-sm text-muted-foreground border rounded-md p-3">
              Deposits and withdrawals are not available in this portal.
              Savings funding goes through your rail-verified wallet — use the
              Payments page or contact support for assistance.
            </p>
          </>
        )}
      </div>
    </MemberLayout>
  );
}
