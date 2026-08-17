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

        {/* Stats Overview — F-12 (wave-4b): mlScoring.analytics is fail-loud
            NOT_IMPLEMENTED (no delivered ML model/store) — honest state */}
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            — ML scoring analytics are not delivered on this platform
          </CardContent>
        </Card>

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
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      — scoring history is not delivered on this platform
                    </td>
                  </tr>
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
<div className="py-6 text-center text-muted-foreground">
                    — feature-importance telemetry is not delivered on this platform
                  </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
