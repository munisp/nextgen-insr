import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Trophy,
  Star,
  TrendingUp,
  Users,
  Target,
  Award,
  Medal,
} from "lucide-react";

// Mock agent performance data (in production, fetched from trpc.sprint23.agentPerformance.calculate)
const mockAgents = [
  {
    agentId: "a1",
    agentId: "AG-001",
    name: "Adebayo Ogundimu",
    overallScore: 92.5,
    tier: "platinum" as const,
    trend: "improving" as const,
    breakdown: {
      transactionVolume: { score: 95, weight: 0.25, raw: 1250 },
      successRate: { score: 98.2, weight: 0.2, raw: 98.2 },
      customerSatisfaction: { score: 90, weight: 0.15, raw: 4.5 },
      complianceAdherence: { score: 88, weight: 0.2, raw: 88 },
      uptimeReliability: { score: 96, weight: 0.1, raw: 168 },
      responseTime: { score: 100, weight: 0.1, raw: 450 },
    },
  },
  {
    agentId: "a2",
    agentId: "AG-002",
    name: "Chioma Nwosu",
    overallScore: 87.3,
    tier: "gold" as const,
    trend: "stable" as const,
    breakdown: {
      transactionVolume: { score: 82, weight: 0.25, raw: 980 },
      successRate: { score: 96.5, weight: 0.2, raw: 96.5 },
      customerSatisfaction: { score: 86, weight: 0.15, raw: 4.3 },
      complianceAdherence: { score: 90, weight: 0.2, raw: 90 },
      uptimeReliability: { score: 88, weight: 0.1, raw: 155 },
      responseTime: { score: 75, weight: 0.1, raw: 2100 },
    },
  },
  {
    agentId: "a3",
    agentId: "AG-003",
    name: "Emeka Okafor",
    overallScore: 78.1,
    tier: "gold" as const,
    trend: "improving" as const,
    breakdown: {
      transactionVolume: { score: 75, weight: 0.25, raw: 820 },
      successRate: { score: 94.0, weight: 0.2, raw: 94.0 },
      customerSatisfaction: { score: 80, weight: 0.15, raw: 4.0 },
      complianceAdherence: { score: 72, weight: 0.2, raw: 72 },
      uptimeReliability: { score: 82, weight: 0.1, raw: 142 },
      responseTime: { score: 75, weight: 0.1, raw: 2500 },
    },
  },
  {
    agentId: "a4",
    agentId: "AG-004",
    name: "Fatima Ibrahim",
    overallScore: 65.8,
    tier: "silver" as const,
    trend: "declining" as const,
    breakdown: {
      transactionVolume: { score: 60, weight: 0.25, raw: 620 },
      successRate: { score: 88.0, weight: 0.2, raw: 88.0 },
      customerSatisfaction: { score: 70, weight: 0.15, raw: 3.5 },
      complianceAdherence: { score: 65, weight: 0.2, raw: 65 },
      uptimeReliability: { score: 55, weight: 0.1, raw: 96 },
      responseTime: { score: 50, weight: 0.1, raw: 4200 },
    },
  },
  {
    agentId: "a5",
    agentId: "AG-005",
    name: "Oluwaseun Bakare",
    overallScore: 55.2,
    tier: "bronze" as const,
    trend: "stable" as const,
    breakdown: {
      transactionVolume: { score: 45, weight: 0.25, raw: 380 },
      successRate: { score: 82.0, weight: 0.2, raw: 82.0 },
      customerSatisfaction: { score: 60, weight: 0.15, raw: 3.0 },
      complianceAdherence: { score: 58, weight: 0.2, raw: 58 },
      uptimeReliability: { score: 50, weight: 0.1, raw: 88 },
      responseTime: { score: 25, weight: 0.1, raw: 6000 },
    },
  },
];

const tierColors: Record<string, string> = {
  platinum: "text-purple-400",
  gold: "text-yellow-400",
  silver: "text-gray-300",
  bronze: "text-orange-400",
};

const tierBg: Record<string, string> = {
  platinum: "border-purple-500/30",
  gold: "border-yellow-500/30",
  silver: "border-gray-500/30",
  bronze: "border-orange-500/30",
};

export default function AgentPerformanceScoring() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const selected = useMemo(
    () => mockAgents.find((a: any) => a.agentId === selectedAgent),
    [selectedAgent]
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" />
            Agent Performance Scoring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            KPI-based scoring dashboard for agent performance evaluation
          </p>
        </div>

        {/* Tier Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["platinum", "gold", "silver", "bronze"] as const).map(
            (tier: any) => (
              <Card key={tier} className={tierBg[tier]}>
                <CardContent className="pt-4 text-center">
                  <Medal
                    className={`w-6 h-6 mx-auto mb-1 ${tierColors[tier]}`}
                  />
                  <p className="text-xl font-bold">
                    {mockAgents.filter((a: any) => a.tier === tier).length}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {tier} Agents
                  </p>
                </CardContent>
              </Card>
            )
          )}
        </div>

        {/* Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-5 h-5" /> Agent Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mockAgents.map((agent, idx) => (
                <div
                  key={agent.agentId}
                  className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedAgent === agent.agentId
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() =>
                    setSelectedAgent(
                      agent.agentId === selectedAgent ? null : agent.agentId
                    )
                  }
                >
                  <div className="text-2xl font-bold text-muted-foreground w-8 text-center">
                    #{idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{agent.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {agent.agentId}
                      </Badge>
                      <Badge
                        className={`text-xs capitalize ${tierColors[agent.tier]}`}
                        variant="outline"
                      >
                        {agent.tier}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress
                        value={agent.overallScore}
                        className="h-2 flex-1"
                      />
                      <span className="text-sm font-mono">
                        {agent.overallScore.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`flex items-center gap-1 text-xs ${
                        agent.trend === "improving"
                          ? "text-green-400"
                          : agent.trend === "declining"
                            ? "text-red-400"
                            : "text-gray-400"
                      }`}
                    >
                      {agent.trend === "improving" ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : agent.trend === "declining" ? (
                        <TrendingUp className="w-3 h-3 rotate-180" />
                      ) : null}
                      {agent.trend}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Selected Agent Detail */}
        {selected && (
          <Card>
            <CardHeader>
              <CardTitle>KPI Breakdown — {selected.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(selected.breakdown).map(([key, kpi]) => (
                  <div key={key} className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Weight: {(kpi.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={kpi.score} className="h-2 mb-1" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Score: {kpi.score.toFixed(1)}</span>
                      <span>
                        Raw:{" "}
                        {typeof kpi.raw === "number"
                          ? kpi.raw.toLocaleString()
                          : kpi.raw}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
