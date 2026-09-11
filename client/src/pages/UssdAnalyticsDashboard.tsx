/**
 * UssdAnalyticsDashboard — B12 (wave-2c): wired to the REAL ussdAnalytics
 * procedures. Every number comes from ussd_session_events rows captured at
 * ussdGateway.processInput. When no sessions have been recorded the backend
 * fails loud (NO_SESSIONS_YET) and this page shows that honest empty state —
 * no Math.random trends, no painted zeros. Metrics the telemetry does not
 * capture (e.g. failure counts) are shown as "—", never invented.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { Activity, BarChart2, DollarSign, Users, CheckCircle, AlertTriangle } from "lucide-react";

export default function UssdAnalyticsDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const dashboard = trpc.ussdAnalytics.getDashboard.useQuery(
    { days: 7 },
    { retry: false }
  );
  const heatmap = trpc.ussdAnalytics.getMenuHeatmap.useQuery(undefined, {
    retry: false,
  });
  const kpi = dashboard.data;
  const noSessions =
    dashboard.error?.message?.includes("NO_SESSIONS_YET") ?? false;

  const cards = [
    { title: "USSD Sessions Today", value: kpi ? kpi.sessionsToday : "—", icon: Activity, trend: "up" as const, trendValue: "", status: "good" as const, href: "/ussd-analytics", accent: "var(--insurance-primary)" },
    { title: "Completion Rate (7d)", value: kpi && kpi.completionRate != null ? kpi.completionRate + "%" : "—", icon: CheckCircle, trend: "up" as const, trendValue: "", status: "good" as const, href: "/ussd-analytics", accent: "var(--risk-low)" },
    { title: "Events (7d)", value: kpi ? kpi.eventsInWindow : "—", icon: DollarSign, trend: "up" as const, trendValue: "", status: "good" as const, href: "/ussd-analytics", accent: "var(--risk-low)" },
    { title: "Avg Session (s)", value: kpi && kpi.avgSessionDurationSeconds != null ? kpi.avgSessionDurationSeconds : "—", icon: AlertTriangle, trend: "down" as const, trendValue: "", status: "warning" as const, href: "/ussd-analytics", accent: "var(--risk-medium)" },
  ];

  // Real per-day trend from the backend; no synthetic jitter.
  const sessionTrend = (kpi?.dailyTrend ?? []).map(d => ({
    day: new Date(d.day + "T00:00:00Z").toLocaleDateString("en-NG", { weekday: "short" }),
    sessions: d.sessions,
  }));

  const menuBars = (heatmap.data?.menuPaths ?? []).slice(0, 10);

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--insurance-primary)20", color: "var(--insurance-primary)" }}>
            <Activity size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>USSD Analytics Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Sessions · Conversions · Menu Paths</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        {(noSessions || (dashboard.isError && !noSessions)) && (
          <div className="rounded-xl p-4 text-sm" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-secondary)" }}>
            {noSessions
              ? "No USSD sessions recorded yet — analytics appear once real sessions flow through the USSD gateway."
              : `USSD analytics unavailable: ${dashboard.error?.message ?? "unknown error"}`}
          </div>
        )}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Key Metrics</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {cards.map((c) => (
              <KpiCard key={c.title} title={c.title} value={c.value} icon={c.icon}
                trend={c.trend} trendValue={c.trendValue} status={c.status}
                accentColor={c.accent} loading={dashboard.isLoading} onClick={() => navigate(c.href)} />
            ))}
          </div>
        </section>
        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>USSD Session Trend (7 Days)</h3>
            {sessionTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={sessionTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                  <XAxis dataKey="day" tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                  <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}} allowDecimals={false}/>
                  <Tooltip/>
                  <Area type="monotone" dataKey="sessions" stroke="#6366f1" fill="#6366f120" strokeWidth={2} name="Sessions"/>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs py-10 text-center" style={{ color: "var(--text-secondary)" }}>
                {dashboard.isLoading ? "Loading…" : "No session trend data yet."}
              </p>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Menu Path Heatmap</h3>
            {menuBars.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={menuBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                  <XAxis dataKey="menuPath" tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                  <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}} allowDecimals={false}/>
                  <Tooltip/>
                  <Bar dataKey="hits" fill="#8b5cf6" name="Hits"/>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs py-10 text-center" style={{ color: "var(--text-secondary)" }}>
                {heatmap.isLoading ? "Loading…" : "No menu-path data yet."}
              </p>
            )}
          </div>
        </div>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            <button key="USSD Analytics" onClick={() => navigate("/ussd-analytics")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Activity size={22} style={{ color: "var(--insurance-primary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>USSD Analytics</span>
            </button>
            <button key="Transactions" onClick={() => navigate("/transactions")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <DollarSign size={22} style={{ color: "var(--risk-low)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Transactions</span>
            </button>
            <button key="Agent Management" onClick={() => navigate("/agent-management")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Users size={22} style={{ color: "var(--insurance-secondary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Agent Management</span>
            </button>
            <button key="Reports" onClick={() => navigate("/financial-reporting-suite")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <BarChart2 size={22} style={{ color: "var(--text-secondary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Reports</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
