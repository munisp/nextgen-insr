/**
 * MyBills.tsx — R3 batch 3 (2026-10-01, R3-b3)
 * Member bill-payments catalog page, bound to the MONOLITH memberBillPayments
 * router (server/routers/memberBillPayments.ts) via services/memberBillsFxApi.ts.
 *
 * READ-ONLY by design: there is NO pay button and NO payment flow here.
 * billPayments.pay is a funds mutation behind financialProcedure (role
 * `user` holds no transfer permission) — payment initiation is disclosed as
 * "coming soon", never offered. Bill history is disclosed as "not yet
 * available" — bill transaction rows carry no member-bound identity column,
 * so member history is not honestly scopable today (omitted, not guessed).
 * Every figure rendered comes from a real proc response — nothing is
 * fabricated.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Info, ReceiptText } from "lucide-react";
import {
  memberBillPaymentsApi,
  type ValidateCustomerResult,
} from "@/services/memberBillsFxApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function formatNgn(amount: number): string {
  return `₦${amount.toLocaleString()}`;
}

export default function MyBills() {
  const catalog = useQuery({
    queryKey: ["r3-b3", "memberBillPayments", "billers"],
    queryFn: () => memberBillPaymentsApi.billers(),
    retry: 1,
  });

  // Validator form state.
  const [biller, setBiller] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [check, setCheck] = useState<{
    biller: string;
    customerNumber: string;
  } | null>(null);

  const validation = useQuery<ValidateCustomerResult | null>({
    queryKey: ["r3-b3", "memberBillPayments", "validateCustomer", check],
    queryFn: () =>
      check
        ? memberBillPaymentsApi.validateCustomer(check)
        : Promise.resolve(null),
    enabled: check !== null,
    retry: 0,
  });

  const c = catalog.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <ReceiptText className="h-6 w-6 text-stone-500" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Bill Payments</h1>
          <p className="text-sm text-stone-500">
            Supported billers and customer-number checks.
          </p>
        </div>
      </div>

      {/* Honest disclosure: payment initiation is deferred (funds wave). */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <p className="text-sm text-amber-800">
          Payment initiation is coming soon — you can browse billers and check
          a customer number today, but paying a bill from this app is not
          available yet.
        </p>
      </div>

      {catalog.isLoading ? (
        <LoadingState label="Loading billers…" />
      ) : catalog.isError ? (
        <ErrorState
          message="We couldn’t load the biller catalog. Please try again."
          onRetry={() => catalog.refetch()}
        />
      ) : c === null || c === undefined ? (
        <UnavailableState feature="Bill payments" />
      ) : (
        <>
          {!c.configured && (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="text-sm text-stone-600">
                Bill payment provider not configured on this deployment —
                biller fulfilment is unavailable.
              </p>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supported billers</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-stone-100">
                {c.billers.map(b => (
                  <li
                    key={b.name}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span className="text-sm font-medium text-stone-900">
                      {b.name}
                    </span>
                    <span className="text-xs text-stone-500">
                      Commission {b.commissionPct}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                Limits: {formatNgn(c.limits.minAmountNGN)}–
                {formatNgn(c.limits.maxAmountNGN)} per payment · daily limit{" "}
                {formatNgn(c.limits.dailyLimitNGN)}.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Check a customer number</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={e => {
                  e.preventDefault();
                  if (biller && customerNumber) setCheck({ biller, customerNumber });
                }}
              >
                <select
                  className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-900"
                  value={biller}
                  onChange={e => setBiller(e.target.value)}
                  aria-label="Biller"
                >
                  <option value="">Select biller…</option>
                  {c.billers.map(b => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <Input
                  value={customerNumber}
                  onChange={e => setCustomerNumber(e.target.value)}
                  placeholder="Customer / meter / smartcard number"
                  aria-label="Customer number"
                />
                <Button type="submit" variant="outline" disabled={!biller || !customerNumber}>
                  Check
                </Button>
              </form>
              {check && (
                <div className="mt-3">
                  {validation.isLoading ? (
                    <LoadingState label="Checking…" />
                  ) : validation.isError ? (
                    <ErrorState message="We couldn’t check that number. Please try again." />
                  ) : validation.data === null || validation.data === undefined ? (
                    <UnavailableState feature="Customer number check" />
                  ) : (
                    <p
                      className={`text-sm font-medium ${
                        validation.data.valid ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {validation.data.message}
                      {" — format check only; no payment has been made."}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Disclosed absence: member bill history is not honestly scopable
              today (bill rows carry no member-bound identity), so no history
              proc exists. Disclosure verbatim, no fabricated rows. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment history</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-stone-500">
                Your bill payment history appears here once member-initiated
                bill pay ships. Payments made by agents on your behalf cannot
                be attributed to your account yet.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
