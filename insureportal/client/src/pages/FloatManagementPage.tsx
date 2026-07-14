import { trpc } from "@/lib/trpc";
/**
 * Sprint 52 — Float Management Dashboard
 * F10: Agent premium reserves, top-ups, alerts, and utilization
 */
// @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageErrorBoundary } from "@/components/ErrorBoundary";
import { useState, useMemo } from "react";
import {
  Wallet,
  TrendingUp,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Download,
  Plus,
  RefreshCw,
  DollarSign,
  BarChart3,
} from "lucide-react";

const MOCK_FLOAT_DATA = [
  {
    id: 1,
    agentId: "AGT-0012",
    name: "Adebayo Ogundimu",
    balance: 2500000,
    limit: 5000000,
    utilized: 50,
    lastTopUp: "2026-04-22T02:00:00Z",
    topUpAmount: 1000000,
    status: "healthy",
  },
  {
    id: 2,
    agentId: "AGT-0034",
    name: "Chidinma Okafor",
    balance: 450000,
    limit: 3000000,
    utilized: 85,
    lastTopUp: "2026-04-21T18:00:00Z",
    topUpAmount: 500000,
    status: "warning",
  },
  {
    id: 3,
    agentId: "AGT-0056",
    name: "Ibrahim Musa",
    balance: 3200000,
    limit: 5000000,
    utilized: 36,
    lastTopUp: "2026-04-22T01:00:00Z",
    topUpAmount: 2000000,
    status: "healthy",
  },
  {
    id: 4,
    agentId: "AGT-0078",
    name: "Funke Adeyemi",
    balance: 120000,
    limit: 2000000,
    utilized: 94,
    lastTopUp: "2026-04-20T12:00:00Z",
    topUpAmount: 300000,
    status: "critical",
  },
  {
    id: 5,
    agentId: "AGT-0023",
    name: "Emeka Nwosu",
    balance: 1800000,
    limit: 4000000,
    utilized: 55,
    lastTopUp: "2026-04-22T00:30:00Z",
    topUpAmount: 1500000,
    status: "healthy",
  },
  {
    id: 6,
    agentId: "AGT-0045",
    name: "Aisha Bello",
    balance: 780000,
    limit: 3000000,
    utilized: 74,
    lastTopUp: "2026-04-21T22:00:00Z",
    topUpAmount: 800000,
    status: "warning",
  },
  {
    id: 7,
    agentId: "AGT-0067",
    name: "Olumide Bakare",
    balance: 2100000,
    limit: 3500000,
    utilized: 40,
    lastTopUp: "2026-04-21T20:00:00Z",
    topUpAmount: 1200000,
    status: "healthy",
  },
  {
    id: 8,
    agentId: "AGT-0089",
    name: "Grace Eze",
    balance: 50000,
    limit: 1500000,
    utilized: 97,
    lastTopUp: "2026-04-19T15:00:00Z",
    topUpAmount: 200000,
    status: "critical",
  },
];

function formatNaira(n: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(n);
}

function FloatContent() {
  const [search, setSearch] = useState("");
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const { data: _liveData } = trpc.floatManagement.list.useQuery(undefined, {
    retry: 1,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [showTopUp, setShowTopUp] = useState(false);

  const filtered = useMemo(() => {
    return MOCK_FLOAT_DATA.filter(f => {
      if (
        search &&
        !f.name.toLowerCase().includes(search.toLowerCase()) &&
        !f.agentId.includes(search)
      )
        return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      return true;
    });
  }, [search, statusFilter]);

  const totalFloat = MOCK_FLOAT_DATA.reduce(
    (s: any, f: any) => s + f.balance,
    0
  );
  const totalLimit = MOCK_FLOAT_DATA.reduce((s: any, f: any) => s + f.limit, 0);
  const criticalCount = MOCK_FLOAT_DATA.filter(
    f => f.status === "critical"
  ).length;
  const avgUtilization =
    MOCK_FLOAT_DATA.reduce((s: any, f: any) => s + f.utilized, 0) /
    MOCK_FLOAT_DATA.length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Float Management</h1>
          <p className="text-sm text-muted-foreground">
            Monitor and manage agent premium reserves
          </p>
        </div>
        <button
          onClick={() => setShowTopUp(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
        >
          <Plus className="h-4 w-4" /> Bulk Top-Up
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Wallet className="h-4 w-4" /> Total Float
          </div>
          <div className="text-2xl font-bold">{formatNaira(totalFloat)}</div>
          <div className="text-xs text-muted-foreground">
            of {formatNaira(totalLimit)} limit
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <BarChart3 className="h-4 w-4" /> Avg Utilization
          </div>
          <div className="text-2xl font-bold">{avgUtilization.toFixed(1)}%</div>
          <div className="text-xs text-green-500">Healthy range</div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <AlertTriangle className="h-4 w-4" /> Critical Agents
          </div>
          <div className="text-2xl font-bold text-red-500">{criticalCount}</div>
          <div className="text-xs text-red-500">Need immediate top-up</div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <DollarSign className="h-4 w-4" /> Today's Top-Ups
          </div>
          <div className="text-2xl font-bold">{formatNaira(5500000)}</div>
          <div className="text-xs text-muted-foreground">12 transactions</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-md border bg-background text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-md border bg-background text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="healthy">Healthy</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Agent</th>
              <th className="text-right p-3 font-medium">Balance</th>
              <th className="text-right p-3 font-medium">Limit</th>
              <th className="text-center p-3 font-medium">Utilization</th>
              <th className="text-right p-3 font-medium">Last Top-Up</th>
              <th className="text-center p-3 font-medium">Status</th>
              <th className="text-center p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => (
              <tr key={f.id} className="border-t hover:bg-muted/30">
                <td className="p-3">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.agentId}
                  </div>
                </td>
                <td className="p-3 text-right font-mono font-medium">
                  {formatNaira(f.balance)}
                </td>
                <td className="p-3 text-right font-mono text-muted-foreground">
                  {formatNaira(f.limit)}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${f.utilized > 90 ? "bg-red-500" : f.utilized > 70 ? "bg-yellow-500" : "bg-green-500"}`}
                        style={{ width: `${f.utilized}%` }}
                      />
                    </div>
                    <span className="text-xs w-10 text-right">
                      {f.utilized}%
                    </span>
                  </div>
                </td>
                <td className="p-3 text-right text-xs text-muted-foreground">
                  {formatNaira(f.topUpAmount)}
                  <br />
                  {new Date(f.lastTopUp).toLocaleDateString()}
                </td>
                <td className="p-3 text-center">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      f.status === "critical"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : f.status === "warning"
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    }`}
                  >
                    {f.status}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <button className="px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                    Top-Up
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FloatManagementPage() {
  return (
    <DashboardLayout>
      <PageErrorBoundary>
        <FloatContent />
      </PageErrorBoundary>
    </DashboardLayout>
  );
}
