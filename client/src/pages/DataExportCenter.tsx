import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function DataExportCenter() {
  const [selectedTable, setSelectedTable] = useState("");
  const [format, setFormat] = useState<"csv" | "json" | "pdf">("csv");

  const tablesQ = trpc.dataExport.availableTables.useQuery();
  const jobsQ = trpc.dataExport.listJobs.useQuery();
  const createJob = trpc.dataExport.createJob.useMutation({
    onSuccess: () => {
      jobsQ.refetch();
      toast.success("Export job created");
    },
  });

  const statusColor: Record<string, string> = {
    queued: "bg-gray-500",
    processing: "bg-blue-500 animate-pulse",
    completed: "bg-green-500",
    failed: "bg-red-500",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Data Export Center</h1>
            <p className="text-gray-400">
              Export any table as CSV, JSON, or PDF
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        {/* New Export */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">New Export</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">
                  Table
                </label>
                <select
                  value={selectedTable}
                  onChange={e => setSelectedTable(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
                >
                  <option value="">Select table...</option>
                  {tablesQ.data?.map(t => (
                    <option key={t.name} value={t.name}>
                      {t.label} (~{t.estimatedRows.toLocaleString()} rows)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  Format
                </label>
                <div className="flex gap-1">
                  {(["csv", "json", "pdf"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`px-3 py-2 rounded text-sm uppercase ${format === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                onClick={() => {
                  if (selectedTable)
                    createJob.mutate({ tableName: selectedTable, format });
                }}
                disabled={!selectedTable || createJob.isPending}
              >
                {createJob.isPending ? "Creating..." : "Start Export"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Export History */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Export History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {jobsQ.data?.jobs.map(job => (
                <div
                  key={job.id}
                  className="flex items-center justify-between bg-gray-800 rounded-lg p-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge className={`${statusColor[job.status]} text-white`}>
                      {job.status}
                    </Badge>
                    <div>
                      <div className="text-sm font-medium text-white">
                        {job.tableName}
                      </div>
                      <div className="text-xs text-gray-400">
                        {job.rowCount.toLocaleString()} rows · {job.fileSize} ·{" "}
                        {job.format.toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                    {job.status === "completed" && job.downloadUrl && (
                      <Button size="sm" variant="outline">
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
