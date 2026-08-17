import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, DollarSign, FileText, CheckCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import KpiCard from "@/components/KpiCard";

export default function CbnReportingDashboard() {
  // F-12 (wave-4b): summary was a zero-payload stub (now fail-loud);
  // complianceDashboard is the REAL proc (transactions + fraud_alerts).
  const { data, isLoading } = trpc.cbnReporting.complianceDashboard.useQuery({ year: new Date().getFullYear() }, { refetchInterval: 30000 });
  const d: Partial<NonNullable<typeof data>> = data ?? {};

  // Real per-month series from complianceDashboard.monthlyStats
  // (sarLarTrend never existed on the real shape).
  const sarTrend: { month: string; sars: number; lars: number }[] =
    (d.monthlyStats ?? []).map(m => ({
      month: String(m.month),
      sars: Number((m as { txCount?: number }).txCount ?? 0),
      lars: 0,
    }));

  // No risk-distribution source exists — no fabricated 75/18/6/1 split.
  const riskCategories: { category: string; count: number }[] = [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>CBN Regulatory Reporting</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>SAR/LAR filings, CTR reports, and compliance submissions</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="SARs Filed (YTD)" value={isLoading ? "…" : String(d.totalSars ?? 0)} icon={AlertTriangle} />
          <KpiCard title="LARs Filed (YTD)" value={isLoading ? "…" : "—"} icon={DollarSign} />
          <KpiCard title="CTRs Filed" value={isLoading ? "…" : String(d.pendingSubmissions ?? 0)} icon={FileText} />
          <KpiCard title="Compliance Score" value={isLoading ? "…" : "—"} icon={CheckCircle} trend="up" trendValue="—" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>SAR/LAR Filing Trend</h3>
            {sarTrend.length === 0 ? (
              <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
                No filing trend data available yet
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sarTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip />
                <Bar dataKey="sars" fill="#ef4444" name="SARs" radius={[4, 4, 0, 0]} />
                <Bar dataKey="lars" fill="#f59e0b" name="LARs" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Transaction Risk Distribution</h3>
            {riskCategories.length === 0 ? (
              <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
                No risk distribution data available yet
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={riskCategories}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]}>
                  {riskCategories.map((entry, i) => (
                    <Cell key={i} fill={["#22c55e", "#f59e0b", "#f97316", "#ef4444"][i] || "#6366f1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
