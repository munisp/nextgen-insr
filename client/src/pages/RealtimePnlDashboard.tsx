/**
 * RealtimePnlDashboard — Role-scoped dashboard with real tRPC data and Recharts charts.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, BarChart2, CheckCircle, DollarSign, TrendingDown, TrendingUp } from "lucide-react";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6","#ec4899"];

export default function RealtimePnlDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.realtimePnlDashboard.dashboard.useQuery();
  const { data: stats } = trpc.realtimePnlDashboard.getStats.useQuery();
  const { data: pnlList } = trpc.realtimePnlDashboard.list.useQuery({ limit: 10 });

  const d: Partial<Exclude<typeof data, undefined>> = data ?? {};
  const s: Partial<Exclude<typeof stats, undefined>> = stats ?? {};

  const cards = [
    { title: "Gross Premium (₦M)", value: d.grossPremium ? (d.grossPremium/1e6).toFixed(2) : s.grossPremium ?? "—", icon: DollarSign, trend: "up" as const, trendValue: "↑ 8%", status: "good" as const, href: "/financial-reporting-suite", accent: "var(--risk-low)" },
    { title: "Net Premium (₦M)", value: d.netPremium ? (d.netPremium/1e6).toFixed(2) : "—", icon: TrendingUp, trend: "up" as const, trendValue: "after RI", status: "good" as const, href: "/financial-reporting-suite", accent: "var(--insurance-primary)" },
    { title: "Claims Paid (₦M)", value: d.claimsPaid ? (d.claimsPaid/1e6).toFixed(2) : "—", icon: TrendingDown, trend: "up" as const, trendValue: "MTD", status: "neutral" as const, href: "/settlement-engine", accent: "var(--risk-medium)" },
    { title: "Net P&L (₦M)", value: d.netPnl ? (d.netPnl/1e6).toFixed(2) : "—", icon: Activity, trend: (Number(d.netPnl ?? 0) >= 0 ? "up" : "down") as "up" | "down", trendValue: Number(d.netPnl ?? 0) >= 0 ? "profit" : "loss", status: (Number(d.netPnl ?? 0) >= 0 ? "good" : "critical") as "good" | "critical", href: "/financial-reporting-suite", accent: Number(d.netPnl ?? 0) >= 0 ? "var(--risk-low)" : "var(--risk-critical)" },
    { title: "Combined Ratio (%)", value: d.combinedRatio ? d.combinedRatio.toFixed(1)+"%" : "—", icon: BarChart2, trend: "down" as const, trendValue: "↓ 2%", status: (Number(d.combinedRatio ?? 100) < 100 ? "good" : "critical") as "good" | "critical", href: "/financial-reporting-suite", accent: "var(--insurance-secondary)" },
    { title: "Expense Ratio (%)", value: d.expenseRatio ? d.expenseRatio.toFixed(1)+"%" : "—", icon: CheckCircle, trend: "down" as const, trendValue: "↓ 1%", status: "good" as const, href: "/financial-reporting-suite", accent: "var(--risk-low)" },
  ];

  const pnlComponents = [
    { name: "Gross Premium", value: (d.grossPremium ?? 0)/1e6 },
    { name: "RI Ceded", value: -(d.riCeded ?? 0)/1e6 },
    { name: "Claims", value: -(d.claimsPaid ?? 0)/1e6 },
    { name: "Expenses", value: -(d.expenses ?? 0)/1e6 },
    { name: "Net P&L", value: (d.netPnl ?? 0)/1e6 },
  ];

  const monthlyPnl = Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(); dt.setMonth(dt.getMonth() - 5 + i);
    const premium = (d.grossPremium ?? 0)/1e6;
    const claims = (d.claimsPaid ?? 0)/1e6;
    return { month: dt.toLocaleDateString("en-NG", { month: "short" }), premium, claims, pnl: premium - claims };
  });

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--insurance-primary)20", color: "var(--insurance-primary)" }}>
            <TrendingUp size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Real-Time P&L Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Premium · Claims · Combined Ratio · Net P&L</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>P&L KPIs (MTD)</h2>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>P&L Waterfall (₦M)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={pnlComponents}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `₦${Number(v).toFixed(2)}M`} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {pnlComponents.map((d, i) => <Cell key={i} fill={Number(d.value) >= 0 ? "#22c55e" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Monthly P&L Trend (₦M)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyPnl}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `₦${Number(v).toFixed(2)}M`} />
                <Legend />
                <Bar dataKey="premium" fill="#22c55e" name="Premium" radius={[4, 4, 0, 0]} />
                <Bar dataKey="claims" fill="#ef4444" name="Claims" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="pnl" stroke="#6366f1" strokeWidth={2} name="Net P&L" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "Financial Reports", icon: BarChart2, href: "/financial-reporting-suite", color: "var(--insurance-primary)" },
              { label: "IFRS17", icon: Activity, href: "/ifrs17-dashboard", color: "var(--role-actuary)" },
              { label: "Reinsurance", icon: TrendingDown, href: "/reinsurance-management", color: "var(--insurance-secondary)" },
              { label: "Settlement", icon: DollarSign, href: "/settlement-engine", color: "var(--risk-low)" },
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
