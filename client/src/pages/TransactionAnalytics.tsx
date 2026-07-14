/**
 * Transaction Analytics — InsurePortal POS Shell (Sprint 89)
 *
 * Real-time analytics dashboard powered by Fluvio→OpenSearch pipeline.
 * Displays transaction volume, time-series charts, search, and pipeline health.
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  BarChart3,
  Search,
  TrendingUp,
  DollarSign,
  Activity,
  RefreshCw,
  Database,
  Loader2,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function TransactionAnalytics() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const {
    data: metricsData,
    refetch: refetchMetrics,
    isLoading: metricsLoading,
  } = trpc.analyticsQuery.getTransactionMetrics.useQuery({ days });

  const searchInput = useMemo(
    () => ({ query: searchQuery, limit: 20 }),
    [searchQuery]
  );
  const { data: searchData, refetch: refetchSearch } =
    trpc.analyticsQuery.searchTransactions.useQuery(searchInput, {
      enabled: searching && searchQuery.length > 0,
    });

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSearching(true);
      refetchSearch();
    }
  };

  const dayOptions = [7, 14, 30, 90, 180, 365];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Transaction Analytics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time analytics powered by Fluvio → OpenSearch pipeline
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {dayOptions.map(d => (
                <Button
                  key={d}
                  size="sm"
                  variant={days === d ? "default" : "ghost"}
                  className="text-xs h-7"
                  onClick={() => setDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchMetrics();
                toast.info("Refreshed");
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Data Source Badge */}
        {metricsData && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                metricsData.source === "opensearch"
                  ? "text-green-400 border-green-500/30"
                  : "text-amber-400 border-amber-500/30"
              )}
            >
              <Database className="h-3 w-3 mr-1" />
              Source: {metricsData.source}
            </Badge>
          </div>
        )}

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">
                Total Volume
              </span>
            </div>
            <p className="text-2xl font-bold">
              {metricsLoading
                ? "..."
                : metricsData
                  ? `$${(metricsData.totalVolume / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                  : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Last {days} days
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">
                Average Amount
              </span>
            </div>
            <p className="text-2xl font-bold">
              {metricsLoading
                ? "..."
                : metricsData
                  ? `$${(metricsData.avgAmount / 100).toFixed(2)}`
                  : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Per transaction
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">
                Transactions
              </span>
            </div>
            <p className="text-2xl font-bold">
              {metricsLoading
                ? "..."
                : (metricsData?.totalCount ??
                  metricsData?.timeSeries?.reduce(
                    (s: number, t: any) => s + (t.count || 0),
                    0
                  ) ??
                  "—")}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Last {days} days
            </p>
          </div>
        </div>

        {/* Status Breakdown */}
        {metricsData?.byStatus && metricsData.byStatus.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3">Status Breakdown</h3>
            <div className="flex gap-3 flex-wrap">
              {metricsData.byStatus.map((s: any) => (
                <div
                  key={s.key}
                  className="px-3 py-2 rounded-lg bg-muted/30 text-xs"
                >
                  <span className="font-medium capitalize">{s.key}</span>
                  <span className="text-muted-foreground ml-2">
                    {s.doc_count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time Series */}
        {metricsData?.timeSeries && metricsData.timeSeries.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3">Daily Volume</h3>
            <div className="flex items-end gap-1 h-32">
              {metricsData.timeSeries
                .slice(-30)
                .map((point: any, i: number) => {
                  const maxVol = Math.max(
                    ...metricsData.timeSeries.map((p: any) => p.volume || 0)
                  );
                  const height =
                    maxVol > 0 ? ((point.volume || 0) / maxVol) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-primary/60 rounded-t hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${point.date}: $${((point.volume || 0) / 100).toFixed(2)} (${point.count} txns)`}
                    />
                  );
                })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Last {Math.min(metricsData.timeSeries.length, 30)} days
            </p>
          </div>
        )}

        {/* Recent Entries (DB fallback) */}
        {metricsData?.recentEntries && metricsData.recentEntries.length > 0 && (
          <div className="rounded-xl border border-border bg-card">
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-semibold">Recent Ledger Entries</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Tenant
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Type
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Currency
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {metricsData.recentEntries.map((entry: any) => (
                    <tr key={entry.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2">{entry.tenantId}</td>
                      <td className="px-3 py-2">{entry.transactionType}</td>
                      <td className="px-3 py-2 font-medium">
                        {entry.grossAmount}
                      </td>
                      <td className="px-3 py-2">{entry.currency}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {entry.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {entry.createdAt
                          ? new Date(entry.createdAt).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Search Transactions
          </h3>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Search by transaction ID, tenant, invoice..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setSearching(false);
              }}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={!searchQuery.trim()}>
              <Search className="h-3.5 w-3.5 mr-1" /> Search
            </Button>
          </div>

          {searchData && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                {searchData.total} results from {searchData.source}
              </p>
              {searchData.results.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {searchData.results.map((r: any, i: number) => (
                    <div
                      key={i}
                      className="p-2 rounded bg-muted/30 text-xs font-mono"
                    >
                      {JSON.stringify(r, null, 0).slice(0, 200)}...
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No results found
                </p>
              )}
            </div>
          )}
        </div>

        {/* Pipeline Info */}
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <h3 className="text-xs font-semibold mb-1 flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
            Data Pipeline
          </h3>
          <p className="text-xs text-muted-foreground">
            Transactions flow through Fluvio (Rust consumer) → OpenSearch
            Indexer (Python) → OpenSearch. When OpenSearch is unavailable,
            queries fall back to the database.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
