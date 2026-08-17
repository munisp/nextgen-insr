import { trpc } from "@/lib/trpc";

export default function DataQualityPage() {
  const { data, isLoading } = trpc.dataQuality.dashboard.useQuery();
  const { data: rules } = trpc.dataQuality.getValidationRules.useQuery();

  if (isLoading)
    return <div className="p-8 text-center">Loading data quality...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Data Quality Engine</h1>
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Overall Score</p>
              <p className="text-2xl font-bold">{data.overallScore}%</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Validation Rules</p>
              <p className="text-2xl font-bold">{data.validationRules}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Active Profiles</p>
              <p className="text-2xl font-bold">{data.activeProfiles}</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Quality Dimensions</h2>
            <div className="grid grid-cols-3 gap-4">
              {data.dimensions.map((d: any) => (
                <div key={d.name} className="border rounded p-4">
                  <p className="text-sm text-muted-foreground">{d.name}</p>
                  <p className="text-xl font-bold">{d.score}%</p>
                  <p className="text-xs">
                    {d.issues} issues • Trend: {d.trend}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent Issues</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Table</th>
                    <th className="text-left p-2">Column</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Count</th>
                    <th className="text-left p-2">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentIssues.map((i: any) => (
                    <tr key={i.id} className="border-b">
                      <td className="p-2">{i.table}</td>
                      <td className="p-2">{i.column}</td>
                      <td className="p-2">{i.type}</td>
                      <td className="p-2 text-right">{i.count}</td>
                      <td className="p-2 capitalize">{i.severity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {rules && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Validation Rules</h2>
          <div className="border rounded p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Table</th>
                  <th className="text-left p-2">Rule</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {rules.rules.map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">{r.table}</td>
                    <td className="p-2 font-mono text-xs">{r.rule}</td>
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 text-right">{r.passRate}%</td>
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
