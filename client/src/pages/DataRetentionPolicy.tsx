import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Database } from "lucide-react";

// Data Retention — GDPR/NDPR compliant data lifecycle management
// Sprint 42: Final Production Features

export default function DataRetentionPolicy() {
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const { data: liveData, isLoading, isError, error } = trpc.dataRetentionPolicy.list.useQuery(
    undefined,
    { retry: 1 }
  );
  const rows: any[] = Array.isArray(liveData) ? liveData : [];
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<
    "overview" | "details" | "history" | "settings"
  >("overview");

  const columns = ["Policy", "Entity", "Retention", "Records", "Status"];

  const filtered = rows.filter(
    // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
    r =>
      String(r.col1 ?? "").toLowerCase().includes(search.toLowerCase()) ||
      String(r.col2 ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="w-6 h-6 text-blue-400" />
              Data Retention
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              GDPR/NDPR compliant data lifecycle management
            </p>
          </div>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
            New Entry
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(["overview", "details", "history", "settings"] as const).map(
            (tab: any) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-blue-600 text-white"
                    : "bg-[#141a2a] text-gray-400 hover:text-white"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            )
          )}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search records..."
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            className="w-full max-w-md px-4 py-2 bg-[#141a2a] border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Error state */}
        {isError && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/40 rounded-lg text-sm text-red-400">
            Failed to load data{error?.message ? `: ${error.message}` : "."}
          </div>
        )}

        {/* Records Table */}
        <div className="bg-[#141a2a] border border-gray-800 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <h3 className="font-semibold">Records ({filtered.length})</h3>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="h-8 bg-[#1a2035] rounded animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              {isError ? "Unable to load records." : "No data available yet"}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {columns.map((col: string, i: number) => (
                    <th
                      key={i}
                      className="text-left p-3 text-gray-400 font-medium"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row: any) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-800/50 hover:bg-[#1a2035] transition-colors"
                  >
                    <td className="p-3 font-mono text-blue-400">{row.col1}</td>
                    <td className="p-3">{row.col2}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          row.col3 === "active"
                            ? "bg-green-500/20 text-green-400"
                            : row.col3 === "pending"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : row.col3 === "warning"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {row.col3}
                      </span>
                    </td>
                    <td className="p-3">{row.col4}</td>
                    <td className="p-3 text-gray-400">{row.col5}</td>
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
