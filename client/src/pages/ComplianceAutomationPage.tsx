import { trpc } from "@/lib/trpc";

export default function ComplianceAutomationPage() {
  const { data, isLoading } = trpc.complianceAutomation.dashboard.useQuery();

  if (isLoading)
    return <div className="p-8 text-center">Loading compliance...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Compliance Automation</h1>
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Overall Score</p>
              <p className="text-2xl font-bold">{data.overallScore}%</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Active Policies</p>
              <p className="text-2xl font-bold">{data.policies.length}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Frameworks</p>
              <p className="text-2xl font-bold">{data.frameworks.length}</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Frameworks</h2>
            <div className="grid grid-cols-3 gap-4">
              {data.frameworks.map((f: any) => (
                <div key={f.name} className="border rounded p-4">
                  <p className="font-medium text-sm">{f.name}</p>
                  <p className="text-xl font-bold">{f.compliance}%</p>
                  <div className="w-full bg-gray-200 rounded h-2 mt-2">
                    <div
                      className={`h-2 rounded ${f.compliance >= 90 ? "bg-green-500" : f.compliance >= 70 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${f.compliance}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {f.controls} controls • {f.passing} passing • {f.failing}{" "}
                    failing
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Upcoming Audits</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Framework</th>
                    <th className="text-left p-2">Scheduled</th>
                    <th className="text-left p-2">Auditor</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingAudits.map((a, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2">{a.framework}</td>
                      <td className="p-2">
                        {new Date(a.scheduledDate).toLocaleDateString()}
                      </td>
                      <td className="p-2">{a.auditor}</td>
                      <td className="p-2 capitalize">{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Policies</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Policy</th>
                    <th className="text-left p-2">Version</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Last Review</th>
                  </tr>
                </thead>
                <tbody>
                  {data.policies.map((p: any) => (
                    <tr key={p.id} className="border-b">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">v{p.version}</td>
                      <td className="p-2 capitalize">{p.status}</td>
                      <td className="p-2">
                        {new Date(p.lastReview).toLocaleDateString()}
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
