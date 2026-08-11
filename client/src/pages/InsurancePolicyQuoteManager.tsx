import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, FileText, Trash2 } from "lucide-react";

function formatNaira(v: number | string | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

/**
 * InsurancePolicyQuoteManager — pending insurance policy quotes (quote cart).
 * Backed by the insurancePolicyQuoteManager tRPC router (policy_quotes table).
 */
export default function InsurancePolicyQuoteManager() {
  const utils = trpc.useUtils();
  const cart = trpc.insurancePolicyQuoteManager.getCart.useQuery({});
  const removeMut = trpc.insurancePolicyQuoteManager.removeItem.useMutation({
    onSuccess: () => {
      toast.success("Quote removed");
      utils.insurancePolicyQuoteManager.getCart.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const items = cart.data?.items ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="w-6 h-6" /> Policy Quote Manager
            </h1>
            <p className="text-muted-foreground mt-1">
              Pending insurance policy quotes awaiting underwriting or binding
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => cart.refetch()}
            disabled={cart.isFetching}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {cart.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {cart.error && (
          <Card>
            <CardContent className="py-4 text-sm text-destructive">
              Failed to load quotes: {cart.error.message}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold">
                {cart.isLoading ? "…" : (cart.data?.count ?? 0)}
              </p>
              <p className="text-sm text-muted-foreground">Pending Quotes</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold">
                {cart.isLoading
                  ? "…"
                  : formatNaira(cart.data?.totalPremium ?? 0)}
              </p>
              <p className="text-sm text-muted-foreground">Total Premium</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending Quotes</CardTitle>
            <CardDescription>
              Quotes are valid for 24 hours from creation
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cart.isLoading ? (
              <div className="text-muted-foreground text-center py-8">
                Loading quotes…
              </div>
            ) : items.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">
                No pending quotes. Quotes created from the product catalog will
                appear here.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3 text-left">Product</th>
                      <th className="p-3 text-left">Type</th>
                      <th className="p-3 text-right">Sum Insured</th>
                      <th className="p-3 text-right">Premium</th>
                      <th className="p-3 text-right">Total Payable</th>
                      <th className="p-3 text-center">Status</th>
                      <th className="p-3 text-left">Valid Until</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(q => (
                      <tr key={q.id} className="border-t">
                        <td className="p-3 font-medium">{q.productName}</td>
                        <td className="p-3 text-muted-foreground">
                          {q.productType}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {formatNaira(q.sumInsured)}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {formatNaira(q.premiumAmount)}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold">
                          {formatNaira(q.totalPayable)}
                        </td>
                        <td className="p-3 text-center">
                          <Badge variant="outline">{q.status}</Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {q.validUntil
                            ? new Date(q.validUntil).toLocaleString("en-NG")
                            : "—"}
                        </td>
                        <td className="p-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              removeMut.mutate({ quoteId: q.id })
                            }
                            disabled={removeMut.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
