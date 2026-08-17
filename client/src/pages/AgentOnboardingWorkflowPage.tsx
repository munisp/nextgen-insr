import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { UserPlus, Search, ArrowRight } from "lucide-react";

// F-12 (S87-02): rewritten against the DELIVERED router surface. The previous
// version called a phantom `advance` mutation and consumed a phantom
// {agents, stageCounts} list shape behind @ts-nocheck/@ts-ignore. The real
// router exposes list ({data, total} of agent_onboarding_progress rows),
// getAnalytics ({byStep}), and advanceStep ({agentId, completedStep}).
const STEP_KEYS = [
  "profile",
  "kyc",
  "training",
  "float_funding",
  "terminal",
  "go_live",
] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STAGE_LABELS = [
  "Application",
  "KYC Review",
  "Training",
  "Device Setup",
  "Float Allocation",
  "Go Live",
];

// DB enum values → API step keys (mirrors the router's API_STEP map).
const DB_TO_API: Record<string, StepKey> = {
  profile: "profile",
  kyc: "kyc",
  training: "training",
  float: "float_funding",
  terminal: "terminal",
  activated: "go_live",
};

export default function AgentOnboardingWorkflowPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.agentOnboardingWorkflow.list.useQuery({
    limit: 50,
    offset: 0,
  });
  const { data: analytics } =
    trpc.agentOnboardingWorkflow.getAnalytics.useQuery();
  const utils = trpc.useUtils();
  const advanceMut = trpc.agentOnboardingWorkflow.advanceStep.useMutation({
    onSuccess: () => {
      toast.success("Stage advanced");
      utils.agentOnboardingWorkflow.list.invalidate();
      utils.agentOnboardingWorkflow.getAnalytics.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const rows = (data?.data ?? []).filter(
    a => !search || a.agentId.toLowerCase().includes(search.toLowerCase())
  );
  const stageIndex = (currentStep: string): number => {
    const api = DB_TO_API[currentStep] ?? "profile";
    return STEP_KEYS.indexOf(api);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserPlus className="w-6 h-6" /> Agent Onboarding Workflow
        </h1>
        <p className="text-muted-foreground mt-1">
          Track and manage the end-to-end agent onboarding process
        </p>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {STAGE_LABELS.map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-3 text-center">
              <p className="text-lg font-bold">
                {analytics?.byStep?.[STEP_KEYS[i]] ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">{s}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search by agent code..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No agents in the onboarding pipeline
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map(a => {
            const stage = stageIndex(a.currentStep);
            return (
              <Card key={a.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium">Agent {a.agentId}</p>
                      <p className="text-sm text-muted-foreground">
                        Started {new Date(a.createdAt).toLocaleDateString()}
                        {a.activatedAt
                          ? ` · Activated ${new Date(a.activatedAt).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    {stage < STEP_KEYS.length - 1 && (
                      <Button
                        size="sm"
                        disabled={advanceMut.isPending}
                        onClick={() =>
                          advanceMut.mutate({
                            agentId: Number(a.agentId),
                            completedStep: STEP_KEYS[stage],
                          })
                        }
                      >
                        <ArrowRight className="w-4 h-4 mr-1" /> Advance
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {STAGE_LABELS.map((_, si) => (
                      <div
                        key={si}
                        className={`flex-1 h-2 rounded ${si <= stage ? "bg-green-500" : "bg-gray-200"}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1">
                    {STAGE_LABELS.map((s, si) => (
                      <span
                        key={si}
                        className={`text-[10px] ${si <= stage ? "text-green-600 font-medium" : "text-muted-foreground"}`}
                      >
                        {s}
                      </span>
                    ))}
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
