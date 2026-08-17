import {
  Webhook,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
export default function WebhookConfig() {
  const configsQuery = trpc.webhookNotif.listConfigs.useQuery();
  const statsQuery = trpc.webhookNotif.getStats.useQuery();
  const eventsQuery = trpc.webhookNotif.getSupportedEvents.useQuery();
  const deliveryQuery = trpc.webhookNotif.getDeliveryLog.useQuery({
    limit: 20,
  });
  const toggleMut = trpc.webhookNotif.toggleWebhook.useMutation({
    onSuccess: () => {
      toast.success("Webhook toggled");
      configsQuery.refetch();
    },
  });
  // F-12 (wave-4b): ingest is fail-loud NOT_IMPLEMENTED — surface the loud
  // backend error on test.
  const testMut = trpc.webhookNotif.ingest.useMutation({
    onError: e => toast.error(e.message),
  });

  const stats = statsQuery.data;

  return (
    <DashboardLayout>
      <div className="container max-w-6xl py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Webhook className="w-6 h-6" /> Webhook Configuration
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage incoming webhook integrations and delivery logs
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              statsQuery.refetch();
              deliveryQuery.refetch();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* F-12 (wave-4b): real getStats fields only — processing-time
                and outcome breakdowns have no delivered source ("—"). */}
            {[
              {
                label: "Endpoints",
                value: stats.totalEndpoints,
                icon: <Activity className="w-4 h-4" />,
              },
              {
                label: "Total Deliveries",
                value: stats.totalDeliveries,
                icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
              },
              {
                label: "Processed",
                value: "—",
                icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
              },
              {
                label: "Rejected",
                value: "—",
                icon: <XCircle className="w-4 h-4 text-red-500" />,
              },
              {
                label: "Avg Time",
                value: "—",
                icon: <Clock className="w-4 h-4" />,
              },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    {s.icon}
                    {s.label}
                  </div>
                  <div className="text-xl font-bold">{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            {configsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-muted animate-pulse rounded"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {configsQuery.data?.configs?.map(wh => (
                  <div
                    key={wh.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${wh.isActive ? "bg-green-500" : "bg-gray-400"}`}
                      />
                      <div>
                        <div className="font-medium text-sm">{wh.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {wh.id}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-wrap gap-1">
                        {wh.events.slice(0, 3).map(e => (
                          <Badge
                            key={e}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {e}
                          </Badge>
                        ))}
                        {wh.events.length > 3 && (
                          <Badge variant="secondary" className="text-[10px]">
                            +{wh.events.length - 3}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          testMut.mutate({
                            source: "dashboard-test",
                            event: wh.events[0] ?? "transaction.completed",
                            payload: { test: true },
                          })
                        }
                      >
                        Test
                      </Button>
                      <Switch
                        checked={wh.isActive}
                        onCheckedChange={() =>
                          toggleMut.mutate({ id: wh.id })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Supported Events ({eventsQuery.data?.events?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[300px] overflow-y-auto">
              <div className="space-y-2">
                {eventsQuery.data?.map(ev => (
                  <div
                    key={ev.name}
                    className="flex items-center justify-between py-1.5 border-b last:border-0"
                  >
                    <span className="text-sm font-mono">{ev.name}</span>
                    {/* F-12 (wave-4b): category is the honest grouping (derived
                        from the event name); priority has no source. */}
                    <Badge variant="outline" className="text-[10px]">
                      {ev.category}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Deliveries</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[300px] overflow-y-auto">
              {(deliveryQuery.data?.deliveries?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No deliveries yet. Send a test webhook to see results.
                </p>
              ) : (
                <div className="space-y-2">
                  {deliveryQuery.data?.deliveries?.map(d => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between py-1.5 border-b last:border-0"
                    >
                      <div>
                        <span className="text-sm font-mono">{d.eventType}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {d.responseTime}ms
                        </span>
                      </div>
                      <Badge
                        variant={
                          d.status === "processed" ? "default" : "destructive"
                        }
                        className="text-[10px]"
                      >
                        {d.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
