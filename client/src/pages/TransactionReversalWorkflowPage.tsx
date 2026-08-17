import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RotateCcw, Search, CheckCircle, Clock, XCircle } from "lucide-react";

export default function TransactionReversalWorkflowPage() {
  const [search, setSearch] = useState("");
  // F-12 (wave-4b): approve/reject were phantom procs — the REAL
  // maker-checker proc is review({id, decision}). list returns {data,
  // total} from reversal_requests.
  const { data, isLoading } = trpc.transactionReversalWorkflow.list.useQuery({});
  const utils = trpc.useUtils();
  const reviewMut = trpc.transactionReversalWorkflow.review.useMutation({
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approved" ? "Reversal approved" : "Reversal rejected");
      utils.transactionReversalWorkflow.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const reversals = (data?.data || []).filter(
    (r: any) =>
      !search ||
      r.transactionId?.includes(search) ||
      `Agent #${r.agentId}`?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <RotateCcw className="w-6 h-6" /> Transaction Reversal Workflow
        </h1>
        <p className="text-muted-foreground mt-1">
          Review and approve transaction reversal requests with maker-checker
          controls
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.total || 0}</p>
            <p className="text-sm text-muted-foreground">Total</p>
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
              —
            </p>
            <p className="text-sm text-muted-foreground">Total Value</p>
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
          {reversals.map((r: any, i: number) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${r.status === "approved" ? "bg-green-100" : r.status === "rejected" ? "bg-red-100" : "bg-yellow-100"}`}
                  >
                    {r.status === "approved" ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : r.status === "rejected" ? (
                      <XCircle className="w-5 h-5 text-red-600" />
                    ) : (
                      <Clock className="w-5 h-5 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">Txn: {r.transactionId}</p>
                    <p className="text-sm text-muted-foreground">
                      {`Agent #${r.agentId}`} • ${r.amount?.toLocaleString()} • {r.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reason: {r.reason}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {r.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => reviewMut.mutate({ id: r.id, decision: "approved" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => reviewMut.mutate({ id: r.id, decision: "rejected" })}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  <span
                    className={`px-2 py-1 rounded text-xs ${r.status === "approved" ? "bg-green-100 text-green-700" : r.status === "rejected" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}
                  >
                    {r.status}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
