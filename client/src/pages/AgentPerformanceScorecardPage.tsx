import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, Award, Star } from "lucide-react";

// F-12 (S87-02): rewritten against the DELIVERED agentPerformanceScorecard
// router. The previous version consumed a phantom {agents, summary} shape
// behind @ts-nocheck/@ts-ignore. Real shapes: list({page, limit, search}) →
// {items, total, page, limit} of agent_performance_scores rows (agentId,
// period, txVolume, txCount, commissionEarned, customerCount, disputeRate,
// uptimePercent, overallScore, rank). Summary cards are computed client-side
// over the loaded page of REAL rows (no fabricated aggregates).
export default function AgentPerformanceScorecardPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.agentPerformanceScorecard.list.useQuery({
    page: 1,
    limit: 50,
  });
  const rows = data?.items ?? [];
  const agents = rows.filter(a =>
    !search ? true : String(a.agentId).includes(search)
  );

  const score = (a: (typeof rows)[number]) => Number(a.overallScore ?? 0);
  const topPerformers = agents.filter(a => score(a) >= 80).length;
  const avgScore =
    agents.length > 0
      ? Math.round(agents.reduce((acc, a) => acc + score(a), 0) / agents.length)
      : 0;
  const totalCommission = agents.reduce(
    (acc, a) => acc + Number(a.commissionEarned ?? 0),
    0
  );

  const getScoreColor = (s: number) =>
    s >= 80 ? "text-green-600" : s >= 60 ? "text-yellow-600" : "text-red-600";
  const getScoreBg = (s: number) =>
    s >= 80 ? "bg-green-100" : s >= 60 ? "bg-yellow-100" : "bg-red-100";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Award className="w-6 h-6" /> Agent Performance Scorecard
        </h1>
        <p className="text-muted-foreground mt-1">
          Track agent KPIs, transaction volumes, and commission performance
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.total ?? 0}</p>
            <p className="text-sm text-muted-foreground">Total Records</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">{topPerformers}</p>
            <p className="text-sm text-muted-foreground">Top Performers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{avgScore}%</p>
            <p className="text-sm text-muted-foreground">Avg Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              ₦{totalCommission.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">Total Commission</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search by agent ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No performance records found
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map(agent => {
            const s = score(agent);
            return (
              <Card key={agent.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center ${getScoreBg(s)}`}
                    >
                      <span className={`text-lg font-bold ${getScoreColor(s)}`}>
                        {s}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">Agent {agent.agentId}</p>
                      <p className="text-sm text-muted-foreground">
                        Period {agent.period}
                        {agent.rank != null ? ` · Rank #${agent.rank}` : ""}
                      </p>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>
                          <TrendingUp className="w-3 h-3 inline mr-1" />
                          {agent.txCount ?? 0} txns
                        </span>
                        <span>
                          <Star className="w-3 h-3 inline mr-1" />₦
                          {Number(agent.commissionEarned ?? 0).toLocaleString()}{" "}
                          earned
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${s >= 80 ? "bg-green-500" : s >= 60 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(100, s)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s >= 80
                        ? "Excellent"
                        : s >= 60
                          ? "Good"
                          : "Needs Improvement"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
