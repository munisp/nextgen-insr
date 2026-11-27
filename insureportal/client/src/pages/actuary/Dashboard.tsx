/**
 * Dashboard.tsx — W34-D (2026-11-28) actuary engine dashboard: per-line
 * loss-ratio tiles + the adequacy alert feed (design Appendix E: "Dashboard
 * (per-line LR tiles, alert feed)").
 *
 * Data: trpc.actuary.adequacyMonitor (act_adequacy_alerts — emitted by the
 * monthly adequacy job, design §4.f). Honest empty state when no alerts
 * exist; no fabricated tiles.
 */
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import ActuaryFeatureGate from "./ActuaryFeatureGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Activity, ShieldCheck } from "lucide-react";

function lrLabel(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function DashboardBody() {
  const adequacy = trpc.actuary.adequacyMonitor.useQuery({});

  // Latest alert per line → per-line LR tiles.
  const latestByLine = new Map<
    string,
    { actualLR: number; pricedLR: number; severity: string; period: string }
  >();
  for (const a of adequacy.data?.alerts ?? []) {
    const code = a.lineCode ?? `#${a.productLineId}`;
    if (!latestByLine.has(code)) {
      latestByLine.set(code, {
        actualLR: a.actualLossRatio,
        pricedLR: a.pricedLossRatio,
        severity: a.severity,
        period: a.period,
      });
    }
  }
  const tiles = [...latestByLine.entries()];
  const alerts = adequacy.data?.alerts ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Actuary Engine</h1>
          <p className="text-muted-foreground">
            Pricing adequacy and de-risking monitor across registered product
            lines
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Activity className="h-4 w-4" /> Open Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {alerts.filter(a => !a.acknowledgedAt).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> Red Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">
                {alerts.filter(a => a.severity === "red").length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-4 w-4" /> Lines Monitored
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{tiles.length}</p>
            </CardContent>
          </Card>
        </div>

        {adequacy.isError ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Adequacy data unavailable:{" "}
              {adequacy.error?.message ?? "service error"}. The monitor is
              fail-closed — no fallback figures are displayed.
            </CardContent>
          </Card>
        ) : tiles.length === 0 && !adequacy.isLoading ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No adequacy alerts yet. Alerts appear after the first monthly
              adequacy run emits actuary.adequacy.v1 events (design §4.f) —
              nothing is fabricated before real data exists.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tiles.map(([code, t]) => (
                <Card key={code}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold">{code}</h3>
                      <Badge
                        variant={t.severity === "red" ? "destructive" : "outline"}
                      >
                        {t.severity}
                      </Badge>
                    </div>
                    <p className="text-2xl font-bold">{lrLabel(t.actualLR)}</p>
                    <p className="text-xs text-muted-foreground">
                      priced {lrLabel(t.pricedLR)} · {t.period}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Alert Feed</CardTitle>
              </CardHeader>
              <CardContent>
                {alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No alerts in the feed.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {alerts.map(a => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between border-b pb-1"
                      >
                        <span>
                          {a.lineCode ?? `#${a.productLineId}`} · {a.period} —
                          actual {lrLabel(a.actualLossRatio)} vs priced{" "}
                          {lrLabel(a.pricedLossRatio)}
                        </span>
                        <span className="flex items-center gap-2">
                          {a.acknowledgedAt && (
                            <span className="text-xs text-muted-foreground">
                              acknowledged
                            </span>
                          )}
                          <Badge
                            variant={
                              a.severity === "red" ? "destructive" : "outline"
                            }
                          >
                            {a.severity}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function ActuaryDashboard() {
  return (
    <ActuaryFeatureGate>
      <DashboardBody />
    </ActuaryFeatureGate>
  );
}
