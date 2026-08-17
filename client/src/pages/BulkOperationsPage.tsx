import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, Play, XCircle, RotateCcw } from "lucide-react";

export default function BulkOperationsPage() {
  const [filter, setFilter] = useState<string>("");
  const jobs = trpc.bulkOps.list.useQuery({
    type: filter || undefined,
    limit: 20,
  });
  // F-12 (S87-02): bulkOps.analytics is not delivered — stats render "—".
  const analytics: { data?: Record<string, number> } = { data: undefined };
  const utils = trpc.useUtils();
  const cancelJob = trpc.bulkOps.cancelBatch.useMutation({
    onSuccess: () => utils.bulkOps.list.invalidate(),
  });
  // F-12 (S87-02): bulkOps.retry is not delivered — the action fails loud.
  const retryJob = {
    mutate: () => toast.error("Batch retry is not available on this deployment"),
    isPending: false,
  };

  const statusColors: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    completed: "default",
    processing: "secondary",
    queued: "outline",
    failed: "destructive",
    cancelled: "destructive",
  };
  const types = [
    "agent_onboarding",
    "float_topup",
    "commission_payout",
    "sms_broadcast",
    "status_update",
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Bulk Operations</h1>
          <p className="text-muted-foreground">
            Mass agent onboarding, float top-up, SMS broadcast, commission
            payouts
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.totalJobs ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Success Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.avgSuccessRate ?? 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Items Processed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {(analytics.data?.totalProcessed ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.byStatus?.processing ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" /> Bulk Jobs
            </CardTitle>
            <div className="flex gap-2 flex-wrap mt-2">
              <Button
                variant={!filter ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("")}
              >
                All
              </Button>
              {types.map(t => (
                <Button
                  key={t}
                  variant={filter === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(t)}
                >
                  {t.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Created By</th>
                    <th className="text-right p-2">Total</th>
                    <th className="text-right p-2">Processed</th>
                    <th className="text-right p-2">Failed</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.data?.jobs?.map((j: any) => (
                    <tr key={j.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{j.id}</td>
                      <td className="p-2">{j.type?.replace(/_/g, " ")}</td>
                      <td className="p-2">{j.createdBy}</td>
                      <td className="p-2 text-right">{j.totalItems}</td>
                      <td className="p-2 text-right text-green-600">
                        {j.processedItems}
                      </td>
                      <td className="p-2 text-right text-red-600">
                        {j.failedItems}
                      </td>
                      <td className="p-2">
                        <Badge variant={statusColors[j.status] || "outline"}>
                          {j.status}
                        </Badge>
                      </td>
                      <td className="p-2 flex gap-1">
                        {(j.status === "queued" ||
                          j.status === "processing") && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => cancelJob.mutate({ id: j.id })}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        )}
                        {j.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryJob.mutate({ id: j.id })}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
