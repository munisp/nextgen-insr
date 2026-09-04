import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Download,
  RefreshCw,
  Plus,
  Eye,
  FileSpreadsheet,
  Clock,
  CheckCircle,
} from "lucide-react";

// Server vocabulary for data_export_jobs.status (server/routers/dataExportHub.ts):
// pending / success / cancelled. The previous keys (completed/processing/…)
// never matched any server-written value.
const STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-400",
  pending: "bg-yellow-500/20 text-yellow-400",
  cancelled: "bg-red-500/20 text-red-400",
};

export default function DataExportHubPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedExport, setSelectedExport] = useState<any>(null);
  const [form, setForm] = useState({
    export_type: "transactions",
    format: "csv",
    date_from: "",
    date_to: "",
    filters: "",
  });

  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const exportsQuery = trpc.dataExportHub.listExports.useQuery({ limit: 50 });
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const statsQuery = trpc.dataExportHub.getStats.useQuery();
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const createMutation = trpc.dataExportHub.createExport.useMutation({
    onSuccess: () => {
      exportsQuery.refetch();
      setShowCreate(false);
      toast.success("Export job created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const stats = statsQuery.data as any;
  const exports = (exportsQuery.data ?? []) as any[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Download className="h-6 w-6 text-fuchsia-400" /> Data Export Hub
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Export transactions, reports, and analytics data in CSV, Excel, or
            PDF
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              exportsQuery.refetch();
              statsQuery.refetch();
            }}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setForm({
                export_type: "transactions",
                format: "csv",
                date_from: "",
                date_to: "",
                filters: "",
              });
              setShowCreate(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-sm"
          >
            <Plus className="h-4 w-4" /> New Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Exports",
            value: stats?.totalExports ?? 0,
            icon: FileSpreadsheet,
            color: "text-fuchsia-400",
          },
          {
            label: "Completed",
            value: stats?.completed ?? 0,
            icon: CheckCircle,
            color: "text-emerald-400",
          },
          {
            label: "Processing",
            value: stats?.processing ?? 0,
            icon: Clock,
            color: "text-blue-400",
          },
          {
            label: "Total Size",
            value: stats?.totalSize || "0 MB",
            icon: Download,
            color: "text-zinc-300",
          },
        ].map((s: any) => (
          <div
            key={s.label}
            className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4"
          >
            <div className="flex items-center gap-2">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <p className="text-xs text-zinc-400 uppercase">{s.label}</p>
            </div>
            <p className="text-2xl font-bold text-white mt-2">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700/50 text-zinc-400">
              <th className="text-left p-4 font-medium">Export Type</th>
              <th className="text-left p-4 font-medium">Format</th>
              <th className="text-left p-4 font-medium">Date Range</th>
              <th className="text-left p-4 font-medium">Records</th>
              <th className="text-left p-4 font-medium">Size</th>
              <th className="text-left p-4 font-medium">Status</th>
              <th className="text-left p-4 font-medium">Created</th>
              <th className="text-left p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {exportsQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-zinc-700/30">
                  <td colSpan={8} className="p-4">
                    <div className="h-8 bg-zinc-700/50 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : exports.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-zinc-500">
                  No exports found
                </td>
              </tr>
            ) : (
              exports.map((ex: any) => (
                <tr
                  key={ex.id}
                  className="border-b border-zinc-700/30 hover:bg-zinc-700/20"
                >
                  <td className="p-4 text-white font-medium">
                    {ex.export_type?.replace(/_/g, " ")}
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-1 bg-fuchsia-500/20 text-fuchsia-400 rounded text-xs uppercase">
                      {ex.format}
                    </span>
                  </td>
                  <td className="p-4 text-zinc-400 text-xs">
                    {ex.date_from && ex.date_to
                      ? `${new Date(ex.date_from).toLocaleDateString()} — ${new Date(ex.date_to).toLocaleDateString()}`
                      : "All time"}
                  </td>
                  <td className="p-4 text-zinc-300">
                    {ex.record_count?.toLocaleString() || "—"}
                  </td>
                  <td className="p-4 text-zinc-300">
                    {ex.file_size
                      ? `${(ex.file_size / 1024).toFixed(1)} KB`
                      : "—"}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-1 rounded-full text-xs ${STATUS_COLORS[ex.status] || "bg-zinc-500/20 text-zinc-400"}`}
                    >
                      {ex.status}
                    </span>
                  </td>
                  <td className="p-4 text-zinc-400 text-xs">
                    {ex.created_at
                      ? new Date(ex.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setSelectedExport(ex)}
                        className="p-1.5 hover:bg-zinc-700 rounded-lg"
                      >
                        <Eye className="h-4 w-4 text-zinc-400" />
                      </button>
                      {ex.status === "success" && ex.download_url && (
                        <a
                          href={ex.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 hover:bg-fuchsia-700/30 rounded-lg"
                        >
                          <Download className="h-4 w-4 text-fuchsia-400" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-4">
              New Data Export
            </h3>
            <div className="space-y-3">
              <select
                value={form.export_type}
                onChange={(e: any) =>
                  setForm({ ...form, export_type: e.target.value })
                }
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              >
                {[
                  "transactions",
                  "agents",
                  "commissions",
                  "settlements",
                  "audit_logs",
                  "compliance_filings",
                  "reconciliation",
                  "general_ledger",
                ].map((t: any) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <select
                value={form.format}
                onChange={(e: any) =>
                  setForm({ ...form, format: e.target.value })
                }
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
              >
                {["csv", "xlsx", "pdf", "json"].map((f: any) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-400">From</label>
                  <input
                    type="date"
                    value={form.date_from}
                    onChange={(e: any) =>
                      setForm({ ...form, date_from: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">To</label>
                  <input
                    type="date"
                    value={form.date_to}
                    onChange={(e: any) =>
                      setForm({ ...form, date_to: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 bg-zinc-700 text-white rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  // @ts-ignore Sprint 85
                  onClick={() => createMutation.mutate(form)}
                  className="px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-sm"
                >
                  Create Export
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedExport && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setSelectedExport(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-white">Export Details</h3>
              <button
                onClick={() => setSelectedExport(null)}
                className="text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              {Object.entries(selectedExport).map(([key, value]) => (
                <div
                  key={key}
                  className="flex justify-between border-b border-zinc-800 pb-2"
                >
                  <span className="text-zinc-400 text-sm">
                    {key.replace(/_/g, " ")}
                  </span>
                  <span className="text-white text-sm font-mono max-w-[250px] truncate">
                    {String(value ?? "—")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
