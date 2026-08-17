import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function AdvancedBiReportingPage() {
  const { data, isLoading } = trpc.advancedBiReporting.dashboard.useQuery();
  const { data: kpis } = trpc.advancedBiReporting.executiveKpis.useQuery();
  const reportBuilder = trpc.advancedBiReporting.reportBuilder.useMutation();
  const [dims] = useState(["region", "product"]);
  const [measures] = useState(["transaction_count", "total_amount"]);

  if (isLoading)
    return <div className="p-8 text-center">Loading BI dashboard...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Advanced BI & Reporting</h1>

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {data.kpis.map((k: any) => (
              <div key={k.name} className="border rounded p-4">
                <p className="text-sm text-muted-foreground">{k.name}</p>
                <p className="text-2xl font-bold">
                  {k.unit === "NGN"
                    ? `₦${(k.value / 1_000_000).toFixed(1)}M`
                    : k.unit === "%"
                      ? `${k.value}%`
                      : k.value.toLocaleString()}
                </p>
                <p
                  className={`text-xs ${k.change > 0 ? "text-green-500" : "text-red-500"}`}
                >
                  {k.change > 0 ? "+" : ""}
                  {k.change}% {k.period}
                </p>
              </div>
            ))}
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Saved Reports</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Report</th>
                    <th className="text-left p-2">Schedule</th>
                    <th className="text-left p-2">Format</th>
                    <th className="text-left p-2">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  {data.savedReports.map((r: any) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-2 font-medium">{r.name}</td>
                      <td className="p-2">{r.schedule}</td>
                      <td className="p-2">{r.format}</td>
                      <td className="p-2">
                        {new Date(r.lastRun).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {kpis && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Executive KPIs</h2>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(kpis).map(([key, v]) => (
              <div key={key} className="border rounded p-4">
                <p className="text-sm text-muted-foreground capitalize">
                  {key.replace(/([A-Z])/g, " $1")}
                </p>
                <p className="text-xl font-bold">
                  {v.unit === "NGN"
                    ? `₦${(v.current / 1_000_000).toFixed(0)}M`
                    : v.unit === "%"
                      ? `${v.current}%`
                      : v.current.toLocaleString()}
                </p>
                <div className="w-full bg-gray-200 rounded h-2 mt-2">
                  <div
                    className="bg-blue-500 h-2 rounded"
                    style={{
                      width: `${Math.min((v.current / v.target) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Target:{" "}
                  {v.unit === "NGN"
                    ? `₦${(v.target / 1_000_000).toFixed(0)}M`
                    : v.target.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Report Builder</h2>
        <div className="border rounded p-4">
          <p className="text-sm mb-2">
            Dimensions: {dims.join(", ")} | Measures: {measures.join(", ")}
          </p>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm"
            onClick={() =>
              reportBuilder.mutate({ dimensions: dims, measures, limit: 10 })
            }
          >
            Run Query
          </button>
          {reportBuilder.data && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {reportBuilder.data.columns.map((c: any) => (
                      <th key={c} className="text-left p-2 capitalize">
                        {c.replace(/_/g, " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportBuilder.data.rows.map((row, i) => (
                    <tr key={i} className="border-b">
                      {reportBuilder.data!.columns.map((c: any) => (
                        <td key={c} className="p-2">
                          {typeof row[c] === "number"
                            ? (row[c] as number).toLocaleString()
                            : String(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
