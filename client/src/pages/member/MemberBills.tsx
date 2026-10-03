/**
 * MemberBills.tsx — /member/bills (W7-B10, 2026-10-06)
 *
 * Wired to the REAL member bill-payments surface
 * (server/routers/memberBillPayments.ts):
 *   - memberBillPayments.billers          (biller catalog: commission rates,
 *                                          platform limits, honest provider
 *                                          `configured` flag)
 *   - memberBillPayments.validateCustomer (format-only customer-number check
 *                                          — electricity 10-13 digits, TV
 *                                          10-12 digits, else >= 5 chars)
 *
 * NO PAY BUTTON — deliberate (2026-10-06, W7-B10): the member router has NO
 * pay-bill mutation. `billPayments.pay` is a funds mutation the `user` role
 * has no transfer permission for (permifyMiddleware), and member-initiated
 * bill pay is deferred to the reviewed funds wave. Any client "Pay" button
 * would be a fabricated action with no backend to honor it, so this page
 * shows the catalog + format validation only, with an honest note. Revisit
 * when a member-safe pay mutation ships.
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

export default function MemberBills() {
  const [biller, setBiller] = useState<string>("");
  const [customerNumber, setCustomerNumber] = useState<string>("");
  // Submitted validation params — the query only fires after Validate.
  const [check, setCheck] = useState<{
    biller: string;
    customerNumber: string;
  } | null>(null);

  const billersQuery = trpc.memberBillPayments.billers.useQuery(undefined, {
    retry: false,
  });
  const validateQuery = trpc.memberBillPayments.validateCustomer.useQuery(
    check ?? { biller: "__none__", customerNumber: "__none__" },
    { enabled: check !== null, retry: false }
  );

  const billers = billersQuery.data?.billers ?? [];
  const limits = billersQuery.data?.limits;
  const configured = billersQuery.data?.configured ?? false;
  const result = check ? validateQuery.data : undefined;
  // Default the selection to the first catalog biller when the member has
  // not picked one explicitly.
  const chosenBiller = biller || (billers[0]?.name ?? "");

  const onValidate = () => {
    if (!chosenBiller || !customerNumber.trim()) return;
    setCheck({ biller: chosenBiller, customerNumber: customerNumber.trim() });
  };

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Billers"
          description="Supported billers, the commission the agent rail applies, and platform limits."
        >
          {billersQuery.isLoading ? (
            <MemberLoading label="Loading billers" />
          ) : billersQuery.isError ? (
            <MemberError message={billersQuery.error.message} />
          ) : (
            <>
              {!configured ? (
                <p className="text-sm text-muted-foreground border rounded-md p-3 mb-4">
                  No bill-payment provider is configured on this deployment, so
                  live bill payment is unavailable.
                </p>
              ) : null}
              {limits ? (
                <p className="text-sm text-muted-foreground mb-4">
                  Limits: {fmtNgn(limits.minAmountNGN)} –{" "}
                  {fmtNgn(limits.maxAmountNGN)} per payment,{" "}
                  {fmtNgn(limits.dailyLimitNGN)} daily.
                </p>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Biller</TableHead>
                    <TableHead>Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billers.map((b) => (
                    <TableRow key={b.name}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{b.commissionPct}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="Check a Customer Number"
          description="Format check only — a valid result does not confirm the account with the biller and never authorises a payment."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="biller">Biller</Label>
              <Select value={chosenBiller} onValueChange={setBiller}>
                <SelectTrigger id="biller">
                  <SelectValue placeholder="Select biller" />
                </SelectTrigger>
                <SelectContent>
                  {billers.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerNumber">Customer / meter number</Label>
              <Input
                id="customerNumber"
                value={customerNumber}
                onChange={(e) => setCustomerNumber(e.target.value)}
                placeholder="e.g. 12345678901"
              />
            </div>
          </div>
          <Button
            className="mt-4"
            onClick={onValidate}
            disabled={!chosenBiller || !customerNumber.trim()}
          >
            Validate
          </Button>
          {check ? (
            <div className="mt-4" data-testid="validate-result">
              {validateQuery.isLoading ? (
                <MemberLoading label="Validating customer number" />
              ) : validateQuery.isError ? (
                <MemberError message={validateQuery.error.message} />
              ) : result ? (
                <p className="text-sm">
                  <Badge variant={result.valid ? "default" : "destructive"}>
                    {result.valid ? "Valid" : "Invalid"}
                  </Badge>{" "}
                  <span className="text-muted-foreground">
                    {result.message} — {result.biller} / {result.customerNumber}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </MemberSection>

        {/* 2026-10-06 (W7-B10): honest note in place of a pay button — see
            header comment for why no payment UI exists. */}
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          Paying a bill is not available in this portal yet — member-initiated
          bill pay has no backend on this deployment. Your payment history
          will appear here once member-initiated bill pay ships.
        </p>
      </div>
    </MemberLayout>
  );
}
