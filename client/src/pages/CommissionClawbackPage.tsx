import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RotateCcw, Search, AlertTriangle, CheckCircle } from "lucide-react";

export default function CommissionClawbackPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.commissionClawback.list.useQuery({});
  const approveMut = trpc.commissionClawback.approve.useMutation({
    onSuccess: () => toast.success("Clawback approved"),
  });
  const rejectMut = trpc.commissionClawback.reject.useMutation({
    onSuccess: () => toast.success("Clawback rejected"),
  });
  const clawbacks = (data?.items || []).filter(
    (c: any) =>
      !search || c.agentName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <RotateCcw className="w-6 h-6" /> Commission Clawback
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage commission reversals for disputed or fraudulent transactions
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.total || 0}</p>
            <p className="text-sm text-muted-foreground">Total Clawbacks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">
              —
            </p>
            <p className="text-sm text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              —
            </p>
            <p className="text-sm text-muted-foreground">Approved</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-red-600">
              $—
            </p>
            <p className="text-sm text-muted-foreground">Total Amount</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {clawbacks.map((c: any, i: number) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${c.status === "approved" ? "bg-green-100" : c.status === "pending" ? "bg-yellow-100" : "bg-red-100"}`}
                  >
                    {c.status === "approved" ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{c.agentName}</p>
                    <p className="text-sm text-muted-foreground">
                      Txn: {c.transactionId} • ${c.amount?.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.reason}</p>
                  </div>
                </div>
                {c.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => approveMut.mutate({ id: c.id })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectMut.mutate({ id: c.id })}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
