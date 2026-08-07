/**
 * Insurance Journey Dashboard
 *
 * Central hub for all 20 insurance stakeholder journeys.
 * Shows journey definitions, recent executions, and allows triggering journeys.
 * Wired to the insuranceJourneyOrchestrator tRPC router.
 */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Users, Shield, FileText, UserCheck, Activity, RefreshCw,
  AlertTriangle, DollarSign, Globe, MessageSquare, Briefcase,
  Calculator, Eye, Cpu, Repeat, User, UploadCloud, BarChart2,
  CheckCircle, Clock, XCircle, Play, Search, Filter
} from "lucide-react";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  customer: <Users className="h-5 w-5" />,
  policy: <FileText className="h-5 w-5" />,
  claims: <Shield className="h-5 w-5" />,
  agent: <UserCheck className="h-5 w-5" />,
  fraud: <AlertTriangle className="h-5 w-5" />,
  finance: <DollarSign className="h-5 w-5" />,
  broker: <Briefcase className="h-5 w-5" />,
  actuarial: <Calculator className="h-5 w-5" />,
  compliance: <Eye className="h-5 w-5" />,
  reinsurance: <Globe className="h-5 w-5" />,
  underwriting: <CheckCircle className="h-5 w-5" />,
  platform: <Cpu className="h-5 w-5" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  customer: "bg-blue-100 text-blue-800 border-blue-200",
  policy: "bg-green-100 text-green-800 border-green-200",
  claims: "bg-orange-100 text-orange-800 border-orange-200",
  agent: "bg-purple-100 text-purple-800 border-purple-200",
  fraud: "bg-red-100 text-red-800 border-red-200",
  finance: "bg-yellow-100 text-yellow-800 border-yellow-200",
  broker: "bg-indigo-100 text-indigo-800 border-indigo-200",
  actuarial: "bg-teal-100 text-teal-800 border-teal-200",
  compliance: "bg-pink-100 text-pink-800 border-pink-200",
  reinsurance: "bg-cyan-100 text-cyan-800 border-cyan-200",
  underwriting: "bg-emerald-100 text-emerald-800 border-emerald-200",
  platform: "bg-slate-100 text-slate-800 border-slate-200",
};

interface JourneyDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  estimatedDuration: string;
}

interface WorkflowStatus {
  workflowId: string;
  status: string;
  currentStep: string;
  startTime?: string;
  closeTime?: string;
}

