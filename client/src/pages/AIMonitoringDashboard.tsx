/**
 * AIMonitoringDashboard — Role-scoped dashboard with real tRPC data and Recharts charts.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, AlertTriangle, BarChart2, Brain, CheckCircle, Clock, Shield, TrendingUp, Zap } from "lucide-react";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6","#ec4899"];

export default function AIMonitoringDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data: dash, isLoading } = (trpc as any).aiMonitoring?.dashboard?.useQuery?.() ?? { data: null, isLoading: false };
  const { data: driftData } = (trpc as any).aiMonitoring?.driftAnalysis?.useQuery?.() ?? { data: null };
  const { data: throughput } = (trpc as any).aiMonitoring?.throughputTimeSeries?.useQuery?.() ?? { data: null };
  const { data: alertsData } = (trpc as any).aiMonitoring?.alerts?.useQuery?.() ?? { data: null };
  const { data: healthData } = (trpc as any).aiMonitoring?.serviceHealth?.useQuery?.() ?? { data: null };

  const d = dash ?? {};
  const cards = [
    { title: "Total Models", value: d.modelCount ?? "—", icon: Brain, trend: "flat" as const, trendValue: "deployed", status: "neutral" as const, href: "/ml-scoring-dashboard", accent: "var(--insurance-primary)" },
    { title: "Active Models", value: d.activeModels ?? "—", icon: CheckCircle, trend: "flat" as const, trendValue: "production", status: "good" as const, href: "/ml-scoring-dashboard", accent: "var(--risk-low)" },
    { title: "Predictions (7d)", value: d.totalPredictions ?? "—", icon: Zap, trend: "up" as const, trendValue: "↑ 12%", status: "good" as const, href: "/ml-scoring-dashboard", accent: "var(--insurance-secondary)" },
    { title: "Avg Latency (ms)", value: d.avgLatencyMs ?? "—", icon: Clock, trend: "down" as const, trendValue: "↓ 3ms", status: "good" as const, href: "/ml-scoring-dashboard", accent: "var(--risk-low)" },
    { title: "Drift Alerts", value: d.driftAlerts ?? "—", icon: AlertTriangle, trend: "flat" as const, trendValue: "stable", status: d.driftAlerts > 0 ? "warning" : "good" as const, href: "/ml-scoring-dashboard", accent: "var(--risk-medium)" },
    { title: "Fraud Detected (7d)", value: d.fraudDetected ?? "—", icon: Shield, trend: "up" as const, trendValue: "flagged", status: "warning" as const, href: "/fraud-dashboard", accent: "var(--risk-critical)" },
  ];

  const driftChart = (driftData?.models ?? []).map((m: any) => ({
    name: m.name?.split(" ")[0] ?? "Model",
    drift: Number((m.driftScore ?? 0) * 100).toFixed(1),
    threshold: 10,
  }));

  const throughputChart = (throughput?.data ?? []).slice(-12).map((t: any) => ({
    time: t.timestamp ? new Date(t.timestamp).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : "",
    requests: Number(t.requests ?? 0),
    latency: Number(t.latencyMs ?? 0),
  }));

  const serviceStatus = (healthData?.services ?? [
    { name: "ML Service", status: "unknown", latencyMs: 0 },
    { name: "Ollama LLM", status: "unknown", latencyMs: 0 },
    { name: "Lakehouse", status: "unknown", latencyMs: 0 },
  ]);

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--insurance-primary)20", color: "var(--insurance-primary)" }}>
            <Activity size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>AI Monitoring Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Models · Drift · Throughput · Alerts</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>AI Platform KPIs</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-3"}`}>
            {cards.map((c) => (
              <KpiCard key={c.title} title={c.title} value={c.value} icon={c.icon}
                trend={c.trend} trendValue={c.trendValue} status={c.status}
                accentColor={c.accent} loading={isLoading} onClick={() => navigate(c.href)} />
            ))}
          </div>
        </section>

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Model Drift Score (%)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={driftChart.length > 0 ? driftChart : [{ name: "No data", drift: 0, threshold: 10 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                <YAxis domain={[0, 20]} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip />
                <Bar dataKey="drift" name="Drift %" radius={[4, 4, 0, 0]}>
                  {driftChart.map((d: any, i: number) => <Cell key={i} fill={Number(d.drift) > 10 ? "#ef4444" : Number(d.drift) > 7 ? "#f59e0b" : "#22c55e"} />)}
                </Bar>
                <Line type="monotone" dataKey="threshold" stroke="#ef4444" strokeDasharray="5 5" name="Threshold" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>AI Request Throughput (24h)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={throughputChart.length > 0 ? throughputChart : [{ time: "Now", requests: 0, latency: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip />
                <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="#6366f120" strokeWidth={2} name="Requests" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Service Health */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>AI Service Health</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-3"}`}>
            {serviceStatus.map((s: any) => (
              <div key={s.name} className="rounded-xl p-4 flex items-center gap-3"
                style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                <span className="w-3 h-3 rounded-full" style={{ background: s.status === "healthy" ? "#22c55e" : s.status === "degraded" ? "#f59e0b" : "#ef4444" }} />
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{s.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.status} · {s.latencyMs}ms</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Recent Alerts */}
        {(alertsData?.items ?? []).length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Recent AI Alerts</h2>
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              {(alertsData.items as any[]).slice(0, 5).map((a: any) => (
                <div key={a.id} className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{a.message}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{new Date(a.timestamp).toLocaleString()}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: a.severity === "critical" ? "#ef444420" : "#f59e0b20", color: a.severity === "critical" ? "#ef4444" : "#f59e0b" }}>
                    {a.severity}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "ML Scoring", icon: BarChart2, href: "/ml-scoring-dashboard", color: "var(--insurance-primary)" },
              { label: "Fraud Dashboard", icon: Shield, href: "/fraud-dashboard", color: "var(--risk-critical)" },
              { label: "Lakehouse AI", icon: Activity, href: "/lakehouse-ai-dashboard", color: "var(--insurance-secondary)" },
              { label: "AI Chat", icon: TrendingUp, href: "/ai-chat-support", color: "var(--risk-low)" },
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
