import { trpc } from "@/lib/trpc";
import { PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6"];
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import KpiCard from "@/components/KpiCard";
import { Banknote, Clock, Users, Zap } from "lucide-react";

export default function RealTimeDashboard() {
  const { user } = useAuth();
  // F-12 (wave-4b): realtimeDashboardWidgets.dashboard/getStats are
  // fail-loud (no widget store) — the page binds the REAL transaction
  // telemetry from systemHealthMonitor.transactionVolume instead.
  const { data: txData, isLoading } = trpc.healthMonitor.transactionVolume.useQuery(
    undefined,
    { enabled: !!user, refetchInterval: 10000 }
  );
  const pendingCount =
    txData?.byStatus.find(x => x.status === "pending")?.count ?? 0;
  const dayVolume =
    txData?.hourly.reduce((a, h) => a + Number(h.amount), 0) ?? 0;

  // Real per-bucket series only — no randomized multipliers on live totals.
  const txTrend: { time: string; count: number; volume: number }[] =
    txData?.hourly.map(h => ({
      time: h.hour,
      count: Number(h.count),
      volume: Number(h.amount),
    })) ?? [];

  // Real per-type aggregates only — no fabricated fixed splits.
  const txByType: { name: string; count: number }[] =
    txData?.byType.map(t => ({ name: t.type, count: Number(t.count) })) ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Real-Time Operations</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Live transaction flow and system activity (10s refresh)</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Txns Today" value={isLoading ? "…" : String(txData?.current ?? 0)} icon={Zap} />
          <KpiCard title="Volume Today" value={isLoading ? "…" : `₦${(dayVolume / 1e6).toFixed(1)}M`} icon={Banknote} />
          <KpiCard title="Active Agents" value={isLoading ? "…" : "—"} icon={Users} />
          <KpiCard title="Pending Queue" value={isLoading ? "…" : String(pendingCount)} icon={Clock} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Transaction Volume Trend</h3>
            {txTrend.length === 0 ? (
              <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
                No volume trend data available yet
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={txTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#6366f120" strokeWidth={2} name="Transactions" />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Transactions by Type</h3>
            {txByType.length === 0 ? (
              <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
                No transaction type data available yet
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={txByType}
                  cx="50%" cy="50%" outerRadius={70} dataKey="count" label={({ name, count }) => `${name}: ${count}`}>
                  {txByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
