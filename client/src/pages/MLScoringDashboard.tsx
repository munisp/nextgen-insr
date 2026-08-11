// @ts-nocheck
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  Brain,
  AlertTriangle,
  CheckCircle,
  Shield,
  Zap,
  BarChart2,
  Play,
  MessageSquare,
  TrendingUp,
} from "lucide-react";

export default function MLScoringDashboard() {
  const [tab, setTab] = useState("score");
  const [amount, setAmount] = useState("25000");
  const [agentId, setAgentId] = useState("AGT-001");
  const [batchInput, setBatchInput] = useState("");
  const analytics = trpc.mlScoring.analytics.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const history = trpc.mlScoring.scoringHistory.useQuery(
    { limit: 20 },
    { refetchInterval: 5000 }
  );

  const scoreMut = trpc.mlScoring.scoreTransaction.useMutation();
  const batchMut = trpc.mlScoring.batchScore.useMutation();
  const explainMut = trpc.mlScoring.explainScore.useMutation();

  const stats = analytics.data;

  const handleScore = () => {
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed)) return; // amount is required — no fabricated default
    scoreMut.mutate({
      amount: parsed,
      agentId,
      transactionId: "TXN-" + Date.now(),
    });
  };

  // Test utility: scores only user-provided transactions — never auto-generated ones.
  const handleBatchScore = () => {
    const lines = batchInput
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);
    const txns = lines.map((line: string, i: number) => {
      const [transactionId, amount, agentId] = line
        .split(",")
        .map((p: string) => p.trim());
      return {
        transactionId: transactionId || `BATCH-${Date.now()}-${i}`,
        amount: Number(amount),
        agentId: agentId || "UNKNOWN",
      };
    });
    if (
      txns.length === 0 ||
      txns.some((t: any) => !Number.isFinite(t.amount))
    ) {
      return;
    }
    batchMut.mutate({ transactions: txns });
  };

  const riskColor = (level: string) => {
    switch (level) {
      case "low":
        return "text-green-500";
      case "medium":
        return "text-yellow-500";
      case "high":
        return "text-orange-500";
      case "critical":
        return "text-red-500";
      default:
        return "";
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-7 w-7 text-purple-500" /> ML Scoring Service
            </h1>
            <p className="text-muted-foreground mt-1">
              Ensemble ML: XGBoost + Autoencoder + GNN + LLM Explanation
            </p>
          </div>
          <Badge variant="default">
            <Zap className="h-3 w-3 mr-1" /> Real-time Scoring
          </Badge>
        </div>

        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">{stats.totalScored}</p>
                <p className="text-xs text-muted-foreground">Total Scored</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">{stats.avgLatencyMs}ms</p>
                <p className="text-xs text-muted-foreground">Avg Latency</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">
                  {(stats.avgRiskScore * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Avg Risk Score</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">
                  {(stats.avgConfidence * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">Avg Confidence</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-red-500">
                  {stats.riskDistribution.high +
                    stats.riskDistribution.critical}
                </p>
                <p className="text-xs text-muted-foreground">Flagged</p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="score">Score Transaction</TabsTrigger>
            <TabsTrigger value="batch">Batch Scoring</TabsTrigger>
            <TabsTrigger value="history">Scoring History</TabsTrigger>
            <TabsTrigger value="features">Feature Importance</TabsTrigger>
          </TabsList>

          {/* Score Tab */}
          <TabsContent value="score" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Score a Transaction</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Amount (NGN)</label>
                    <Input
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="25000"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Agent ID</label>
                    <Input
                      value={agentId}
                      onChange={e => setAgentId(e.target.value)}
                      placeholder="AGT-001"
                    />
                  </div>
                </div>
                <Button onClick={handleScore} disabled={scoreMut.isPending}>
                  <Play className="h-4 w-4 mr-2" />{" "}
                  {scoreMut.isPending ? "Scoring..." : "Score Transaction"}
                </Button>
              </CardContent>
            </Card>

            {scoreMut.data && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {scoreMut.data.result.riskLevel === "low" ? (
                      <CheckCircle className="text-green-500" />
                    ) : scoreMut.data.result.riskLevel === "medium" ? (
                      <AlertTriangle className="text-yellow-500" />
                    ) : (
                      <Shield className="text-red-500" />
                    )}
                    Score Result: {scoreMut.data.result.riskLevel.toUpperCase()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">XGBoost</p>
                      <p className="text-lg font-bold">
                        {(
                          scoreMut.data.result.modelScores.xgboost * 100
                        ).toFixed(1)}
                        %
                      </p>
                    </div>
                    <div className="text-center p-3 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">
                        Autoencoder
                      </p>
                      <p className="text-lg font-bold">
                        {(
                          scoreMut.data.result.modelScores.autoencoder * 100
                        ).toFixed(1)}
                        %
                      </p>
                    </div>
                    <div className="text-center p-3 bg-muted rounded">
                      <p className="text-xs text-muted-foreground">GNN</p>
                      <p className="text-lg font-bold">
                        {(scoreMut.data.result.modelScores.gnn * 100).toFixed(
                          1
                        )}
                        %
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Final Score:{" "}
                      <span
                        className={riskColor(scoreMut.data.result.riskLevel)}
                      >
                        {(scoreMut.data.result.finalScore * 100).toFixed(1)}%
                      </span>
                    </p>
                    <p className="text-sm">
                      Confidence:{" "}
                      {(scoreMut.data.result.confidence * 100).toFixed(0)}% ·
                      Recommendation:{" "}
                      <Badge variant="outline">
                        {scoreMut.data.result.recommendation}
                      </Badge>
                    </p>
                  </div>
                  {scoreMut.data.result.topRiskFactors.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1">Risk Factors:</p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {scoreMut.data.result.topRiskFactors.map((f, i) => (
                          <li key={i}>• {f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      explainMut.mutate({ scoreId: scoreMut.data!.id })
                    }
                    disabled={explainMut.isPending}
                  >
                    <MessageSquare className="h-3 w-3 mr-1" />{" "}
                    {explainMut.isPending ? "Generating..." : "LLM Explain"}
                  </Button>
                  {explainMut.data && (
                    <div className="p-3 bg-muted rounded text-sm">
                      {explainMut.data.explanation}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Batch Tab */}
          <TabsContent value="batch" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Batch Scoring</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">
                  Test utility — paste real transactions to score, one per
                  line, as{" "}
                  <code className="font-mono">transactionId,amount,agentId</code>.
                  No transactions are auto-generated.
                </p>
                <textarea
                  value={batchInput}
                  onChange={(e: any) => setBatchInput(e.target.value)}
                  placeholder="TXN-001,25000,AGT-001&#10;TXN-002,130000,AGT-002"
                  rows={6}
                  className="w-full mb-4 rounded-md border bg-background p-2 font-mono text-sm"
                />
                <Button
                  onClick={handleBatchScore}
                  disabled={batchMut.isPending || batchInput.trim().length === 0}
                >
                  <Zap className="h-4 w-4 mr-2" />{" "}
                  {batchMut.isPending ? "Scoring..." : "Score Provided Transactions"}
                </Button>
              </CardContent>
            </Card>
            {batchMut.data && (
              <Card>
                <CardHeader>
                  <CardTitle>Batch Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="text-center p-2 bg-green-500/10 rounded">
                      <p className="text-lg font-bold text-green-500">
                        {batchMut.data.riskDistribution.low}
                      </p>
                      <p className="text-xs">Low Risk</p>
                    </div>
                    <div className="text-center p-2 bg-yellow-500/10 rounded">
                      <p className="text-lg font-bold text-yellow-500">
                        {batchMut.data.riskDistribution.medium}
                      </p>
                      <p className="text-xs">Medium</p>
                    </div>
                    <div className="text-center p-2 bg-orange-500/10 rounded">
                      <p className="text-lg font-bold text-orange-500">
                        {batchMut.data.riskDistribution.high}
                      </p>
                      <p className="text-xs">High</p>
                    </div>
                    <div className="text-center p-2 bg-red-500/10 rounded">
                      <p className="text-lg font-bold text-red-500">
                        {batchMut.data.riskDistribution.critical}
                      </p>
                      <p className="text-xs">Critical</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Scored {batchMut.data.totalScored} transactions · Avg{" "}
                    {batchMut.data.avgLatencyMs}ms · {batchMut.data.flagged}{" "}
                    flagged
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">ID</th>
                    <th className="p-2">Transaction</th>
                    <th className="p-2">Score</th>
                    <th className="p-2">Risk</th>
                    <th className="p-2">XGB / AE / GNN</th>
                    <th className="p-2">Confidence</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data?.records.map(r => (
                    <tr key={r.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{r.id}</td>
                      <td className="p-2 text-xs">{r.transactionId}</td>
                      <td className="p-2 font-bold">
                        {(r.result.finalScore * 100).toFixed(1)}%
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            r.result.riskLevel === "low"
                              ? "default"
                              : r.result.riskLevel === "critical"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {r.result.riskLevel}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">
                        {(r.result.modelScores.xgboost * 100).toFixed(0)}% /{" "}
                        {(r.result.modelScores.autoencoder * 100).toFixed(0)}% /{" "}
                        {(r.result.modelScores.gnn * 100).toFixed(0)}%
                      </td>
                      <td className="p-2">
                        {(r.result.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="p-2">
                        <Badge variant="outline">
                          {r.result.recommendation}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Feature Importance Tab */}
          <TabsContent value="features" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" /> Feature Importance (XGBoost
                  Weights)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats?.featureImportance.map(f => (
                    <div key={f.feature} className="flex items-center gap-3">
                      <span className="w-48 text-sm truncate">{f.feature}</span>
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${f.direction === "risk" ? "bg-red-500" : "bg-green-500"}`}
                          style={{ width: `${Math.abs(f.weight) * 500}%` }}
                        />
                      </div>
                      <span className="text-xs w-16 text-right">
                        {f.weight > 0 ? "+" : ""}
                        {f.weight}
                      </span>
                      <Badge
                        variant={
                          f.direction === "risk" ? "destructive" : "default"
                        }
                        className="text-xs"
                      >
                        {f.direction}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-muted rounded text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Ensemble Weights:</p>
                  <p>XGBoost: 45% · Autoencoder: 30% · GNN: 25%</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
