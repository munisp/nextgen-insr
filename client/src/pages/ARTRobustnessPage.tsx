import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield,
  Activity,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

export default function ARTRobustnessPage() {
  const health = trpc.artRobustness.health.useQuery();
  const analytics = trpc.artRobustness.analytics.useQuery();
  const attacks = trpc.artRobustness.listAttacks.useQuery();
  const results = trpc.artRobustness.listResults.useQuery();
  const runAttackMut = trpc.artRobustness.runAttack.useMutation({
    onSuccess: () => results.refetch(),
  });
  const runSuiteMut = trpc.artRobustness.runFullSuite.useMutation({
    onSuccess: () => results.refetch(),
  });

  const gradeColor = (grade: string) => {
    if (grade === "A") return "text-green-600";
    if (grade === "B") return "text-blue-600";
    if (grade === "C") return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ART Adversarial Robustness</h1>
          <p className="text-muted-foreground">
            Model security testing: FGSM, PGD, Carlini-Wagner, data poisoning,
            model extraction
          </p>
        </div>
        <div className="flex gap-2">
          <Badge
            variant={
              health.data?.artService === "connected" ? "default" : "secondary"
            }
          >
            {health.data?.artService ?? "checking..."}
          </Badge>
          <Button
            onClick={() => runSuiteMut.mutate({})}
            disabled={runSuiteMut.isPending}
          >
            {runSuiteMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Play className="w-4 h-4 mr-1" />
            )}
            Run Full Suite
          </Button>
        </div>
      </div>

      {/* Suite Result */}
      {runSuiteMut.data && (
        <Card className="border-primary">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Full Suite Results</h3>
                <p className="text-sm text-muted-foreground">
                  {runSuiteMut.data.attacksRun} attacks executed
                </p>
              </div>
              <div className="text-center">
                <div
                  className={`text-4xl font-bold ${gradeColor(runSuiteMut.data.overallGrade)}`}
                >
                  {runSuiteMut.data.overallGrade}
                </div>
                <p className="text-sm text-muted-foreground">
                  Robustness: {runSuiteMut.data.avgRobustnessScore}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Tests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.totalTests ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Avg Robustness
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.avgRobustnessScore ?? 0}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Overall Grade
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${gradeColor(analytics.data?.overallGrade ?? "")}`}
            >
              {analytics.data?.overallGrade ?? "-"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Critical Vulns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {analytics.data?.criticalVulnerabilities ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="attacks">
        <TabsList>
          <TabsTrigger value="attacks">
            <Shield className="w-4 h-4 mr-1" />
            Attack Library
          </TabsTrigger>
          <TabsTrigger value="results">
            <Activity className="w-4 h-4 mr-1" />
            Test Results
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attacks" className="space-y-4">
          {attacks.data?.attacks?.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{a.name}</h3>
                      <Badge
                        variant={
                          a.severity === "critical"
                            ? "destructive"
                            : a.severity === "high"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {a.severity}
                      </Badge>
                      <Badge variant="outline">{a.type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {a.description}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Target: {a.targetModel}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => runAttackMut.mutate({ attackId: a.id })}
                    disabled={runAttackMut.isPending}
                  >
                    {runAttackMut.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          {results.data?.results?.map((r, i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold">{r.attackName}</h3>
                    <p className="text-sm text-muted-foreground">
                      Original: {r.originalAccuracy}% → Adversarial:{" "}
                      {r.adversarialAccuracy}% | {r.successfulAttacks}/
                      {r.samplesGenerated} successful
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.defenseRecommendation}
                    </p>
                  </div>
                  <div className="text-center">
                    <div
                      className={`text-2xl font-bold ${r.robustnessScore >= 80 ? "text-green-600" : r.robustnessScore >= 60 ? "text-yellow-600" : "text-red-600"}`}
                    >
                      {r.robustnessScore}%
                    </div>
                    <p className="text-xs text-muted-foreground">robustness</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
