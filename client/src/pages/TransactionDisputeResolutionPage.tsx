import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Scale,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  MessageSquare,
} from "lucide-react";

export default function TransactionDisputeResolutionPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.transactionDisputeResolution.list.useQuery();
  const resolveMut = trpc.transactionDisputeResolution.resolve.useMutation({
    onSuccess: () => toast.success("Dispute resolved"),
  });
  const escalateMut = trpc.transactionDisputeResolution.escalate.useMutation({
    onSuccess: () => toast.success("Dispute escalated"),
  });
  const disputes = (data?.disputes || []).filter(
    (d: any) =>
      !search ||
      d.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      d.transactionId?.includes(search)
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="w-6 h-6" /> Transaction Dispute Resolution
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage customer disputes, chargebacks, and resolution workflows
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.summary?.total || 0}</p>
            <p className="text-sm text-muted-foreground">Total Disputes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">
              {data?.summary?.open || 0}
            </p>
            <p className="text-sm text-muted-foreground">Open</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {data?.summary?.resolved || 0}
            </p>
            <p className="text-sm text-muted-foreground">Resolved</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-red-600">
              ${(data?.summary?.totalAmount || 0).toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">Total Value</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search disputes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {disputes.map((d: any, i: number) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${d.status === "resolved" ? "bg-green-100" : d.status === "escalated" ? "bg-red-100" : "bg-yellow-100"}`}
                    >
                      {d.status === "resolved" ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : d.status === "escalated" ? (
                        <XCircle className="w-5 h-5 text-red-600" />
                      ) : (
                        <Clock className="w-5 h-5 text-yellow-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{d.customerName}</p>
                      <p className="text-sm text-muted-foreground">
                        Txn: {d.transactionId} • ${d.amount?.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.reason} • {d.category}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {d.status === "open" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            resolveMut.mutate({
                              id: d.id,
                              resolution: "Refunded",
                            })
                          }
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => escalateMut.mutate({ id: d.id })}
                        >
                          Escalate
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
