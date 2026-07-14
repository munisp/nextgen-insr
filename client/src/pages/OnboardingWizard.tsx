/**
 * Onboarding Wizard — Step-by-step agent onboarding with KYC, device provisioning, and training
 * Wired to agentOnboarding.listApplications, agentOnboarding.approve, kyc.getStatus, mdm.listDevices
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  UserPlus,
  Search,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  FileText,
  Smartphone,
  GraduationCap,
} from "lucide-react";
import { toast } from "sonner";

const STEPS = [
  "Application",
  "KYC Verification",
  "Device Provisioning",
  "Training",
  "Activation",
];

export default function OnboardingWizard() {
  const [search, setSearch] = useState("");

  const applications = trpc.agentOnboarding.list.useQuery(
    { page: 1, limit: 50 },
    { retry: false }
  );
  const approveMutation = trpc.agentOnboarding.advanceStep.useMutation({
    onSuccess: () => {
      toast.success("Step advanced");
      applications.refetch();
    },
    onError: (e: any) => toast.error("Failed: " + e.message),
  });

  const rawData = applications.data;
  const items: any[] = Array.isArray(rawData)
    ? rawData
    : (rawData?.items ?? []);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (a: any) =>
        a.fullName?.toLowerCase().includes(q) ||
        a.agentId?.toLowerCase().includes(q) ||
        a.phone?.includes(q)
    );
  }, [items, search]);

  const getStep = (status: string) => {
    switch (status) {
      case "pending":
      case "submitted":
        return 0;
      case "kyc_pending":
      case "kyc_review":
        return 1;
      case "device_pending":
        return 2;
      case "training":
        return 3;
      case "active":
      case "approved":
        return 4;
      default:
        return 0;
    }
  };

  const stats = {
    total: items.length,
    pending: items.filter((a: any) =>
      ["pending", "submitted"].includes(a.status)
    ).length,
    inProgress: items.filter((a: any) =>
      ["kyc_pending", "kyc_review", "device_pending", "training"].includes(
        a.status
      )
    ).length,
    completed: items.filter((a: any) =>
      ["active", "approved"].includes(a.status)
    ).length,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserPlus className="w-6 h-6 text-cyan-400" /> Agent Onboarding Wizard
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Track and manage the full agent onboarding pipeline
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-white" },
          { label: "Pending", value: stats.pending, color: "text-yellow-400" },
          {
            label: "In Progress",
            value: stats.inProgress,
            color: "text-blue-400",
          },
          {
            label: "Completed",
            value: stats.completed,
            color: "text-green-400",
          },
        ].map(s => (
          <Card key={s.label} className="bg-slate-900/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="pl-9 bg-slate-800 border-slate-700 text-white"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((app: any) => {
          const step = getStep(app.status);
          const progress = ((step + 1) / STEPS.length) * 100;
          return (
            <Card key={app.id} className="bg-slate-900/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-white font-medium">
                      {app.fullName ?? `Agent #${app.id}`}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {app.agentId ?? app.phone ?? `ID: ${app.id}`}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${step >= 4 ? "border-green-600 text-green-400" : step >= 2 ? "border-blue-600 text-blue-400" : "border-yellow-600 text-yellow-400"}`}
                  >
                    {app.status}
                  </Badge>
                </div>
                <Progress value={progress} className="h-1.5 mb-2" />
                <div className="flex items-center gap-1 text-[10px]">
                  {STEPS.map((s, i) => (
                    <div key={s} className="flex items-center gap-1">
                      <span
                        className={
                          i <= step ? "text-cyan-400" : "text-slate-600"
                        }
                      >
                        {i < step ? (
                          <CheckCircle className="w-3 h-3 inline" />
                        ) : i === step ? (
                          <Clock className="w-3 h-3 inline" />
                        ) : (
                          <span className="w-3 h-3 inline-block rounded-full border border-slate-600" />
                        )}
                      </span>
                      <span
                        className={
                          i <= step ? "text-slate-300" : "text-slate-600"
                        }
                      >
                        {s}
                      </span>
                      {i < STEPS.length - 1 && (
                        <ChevronRight className="w-3 h-3 text-slate-700" />
                      )}
                    </div>
                  ))}
                </div>
                {app.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs"
                      onClick={() =>
                        approveMutation.mutate({
                          agentId: app.agentId,
                          stepNumber: 2,
                        })
                      }
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle className="w-3 h-3 mr-1" /> Approve & Start
                      KYC
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="bg-slate-900/50 border-slate-700">
            <CardContent className="p-8 text-center text-slate-600">
              {applications.isLoading
                ? "Loading..."
                : "No onboarding applications found"}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
