import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

function formatNaira(v: number | string) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

/**
 * FloatReconciliationPage — agent float reconciliation against the
 * transaction ledger. Backed by the floatReconciliation tRPC router.
 */
export default function FloatReconciliationPage() {
  const [search, setSearch] = useState("");
  const summary = trpc.floatReconciliation.getSummary.useQuery();
  const list = trpc.floatReconciliation.list.useQuery({
    limit: 20,
    offset: 0,
  });

  const rows = (list.data?.data ?? []).filter(tx => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(tx.reference ?? "").toLowerCase().includes(q) ||
      String(tx.type ?? "").toLowerCase().includes(q) ||
      String(tx.status ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RefreshCw className="w-6 h-6" /> Float Reconciliation
            </h1>
            <p className="text-muted-foreground mt-1">
              Reconcile agent premium reserves against the transaction ledger
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              summary.refetch();
              list.refetch();
            }}
            disabled={summary.isFetching || list.isFetching}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {summary.isFetching || list.isFetching
              ? "Refreshing…"
              : "Refresh"}
          </Button>
        </div>

        {summary.error && (
          <Card>
            <CardContent className="py-4 text-sm text-destructive">
              Failed to load summary: {summary.error.message}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold">
                {summary.isLoading
                  ? "…"
                  : (summary.data?.total ?? 0).toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">
                Ledger Transactions
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-sm font-medium">
                {summary.isLoading
                  ? "…"
                  : summary.data?.lastUpdated
                    ? new Date(summary.data.lastUpdated).toLocaleString(
                        "en-NG"
                      )
                    : "—"}
              </p>
              <p className="text-sm text-muted-foreground">Last Updated</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ledger Transactions</CardTitle>
            <CardDescription>
              Most recent transactions in the reconciliation ledger
            </CardDescription>
            <Input
              placeholder="Search by reference, type, or status…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </CardHeader>
          <CardContent>
            {list.isLoading ? (
              <div className="text-muted-foreground text-center py-8">
                Loading ledger…
              </div>
            ) : list.error ? (
              <div className="text-destructive text-center py-8">
                Failed to load ledger: {list.error.message}
              </div>
            ) : rows.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">
                No ledger transactions found.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3 text-left">Reference</th>
                      <th className="p-3 text-left">Type</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-center">Status</th>
                      <th className="p-3 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(tx => (
                      <tr key={tx.id} className="border-t">
                        <td className="p-3 font-mono text-xs">
                          {tx.reference}
                        </td>
                        <td className="p-3">{tx.type}</td>
                        <td className="p-3 text-right font-mono">
                          {formatNaira(tx.amount)}
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            variant={
                              tx.status === "success" ? "default" : "outline"
                            }
                          >
                            {tx.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {tx.createdAt
                            ? new Date(tx.createdAt).toLocaleString("en-NG")
                            : "—"}
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
