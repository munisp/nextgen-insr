import { trpc } from "@/lib/trpc";

export default function OpenTelemetryPage() {
  const { data, isLoading } = trpc.openTelemetry.dashboard.useQuery();
  const { data: health } = trpc.openTelemetry.serviceHealth.useQuery();

  if (isLoading)
    return (
      <div className="p-8 text-center">Loading distributed tracing...</div>
    );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">OpenTelemetry Distributed Tracing</h1>

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Total Spans (24h)</p>
              <p className="text-2xl font-bold">
                {data.metrics.totalSpans24h.toLocaleString()}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">
                Total Traces (24h)
              </p>
              <p className="text-2xl font-bold">
                {data.metrics.totalTraces24h.toLocaleString()}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Throughput</p>
              <p className="text-2xl font-bold">
                {data.metrics.throughputRps} RPS
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Avg Latency</p>
              <p className="text-2xl font-bold">
                {data.metrics.avgLatencyMs}ms
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">P99 Latency</p>
              <p className="text-2xl font-bold">
                {data.metrics.p99LatencyMs}ms
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Error Rate</p>
              <p className="text-2xl font-bold">{data.metrics.errorRate}%</p>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Service Map</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Source</th>
                    <th className="text-left p-2">Target</th>
                    <th className="text-right p-2">P50 (ms)</th>
                    <th className="text-right p-2">P99 (ms)</th>
                    <th className="text-right p-2">Req/s</th>
                    <th className="text-right p-2">Error %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.serviceMap.map((s, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2">{s.source}</td>
                      <td className="p-2">{s.target}</td>
                      <td className="p-2 text-right">{s.latencyP50}</td>
                      <td className="p-2 text-right">{s.latencyP99}</td>
                      <td className="p-2 text-right">{s.requestRate}</td>
                      <td className="p-2 text-right">{s.errorRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h2 className="text-lg font-semibold mb-3">Top Slow Traces</h2>
              <div className="border rounded p-4 space-y-2">
                {data.topSlowTraces.map((t: any) => (
                  <div
                    key={t.traceId}
                    className="flex justify-between items-center border-b pb-2"
                  >
                    <div>
                      <p className="font-medium text-sm">{t.operation}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.traceId} • {t.spans} spans
                      </p>
                    </div>
                    <span
                      className={`text-sm font-bold ${t.status === "error" ? "text-red-500" : ""}`}
                    >
                      {t.duration}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-3">Exporters</h2>
              <div className="border rounded p-4 space-y-2">
                {data.exporters.map((e: any) => (
                  <div
                    key={e.name}
                    className="flex justify-between items-center border-b pb-2"
                  >
                    <div>
                      <p className="font-medium text-sm">{e.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.endpoint}
                      </p>
                    </div>
                    <span className="text-sm text-green-500">{e.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {health && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Service Health</h2>
          <div className="border rounded p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Service</th>
                  <th className="text-right p-2">Uptime %</th>
                  <th className="text-right p-2">Instances</th>
                  <th className="text-right p-2">CPU %</th>
                  <th className="text-right p-2">Memory %</th>
                  <th className="text-right p-2">Req/s</th>
                </tr>
              </thead>
              <tbody>
                {health.services.map((s: any) => (
                  <tr key={s.name} className="border-b">
                    <td className="p-2">{s.name}</td>
                    <td className="p-2 text-right">{s.uptime}</td>
                    <td className="p-2 text-right">{s.instances}</td>
                    <td className="p-2 text-right">{s.cpu}</td>
                    <td className="p-2 text-right">{s.memory}</td>
                    <td className="p-2 text-right">{s.requestRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
