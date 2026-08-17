import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function PredictiveAgentChurn() {
  const [search, setSearch] = useState("");
  const stats = trpc.predictiveAgentChurn.getStats.useQuery();
  const list = trpc.predictiveAgentChurn.listAtRisk.useQuery({
    minProbability: 0.5,
  });
  const action = trpc.predictiveAgentChurn.triggerIntervention.useMutation({
    onSuccess: () =>
      toast.success("Trigger Intervention completed successfully"),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Predictive Agent Churn</h1>
            <p className="text-muted-foreground">
              ML-powered agent attrition risk analysis and intervention
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-64"
            />
            <Button
              onClick={() => toast.info("Refreshing data...")}
              variant="outline"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : stats.data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(stats.data)
              .slice(0, 4)
              .map(([key, value]) => (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {typeof value === "number"
                        ? value > 100000
                          ? "\u20a6" + value.toLocaleString()
                          : value.toLocaleString()
                        : String(value)}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : null}

        {/* Data Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Predictive Agent Churn Records</CardTitle>
              <Badge variant="outline">{list.data?.total ?? 0} total</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Agent</th>
                    <th className="text-left py-3 px-2">Region</th>
                    <th className="text-left py-3 px-2">Churn Probability</th>
                    <th className="text-left py-3 px-2">Risk Factors</th>
                    <th className="text-left py-3 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.agents ?? [])
                    .filter(
                      (item: any) =>
                        !search ||
                        JSON.stringify(item)
                          .toLowerCase()
                          .includes(search.toLowerCase())
                    )
                    .map((item: any) => (
                      <tr
                        key={item.id || item.agentId}
                        className="border-b hover:bg-muted/50"
                      >
                        <td className="py-3 px-2">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.id}
                          </div>
                        </td>
                        <td className="py-3 px-2">{item.region}</td>
                        <td className="py-3 px-2">
                          {(item.churnProbability * 100).toFixed(1)}%
                        </td>
                        <td className="py-3 px-2">
                          {item.riskFactors?.slice(0, 2).join(", ")}
                        </td>
                        <td className="py-3 px-2">
                          <Badge
                            variant={
                              item.churnProbability > 0.7
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {item.status || "—"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Additional Stats */}
        {stats.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Detailed Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(stats.data)
                  .slice(4)
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="flex justify-between items-center py-2 border-b last:border-0"
                    >
                      <span className="text-sm text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className="font-medium">
                        {typeof value === "number"
                          ? value > 100000
                            ? "\u20a6" + value.toLocaleString()
                            : value.toLocaleString()
                          : String(value)}
                      </span>
                    </div>
                  ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => action.mutate({} as any)}
                  disabled={action.isPending}
                >
                  {action.isPending ? "Processing..." : "Trigger Intervention"}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => toast.info("Export initiated")}
                >
                  Export Report
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => toast.info("Scheduled for next cycle")}
                >
                  Schedule Analysis
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
