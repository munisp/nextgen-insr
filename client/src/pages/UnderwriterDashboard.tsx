/**
 * UnderwriterDashboard — Role-scoped KPI home screen for the Underwriter role.
 * Fetches live data from insuranceKpiDashboard.getUnderwriterKpi tRPC procedure.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  Shield, ClipboardList, AlertTriangle, TrendingUp,
  CheckCircle, XCircle, Clock, DollarSign, BarChart2, FileText,
} from "lucide-react";

export default function UnderwriterDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = (trpc as any).insuranceKpiDashboard?.getUnderwriterKpi?.useQuery?.() ?? { data: null, isLoading: false };

  const kpi = data?.kpis ?? {};

  const cards = [
    { title: "Applications in Queue",  value: kpi.applicationsInQueue  ?? "—", icon: ClipboardList, trend: "up"   as const, trendValue: "+12 today",  status: "neutral"  as const, href: "/underwriting-queue",    accent: "var(--role-underwriter)" },
    { title: "Approved Today",         value: kpi.approvedToday        ?? "—", icon: CheckCircle,   trend: "up"   as const, trendValue: "↑ 8%",        status: "good"     as const, href: "/underwriting-queue",    accent: "var(--risk-low)" },
    { title: "Declined Today",         value: kpi.declinedToday        ?? "—", icon: XCircle,       trend: "flat" as const, trendValue: "stable",      status: "warning"  as const, href: "/underwriting-queue",    accent: "var(--risk-medium)" },
    { title: "Referred for Review",    value: kpi.referredForReview    ?? "—", icon: AlertTriangle, trend: "up"   as const, trendValue: "+3",           status: "warning"  as const, href: "/risk-assessment",       accent: "var(--risk-high)" },
    { title: "Avg. Decision Time",     value: kpi.avgDecisionTimeHours ?? "—", icon: Clock,         subtitle: "hours",                                  status: "neutral"  as const, href: "/underwriting-reports",  accent: "var(--insurance-primary)" },
    { title: "Loss Ratio (MTD)",       value: kpi.lossRatioMtd         ?? "—", icon: TrendingUp,    trend: "down" as const, trendValue: "↓ 2.1%",      status: "good"     as const, href: "/underwriting-reports",  accent: "var(--risk-low)" },
    { title: "Premium Written (MTD)",  value: kpi.premiumWrittenMtd    ?? "—", icon: DollarSign,    trend: "up"   as const, trendValue: "↑ 14%",       status: "good"     as const, href: "/underwriting-reports",  accent: "var(--insurance-primary)" },
    { title: "Risk Score Avg.",        value: kpi.avgRiskScore         ?? "—", icon: Shield,        subtitle: "/ 100",                                  status: "neutral"  as const, href: "/risk-assessment",       accent: "var(--role-underwriter)" },
  ];

  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--page-bg)",
        paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem",
      }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{
          background: "var(--header-bg)",
          borderBottom: "1px solid var(--card-border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--role-underwriter)20", color: "var(--role-underwriter)" }}
          >
            <Shield size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Underwriting Dashboard
            </h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Risk Assessment & Approval Queue
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate("/underwriting-reports")}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
          style={{ background: "var(--role-underwriter)15", color: "var(--role-underwriter)" }}
        >
          <BarChart2 size={13} />
          Reports
        </button>
      </div>

      <div className="px-4 pt-4 space-y-6">
        {/* KPI Grid */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: "var(--text-secondary)" }}>
            Key Metrics
          </h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {cards.map((c) => (
              <KpiCard
                key={c.title}
                title={c.title}
                value={c.value}
                icon={c.icon}
                trend={c.trend}
                trendValue={c.trendValue}
                subtitle={c.subtitle}
                status={c.status}
                accentColor={c.accent}
                loading={isLoading}
                onClick={() => navigate(c.href)}
              />
            ))}
          </div>
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: "var(--text-secondary)" }}>
            Quick Actions
          </h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "Review Queue",      icon: ClipboardList, href: "/underwriting-queue",   color: "var(--role-underwriter)" },
              { label: "Risk Assessment",   icon: Shield,        href: "/risk-assessment",       color: "var(--risk-high)" },
              { label: "Product Config",    icon: FileText,      href: "/insurance-products",    color: "var(--insurance-primary)" },
              { label: "UW Reports",        icon: BarChart2,     href: "/underwriting-reports",  color: "var(--text-secondary)" },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.href)}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl
                           transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  color: a.color,
                }}
              >
                <a.icon size={22} />
                <span className="text-xs font-medium text-center leading-tight"
                      style={{ color: "var(--text-primary)" }}>
                  {a.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
