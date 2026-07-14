import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, MapPin, Activity, Eye } from "lucide-react";

export default function FraudRealtimeVizPage() {
  // @ts-ignore Sprint 85
  const { data: live } = trpc.fraudRealtimeViz.liveMap.useQuery();
  // @ts-ignore Sprint 85
  const { data: stream } = trpc.fraudRealtimeViz.suspiciousStream.useQuery({
    limit: 20,
  });
  // @ts-ignore Sprint 85
  const { data: heatmap } = trpc.fraudRealtimeViz.agentHeatmap.useQuery();

  const summary = live?.summary;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Real-time Fraud Visualization</h1>
          <p className="text-muted-foreground">
            Live fraud monitoring with geographic visualization
          </p>
        </div>
        <Badge variant="destructive" className="animate-pulse">
          <Activity className="w-3 h-3 mr-1" /> LIVE
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: "Active Alerts",
            value: summary?.totalAlerts ?? 0,
            icon: AlertTriangle,
            color: "text-red-500",
          },
          {
            label: "Critical",
            value: summary?.critical ?? 0,
            icon: Eye,
            color: "text-blue-500",
          },
          {
            label: "Map Markers",
            value: live?.markers?.length ?? 0,
            icon: MapPin,
            color: "text-orange-500",
          },
          {
            label: "Avg Response",
            value: `${(summary?.avgResponseTimeMs ?? 0).toFixed(0)}ms`,
            icon: Activity,
            color: "text-yellow-500",
          },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Fraud Map Markers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(live?.markers ?? []).map((h: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-red-500" />
                    <span className="font-medium">{h.agentId}</span>
                    <span className="text-xs text-muted-foreground">
                      {h.txRef}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        h.severity === "critical" ? "destructive" : "secondary"
                      }
                    >
                      {h.severity}
                    </Badge>
                    <span className="text-sm">
                      ₦{(h.amount ?? 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suspicious Transaction Stream</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(stream?.items ?? []).map((tx: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{tx.txRef}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx.type} — ₦{(tx.amount ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        tx.riskScore > 0.8
                          ? "destructive"
                          : tx.riskScore > 0.5
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {(tx.riskScore * 100).toFixed(0)}%
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      {tx.explanation}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent Risk Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {(heatmap?.zones ?? []).map((r: any, i: number) => (
              <div
                key={i}
                className={`p-3 rounded text-center ${r.riskLevel === "high" ? "bg-red-500/20 border border-red-500" : r.riskLevel === "medium" ? "bg-yellow-500/20 border border-yellow-500" : "bg-green-500/20 border border-green-500"}`}
              >
                <p className="font-bold text-sm">{r.zone}</p>
                <p className="text-xs">{r.agentCount} agents</p>
                <p className="text-xs">{r.suspiciousCount} suspicious</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
