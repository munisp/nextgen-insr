/**
 * Agent Performance Leaderboard — Full CRUD with search, filter, sort, pagination
 * Wired to analytics.agentLeaderboard tRPC procedure
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trophy,
  TrendingUp,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Medal,
  Star,
  Zap,
} from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  Platinum: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  Gold: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  Silver: "bg-slate-400/20 text-slate-300 border-slate-400/40",
  Bronze: "bg-orange-500/20 text-orange-300 border-orange-500/40",
};

export default function AgentPerformance() {
  const [days, setDays] = useState(30);
  const [sortBy, setSortBy] = useState<
    "volume" | "txCount" | "commission" | "successRate"
  >("volume");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;

  const { data, isLoading } = trpc.analytics.agentLeaderboard.useQuery({
    days,
    sortBy,
    page,
    limit,
  });

  const filtered = useMemo(() => {
    if (!data?.agents || !search) return data?.agents ?? [];
    const q = search.toLowerCase();
    return data.agents.filter(
      (a: any) =>
        a.agentId?.toLowerCase().includes(q) ||
        a.name?.toLowerCase().includes(q)
    );
  }, [data?.agents, search]);

  const totalPages = Math.ceil((data?.total ?? 0) / limit);
  const formatCurrency = (n: number) =>
    `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" /> Agent Performance
            Leaderboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Track agent rankings by volume, transactions, commission, and
            success rate
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border-blue-700/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-blue-400 text-xs font-medium">
              <Users className="w-4 h-4" /> Total Agents
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {data?.total ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-900/40 to-green-800/20 border-green-700/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
              <TrendingUp className="w-4 h-4" /> Top Volume
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {filtered[0] ? formatCurrency(filtered[0].volume) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border-purple-700/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-purple-400 text-xs font-medium">
              <Medal className="w-4 h-4" /> Top Commission
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {filtered[0] ? formatCurrency(filtered[0].commission) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-900/40 to-amber-800/20 border-amber-700/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
              <Star className="w-4 h-4" /> Top Success Rate
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              {filtered[0] ? `${filtered[0].successRate}%` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by agent ID or name..."
                className="pl-9 bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <Select
              value={String(days)}
              onValueChange={v => {
                setDays(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[140px] bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortBy}
              onValueChange={v => {
                setSortBy(v as any);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px] bg-slate-800 border-slate-700 text-white">
                <ArrowUpDown className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="volume">Sort by Volume</SelectItem>
                <SelectItem value="txCount">Sort by Tx Count</SelectItem>
                <SelectItem value="commission">Sort by Commission</SelectItem>
                <SelectItem value="successRate">
                  Sort by Success Rate
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Leaderboard Table */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" /> Rankings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-500">
                  <th className="px-3 py-2 text-left w-12">#</th>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-left">Tier</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Transactions</th>
                  <th className="px-3 py-2 text-right">Volume</th>
                  <th className="px-3 py-2 text-right">Commission</th>
                  <th className="px-3 py-2 text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-12 text-slate-500"
                    >
                      Loading leaderboard...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-12 text-slate-500"
                    >
                      No agents found
                    </td>
                  </tr>
                ) : (
                  filtered.map((a: any, i: number) => (
                    <tr
                      key={a.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        {(page - 1) * limit + i + 1 <= 3 ? (
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                              i === 0
                                ? "bg-yellow-500/20 text-yellow-400"
                                : i === 1
                                  ? "bg-slate-400/20 text-slate-300"
                                  : "bg-orange-500/20 text-orange-400"
                            }`}
                          >
                            {(page - 1) * limit + i + 1}
                          </span>
                        ) : (
                          <span className="text-slate-500 pl-1.5">
                            {(page - 1) * limit + i + 1}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white">
                          {a.name || a.agentId}
                        </div>
                        <div className="text-slate-500 text-[10px]">
                          {a.agentId}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${TIER_COLORS[a.tier] ?? "border-slate-600 text-slate-400"}`}
                        >
                          {a.tier}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${a.status === "active" ? "border-green-600 text-green-400" : "border-red-600 text-red-400"}`}
                        >
                          {a.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {a.txCount?.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {formatCurrency(a.volume)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-green-400">
                        {formatCurrency(a.commission)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`font-mono ${a.successRate >= 90 ? "text-green-400" : a.successRate >= 70 ? "text-yellow-400" : "text-red-400"}`}
                        >
                          {a.successRate}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} ({data?.total ?? 0} agents)
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="border-slate-700 text-slate-300"
            >
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="border-slate-700 text-slate-300"
            >
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
