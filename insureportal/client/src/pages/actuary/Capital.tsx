/**
 * Capital.tsx — W34-D (2026-11-28) capital page: NAICOM RBC approximation
 * gauge + internal economic-capital waterfall (design Appendix E: "Capital
 * (RBC gauge + EC waterfall)"). Data: trpc.actuary.capitalReport over
 * act_capital_runs. Honest found:false empty state; no synthetic figures.
 */
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import ActuaryFeatureGate from "./ActuaryFeatureGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function fmtN(v: number | null): string {
  return v == null ? "—" : `₦${v.toLocaleString()}`;
}

interface EcLine {
  line: string;
  tvar99: number;
}

function parsePerLine(payload: unknown): EcLine[] {
  if (!Array.isArray(payload)) return [];
  const out: EcLine[] = [];
  for (const row of payload) {
    if (
      row &&
      typeof row === "object" &&
      "line" in row &&
      typeof (row as { tvar99?: unknown }).tvar99 === "number"
    ) {
      out.push({
        line: String((row as { line: unknown }).line),
        tvar99: (row as { tvar99: number }).tvar99,
      });
    }
  }
  return out;
}

/** SVG semicircle gauge for the solvency ratio; needle position = ratio
 *  clamped to [0, 2] (100% = 1.0). Colour: red < 1.0, amber < 1.5, green ≥
 *  1.5 — these are DISPLAY thresholds only; the underlying figures come
 *  straight from the approved capital run. */
function RbcGauge({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(2, ratio));
  const angle = Math.PI * (1 - clamped / 2); // π (left, 0) → 0 (right, 2)
  const r = 80;
  const cx = 100;
  const cy = 90;
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);
  const color = ratio < 1 ? "#dc2626" : ratio < 1.5 ? "#d97706" : "#16a34a";
  return (
    <svg viewBox="0 0 200 100" className="w-full max-w-xs">
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="12"
      />
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="14" fill={color}>
        {ratio.toFixed(2)}×
      </text>
      <text x={cx - r} y={cy + 14} fontSize="9" fill="#64748b">
        0
      </text>
      <text x={cx + r} y={cy + 14} fontSize="9" fill="#64748b" textAnchor="end">
        2.0
      </text>
    </svg>
  );
}

function CapitalBody() {
  const report = trpc.actuary.capitalReport.useQuery({});
  const found = report.data?.found ? report.data : null;
  const ecLines = found?.ec ? parsePerLine(found.ec.perLine) : [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Capital</h1>
          <p className="text-muted-foreground">
            NAICOM RBC approximation + internal economic capital (VaR/TVaR)
            from the latest capital run
          </p>
        </div>

        {report.isError ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Capital report unavailable: {report.error?.message}. Fail-closed
              — no solvency figures are fabricated.
            </CardContent>
          </Card>
        ) : report.data && !report.data.found ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No capital run has been persisted yet (quarterly batch, design
              §4.d). Nothing is fabricated.
            </CardContent>
          </Card>
        ) : found ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    NAICOM RBC (approximation)
                    {found.naicomRbc && (
                      <Badge variant="outline">{found.naicomRbc.status}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {found.naicomRbc && found.naicomRbc.ratio != null ? (
                    <>
                      <RbcGauge ratio={found.naicomRbc.ratio} />
                      <div className="text-sm space-y-1 mt-2">
                        <p>Required: {fmtN(found.naicomRbc.required)}</p>
                        <p>Available: {fmtN(found.naicomRbc.available)}</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      The latest run carries no RBC view (model: internal EC
                      only).
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Economic Capital
                    {found.ec && (
                      <Badge variant="outline">{found.ec.status}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p>VaR 99.5%: {fmtN(found.ec?.var995 ?? null)}</p>
                  <p>TVaR 99%: {fmtN(found.ec?.tvar99 ?? null)}</p>
                  <p className="text-muted-foreground">
                    As of{" "}
                    {found.asOf
                      ? new Date(found.asOf).toISOString().slice(0, 10)
                      : "—"}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>EC Waterfall — per-line TVaR contribution</CardTitle>
              </CardHeader>
              <CardContent>
                {ecLines.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={ecLines}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="line" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="tvar99" fill="#7c3aed" name="TVaR 99%" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The latest EC run carries no per-line contribution
                    breakdown — the waterfall renders only when the run
                    payload includes it.
                  </p>
                )}
              </CardContent>
            </Card>
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

export default function ActuaryCapital() {
  return (
    <ActuaryFeatureGate>
      <CapitalBody />
    </ActuaryFeatureGate>
  );
}
