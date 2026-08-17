import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleLeft, ToggleRight, FlaskConical } from "lucide-react";

export default function FeatureFlagsPage() {
  const { data } = trpc.featureFlags.dashboard.useQuery();
  const toggleMut = trpc.featureFlags.toggleFlag.useMutation();
  const utils = trpc.useUtils();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Feature Flags</h1>
        <p className="text-muted-foreground">
          Gradual rollouts, A/B testing, kill switches
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Flags", value: data?.totalFlags ?? 0 },
          { label: "Enabled", value: data?.enabledFlags ?? 0 },
          { label: "Disabled", value: data?.disabledFlags ?? 0 },
          { label: "Experiments", value: data?.experimentFlags ?? 0 },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(data?.flags ?? []).map((f: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  {f.status === "enabled" ? (
                    <ToggleRight className="w-5 h-5 text-green-500" />
                  ) : f.status === "experiment" ? (
                    <FlaskConical className="w-5 h-5 text-purple-500" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-gray-500" />
                  )}
                  <div>
                    <p className="font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {f.key}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm">{f.rolloutPercent}%</span>
                  <Badge
                    variant={
                      f.type === "ab_test"
                        ? "secondary"
                        : f.type === "kill_switch"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {f.type}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      toggleMut.mutate(
                        { flagId: f.id, enabled: f.status !== "enabled" },
                        {
                          onSuccess: () =>
                            utils.featureFlags.dashboard.invalidate(),
                        }
                      );
                    }}
                  >
                    {f.status === "enabled" ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {(data?.recentChanges ?? []).map((c: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 text-sm"
              >
                <div>
                  <span className="font-mono text-xs">{c.flagKey}</span> —{" "}
                  {c.change}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.timestamp).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