export default function InsuranceJourneyDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<{ workflowId: string; journeyId: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch journey definitions
  const { data: definitions, isLoading: defsLoading } = trpc.insuranceJourneyOrchestrator.getDefinitions.useQuery();
  // V2 router — real execution history, analytics, cancel, approve
  const { data: executionsV2, refetch: refetchExecutions } = trpc.journeyOrchestratorV2.listExecutions.useQuery(
    { limit: 20, offset: 0 },
    { refetchInterval: 5000 }
  );
  const { data: analyticsV2 } = trpc.journeyOrchestratorV2.getAnalytics.useQuery({ days: 30 });
  const cancelMutation = trpc.journeyOrchestratorV2.cancel.useMutation({ onSuccess: () => refetchExecutions() });
  const approveMutation = trpc.journeyOrchestratorV2.approveStep.useMutation();

  // Fetch workflow status if we have an active workflow
  const { data: workflowStatus, refetch: refetchStatus } = trpc.insuranceJourneyOrchestrator.getStatus.useQuery(
    { workflowId: activeWorkflowId! },
    { enabled: !!activeWorkflowId, refetchInterval: 3000 }
  );

  // Generic trigger mutation
  const triggerMutation = trpc.insuranceJourneyOrchestrator.trigger.useMutation({
    onSuccess: (data) => {
      setTriggerResult(data);
      setActiveWorkflowId(data.workflowId);
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // J20 Platform Health trigger (no input required)
  const triggerJ20 = trpc.insuranceJourneyOrchestrator.triggerJ20.useMutation({
    onSuccess: (data) => {
      setTriggerResult(data);
      setActiveWorkflowId(data.workflowId);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const filteredDefinitions = (definitions ?? []).filter((d: JourneyDefinition) => {
    const matchesSearch = searchTerm === "" ||
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || d.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["all", ...Array.from(new Set((definitions ?? []).map((d: JourneyDefinition) => d.category)))];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "RUNNING": return <Clock className="h-4 w-4 text-blue-500 animate-spin" />;
      case "COMPLETED": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "FAILED": return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Activity className="h-4 w-4 text-gray-400" />;
    }
  };

  const handleQuickTrigger = (journeyId: string) => {
    if (journeyId === "J20") {
      triggerJ20.mutate({ triggeredBy: "manual" });
      return;
    }
    // For other journeys, show a simplified trigger with minimal required fields
    const defaultInputs: Record<string, unknown> = {
      J16: { customerId: 1, action: "view_policies" },
      J13: { entityType: "transaction", entityId: 1, amount: 100000, transactionType: "premium", complianceOfficerId: 1 },
    };
    if (defaultInputs[journeyId]) {
      triggerMutation.mutate({ journeyId: journeyId as "J01", input: defaultInputs[journeyId] as Record<string, unknown> });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Insurance Journey Orchestrator</h1>
            <p className="text-gray-500 text-sm">20 reusable stakeholder journeys powered by Temporal workflows</p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">20</div>
            <div className="text-sm text-gray-500">Journey Types</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-2xl font-bold text-green-600">12</div>
            <div className="text-sm text-gray-500">Service Categories</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-2xl font-bold text-purple-600">100%</div>
            <div className="text-sm text-gray-500">Saga Compensated</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-2xl font-bold text-orange-600">∞</div>
            <div className="text-sm text-gray-500">Reusable</div>
          </div>
        </div>
      </div>

      {/* Error/Success alerts */}
      {error && (
        <Alert className="mb-4 border-red-200 bg-red-50">
          <XCircle className="h-4 w-4 text-red-500" />
          <AlertDescription className="text-red-700">{error}</AlertDescription>
        </Alert>
      )}
      {triggerResult && (
        <Alert className="mb-4 border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-700">
            <strong>{triggerResult.message}</strong> — Workflow ID: <code className="text-xs bg-green-100 px-1 rounded">{triggerResult.workflowId}</code>
          </AlertDescription>
        </Alert>
      )}

      {/* Active Workflow Status */}
      {activeWorkflowId && workflowStatus && (
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-800 flex items-center gap-2">
              {getStatusIcon(workflowStatus.status)}
              Active Journey: {activeWorkflowId}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-blue-700">Status: <strong>{workflowStatus.status}</strong></span>
              <span className="text-blue-700">Step: <strong>{workflowStatus.currentStep}</strong></span>
              <Button size="sm" variant="outline" onClick={() => refetchStatus()} className="ml-auto">
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setActiveWorkflowId(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="journeys">
        <TabsList className="mb-6">
          <TabsTrigger value="journeys">All Journeys</TabsTrigger>
          <TabsTrigger value="executions">Execution History</TabsTrigger>
          <TabsTrigger value="quick-actions">Quick Actions</TabsTrigger>
          <TabsTrigger value="architecture">Architecture</TabsTrigger>
        </TabsList>

        {/* All Journeys Tab */}
        <TabsContent value="journeys">
          {/* Search and Filter */}
          <div className="flex gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search journeys..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  size="sm"
                  variant={selectedCategory === cat ? "default" : "outline"}
                  onClick={() => setSelectedCategory(cat)}
                  className="capitalize"
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          {defsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-48 bg-gray-200 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDefinitions.map((journey: JourneyDefinition) => (
                <Card key={journey.id} className="hover:shadow-md transition-shadow border border-gray-200">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-md ${CATEGORY_COLORS[journey.category] ?? "bg-gray-100"}`}>
                          {CATEGORY_ICONS[journey.category] ?? <Activity className="h-5 w-5" />}
                        </div>
                        <div>
                          <CardTitle className="text-sm font-semibold leading-tight">{journey.name}</CardTitle>
                          <span className="text-xs text-gray-400 font-mono">{journey.id}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-xs ${CATEGORY_COLORS[journey.category] ?? ""}`}>
                        {journey.category}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-xs text-gray-600 mb-3 leading-relaxed">
                      {journey.description}
                    </CardDescription>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {journey.estimatedDuration}
                      </span>
                      <div className="flex gap-2">
                        {(journey.id === "J20" || journey.id === "J16" || journey.id === "J13") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => handleQuickTrigger(journey.id)}
                            disabled={triggerMutation.isPending || triggerJ20.isPending}
                          >
                            <Play className="h-3 w-3 mr-1" /> Quick Run
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                          onClick={() => {
                            // Navigate to the journey-specific trigger page
                            window.location.href = `/insurance/journeys/${journey.id.toLowerCase()}`;
                          }}
                        >
                          Configure & Run
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Execution History Tab */}
        <TabsContent value="executions">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Recent Journey Executions</h2>
              <button onClick={() => refetchExecutions()} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5">↻ Refresh</button>
            </div>
            {executionsV2?.executions.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 text-sm">No executions yet. Trigger a journey to get started.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Journey</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Name</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Current Step</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Started</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Duration</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executionsV2?.executions.map((exec) => (
                      <tr key={exec.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-xs font-mono text-gray-500">{exec.journeyId}</td>
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">{exec.journeyName}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            exec.status === "running" ? "bg-blue-100 text-blue-800" :
                            exec.status === "completed" ? "bg-green-100 text-green-800" :
                            exec.status === "failed" ? "bg-red-100 text-red-800" :
                            "bg-gray-100 text-gray-600"
                          }`}>{exec.status}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">{exec.currentStep ?? "—"}</td>
                        <td className="py-3 px-4 text-xs text-gray-500">{exec.startedAt ? new Date(exec.startedAt).toLocaleString() : "—"}</td>
                        <td className="py-3 px-4 text-xs text-gray-500">{exec.durationMs ? `${(exec.durationMs / 1000).toFixed(1)}s` : exec.status === "running" ? "running…" : "—"}</td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            {exec.status === "running" && (
                              <>
                                <button onClick={() => approveMutation.mutate({ workflowId: exec.workflowId, stepId: "manual" })} className="text-xs text-green-600 hover:underline">Approve</button>
                                <button onClick={() => cancelMutation.mutate({ workflowId: exec.workflowId })} className="text-xs text-red-600 hover:underline">Cancel</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Analytics summary */}
            {analyticsV2 && analyticsV2.byStatus.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {analyticsV2.byStatus.map((s) => (
                  <div key={s.status} className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 capitalize">{s.status}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{s.count}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Quick Actions Tab */}
        <TabsContent value="quick-actions">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-slate-600" />
                  Platform Health Check (J20)
                </CardTitle>
                <CardDescription>Probe all services and detect SLA breaches</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  onClick={() => triggerJ20.mutate({ triggeredBy: "manual" })}
                  disabled={triggerJ20.isPending}
                >
                  {triggerJ20.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Running...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Run Health Check</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-5 w-5 text-pink-600" />
                  AML Compliance Check (J13)
                </CardTitle>
                <CardDescription>Screen a transaction for AML/compliance</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => triggerMutation.mutate({
                    journeyId: "J13",
                    input: { entityType: "transaction", entityId: 1, amount: 500000, transactionType: "premium_payment", complianceOfficerId: 1 }
                  })}
                  disabled={triggerMutation.isPending}
                >
                  {triggerMutation.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Running...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Run AML Check</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-5 w-5 text-blue-600" />
                  Customer Self-Service (J16)
                </CardTitle>
                <CardDescription>Customer views their policies</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => triggerMutation.mutate({
                    journeyId: "J16",
                    input: { customerId: 1, action: "view_policies" }
                  })}
                  disabled={triggerMutation.isPending}
                >
                  <Play className="h-4 w-4 mr-2" /> Run Self-Service
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="h-5 w-5 text-teal-600" />
                  IFRS17 Reserve Computation (J12)
                </CardTitle>
                <CardDescription>Compute actuarial reserves per IFRS17</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => triggerMutation.mutate({
                    journeyId: "J12",
                    input: {
                      actuaryId: 1,
                      reportingDate: new Date().toISOString().slice(0, 10),
                      portfolios: [{ policyType: "motor", measurementModel: "PAA" }, { policyType: "life", measurementModel: "BBA" }],
                      currency: "NGN",
                    }
                  })}
                  disabled={triggerMutation.isPending}
                >
                  <Play className="h-4 w-4 mr-2" /> Run IFRS17 Computation
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Architecture Tab */}
        <TabsContent value="architecture">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Technology Stack</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  {[
                    { lang: "TypeScript", role: "Temporal workflows, tRPC API, React frontend", color: "bg-blue-100 text-blue-800" },
                    { lang: "Go", role: "Float reconciler, health worker, payment gateway, TB sidecar", color: "bg-cyan-100 text-cyan-800" },
                    { lang: "Rust", role: "Fraud gate, ledger sidecar, realtime streaming", color: "bg-orange-100 text-orange-800" },
                    { lang: "Python", role: "ML fraud scoring, KYC pipeline, IFRS17 actuarial, AI advisor", color: "bg-green-100 text-green-800" },
                  ].map(({ lang, role, color }) => (
                    <div key={lang} className="flex items-start gap-3">
                      <Badge className={`${color} border-0 font-mono text-xs shrink-0`}>{lang}</Badge>
                      <span className="text-gray-600">{role}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Middleware Integration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {[
                    { svc: "Temporal", role: "Workflow orchestration, saga compensation" },
                    { svc: "TigerBeetle", role: "Double-entry ledger, atomic fund transfers" },
                    { svc: "Redis", role: "Distributed locks, idempotency keys, rate limiting" },
                    { svc: "Fluvio", role: "Real-time event streaming, audit trail" },
                    { svc: "Keycloak", role: "Identity & access management, JWT" },
                    { svc: "Permify", role: "Fine-grained authorization (RBAC/ABAC)" },
                    { svc: "APISIX", role: "API gateway, rate limiting, WAF" },
                    { svc: "Dapr", role: "Service mesh, pub/sub, state management" },
                    { svc: "OpenAppSec", role: "Web application firewall" },
                    { svc: "Ollama", role: "CPU-based LLM inference (llama3.2:3b)" },
                  ].map(({ svc, role }) => (
                    <div key={svc} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                      <span className="font-medium text-gray-700 w-28 shrink-0">{svc}</span>
                      <span className="text-gray-500 text-xs">{role}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Journey Atomicity Guarantee</CardTitle>
                <CardDescription>Every fund movement follows this 7-step sequence</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    "1. Idempotency Check",
                    "2. Redis Lock",
                    "3. TigerBeetle Transfer",
                    "4. PostgreSQL Update",
                    "5. Fluvio Event",
                    "6. Audit Log",
                    "7. Lock Release",
                  ].map((step, i) => (
                    <React.Fragment key={step}>
                      <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-xs text-blue-800 font-medium">
                        <CheckCircle className="h-3 w-3" />
                        {step}
                      </div>
                      {i < 6 && <span className="text-gray-400">→</span>}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
