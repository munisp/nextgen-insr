import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function PushNotificationConfig() {
  const vapidQ = trpc.push.getVapidPublicKey.useQuery(undefined, {
    retry: false,
  });
  const subsQ = trpc.push.listSubscriptions.useQuery(
    { agentId: "AGT-001" },
    { retry: false }
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Push Notifications</h1>
            <p className="text-gray-400 text-sm">
              Web Push (VAPID) subscription management and configuration
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "VAPID Key",
              value: vapidQ.data ? "Configured" : "Not set",
              color: vapidQ.data ? "text-green-400" : "text-red-400",
            },
            {
              label: "Subscriptions",
              value: String(Array.isArray(subsQ.data) ? subsQ.data.length : 0),
              color: "text-white",
            },
            {
              label: "Service Worker",
              value: "Registered",
              color: "text-green-400",
            },
          ].map((kpi, i) => (
            <Card key={i} className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400">{kpi.label}</div>
                <div className={`text-lg font-bold ${kpi.color}`}>
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Active Subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            {Array.isArray(subsQ.data) && subsQ.data.length > 0 ? (
              <div className="space-y-2">
                {subsQ.data.map((s: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-gray-800 rounded"
                  >
                    <div>
                      <span className="text-sm text-gray-200">
                        {s.endpoint?.substring(0, 60) || "Subscription"}...
                      </span>
                      <div className="text-xs text-gray-500">
                        {s.createdAt
                          ? new Date(s.createdAt).toLocaleDateString()
                          : ""}
                      </div>
                    </div>
                    <Badge className="bg-green-600">Active</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No push subscriptions found
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
