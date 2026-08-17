import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Download, Search, FileSpreadsheet, Calendar } from "lucide-react";

export default function AuditTrailExportPage() {
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const { data, isLoading } = trpc.auditTrailExport.list.useQuery({});
  const exportMut = trpc.auditTrailExport.export.useMutation({
    onSuccess: (d: any) => {
      toast.success(`Export ready: ${d?.filename || "audit_export.csv"}`);
    },
  });
  // F-12 (wave-4b): list returns {data, total} from audit_log.
  const entries = (data?.data || []).filter(
    (e: any) =>
      !search ||
      e.action?.toLowerCase().includes(search.toLowerCase()) ||
      e.userName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6" /> Audit Trail Export
          </h1>
          <p className="text-muted-foreground mt-1">
            Export comprehensive audit logs for compliance and regulatory
            reporting
          </p>
        </div>
        <Button
          onClick={() =>
            exportMut.mutate({ format: "csv", dateFrom: dateRange.from, dateTo: dateRange.to })
          }
          disabled={exportMut.isPending}
        >
          <Download className="w-4 h-4 mr-1" />{" "}
          {exportMut.isPending ? "Exporting..." : "Export CSV"}
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.total || 0}</p>
            <p className="text-sm text-muted-foreground">Total Events</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              —
            </p>
            <p className="text-sm text-muted-foreground">Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              —
            </p>
            <p className="text-sm text-muted-foreground">Active Users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-purple-600">
              —
            </p>
            <p className="text-sm text-muted-foreground">Categories</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          <Input
            type="date"
            value={dateRange.from}
            onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
            className="w-40"
          />
        </div>
        <span>to</span>
        <Input
          type="date"
          value={dateRange.to}
          onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
          className="w-40"
        />
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">Timestamp</th>
                <th className="p-3 text-left">User</th>
                <th className="p-3 text-left">Action</th>
                <th className="p-3 text-left">Resource</th>
                <th className="p-3 text-left">IP</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 50).map((e: any, i: number) => (
                <tr key={i} className="border-t">
                  <td className="p-3 text-xs">{e.timestamp}</td>
                  <td className="p-3">{e.userName}</td>
                  <td className="p-3 font-medium">{e.action}</td>
                  <td className="p-3 text-muted-foreground">{e.resource}</td>
                  <td className="p-3 text-xs">{e.ip}</td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-1 rounded text-xs ${e.success ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                    >
                      {e.success ? "OK" : "FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
