/**
 * LakehouseAiDashboard — Role-scoped dashboard with real tRPC data and Recharts charts.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard, type KpiTrend, type KpiStatus } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, BarChart2, CheckCircle, Database, FileText, Shield, TrendingUp, Zap } from "lucide-react";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6","#ec4899"];

export default function LakehouseAiDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data: analytics, isLoading } = trpc.lakehouseAi.analytics.useQuery();
  const { data: models } = trpc.lakehouseAi.listModels.useQuery();
  const { data: datasets } = trpc.lakehouseAi.listDatasets.useQuery();
  const { data: jobs } = trpc.lakehouseAi.listBatchJobs.useQuery();
  const { data: health } = trpc.lakehouseAi.health.useQuery();
  const { data: lineage } = trpc.lakehouseAi.dataLineage.useQuery();

  const a: Partial<Exclude<typeof analytics, undefined>> = analytics ?? {};
  const cards: Array<{
    title: string; value: string | number; icon: React.ElementType;
    trend?: KpiTrend; trendValue?: string; subtitle?: string;
    status?: KpiStatus; href?: string; accent: string;
  }> = [
    { title: "Total AI Queries", value: a.totalQueries ?? "—", icon: Zap, trend: "up" as const, trendValue: "↑ 8%", status: "good" as const, href: "/lakehouse-ai-dashboard", accent: "var(--insurance-primary)" },
    { title: "Avg Latency (ms)", value: a.avgLatencyMs ?? "—", icon: Activity, trend: "down" as const, trendValue: "↓ 5ms", status: "good" as const, href: "/lakehouse-ai-dashboard", accent: "var(--risk-low)" },
    { title: "Storage Used (GB)", value: a.storageUsedGb ? Number(a.storageUsedGb).toFixed(2) : "—", icon: Database, trend: "up" as const, trendValue: "growing", status: "neutral" as const, href: "/lakehouse-ai-dashboard", accent: "var(--insurance-secondary)" },
    { title: "Tables / Datasets", value: a.tablesCount ?? (datasets?.total ?? "—"), icon: FileText, trend: "flat" as const, trendValue: "medallion", status: "neutral" as const, href: "/lakehouse-ai-dashboard", accent: "var(--insurance-primary)" },
    { title: "ML Models", value: models?.total ?? "—", icon: BarChart2, trend: "flat" as const, trendValue: "deployed", status: "good" as const, href: "/ml-scoring-dashboard", accent: "var(--role-actuary)" },
    { title: "Lakehouse Status", value: health?.status ?? "—", icon: CheckCircle, trend: "flat" as const, trendValue: health?.latencyMs ? `${health.latencyMs}ms` : "—", status: health?.status === "healthy" ? "good" : "warning" as const, href: "/lakehouse-ai-dashboard", accent: "var(--risk-low)" },
  ];

  const modelAccuracy = (models?.models ?? []).map((m: any) => ({
    name: m.name?.split(" ")[0] ?? "Model",
    accuracy: Number((m.accuracy ?? 0) * 100).toFixed(1),
    status: m.status,
  }));

  const datasetSizes = (datasets?.datasets ?? []).map((d: any) => ({
    name: d.name?.split(".")[1] ?? d.name,
    rows: Number(d.rows ?? 0),
    sizeGb: Number(d.sizeGb ?? 0),
  }));

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--insurance-secondary)20", color: "var(--insurance-secondary)" }}>
            <Database size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Lakehouse AI Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Delta Lake · Models · Lineage · Batch Jobs</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Platform KPIs</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-3"}`}>
            {cards.map((c) => (
              <KpiCard key={c.title} title={c.title} value={c.value} icon={c.icon}
                trend={c.trend} trendValue={c.trendValue} status={c.status}
                accentColor={c.accent} loading={isLoading} onClick={() => c.href && navigate(c.href)} />
            ))}
          </div>
        </section>

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Model Accuracy (%)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={modelAccuracy.length > 0 ? modelAccuracy : [{ name: "No models", accuracy: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--text-secondary)" }} />
                <YAxis domain={[80, 100]} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Bar dataKey="accuracy" name="Accuracy %" radius={[4, 4, 0, 0]}>
                  {modelAccuracy.map((m: any, i: number) => <Cell key={i} fill={Number(m.accuracy) >= 90 ? "#22c55e" : "#f59e0b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Dataset Sizes (GB)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={datasetSizes.length > 0 ? datasetSizes : [{ name: "No datasets", sizeGb: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(3)} GB`} />
                <Bar dataKey="sizeGb" fill="#6366f1" radius={[4, 4, 0, 0]} name="Size (GB)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Batch Jobs */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Batch Jobs</h2>
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            {(jobs?.jobs ?? []).length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    {["Job", "Status", "Progress", "Started"].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {((jobs?.jobs ?? []) as any[]).map((j: any) => (
                    <tr key={j.id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-3 py-2 font-medium" style={{ color: "var(--text-primary)" }}>{j.name}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: j.status === "completed" ? "#22c55e20" : "#6366f120", color: j.status === "completed" ? "#22c55e" : "#6366f1" }}>{j.status}</span>
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{j.progress}%</td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{j.startedAt ? new Date(j.startedAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No batch jobs running</div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "ML Scoring", icon: BarChart2, href: "/ml-scoring-dashboard", color: "var(--insurance-primary)" },
              { label: "AI Monitoring", icon: Activity, href: "/ai-monitoring-dashboard", color: "var(--insurance-secondary)" },
              { label: "Analytics", icon: TrendingUp, href: "/analytics-dashboard", color: "var(--risk-low)" },
              { label: "Data Lineage", icon: Shield, href: "/lakehouse-ai-dashboard", color: "var(--text-secondary)" },
            ].map((a) => (
              <button key={a.label} onClick={() => navigate(a.href)}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
                style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                <a.icon size={22} style={{ color: a.color }} />
                <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>{a.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
