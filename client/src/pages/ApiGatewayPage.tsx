import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Key, Activity, Shield } from "lucide-react";

export default function ApiGatewayPage() {
  const { data } = trpc.apiGateway.dashboard.useQuery();
  const { data: keys } = trpc.apiGateway.listApiKeys.useQuery();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Gateway</h1>
        <p className="text-muted-foreground">
          Rate limiting, API key management, usage analytics
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: "Requests (24h)",
            value: (data?.overview?.totalRequests24h ?? 0).toLocaleString(),
          },
          {
            label: "Success Rate",
            value: `${data?.overview?.successRate ?? 0}%`,
          },
          {
            label: "Avg Latency",
            value: `${data?.overview?.avgLatencyMs ?? 0}ms`,
          },
          { label: "Active Keys", value: data?.overview?.activeApiKeys ?? 0 },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Rate Limit Tiers</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Tier</th>
                  <th className="text-left p-2">Req/Min</th>
                  <th className="text-left p-2">Burst</th>
                  <th className="text-left p-2">Keys</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rateLimits ?? []).map((r: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-2">
                      <Badge>{r.tier}</Badge>
                    </td>
                    <td className="p-2">{r.requestsPerMin}</td>
                    <td className="p-2">{r.burstLimit}</td>
                    <td className="p-2">{r.activeKeys}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>API Keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(keys?.keys ?? []).map((k: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{k.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.prefix}...
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        k.status === "active" ? "default" : "destructive"
                      }
                    >
                      {k.status}
                    </Badge>
                    <span className="text-xs">
                      {k.totalRequests?.toLocaleString()} calls
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
