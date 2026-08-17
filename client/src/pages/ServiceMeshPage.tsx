import { trpc } from "@/lib/trpc";

export default function ServiceMeshPage() {
  const { data, isLoading } = trpc.serviceMesh.dashboard.useQuery();

  if (isLoading)
    return <div className="p-8 text-center">Loading service mesh...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Service Mesh</h1>
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Total Services</p>
              <p className="text-2xl font-bold">{data.totalServices}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Healthy</p>
              <p className="text-2xl font-bold text-green-500">
                {data.healthyServices}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Degraded</p>
              <p className="text-2xl font-bold text-yellow-500">
                {data.degradedServices}
              </p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Service Registry</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Service</th>
                    <th className="text-left p-2">Version</th>
                    <th className="text-right p-2">Instances</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.serviceRegistry.map((s: any) => (
                    <tr key={s.name} className="border-b">
                      <td className="p-2 font-medium">{s.name}</td>
                      <td className="p-2">{s.version}</td>
                      <td className="p-2 text-right">{s.instances}</td>
                      <td className="p-2">
                        <span
                          className={`text-xs px-2 py-1 rounded ${s.status === "healthy" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="p-2 text-xs">
                        {new Date(s.lastHeartbeat).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Circuit Breakers</h2>
            <div className="grid grid-cols-2 gap-4">
              {data.circuitBreakers.map((cb: any) => (
                <div key={cb.service} className="border rounded p-4">
                  <div className="flex justify-between items-center">
                    <p className="font-medium text-sm">{cb.service}</p>
                    <span
                      className={`text-xs px-2 py-1 rounded ${cb.state === "closed" ? "bg-green-100 text-green-700" : cb.state === "half-open" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}
                    >
                      {cb.state}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Failure: {cb.failureRate}% / Threshold: {cb.threshold}%
                  </p>
                  <div className="w-full bg-gray-200 rounded h-2 mt-2">
                    <div
                      className={`h-2 rounded ${cb.failureRate < cb.threshold * 0.5 ? "bg-green-500" : cb.failureRate < cb.threshold ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{
                        width: `${Math.min(100, (cb.failureRate / cb.threshold) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Load Balancing</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Service</th>
                    <th className="text-left p-2">Algorithm</th>
                    <th className="text-right p-2">Instances</th>
                    <th className="text-right p-2">Connections</th>
                    <th className="text-right p-2">RPS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.loadBalancing.map((lb: any) => (
                    <tr key={lb.service} className="border-b">
                      <td className="p-2 font-medium">{lb.service}</td>
                      <td className="p-2">{lb.algorithm}</td>
                      <td className="p-2 text-right">{lb.instances}</td>
                      <td className="p-2 text-right">{lb.activeConnections}</td>
                      <td className="p-2 text-right">
                        {lb.requestsPerSec.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
