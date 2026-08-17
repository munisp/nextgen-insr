import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AdvancedNotificationsPage() {
  const { data, isLoading } = trpc.advancedNotifications.dashboard.useQuery();
  const templates = trpc.advancedNotifications.listTemplates.useQuery();

  if (isLoading)
    return (
      <div className="p-6 animate-pulse">Loading Notifications Engine...</div>
    );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Advanced Notification Engine</h1>
        <p className="text-muted-foreground">
          Multi-channel notifications: SMS, email, push, WhatsApp, in-app
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sent Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.totalSentToday ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Delivery Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {data?.overallDeliveryRate ?? 0}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.templateCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Channels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.channels?.length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channel Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {(data?.channels || []).map((c: any) => (
              <div key={c.channel} className="text-center p-3 border rounded">
                <div className="text-xl font-bold">{c.sentToday}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {c.channel}
                </div>
                <div className="text-xs text-green-600">
                  {c.deliveryRate}% delivered
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Template</th>
                  <th className="text-left p-2">Channel</th>
                  <th className="text-left p-2">Priority</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(templates.data?.templates || []).map((t: any) => (
                  <tr key={t.id} className="border-b">
                    <td className="p-2 font-medium">{t.name}</td>
                    <td className="p-2">
                      <Badge variant="outline">{t.channel}</Badge>
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          t.priority === "critical" ? "destructive" : "outline"
                        }
                      >
                        {t.priority}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge variant={t.enabled ? "default" : "secondary"}>
                        {t.enabled ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
