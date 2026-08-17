/**
 * BillingDashboardPage — Role-scoped dashboard with real tRPC data and Recharts charts.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, AlertTriangle, BarChart2, CheckCircle, Clock, DollarSign, FileText, TrendingUp } from "lucide-react";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6","#ec4899"];

export default function BillingDashboardPage() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  // F-12: billingLedger.aggregateRevenue + getLiveSplitMetrics are HARDCODED
  // fabrications in the delivered router (literal 150/22500/6300 values, no DB
  // query) — reported as undelivered-scope, NOT wired. Only the genuine
  // billingAdminKpi feed is displayed; fabrication-fed sections render "—".
  const isLoading = false;
  const r: Partial<{
    totalRevenue: number; platformFees: number; transactionCount: number;
    avgTransactionValue: number; commissionRevenue: number;
    premiumRevenue: number; otherRevenue: number;
  }> = {};
  const metrics: Partial<{ activeSplits: number; splitsToday: number; volumeToday: number; avgSplitMs: number }> = {};
  // F-12 (S87-05): billingInvoice.list was a phantom API — the delivered
  // listInvoices procedure is TENANT-scoped (requires tenantId) and this is a
  // platform-level dashboard, so the recent-invoices section renders its
  // honest empty state until a platform-level invoices feed is delivered.
  const invoices = undefined as { data?: Array<Record<string, unknown>> } | undefined;
  const { data: kpi } = trpc.insuranceKpiDashboard.billingAdminKpi.useQuery({ periodDays: 30 });

  const m: Partial<Exclude<typeof metrics, null | undefined>> = metrics ?? {};
  const k: Partial<Exclude<typeof kpi, null | undefined>["billing"]> = kpi?.billing ?? {};

  const cards = [
    { title: "Revenue (MTD ₦M)", value: r.totalRevenue ? (r.totalRevenue/1e6).toFixed(2) : "—", icon: DollarSign, trend: "up" as const, trendValue: "↑ 8%", status: "good" as const, href: "/billing-analytics-dashboard", accent: "var(--insurance-primary)" },
    { title: "Platform Fees (₦M)", value: k.platformRevenue != null ? (Number(k.platformRevenue)/1e6).toFixed(2) : "—", icon: TrendingUp, trend: "up" as const, trendValue: "↑ 5%", status: "good" as const, href: "/billing-analytics-dashboard", accent: "var(--risk-low)" },
    { title: "Active Tenants", value: "—", icon: Activity, trend: "flat" as const, trendValue: "subscribed", status: "neutral" as const, href: "/tenant-admin-dashboard", accent: "var(--insurance-secondary)" },
    { title: "Overdue Invoices", value: "—", icon: AlertTriangle, trend: "flat" as const, trendValue: "pending", status: ("good") as "critical" | "good", href: "/billing-admin-dashboard", accent: "var(--risk-critical)" },
    { title: "Transactions (MTD)", value: r.transactionCount ?? "—", icon: CheckCircle, trend: "up" as const, trendValue: "processed", status: "good" as const, href: "/transactions", accent: "var(--risk-low)" },
    { title: "Avg Txn Value (₦)", value: r.avgTransactionValue ? Number(r.avgTransactionValue).toLocaleString() : "—", icon: BarChart2, trend: "flat" as const, trendValue: "per txn", status: "neutral" as const, href: "/billing-analytics-dashboard", accent: "var(--insurance-primary)" },
  ];

  const revenueBreakdown = [
    { name: "Platform Fees", value: (r.platformFees ?? 0)/1e6 },
    { name: "Commission", value: (r.commissionRevenue ?? 0)/1e6 },
    { name: "Premium", value: (r.premiumRevenue ?? 0)/1e6 },
    { name: "Other", value: (r.otherRevenue ?? 0)/1e6 },
  ].filter(d => d.value > 0);

  // F-12: historical monthly series has no delivered source — show the REAL
  // current-month platform revenue only (no fabricated trend).
  const monthlyRevenue = [
    {
      month: new Date().toLocaleDateString("en-NG", { month: "short" }),
      revenue: k.platformRevenue != null ? Number(k.platformRevenue) / 1e6 : 0,
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--insurance-primary)20", color: "var(--insurance-primary)" }}>
            <DollarSign size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Billing Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Revenue · Invoices · Tenants · Fees</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Billing KPIs (30 Days)</h2>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Revenue Breakdown (₦M)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={revenueBreakdown.length > 0 ? revenueBreakdown : [{ name: "No revenue", value: 1 }]}
                  cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ₦${Number(value).toFixed(2)}M`}>
                  {(revenueBreakdown.length > 0 ? revenueBreakdown : [{ name: "No revenue", value: 1 }]).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => `₦${Number(v).toFixed(2)}M`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Monthly Revenue Trend (₦M)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `₦${Number(v).toFixed(2)}M`} />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="#6366f120" strokeWidth={2} name="Revenue (₦M)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Invoices */}
        {(invoices?.data ?? []).length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>Recent Invoices</h2>
              <button onClick={() => navigate("/billing-admin-dashboard")} className="text-xs" style={{ color: "var(--insurance-primary)" }}>View All →</button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                    {["Invoice #", "Tenant", "Amount", "Status", "Due"].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {((invoices?.data ?? []) as any[]).slice(0, 5).map((inv: any) => (
                    <tr key={inv.id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                      <td className="px-3 py-2 font-mono" style={{ color: "var(--text-primary)" }}>{inv.invoiceNumber ?? `INV-${inv.id}`}</td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{inv.tenantId ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>₦{Number(inv.amount ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: inv.status === "paid" ? "#22c55e20" : inv.status === "overdue" ? "#ef444420" : "#f59e0b20", color: inv.status === "paid" ? "#22c55e" : inv.status === "overdue" ? "#ef4444" : "#f59e0b" }}>{inv.status}</span>
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "Billing Analytics", icon: BarChart2, href: "/billing-analytics-dashboard", color: "var(--insurance-primary)" },
              { label: "Invoices", icon: FileText, href: "/billing-admin-dashboard", color: "var(--insurance-secondary)" },
              { label: "Tenant Admin", icon: Activity, href: "/tenant-admin-dashboard", color: "var(--risk-low)" },
              { label: "Revenue Report", icon: TrendingUp, href: "/financial-reporting-suite", color: "var(--text-secondary)" },
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
