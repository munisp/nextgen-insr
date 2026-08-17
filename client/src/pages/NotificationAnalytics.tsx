import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function NotificationAnalytics() {
  const [days, setDays] = useState(7);
  const overviewQ = trpc.notifAnalytics.overview.useQuery({ days });
  const trendQ = trpc.notifAnalytics.dailyTrend.useQuery({ days });

  const channelColors: Record<string, string> = {
    email: "bg-blue-500",
    sms: "bg-green-500",
    push: "bg-purple-500",
    webhook: "bg-orange-500",
    in_app: "bg-cyan-500",
  };

  const maxSent = useMemo(() => {
    if (!trendQ.data) return 1;
    return Math.max(...trendQ.data.map(d => d.sent), 1);
  }, [trendQ.data]);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Notification Analytics</h1>
            <p className="text-gray-400">
              Delivery rates, channel performance, and response times
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded text-sm ${days === d ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                {d}d
              </button>
            ))}
            <a href="/" className="text-sm text-gray-400 hover:text-white ml-4">
              ← Back
            </a>
          </div>
        </div>

        {/* KPI Cards */}
        {overviewQ.data && (
          <div className="grid grid-cols-4 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-white">
                  {overviewQ.data.totals.sent.toLocaleString()}
                </div>
                <div className="text-sm text-gray-400">Total Sent</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-green-400">
                  {overviewQ.data.totals.delivered.toLocaleString()}
                </div>
                <div className="text-sm text-gray-400">Delivered</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-red-400">
                  {overviewQ.data.totals.failed.toLocaleString()}
                </div>
                <div className="text-sm text-gray-400">Failed</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-blue-400">
                  {overviewQ.data.totals.deliveryRate}%
                </div>
                <div className="text-sm text-gray-400">Delivery Rate</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Channel Performance */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Channel Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {overviewQ.data?.channelStats.map(ch => (
                <div key={ch.channel} className="flex items-center gap-4">
                  <div className="w-20 text-sm font-medium text-gray-300 capitalize">
                    {ch.channel.replace(/_/g, " ")}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                        <div
                          className={`h-full ${channelColors[ch.channel] || "bg-gray-500"} rounded-full`}
                          style={{ width: `${ch.deliveryRate}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-400 w-16 text-right">
                        {ch.deliveryRate}%
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>Sent: {ch.totalSent.toLocaleString()}</span>
                      <span>
                        Delivered: {ch.totalDelivered.toLocaleString()}
                      </span>
                      <span>Failed: {ch.totalFailed.toLocaleString()}</span>
                      {ch.openRate > 0 && (
                        <span>Open Rate: {ch.openRate}%</span>
                      )}
                      <span>Avg Response: {ch.avgResponseTimeMs}ms</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Daily Trend (simple bar chart) */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Daily Volume Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-48">
              {trendQ.data?.map((day, i) => (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <div className="w-full flex flex-col items-center">
                    <div
                      className="w-full bg-blue-600 rounded-t"
                      style={{ height: `${(day.sent / maxSent) * 160}px` }}
                      title={`Sent: ${day.sent}`}
                    />
                    <div
                      className="w-full bg-red-500 rounded-b"
                      style={{ height: `${(day.failed / maxSent) * 160}px` }}
                      title={`Failed: ${day.failed}`}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 rotate-45 origin-left">
                    {day.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-blue-600 rounded" /> Sent
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-red-500 rounded" /> Failed
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
