import { trpc } from "@/lib/trpc";
/**
 * Sprint 52 — Agent Performance Leaderboard
 * F09: Ranked agent performance with metrics, trends, and drill-down
 */
// @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageErrorBoundary } from "@/components/ErrorBoundary";
import { useState, useMemo } from "react";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Medal,
  Star,
  Search,
  ArrowUpDown,
  Download,
  Crown,
  Award,
  Target,
} from "lucide-react";

function formatNaira(n: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(n);
}

function LeaderboardContent() {
  const [search, setSearch] = useState("");
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const {
    data: _liveData,
    isLoading,
    isError,
    error,
  } = trpc.agentPerformanceLeaderboard.list.useQuery(
    // @ts-ignore Sprint 85
    undefined,
    { retry: 1 }
  );
  const [regionFilter, setRegionFilter] = useState("all");
  const [sortBy, setSortBy] = useState<
    "volume" | "txCount" | "commission" | "rating"
  >("volume");
  const [period, setPeriod] = useState("month");

  // Map real agent rows only — metrics the API does not provide stay unknown ("—")
  const agents = useMemo(() => {
    const rows = Array.isArray(_liveData?.data) ? _liveData.data : [];
    return rows.map((a: any) => ({
      rank: Number(a.rank ?? 0),
      id: String(a.agentId ?? a.id),
      name: a.name ?? "—",
      region: a.location ?? "—",
      txCount: a.txCount != null ? Number(a.txCount) : null,
      volume: a.volume != null ? Number(a.volume) : null,
      commission:
        a.commission != null
          ? Number(a.commission)
          : a.commissionBalance != null
            ? Number(a.commissionBalance)
            : null,
      rating: a.rating != null ? Number(a.rating) : null,
      trend: a.trend ?? "flat",
      badge: String(a.tier ?? "bronze").toLowerCase(),
    }));
  }, [_liveData]);

  const regions = [...new Set(agents.map(a => a.region))];

  const filtered = useMemo(() => {
    let result = [...agents];
    if (search)
      result = result.filter(
        a =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.id.includes(search)
      );
    if (regionFilter !== "all")
      result = result.filter(a => a.region === regionFilter);
    result.sort(
      (a: any, b: any) =>
        ((b[sortBy] as number | null) ?? -1) - ((a[sortBy] as number | null) ?? -1)
    );
    return result.map((a, i) => ({ ...a, rank: i + 1 }));
  }, [agents, search, regionFilter, sortBy]);

  const badgeIcon = (badge: string) => {
    if (badge === "gold") return <Crown className="h-4 w-4 text-yellow-500" />;
    if (badge === "silver") return <Medal className="h-4 w-4 text-gray-400" />;
    return <Award className="h-4 w-4 text-amber-700" />;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-yellow-500" /> Agent Performance
            Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Top performing agents ranked by transaction volume
          </p>
        </div>
        <div className="flex gap-2">
          {["week", "month", "quarter", "year"].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p ? "bg-primary text-primary-foreground" : "border hover:bg-accent"}`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Failed to load the leaderboard{error?.message ? `: ${error.message}` : "."}
        </div>
      )}

      {/* Top 3 Podium */}
      {!isLoading && !isError && filtered.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No leaderboard data available yet
        </div>
      ) : (
      <div className="grid grid-cols-3 gap-4">
        {filtered.slice(0, 3).map((agent, i) => (
          <div
            key={agent.id}
            className={`rounded-lg border p-5 text-center ${i === 0 ? "bg-yellow-50 dark:bg-yellow-900/10 border-yellow-300 dark:border-yellow-800" : "bg-card"}`}
          >
            <div className="flex justify-center mb-2">
              {badgeIcon(agent.badge)}
            </div>
            <div className="text-3xl font-bold mb-1">#{agent.rank}</div>
            <div className="font-semibold">{agent.name}</div>
            <div className="text-xs text-muted-foreground mb-2">
              {agent.id} — {agent.region}
            </div>
            <div className="text-lg font-bold text-primary">
              {agent.volume != null ? formatNaira(agent.volume) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {agent.txCount != null
                ? `${agent.txCount.toLocaleString()} transactions`
                : "Transactions unknown"}
            </div>
            {agent.rating != null ? (
              <div className="flex items-center justify-center gap-1 mt-2">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star
                    key={s}
                    className={`h-3 w-3 ${s < Math.floor(agent.rating!) ? "text-yellow-500 fill-yellow-500" : "text-muted"}`}
                  />
                ))}
                <span className="text-xs ml-1">{agent.rating}</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground mt-2">
                Rating unavailable
              </div>
            )}
          </div>
        ))}
      </div>
      )}

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
          value={regionFilter}
          onChange={e => setRegionFilter(e.target.value)}
          className="px-3 py-2 rounded-md border bg-background text-sm"
        >
          <option value="all">All Regions</option>
          {regions.map(r => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          className="px-3 py-2 rounded-md border bg-background text-sm"
        >
          <option value="volume">Sort by Volume</option>
          <option value="txCount">Sort by Transactions</option>
          <option value="commission">Sort by Commission</option>
          <option value="rating">Sort by Rating</option>
        </select>
        <button className="inline-flex items-center gap-2 px-3 py-2 rounded-md border hover:bg-accent text-sm">
          <Download className="h-4 w-4" /> Export
        </button>
      </div>

      {/* Full Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Rank</th>
              <th className="text-left p-3 font-medium">Agent</th>
              <th className="text-left p-3 font-medium">Region</th>
              <th className="text-right p-3 font-medium">Transactions</th>
              <th className="text-right p-3 font-medium">Volume</th>
              <th className="text-right p-3 font-medium">Commission</th>
              <th className="text-center p-3 font-medium">Rating</th>
              <th className="text-center p-3 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t">
                  <td colSpan={8} className="p-3">
                    <div className="h-6 rounded bg-muted animate-pulse" />
                  </td>
                </tr>
              ))}
            {!isLoading && filtered.map(agent => (
              <tr key={agent.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-bold">
                  <div className="flex items-center gap-2">
                    {agent.rank <= 3 ? (
                      badgeIcon(agent.badge)
                    ) : (
                      <span className="text-muted-foreground">
                        #{agent.rank}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {agent.id}
                  </div>
                </td>
                <td className="p-3">{agent.region}</td>
                <td className="p-3 text-right font-mono">
                  {agent.txCount != null ? agent.txCount.toLocaleString() : "—"}
                </td>
                <td className="p-3 text-right font-mono font-medium">
                  {agent.volume != null ? formatNaira(agent.volume) : "—"}
                </td>
                <td className="p-3 text-right font-mono">
                  {agent.commission != null
                    ? formatNaira(agent.commission)
                    : "—"}
                </td>
                <td className="p-3 text-center">
                  {agent.rating != null ? (
                    <div className="flex items-center justify-center gap-1">
                      <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                      <span>{agent.rating}</span>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3 text-center">
                  {agent.trend === "up" ? (
                    <TrendingUp className="h-4 w-4 text-green-500 mx-auto" />
                  ) : agent.trend === "down" ? (
                    <TrendingDown className="h-4 w-4 text-red-500 mx-auto" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AgentPerformanceLeaderboardPage() {
  return (
    <DashboardLayout>
      <PageErrorBoundary>
        <LeaderboardContent />
      </PageErrorBoundary>
    </DashboardLayout>
  );
}
