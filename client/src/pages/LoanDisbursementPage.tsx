import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function LoanDisbursementPage() {
  // F-12 (wave-4b): no loan-disbursement store is delivered — loanDisbursement.list/.analytics/.products are fail-loud. Honest unavailable state; the query stays wired.
  const { isError } = trpc.loanDisbursement.list.useQuery(undefined, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Loan Disbursement</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — loan disbursement are not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports this feature as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
