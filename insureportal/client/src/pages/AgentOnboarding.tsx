// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CheckCircle,
  Circle,
  ChevronRight,
  User,
  FileText,
  Wallet,
  Monitor,
  GraduationCap,
  Search,
} from "lucide-react";

const STEP_ICONS = [User, FileText, Wallet, Monitor, GraduationCap];
const STEP_LABELS = ["Profile", "KYC", "Float", "Terminal", "Training"];

export default function AgentOnboarding() {
  const { loading, isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [advanceStep, setAdvanceStep] = useState<{
    agentId: number;
    step: number;
  } | null>(null);
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.agentOnboarding.list.useQuery({
    page,
    limit: 15,
    search: search || undefined,
    status: statusFilter === "all" ? undefined : (statusFilter as any),
  });
  const { data: detail } = trpc.agentOnboarding.detail.useQuery(
    { agentId: selectedAgent! },
    { enabled: !!selectedAgent }
  );
  const { data: stats } = trpc.agentOnboarding.stats.useQuery();

  const advanceMutation = trpc.agentOnboarding.advanceStep.useMutation({
    onSuccess: () => {
      utils.agentOnboarding.list.invalidate();
      utils.agentOnboarding.detail.invalidate();
      utils.agentOnboarding.stats.invalidate();
      setAdvanceStep(null);
      setNotes("");
      toast.success("Step advanced");
    },
    onError: e => toast.error(e.message),
  });

  const initMutation = trpc.agentOnboarding.initiate.useMutation({
    onSuccess: () => {
      utils.agentOnboarding.list.invalidate();
      utils.agentOnboarding.stats.invalidate();
      toast.success("Onboarding initiated");
    },
    onError: e => toast.error(e.message),
  });

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  const stepColor = (status: string) =>
    status === "completed"
      ? "text-green-600"
      : status === "in_progress"
        ? "text-blue-600"
        : status === "failed"
          ? "text-red-600"
          : "text-muted-foreground";

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Agent Onboarding
          </h1>
          <p className="text-muted-foreground text-sm">
            5-step onboarding wizard: Profile → KYC → Float → Terminal →
            Training
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total", value: stats.total },
              {
                label: "In Progress",
                value: stats.inProgress,
                color: "text-blue-600",
              },
              {
                label: "Completed",
                value: stats.completed,
                color: "text-green-600",
              },
              {
                label: "Avg Days",
                value: stats.avgDaysToComplete?.toFixed(1) ?? "—",
              },
            ].map((s: any) => (
              <Card key={s.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color ?? ""}`}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent list */}
          <Card>
            <CardHeader>
              <CardTitle>Onboarding Queue</CardTitle>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9 h-8 text-sm"
                    placeholder="Search agent..."
                    value={search}
                    onChange={e => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={v => {
                    setStatusFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-32 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="not_started">Not Started</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading && (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
              {data?.items.map((item: any) => {
                const pct = Math.round((item.currentStep / 5) * 100);
                return (
                  <div
                    key={item.agentId}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedAgent === item.agentId ? "border-primary bg-primary/5" : "hover:border-muted-foreground/30"}`}
                    onClick={() => setSelectedAgent(item.agentId)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{item.agentName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.agentId}
                        </p>
                      </div>
                      <Badge
                        variant={
                          item.overallStatus === "completed"
                            ? "default"
                            : item.overallStatus === "in_progress"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {item.overallStatus}
                      </Badge>
                    </div>
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>
                          Step {item.currentStep}/5:{" "}
                          {STEP_LABELS[item.currentStep - 1] ?? "Done"}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  </div>
                );
              })}
              {!isLoading && data?.items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No onboarding records found
                </p>
              )}
              {data && data.total > 15 && (
                <div className="flex justify-between items-center pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {page}/{Math.ceil(data.total / 15)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * 15 >= data.total}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step detail */}
          <Card>
            <CardHeader>
              <CardTitle>Step Details</CardTitle>
              <CardDescription>
                {selectedAgent
                  ? `Agent #${selectedAgent}`
                  : "Select an agent to view steps"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedAgent && (
                <p className="text-sm text-muted-foreground text-center py-12">
                  Click an agent to view their onboarding steps
                </p>
              )}
              {selectedAgent && detail && (
                <div className="space-y-3">
                  {detail.steps.map((step, idx) => {
                    const Icon = STEP_ICONS[idx];
                    const isActive = step.status === "in_progress";
                    return (
                      <div
                        key={step.stepNumber}
                        className={`border rounded-lg p-3 ${isActive ? "border-blue-300 bg-blue-50/50" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 ${stepColor(step.status)}`}>
                            {step.status === "completed" ? (
                              <CheckCircle className="w-5 h-5" />
                            ) : (
                              <Icon className="w-5 h-5" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-sm">
                                {STEP_LABELS[idx]}
                              </p>
                              <span
                                className={`text-xs font-medium ${stepColor(step.status)}`}
                              >
                                {step.status}
                              </span>
                            </div>
                            {step.notes && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {step.notes}
                              </p>
                            )}
                            {step.completedAt && (
                              <p className="text-xs text-muted-foreground">
                                Completed:{" "}
                                {new Date(
                                  step.completedAt
                                ).toLocaleDateString()}
                              </p>
                            )}
                            {isActive && (
                              <Button
                                size="sm"
                                className="mt-2 h-7 text-xs"
                                onClick={() =>
                                  setAdvanceStep({
                                    agentId: selectedAgent,
                                    step: step.stepNumber,
                                  })
                                }
                              >
                                Mark Complete{" "}
                                <ChevronRight className="w-3 h-3 ml-1" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Advance step confirm */}
        {advanceStep && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-96">
              <CardHeader>
                <CardTitle>
                  Complete Step {advanceStep.step}:{" "}
                  {STEP_LABELS[advanceStep.step - 1]}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="Add notes about this step..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAdvanceStep(null);
                      setNotes("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() =>
                      advanceMutation.mutate({
                        agentId: advanceStep.agentId,
                        stepNumber: advanceStep.step,
                        notes: notes || undefined,
                      })
                    }
                    disabled={advanceMutation.isPending}
                  >
                    {advanceMutation.isPending ? "Saving..." : "Mark Complete"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
