import { useEffect, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6"];
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Chart from "chart.js/auto";

const EMPTY_MSG = "No data available yet";

function EmptyChart({ height = 400 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={{ height }}
    >
      {EMPTY_MSG}
    </div>
  );
}

export default function BillingAnalyticsDashboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("12m");
  const [tenantFilter, setTenantFilter] = useState("all");

  // Chart refs
  const revenueChartRef = useRef<HTMLCanvasElement>(null);
  const mrrChartRef = useRef<HTMLCanvasElement>(null);
  const churnChartRef = useRef<HTMLCanvasElement>(null);
  const ltvChartRef = useRef<HTMLCanvasElement>(null);
  const cohortChartRef = useRef<HTMLCanvasElement>(null);
  const forecastChartRef = useRef<HTMLCanvasElement>(null);

  // Chart instances
  const chartsRef = useRef<Record<string, Chart>>({});

  // Fetch analytics data
  const cohortData = trpc.billingProduction.getCohortAnalytics.useQuery(
    { period: period === "12m" ? 12 : period === "6m" ? 6 : 3 },
    { enabled: !!user }
  );
  const forecastData = trpc.billingProduction.getRevenueForecast.useQuery(
    { months: period === "12m" ? 12 : period === "6m" ? 6 : 3 },
    { enabled: !!user }
  );
  const dashboardData = trpc.liveBillingDashboard.getSummary.useQuery(
    undefined,
    { enabled: !!user }
  );

  // Real data only — every series below comes from a query response.
  const data: any = dashboardData.data ?? null;
  const isLoading = dashboardData.isLoading;

  const revenueByMonth: any[] = Array.isArray(data?.revenueByMonth)
    ? data.revenueByMonth
    : [];
  const mrrGrowth: any[] = Array.isArray(data?.mrrGrowth) ? data.mrrGrowth : [];
  const churnTrend: any[] = Array.isArray(data?.churnTrend)
    ? data.churnTrend
    : [];
  const ltvByCohort: any[] = Array.isArray(data?.ltvByCohort)
    ? data.ltvByCohort
    : [];
  const cohortRetention: any[] = Array.isArray(cohortData.data)
    ? (cohortData.data as any[])
    : Array.isArray(data?.cohortRetention)
      ? data.cohortRetention
      : [];
  const forecast: any = forecastData.data ?? null;
  const forecastLabels: string[] = Array.isArray(forecast?.labels)
    ? forecast.labels
    : [];
  const revenueTrend: any[] = Array.isArray(data?.revenueTrend)
    ? data.revenueTrend
    : [];

  useEffect(() => {
    // Destroy existing charts
    Object.values(chartsRef.current).forEach((chart: any) => chart.destroy());
    chartsRef.current = {};

    // Revenue by Tenant Chart (real per-month values only)
    if (revenueChartRef.current && revenueByMonth.length > 0) {
      chartsRef.current.revenue = new Chart(revenueChartRef.current, {
        type: "bar",
        data: {
          labels: revenueByMonth.map((r: any) => r.month),
          datasets: [
            {
              label: "Platform Revenue (₦M)",
              data: revenueByMonth.map((r: any) => Number(r.platform ?? 0)),
              backgroundColor: "rgba(59, 130, 246, 0.7)",
              borderColor: "rgb(59, 130, 246)",
              borderWidth: 1,
            },
            {
              label: "Tenant Revenue (₦M)",
              data: revenueByMonth.map((r: any) => Number(r.tenant ?? 0)),
              backgroundColor: "rgba(16, 185, 129, 0.7)",
              borderColor: "rgb(16, 185, 129)",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Revenue by Tenant (₦ Millions)" },
          },
          scales: { y: { beginAtZero: true } },
        },
      });
    }

    // MRR Growth Chart (real series only — no fabricated target line)
    if (mrrChartRef.current && mrrGrowth.length > 0) {
      chartsRef.current.mrr = new Chart(mrrChartRef.current, {
        type: "line",
        data: {
          labels: mrrGrowth.map((r: any) => r.month),
          datasets: [
            {
              label: "MRR (₦M)",
              data: mrrGrowth.map((r: any) => Number(r.mrr ?? r.value ?? 0)),
              borderColor: "rgb(139, 92, 246)",
              backgroundColor: "rgba(139, 92, 246, 0.1)",
              fill: true,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Monthly Recurring Revenue Growth" },
          },
        },
      });
    }

    // Churn Rate Chart (real series only)
    if (churnChartRef.current && churnTrend.length > 0) {
      chartsRef.current.churn = new Chart(churnChartRef.current, {
        type: "line",
        data: {
          labels: churnTrend.map((r: any) => r.month),
          datasets: [
            {
              label: "Revenue Churn %",
              data: churnTrend.map((r: any) => Number(r.revenueChurn ?? 0)),
              borderColor: "rgb(239, 68, 68)",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              fill: true,
              tension: 0.3,
            },
            {
              label: "Logo Churn %",
              data: churnTrend.map((r: any) => Number(r.logoChurn ?? 0)),
              borderColor: "rgb(245, 158, 11)",
              backgroundColor: "rgba(245, 158, 11, 0.1)",
              fill: true,
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Churn Rate Trends" },
          },
          scales: { y: { beginAtZero: true } },
        },
      });
    }

    // LTV by Cohort Chart (real series only)
    if (ltvChartRef.current && ltvByCohort.length > 0) {
      chartsRef.current.ltv = new Chart(ltvChartRef.current, {
        type: "bar",
        data: {
          labels: ltvByCohort.map((r: any) => r.cohort),
          datasets: [
            {
              label: "Avg LTV (₦K)",
              data: ltvByCohort.map((r: any) => Number(r.ltv ?? 0)),
              backgroundColor: ltvByCohort.map(
                (_: any, i: number) => COLORS[i % COLORS.length] + "b3"
              ),
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Customer Lifetime Value by Cohort" },
          },
          scales: { y: { beginAtZero: true } },
        },
      });
    }

    // Cohort Retention (real series only)
    if (cohortChartRef.current && cohortRetention.length > 0) {
      chartsRef.current.cohort = new Chart(cohortChartRef.current, {
        type: "bar",
        data: {
          labels: cohortRetention.map((r: any) => r.label ?? r.month),
          datasets: [
            {
              label: "Retention %",
              data: cohortRetention.map((r: any) =>
                Number(r.retention ?? r.value ?? 0)
              ),
              backgroundColor: "rgba(59, 130, 246, 0.7)",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Cohort Retention (% Retained)" },
          },
          scales: { y: { beginAtZero: true, max: 100 } },
        },
      });
    }

    // Revenue Forecast Chart (real forecast API values only)
    if (forecastChartRef.current && forecastLabels.length > 0) {
      chartsRef.current.forecast = new Chart(forecastChartRef.current, {
        type: "line",
        data: {
          labels: forecastLabels,
          datasets: [
            {
              label: "Actual Revenue (₦M)",
              data: forecast?.actual ?? [],
              borderColor: "rgb(59, 130, 246)",
              backgroundColor: "rgba(59, 130, 246, 0.1)",
              fill: true,
              tension: 0.3,
            },
            {
              label: "Forecast (₦M)",
              data: forecast?.forecast ?? [],
              borderColor: "rgb(16, 185, 129)",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              borderDash: [5, 5],
              fill: true,
              tension: 0.3,
            },
            ...(Array.isArray(forecast?.upper)
              ? [
                  {
                    label: "Upper Bound",
                    data: forecast.upper,
                    borderColor: "rgba(16, 185, 129, 0.3)",
                    borderDash: [2, 2],
                    fill: false,
                    pointRadius: 0,
                  },
                ]
              : []),
            ...(Array.isArray(forecast?.lower)
              ? [
                  {
                    label: "Lower Bound",
                    data: forecast.lower,
                    borderColor: "rgba(16, 185, 129, 0.3)",
                    borderDash: [2, 2],
                    fill: "-1",
                    backgroundColor: "rgba(16, 185, 129, 0.05)",
                    pointRadius: 0,
                  },
                ]
              : []),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
            title: {
              display: true,
              text: "Revenue Forecast with Confidence Interval",
            },
          },
        },
      });
    }

    return () => {
      Object.values(chartsRef.current).forEach((chart: any) => chart.destroy());
    };
  }, [period, tenantFilter, data, cohortData.data, forecastData.data]);

  const revCats = [
    { name: "Platform Fees", value: Number(data?.platformFees ?? 0) / 1e6 },
    { name: "Commission", value: Number(data?.commission ?? 0) / 1e6 },
    { name: "Premium", value: Number(data?.premium ?? 0) / 1e6 },
  ].filter(d => d.value > 0);

  const kpiValue = (v: any, fmt: (n: number) => string) =>
    v === null || v === undefined || Number.isNaN(Number(v))
      ? "—"
      : fmt(Number(v));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing Analytics</h1>
          <p className="text-muted-foreground">
            Revenue metrics, cohort analysis, and forecasting
          </p>
        </div>
        <div className="flex gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3m">3 Months</SelectItem>
              <SelectItem value="6m">6 Months</SelectItem>
              <SelectItem value="12m">12 Months</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tenants</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
              <SelectItem value="smb">SMB</SelectItem>
              <SelectItem value="startup">Startup</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </div>
      </div>

      {dashboardData.isError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Failed to load billing metrics
          {dashboardData.error?.message ? `: ${dashboardData.error.message}` : "."}
        </div>
      )}

      {/* KPI Cards — real values or honest placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Monthly Recurring Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "…" : kpiValue(data?.mrr, n => `₦${n.toLocaleString()}`)}
            </div>
            {data?.mrrChange != null && (
              <p className="text-xs text-green-600">
                {data.mrrChange > 0 ? "+" : ""}
                {data.mrrChange}% from last month
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Annual Run Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "…" : kpiValue(data?.arr, n => `₦${n.toLocaleString()}`)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Revenue Churn
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "…" : kpiValue(data?.revenueChurn, n => `${n}%`)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Avg Customer LTV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "…" : kpiValue(data?.avgLtv, n => `₦${n.toLocaleString()}`)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="mrr">MRR Growth</TabsTrigger>
          <TabsTrigger value="churn">Churn</TabsTrigger>
          <TabsTrigger value="ltv">LTV</TabsTrigger>
          <TabsTrigger value="cohort">Cohort</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <Card>
            <CardContent className="pt-6">
              {revenueByMonth.length === 0 ? (
                <EmptyChart />
              ) : (
                <div style={{ height: "400px" }}>
                  <canvas ref={revenueChartRef}></canvas>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mrr">
          <Card>
            <CardContent className="pt-6">
              {mrrGrowth.length === 0 ? (
                <EmptyChart />
              ) : (
                <div style={{ height: "400px" }}>
                  <canvas ref={mrrChartRef}></canvas>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="churn">
          <Card>
            <CardContent className="pt-6">
              {churnTrend.length === 0 ? (
                <EmptyChart />
              ) : (
                <div style={{ height: "400px" }}>
                  <canvas ref={churnChartRef}></canvas>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ltv">
          <Card>
            <CardContent className="pt-6">
              {ltvByCohort.length === 0 ? (
                <EmptyChart />
              ) : (
                <div style={{ height: "400px" }}>
                  <canvas ref={ltvChartRef}></canvas>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cohort">
          <Card>
            <CardContent className="pt-6">
              {cohortRetention.length === 0 ? (
                <EmptyChart />
              ) : (
                <div style={{ height: "400px" }}>
                  <canvas ref={cohortChartRef}></canvas>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast">
          <Card>
            <CardContent className="pt-6">
              {forecastLabels.length === 0 ? (
                <EmptyChart />
              ) : (
                <div style={{ height: "400px" }}>
                  <canvas ref={forecastChartRef}></canvas>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Supplementary charts — real aggregates only */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Revenue by Category (₦M)</h3>
          {revCats.length === 0 ? (
            <EmptyChart height={200} />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={revCats} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,value})=>`${name}: ₦${Number(value).toFixed(1)}M`}>{revCats.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={(v:any)=>`₦${Number(v).toFixed(2)}M`}/></PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Monthly Revenue Trend (₦M)</h3>
          {revenueTrend.length === 0 ? (
            <EmptyChart height={200} />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenueTrend}><CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/><XAxis dataKey="month" tick={{fontSize:11,fill:"var(--text-secondary)"}}/><YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/><Tooltip formatter={(v:any)=>`₦${Number(v).toFixed(2)}M`}/><Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="#6366f120" strokeWidth={2} name="Revenue (₦M)"/></AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
