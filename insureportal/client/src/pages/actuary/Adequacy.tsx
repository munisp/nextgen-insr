/**
 * Adequacy.tsx — W34-D (2026-11-28) pricing-adequacy page: priced-vs-actual
 * loss-ratio trend per line (design Appendix E: "Adequacy (priced-vs-actual
 * LR trend)"). Data: trpc.actuary.adequacyMonitor over act_adequacy_alerts.
 * Honest empty state when the adequacy job has produced nothing yet.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import ActuaryFeatureGate from "./ActuaryFeatureGate";
import { ACTUARY_PRODUCT_LINES } from "./featureFlag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

function AdequacyBody() {
  const [line, setLine] = useState<string | undefined>(undefined);
  const monitor = trpc.actuary.adequacyMonitor.useQuery(
    line ? { line } : {}
  );

  // Trend points: one per alert row, ascending period (alerts arrive
  // newest-first from the procedure).
  const trend = useMemo(() => {
    const rows = [...(monitor.data?.alerts ?? [])].sort((a, b) =>
      a.period.localeCompare(b.period)
    );
    return rows.map(a => ({
      period: a.period,
      priced: a.pricedLossRatio * 100,
      actual: a.actualLossRatio * 100,
      severity: a.severity,
    }));
  }, [monitor.data]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Pricing Adequacy</h1>
          <p className="text-muted-foreground">
            Priced vs actual loss ratio — amber ±5 pts, red ±10 pts bands
            (design §4.f)
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant={line === undefined ? "default" : "outline"}
            size="sm"
            onClick={() => setLine(undefined)}
          >
            all lines
          </Button>
          {ACTUARY_PRODUCT_LINES.map(code => (
            <Button
              key={code}
              variant={line === code ? "default" : "outline"}
              size="sm"
              onClick={() => setLine(code)}
            >
              {code}
            </Button>
          ))}
        </div>

        {monitor.isError ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Adequacy data unavailable: {monitor.error?.message}. Fail-closed
              — no trend is fabricated.
            </CardContent>
          </Card>
        ) : trend.length === 0 && !monitor.isLoading ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No adequacy observations{line ? ` for ${line}` : ""} yet. The
              first monthly adequacy run has not emitted alerts — nothing is
              fabricated before real data exists.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Priced vs Actual Loss Ratio (%)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="priced"
                    name="Priced LR"
                    stroke="#64748b"
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Actual LR"
                    stroke="#dc2626"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function ActuaryAdequacy() {
  return (
    <ActuaryFeatureGate>
      <AdequacyBody />
    </ActuaryFeatureGate>
  );
}
