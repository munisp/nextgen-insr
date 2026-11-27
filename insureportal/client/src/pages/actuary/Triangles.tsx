/**
 * Triangles.tsx — W34-D (2026-11-28) reserve run viewer: interactive
 * line/method picker over actuary.reserveEstimate with per-origin ultimates
 * and a development-factor overlay when the run payload carries factors
 * (design Appendix E: "Triangles (interactive triangle viewer with
 * dev-factor overlay)").
 *
 * HONEST-SCOPE NOTE: full triangle snapshots (act_triangles persistence) are
 * the analytics pipeline's scope (W34-C); this page renders exactly what
 * act_reserve_runs rows carry — ultimateByOrigin (+ optional devFactors in
 * the payload). When a run has no factor payload the overlay shows an honest
 * "not persisted" note, never synthesized factors.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import ActuaryFeatureGate from "./ActuaryFeatureGate";
import { ACTUARY_PRODUCT_LINES } from "./featureFlag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type Method = "chainladder" | "bf" | "mack";

interface OriginUltimate {
  origin: string;
  ultimate: number;
  devFactors?: number[];
}

/** Accepts either an array of {origin, ultimate[, devFactors]} records or a
 *  plain {originPeriod: ultimate} object map — the two shapes the analytics
 *  pipeline writes into ultimateByOrigin. Anything else renders as raw JSON
 *  (honest pass-through). */
function parseUltimates(payload: unknown): OriginUltimate[] | null {
  if (Array.isArray(payload)) {
    const out: OriginUltimate[] = [];
    for (const row of payload) {
      if (
        row &&
        typeof row === "object" &&
        "origin" in row &&
        "ultimate" in row &&
        typeof (row as { ultimate: unknown }).ultimate === "number"
      ) {
        const r = row as { origin: string; ultimate: number; devFactors?: number[] };
        out.push({
          origin: String(r.origin),
          ultimate: r.ultimate,
          devFactors: Array.isArray(r.devFactors)
            ? r.devFactors.filter((d): d is number => typeof d === "number")
            : undefined,
        });
      }
    }
    return out.length === payload.length ? out : null;
  }
  if (payload && typeof payload === "object") {
    const out: OriginUltimate[] = [];
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof v !== "number") return null;
      out.push({ origin: k, ultimate: v });
    }
    return out;
  }
  return null;
}

function TrianglesBody() {
  const [line, setLine] = useState<string>("motor");
  const [method, setMethod] = useState<Method | undefined>(undefined);
  const run = trpc.actuary.reserveEstimate.useQuery({
    line,
    ...(method ? { method } : {}),
  });

  const ultimates = useMemo(
    () =>
      run.data?.found
        ? parseUltimates(run.data.ultimateByOrigin)
        : null,
    [run.data]
  );
  const hasDevOverlay = (ultimates ?? []).some(u => u.devFactors?.length);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Reserve Triangles</h1>
          <p className="text-muted-foreground">
            Chain-ladder / Bornhuetter–Ferguson / Mack reserve runs per line
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
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
        <div className="flex gap-2">
          {(["chainladder", "bf", "mack"] as const).map(m => (
            <Button
              key={m}
              variant={method === m ? "default" : "outline"}
              size="sm"
              onClick={() => setMethod(method === m ? undefined : m)}
            >
              {m}
            </Button>
          ))}
        </div>

        {run.isError ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Reserve data unavailable: {run.error?.message}. Fail-closed — no
              fabricated reserves are shown.
            </CardContent>
          </Card>
        ) : run.data && !run.data.found ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {run.data.reason === "unknown_product_line"
                ? `Line "${line}" is not registered in act_product_lines.`
                : `No reserve run exists yet for ${line}${method ? ` (method ${method})` : ""} — runs are produced by the monthly analytics batch (W34-C). Nothing is fabricated.`}
            </CardContent>
          </Card>
        ) : run.data?.found ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    IBNR
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    ₦{run.data.ibnr.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Method / Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex gap-2 items-center">
                  <Badge>{run.data.method}</Badge>
                  <Badge variant="outline">{run.data.status}</Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">#{run.data.runId}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Ultimates by Origin</CardTitle>
              </CardHeader>
              <CardContent>
                {ultimates ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={ultimates}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="origin" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="ultimate" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <pre className="text-xs overflow-auto max-h-64 bg-muted p-3 rounded">
                    {JSON.stringify(run.data.ultimateByOrigin, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Development-Factor Overlay</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {hasDevOverlay ? (
                  <div className="overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left">Origin</th>
                          {Array.from({
                            length: Math.max(
                              ...(ultimates ?? []).map(
                                u => u.devFactors?.length ?? 0
                              )
                            ),
                          }).map((_, i) => (
                            <th key={i} className="text-left">
                              Dev {i}→{i + 1}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(ultimates ?? []).map(u => (
                          <tr key={u.origin} className="border-t">
                            <td>{u.origin}</td>
                            {(u.devFactors ?? []).map((d, i) => (
                              <td key={i}>{d.toFixed(4)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    This run&apos;s payload does not carry development factors
                    (triangle snapshot persistence is the analytics pipeline
                    scope, W34-C). No factors are synthesized.
                  </p>
                )}
              </CardContent>
            </Card>

            {run.data.mackSe != null && (
              <Card>
                <CardHeader>
                  <CardTitle>Mack Standard Errors</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs overflow-auto max-h-64 bg-muted p-3 rounded">
                    {JSON.stringify(run.data.mackSe, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Loading…
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function ActuaryTriangles() {
  return (
    <ActuaryFeatureGate>
      <TrianglesBody />
    </ActuaryFeatureGate>
  );
}
