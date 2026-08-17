import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ServiceHealthAggregator() {
  const healthQ = trpc.serviceHealth.getAll.useQuery();

  const statusColor: Record<string, string> = {
    healthy: "bg-green-500",
    degraded: "bg-yellow-500",
    down: "bg-red-500",
    unknown: "bg-gray-500",
  };
  const statusIcon: Record<string, string> = {
    healthy: "✓",
    degraded: "⚠",
    down: "✗",
    unknown: "?",
  };

  const categories =
    healthQ.data?.services.reduce(
      (acc: any, s: any) => {
        if (!acc[s.category]) acc[s.category] = [];
        acc[s.category].push(s);
        return acc;
      },
      {} as Record<string, typeof healthQ.data.services>
    ) || {};

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Service Health Aggregator</h1>
            <p className="text-gray-400">
              Combined health status of all middleware and infrastructure
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        {/* Overall Status */}
        {healthQ.data?.summary && (
          <Card
            className={`border ${healthQ.data.summary.overallStatus === "healthy" ? "bg-green-950 border-green-800" : healthQ.data.summary.overallStatus === "degraded" ? "bg-yellow-950 border-yellow-800" : "bg-red-950 border-red-800"}`}
          >
            <CardContent className="pt-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className={`w-6 h-6 rounded-full ${statusColor[healthQ.data.summary.overallStatus]} flex items-center justify-center text-white text-sm font-bold`}
                >
                  {statusIcon[healthQ.data.summary.overallStatus]}
                </div>
                <div>
                  <div className="text-lg font-bold text-white capitalize">
                    System {healthQ.data.summary.overallStatus}
                  </div>
                  <div className="text-sm text-gray-400">
                    {healthQ.data.summary.total} services monitored
                  </div>
                </div>
              </div>
              <div className="flex gap-6 text-sm">
                <span className="text-green-400">
                  {healthQ.data.summary.healthy} healthy
                </span>
                <span className="text-yellow-400">
                  {healthQ.data.summary.degraded} degraded
                </span>
                <span className="text-red-400">
                  {healthQ.data.summary.down} down
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Services by Category */}
        {Object.entries(categories).map(([category, services]) => (
          <Card key={category} className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {services.map(svc => (
                  <div
                    key={svc.name}
                    className="flex items-center justify-between bg-gray-800 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full ${statusColor[svc.status]}`}
                      />
                      <div>
                        <div className="text-sm font-medium text-white">
                          {svc.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {svc.details}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">
                        {svc.latencyMs}ms
                      </div>
                      <div className="text-xs text-gray-500">{svc.uptime}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
