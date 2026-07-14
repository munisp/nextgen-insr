// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  MessageSquare,
  Shield,
  Tag,
  Loader2,
  Server,
} from "lucide-react";

export default function OllamaLLMPage() {
  const [chatInput, setChatInput] = useState("");
  const [txDesc, setTxDesc] = useState("");
  const health = trpc.ollamaLLM.health.useQuery();
  const analytics = trpc.ollamaLLM.analytics.useQuery();
  const models = trpc.ollamaLLM.listModels.useQuery();
  const sessions = trpc.ollamaLLM.listSessions.useQuery();
  const chatMut = trpc.ollamaLLM.chat.useMutation();
  const fraudMut = trpc.ollamaLLM.explainFraud.useMutation();
  const classifyMut = trpc.ollamaLLM.classifyTransaction.useMutation();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ollama Local LLM</h1>
          <p className="text-muted-foreground">
            Local inference for fraud explanation, classification, and agent
            support
          </p>
        </div>
        <Badge
          variant={
            health.data?.ollama === "connected" ? "default" : "secondary"
          }
        >
          {health.data?.ollama === "connected"
            ? "Ollama Connected"
            : "Built-in LLM Fallback"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {analytics.data?.ollamaStatus ?? "checking..."}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Installed Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.installedModels ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.totalSessions ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Avg Latency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.avgLatencyMs ?? 0}ms
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">
            <MessageSquare className="w-4 h-4 mr-1" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="fraud">
            <Shield className="w-4 h-4 mr-1" />
            Fraud Explain
          </TabsTrigger>
          <TabsTrigger value="classify">
            <Tag className="w-4 h-4 mr-1" />
            Classify
          </TabsTrigger>
          <TabsTrigger value="models">
            <Server className="w-4 h-4 mr-1" />
            Models
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Chat Completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Ask about insurance, fraud patterns, CBN regulations..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                />
                <Button
                  onClick={() =>
                    chatMut.mutate({
                      messages: [{ role: "user", content: chatInput }],
                    })
                  }
                  disabled={!chatInput || chatMut.isPending}
                >
                  {chatMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {chatMut.data && (
                <div className="space-y-2">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="whitespace-pre-wrap">
                      {chatMut.data.content}
                    </p>
                  </div>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    <span>Model: {chatMut.data.model}</span>
                    <span>Tokens: {chatMut.data.tokensUsed}</span>
                    <span>Latency: {chatMut.data.latencyMs}ms</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fraud" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Fraud Explanation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() =>
                  fraudMut.mutate({
                    transactionType: "cash_withdrawal",
                    amount: 950000,
                    channel: "POS",
                    customer: "John Doe",
                    agentId: "AGT-001",
                    fraudScore: 0.87,
                    ruleTriggered: "velocity_limit_exceeded",
                  })
                }
                disabled={fraudMut.isPending}
              >
                {fraudMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Shield className="w-4 h-4 mr-1" />
                )}
                Analyze Sample Fraud Case
              </Button>
              {fraudMut.data && (
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <Badge variant="destructive">
                      Fraud Score: {(fraudMut.data.fraudScore * 100).toFixed(0)}
                      %
                    </Badge>
                    <Badge variant="outline">
                      Source: {fraudMut.data.source}
                    </Badge>
                  </div>
                  <p className="whitespace-pre-wrap">
                    {fraudMut.data.explanation}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="classify" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Transaction Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Describe transaction..."
                  value={txDesc}
                  onChange={e => setTxDesc(e.target.value)}
                />
                <Button
                  onClick={() =>
                    classifyMut.mutate({
                      description: txDesc,
                      amount: 50000,
                      channel: "POS",
                    })
                  }
                  disabled={!txDesc || classifyMut.isPending}
                >
                  {classifyMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Tag className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {classifyMut.data && (
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div className="flex gap-2">
                    <Badge>{classifyMut.data.category}</Badge>
                    <Badge
                      variant={
                        classifyMut.data.riskLevel === "high"
                          ? "destructive"
                          : classifyMut.data.riskLevel === "medium"
                            ? "secondary"
                            : "default"
                      }
                    >
                      {classifyMut.data.riskLevel}
                    </Badge>
                    <Badge variant="outline">
                      Confidence:{" "}
                      {((classifyMut.data.confidence ?? 0) * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {classifyMut.data.tags?.map((t: string, i: number) => (
                      <Badge key={i} variant="outline">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Model Registry</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="font-medium mb-2">
                    Installed ({models.data?.totalInstalled ?? 0})
                  </p>
                  {models.data?.installed?.map((m: any, i: number) => (
                    <div
                      key={i}
                      className="p-2 border rounded mb-1 flex justify-between"
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {(m.size / 1e9).toFixed(1)}GB
                      </span>
                    </div>
                  ))}
                  {(models.data?.totalInstalled ?? 0) === 0 && (
                    <p className="text-muted-foreground text-sm">
                      No Ollama models installed. Using built-in LLM fallback.
                    </p>
                  )}
                </div>
                <div>
                  <p className="font-medium mb-2">Recommended Models</p>
                  {models.data?.recommended?.map((m, i) => (
                    <div
                      key={i}
                      className="p-2 border rounded mb-1 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-medium">{m.name}</span>
                        <span className="text-sm text-muted-foreground ml-2">
                          {m.params} | {m.quant}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {m.useCase}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
