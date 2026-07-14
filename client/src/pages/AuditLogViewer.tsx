/**
 * AuditLogViewer.tsx — Admin audit log browser with search, filter, and CSV export.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Download, RefreshCw, Shield } from "lucide-react";
import { toast } from "sonner";

const ACTION_GROUPS = [
  { label: "All Actions", value: "all" },
  { label: "Auth Events", value: "auth" },
  { label: "Transaction Events", value: "transaction" },
  { label: "KYC Events", value: "kyc" },
  { label: "Float Events", value: "float" },
  { label: "Admin Actions", value: "admin" },
  { label: "Compliance", value: "compliance" },
];

const ACTION_GROUP_FILTERS: Record<string, string[]> = {
  auth: ["login", "logout", "pin_reset", "session_expired"],
  transaction: [
    "transaction_created",
    "transaction_reversed",
    "transaction_failed",
  ],
  kyc: [
    "kyc_initiated",
    "kyc_approved",
    "kyc_rejected",
    "kyc_document_uploaded",
  ],
  float: [
    "float_topup_requested",
    "float_topup_approved",
    "float_topup_rejected",
  ],
  admin: [
    "agent_created",
    "agent_suspended",
    "agent_activated",
    "role_changed",
  ],
  compliance: ["sar_filed", "ctr_filed", "audit_export", "compliance_report"],
};

export default function AuditLogViewer() {
  const { loading, isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [actionGroup, setActionGroup] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const actions =
    actionGroup !== "all" ? (ACTION_GROUP_FILTERS[actionGroup] ?? []) : [];

  const {
    data: allLogs,
    isLoading,
    refetch,
  } = trpc.auditLog.listAll.useQuery({
    limit: 500,
    offset: 0,
  });

  const { data: filteredByAction } = trpc.auditLog.listByActions.useQuery(
    { actions, limit: 500, offset: 0 },
    { enabled: actionGroup !== "all" }
  );

  const displayLogs = useMemo(() => {
    const base =
      actionGroup !== "all" ? (filteredByAction ?? []) : (allLogs ?? []);
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter(
      (l: any) =>
        (l.action ?? "").toLowerCase().includes(q) ||
        (l.entityType ?? "").toLowerCase().includes(q) ||
        (l.entityId ?? "").toLowerCase().includes(q) ||
        (l.agentId ?? "").toLowerCase().includes(q) ||
        JSON.stringify(l.metadata ?? {})
          .toLowerCase()
          .includes(q)
    );
  }, [allLogs, filteredByAction, actionGroup, search]);

  const paginated = displayLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(displayLogs.length / PAGE_SIZE);

  const exportCsv = () => {
    if (!displayLogs.length) {
      toast.error("No data to export");
      return;
    }
    const headers = [
      "Timestamp",
      "Action",
      "Entity Type",
      "Entity ID",
      "Agent Code",
      "IP Address",
      "Details",
    ];
    const rows = displayLogs.map((l: any) => [
      new Date(l.createdAt).toISOString(),
      l.action ?? "",
      l.entityType ?? "",
      l.entityId ?? "",
      l.agentId ?? "",
      l.ipAddress ?? "",
      JSON.stringify(l.metadata ?? {}),
    ]);
    const csv = [headers, ...rows]
      .map((r: any) =>
        r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${displayLogs.length} records`);
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  const actionColor = (action: string) => {
    if (action.includes("login") || action.includes("logout"))
      return "bg-blue-100 text-blue-800";
    if (
      action.includes("failed") ||
      action.includes("rejected") ||
      action.includes("suspended")
    )
      return "bg-red-100 text-red-800";
    if (
      action.includes("approved") ||
      action.includes("created") ||
      action.includes("activated")
    )
      return "bg-green-100 text-green-800";
    if (
      action.includes("kyc") ||
      action.includes("compliance") ||
      action.includes("sar") ||
      action.includes("ctr")
    )
      return "bg-purple-100 text-purple-800";
    return "bg-gray-100 text-gray-700";
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="w-6 h-6 text-muted-foreground" />
              Audit Log
            </h1>
            <p className="text-muted-foreground text-sm">
              Full platform audit trail — {displayLogs.length} records shown
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search action, entity, agent ID..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <Select
            value={actionGroup}
            onValueChange={v => {
              setActionGroup(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Action Group" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_GROUPS.map((g: any) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Audit Records ({displayLogs.length} total · page {page + 1}/
              {Math.max(1, totalPages)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 px-3">Timestamp</th>
                    <th className="text-left py-2 px-3">Action</th>
                    <th className="text-left py-2 px-3">Entity</th>
                    <th className="text-left py-2 px-3">Agent</th>
                    <th className="text-left py-2 px-3">IP</th>
                    <th className="text-left py-2 px-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Loading audit records...
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    paginated.map((log: any, i: number) => (
                      <tr
                        key={`${log.id}-${i}`}
                        className="border-b hover:bg-muted/30"
                      >
                        <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(log.action ?? "")}`}
                          >
                            {log.action ?? "—"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs">
                          {log.entityType && (
                            <span className="font-medium">
                              {log.entityType}
                            </span>
                          )}
                          {log.entityId && (
                            <span className="text-muted-foreground ml-1">
                              #{log.entityId}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs font-mono">
                          {log.agentId ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground font-mono">
                          {log.ipAddress ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground max-w-xs truncate">
                          {log.metadata
                            ? JSON.stringify(log.metadata).slice(0, 80)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  {!isLoading && paginated.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No audit records found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex justify-between items-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–
                  {Math.min((page + 1) * PAGE_SIZE, displayLogs.length)} of{" "}
                  {displayLogs.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
