/**
 * MyAccount.tsx — R3 batch 2 (2026-10-01, R3-b2)
 * Member's own savings account profile + session-bound account opening.
 * BINDING: REAL — memberSavings.myAccount / openMyAccount. The domain
 * `accountOpening.openAccount` is deliberately NOT used (it creates a
 * customers row for an arbitrary caller-supplied identity). openMyAccount
 * binds the row to the signed-in session (keycloakSub) and takes names from
 * the session server-side — this form never collects a name.
 * After submit the page shows the DISCLOSED "pending_kyc" state from the
 * real response — never a fake "approved". No balances are shown here; the
 * balance lives on My Savings (settled-only, live).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserRound, ShieldCheck } from "lucide-react";
import { savingsApi, SavingsApiError } from "@/services/savingsApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending_kyc":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "suspended":
    case "blacklisted":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

function statusLabel(status: string): string {
  return status === "pending_kyc" ? "Pending KYC verification" : status;
}

export default function MyAccount() {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["r3-b2", "savings", "account"],
    queryFn: () => savingsApi.myAccount(),
    retry: 1,
  });

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // Set from the REAL mutation response — drives the disclosed pending_kyc
  // confirmation. Never a fabricated status.
  const [openedStatus, setOpenedStatus] = useState<string | null>(null);

  const openMutation = useMutation({
    mutationFn: () =>
      savingsApi.openMyAccount({
        phone: phone.trim(),
        email: email.trim() || undefined,
        bvn: bvn.trim() || undefined,
        nin: nin.trim() || undefined,
        address: address.trim() || undefined,
      }),
    onSuccess: res => {
      setFormError(null);
      setOpenedStatus(res?.account?.status ?? "pending_kyc");
      queryClient.invalidateQueries({ queryKey: ["r3-b2", "savings"] });
    },
    onError: error => {
      // Surface the server's real reason verbatim (CONFLICT duplicate,
      // PRECONDITION_FAILED KYC gate blocked, validation…).
      setFormError(
        error instanceof SavingsApiError
          ? error.message
          : "Account opening failed. Please try again."
      );
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    openMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Account
        </h1>
        <p className="text-sm text-stone-500">
          Your savings account profile. Identity details come from your
          signed-in session — you never type your name here.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <UserRound className="h-5 w-5 text-amber-600" aria-hidden />
            Account profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          {account.isLoading ? (
            <LoadingState label="Loading your account…" />
          ) : account.isError ? (
            <ErrorState
              message="We couldn’t load your account. Please try again."
              onRetry={() => account.refetch()}
            />
          ) : account.data === null ? (
            <UnavailableState feature="Savings accounts" />
          ) : account.data.account !== null ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-stone-500">
                    Name
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-stone-900">
                    {account.data.account.firstName}{" "}
                    {account.data.account.lastName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-stone-500">
                    Opened
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-stone-900">
                    {new Date(
                      account.data.account.createdAt
                    ).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-stone-500">
                    KYC level
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-stone-900">
                    Tier {account.data.account.kycLevel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-stone-500">
                    Status
                  </dt>
                  <dd className="mt-1">
                    <Badge
                      className={`ring-1 ring-inset ${statusTone(account.data.account.status)}`}
                    >
                      {statusLabel(account.data.account.status)}
                    </Badge>
                  </dd>
                </div>
              </dl>
              {account.data.account.status === "pending_kyc" && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Your account is pending KYC verification. It activates once
                  verification completes — nothing here is simulated.
                </p>
              )}
            </div>
          ) : openedStatus ? (
            // Disclosed post-submit state: status from the real response
            // (always pending_kyc from the server — never "approved").
            <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-6 py-10 text-center">
              <ShieldCheck className="h-6 w-6 text-amber-600" aria-hidden />
              <p className="text-sm font-medium text-stone-800">
                Your account was created and is{" "}
                {statusLabel(openedStatus).toLowerCase()}
              </p>
              <p className="max-w-md text-xs text-stone-500">
                Your identity details were taken from your signed-in session.
                The account activates once KYC verification completes.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-xs text-stone-500">
                You don’t have a savings account yet. Open one below — your
                name and identity are bound to your signed-in session
                automatically. Supplying a BVN or NIN opens a higher-tier
                account and requires the KYC verification service to be
                reachable; if it isn’t, opening is blocked (fail-closed).
              </p>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  minLength={7}
                  maxLength={20}
                  placeholder="0803 000 0000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bvn">BVN (optional, 11 digits)</Label>
                  <Input
                    id="bvn"
                    value={bvn}
                    onChange={e => setBvn(e.target.value)}
                    minLength={11}
                    maxLength={11}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nin">NIN (optional, 11 digits)</Label>
                  <Input
                    id="nin"
                    value={nin}
                    onChange={e => setNin(e.target.value)}
                    minLength={11}
                    maxLength={11}
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address (optional)</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  maxLength={512}
                />
              </div>
              {formError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={openMutation.isPending}>
                {openMutation.isPending ? "Opening…" : "Open my account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
