import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ServiceHealthAggregator() {
  const healthQ = trpc.serviceHealth.getAll.useQuery();

  // F-12 (wave-4b): the real getAll returns {services, overallStatus,
  // checkedAt} — the summary block is derived client-side from the real
  // rows (no fabricated counts).
  const summary = healthQ.data
    ? {
        overallStatus: healthQ.data.overallStatus,
        total: healthQ.data.services.length,
        healthy: healthQ.data.services.filter(
          x => x.status === "healthy" || x.status === "up" || x.status === "ok"
        ).length,
        degraded: healthQ.data.services.filter(x => x.status === "degraded")
          .length,
        down: healthQ.data.services.filter(
          x => x.status === "error" || x.status === "down"
        ).length,
      }
    : undefined;

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
        {summary && (
          <Card
            className={`border ${summary.overallStatus === "healthy" ? "bg-green-950 border-green-800" : summary.overallStatus === "degraded" ? "bg-yellow-950 border-yellow-800" : "bg-red-950 border-red-800"}`}
          >
            <CardContent className="pt-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className={`w-6 h-6 rounded-full ${statusColor[summary.overallStatus]} flex items-center justify-center text-white text-sm font-bold`}
                >
                  {statusIcon[summary.overallStatus]}
                </div>
                <div>
                  <div className="text-lg font-bold text-white capitalize">
                    System {summary.overallStatus}
                  </div>
                  <div className="text-sm text-gray-400">
                    {summary.total} services monitored
                  </div>
                </div>
              </div>
              <div className="flex gap-6 text-sm">
                <span className="text-green-400">
                  {summary.healthy} healthy
                </span>
                <span className="text-yellow-400">
                  {summary.degraded} degraded
                </span>
                <span className="text-red-400">
                  {summary.down} down
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
                {(services as Array<{ name: string; status?: string; latencyMs?: number }>).map(svc => (
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
                        —
                      </div>
                      <div className="text-xs text-gray-500">—</div>
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
