import { trpc } from "@/lib/trpc";

export default function ConfigManagementPage() {
  const { data, isLoading } = trpc.configManagement.dashboard.useQuery();

  if (isLoading)
    return <div className="p-8 text-center">Loading config management...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Configuration Management</h1>
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Total Configs</p>
              <p className="text-2xl font-bold">{data.totalConfigs}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Environments</p>
              <p className="text-2xl font-bold">{data.environments.length}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Categories</p>
              <p className="text-2xl font-bold">{data.categories.length}</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Categories</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Category</th>
                    <th className="text-right p-2">Config Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c: any) => (
                    <tr key={c.name} className="border-b">
                      <td className="p-2 font-medium">{c.name}</td>
                      <td className="p-2 text-right">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent Changes</h2>
            <div className="border rounded p-4 space-y-2">
              {data.recentChanges.map((c, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center border-b pb-2"
                >
                  <div>
                    <p className="font-medium text-sm">{c.key}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.env} &bull; {c.changedBy}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs">
                      <span className="text-red-500 line-through">
                        {c.oldValue}
                      </span>{" "}
                      &rarr;{" "}
                      <span className="text-green-600">{c.newValue}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.changedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Environments</h2>
            <div className="flex gap-3">
              {data.environments.map((env: any) => (
                <span
                  key={env}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm capitalize"
                >
                  {env}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
