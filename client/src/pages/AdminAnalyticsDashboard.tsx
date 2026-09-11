import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  useRealtimeNotifications,
  ConnectionStatusBadge,
} from "@/hooks/useRealtimeNotifications";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
];

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `\u20A6${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `\u20A6${(value / 1_000).toFixed(0)}K`;
  return `\u20A6${value.toLocaleString()}`;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function ChangeIndicator({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span
      className={`text-xs font-medium ${isPositive ? "text-emerald-500" : "text-red-500"}`}
    >
      {isPositive ? "\u2191" : "\u2193"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KPICards() {
  // F-12 (wave-5, B16): cards bind the REAL getOverview + kpiSummary
  // aggregates; the one source-less card (avg response time — no APM
  // telemetry source in the schema) still renders "—".
  const { data: kpi } = trpc.analyticsDashboard.getOverview.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: summary } = trpc.analyticsDashboard.kpiSummary.useQuery(undefined, {
    refetchInterval: 30000,
  });
  if (!kpi) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-muted rounded w-24 mb-2" />
              <div className="h-8 bg-muted rounded w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  const cards: Array<{ label: string; value: string; change?: number }> = [
    { label: "Total Transactions", value: formatNumber(kpi.totalTransactions) },
    { label: "Total Volume", value: formatCurrency(kpi.totalVolume) },
    { label: "Total Agents", value: formatNumber(kpi.totalAgents) },
    { label: "Saved Dashboards", value: formatNumber(kpi.totalDashboards) },
    {
      label: "Fees Collected",
      value: summary ? formatCurrency(summary.totalFees) : "—",
    },
    {
      label: "Open Fraud Alerts",
      value: summary ? formatNumber(summary.openFraudAlerts) : "—",
    },
    // No APM/latency telemetry source exists in the schema — honest "—".
    { label: "Avg Response Time", value: "—" },
    {
      label: "KYC Approval Rate",
      value: summary ? `${(summary.kycApprovalRate * 100).toFixed(1)}%` : "—",
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(card => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold">{card.value}</span>
              {card.change != null && <ChangeIndicator value={card.change} />}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// F-12 (wave-5, B16): every section below renders REAL server aggregates.
// Loading renders a pulse; a query error renders the loud "unavailable"
// badge; data renders the real numbers (honest zeros included).

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function SectionBody({
  isLoading,
  isError,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  children: React.ReactNode;
}) {
  if (isError) {
    return (
      <div className="text-center text-muted-foreground py-8">
        — this analytics surface errored (see server logs)
      </div>
    );
  }
  if (isLoading) {
    return <div className="h-24 animate-pulse bg-muted rounded" />;
  }
  return <div className="divide-y divide-muted/40">{children}</div>;
}

function TransactionVolumeChart() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.transactionVolume.useQuery({});
  const rows = data?.data ?? [];
  const totalVolume = rows.reduce(
    (acc: number, r: { amount?: string | number }) => acc + Number(r.amount ?? 0),
    0
  );
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Transaction Volume</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          <Metric label="Recent transactions" value={formatNumber(rows.length)} />
          <Metric label="Combined amount" value={formatCurrency(totalVolume)} />
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function OnboardingFunnel() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.agentOnboardingFunnel.useQuery();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Agent Onboarding Funnel</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          <Metric label="Sessions started" value={formatNumber(data?.total ?? 0)} />
          <Metric label="Approved / completed" value={formatNumber(data?.approved ?? 0)} />
          <Metric label="Rejected" value={formatNumber(data?.rejected ?? 0)} />
          <Metric label="Pending" value={formatNumber(data?.pending ?? 0)} />
          <Metric
            label="Completion rate"
            value={`${((data?.completionRate ?? 0) * 100).toFixed(1)}%`}
          />
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function FraudDetectionChart() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.fraudDetectionRates.useQuery();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Fraud Detection</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          <Metric label="Total alerts" value={formatNumber(data?.totalAlerts ?? 0)} />
          {(data?.bySeverity ?? []).map((s) => (
            <Metric
              key={s.severity}
              label={`Severity: ${s.severity}`}
              value={formatNumber(s.count)}
            />
          ))}
          <Metric
            label="Velocity breach rate"
            value={`${((data?.velocityBreachRate ?? 0) * 100).toFixed(2)}%`}
          />
          <Metric
            label="Avg fraud score"
            value={(data?.averageFraudScore ?? 0).toFixed(2)}
          />
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function RevenueBreakdown() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.revenueBreakdown.useQuery();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Revenue Breakdown</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          {(data?.byType ?? []).map((t) => (
            <Metric
              key={t.type}
              label={t.type}
              value={`${formatCurrency(t.fees)} fees / ${formatNumber(t.count)} tx`}
            />
          ))}
          <Metric label="Total fees" value={formatCurrency(data?.totalFees ?? 0)} />
          <Metric
            label="Total commission"
            value={formatCurrency(data?.totalCommission ?? 0)}
          />
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function GeographicDistribution() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.geographicDistribution.useQuery();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Geographic Distribution</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          {(data?.byLocation ?? []).slice(0, 10).map((l) => (
            <Metric
              key={l.location}
              label={l.location}
              value={`${formatNumber(l.agentCount)} agents / ${formatCurrency(l.volume)}`}
            />
          ))}
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function SettlementTrend() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.settlementTrend.useQuery({});
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Settlement Trend</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          {(data?.days ?? []).slice(0, 10).map((d) => (
            <Metric
              key={d.date}
              label={d.date}
              value={`${formatCurrency(d.actualAmount)} / ${formatCurrency(d.expectedAmount)} exp${
                d.discrepancy !== 0
                  ? ` (${formatCurrency(d.discrepancy)} disc)`
                  : ""
              }`}
            />
          ))}
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function KYCApprovalTrend() {
  const { data, isLoading, isError } =
    trpc.analyticsDashboard.kycApprovalTrend.useQuery({});
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">KYC Approval Trend</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          {(data?.days ?? []).map((d) => (
            <Metric
              key={d.day}
              label={d.day.slice(0, 10)}
              value={`${formatNumber(d.approved)}/${formatNumber(d.total)} (${(d.approvalRate * 100).toFixed(0)}%)`}
            />
          ))}
        </SectionBody>
      </CardContent>
    </Card>
  );
}

function TopAgentsLeaderboard() {
  const { data, isLoading, isError } = trpc.analyticsDashboard.topAgents.useQuery();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Top Agents</CardTitle>
        {isError && (
          <span className="text-xs text-muted-foreground">unavailable</span>
        )}
      </CardHeader>
      <CardContent>
        <SectionBody isLoading={isLoading} isError={isError}>
          {(data?.agents ?? []).map((a, i) => (
            <Metric
              key={a.agentId}
              label={`${i + 1}. ${a.name} (${a.tier})`}
              value={`${formatCurrency(a.volume)} / ${formatNumber(a.transactionCount)} tx`}
            />
          ))}
        </SectionBody>
      </CardContent>
    </Card>
  );
}

export default function AdminAnalyticsDashboard() {
  const { connectionState, unreadCount, notifications } =
    useRealtimeNotifications({
      channels: ["transaction", "fraud", "settlement", "kyc", "system"],
    });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Platform Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time platform metrics and performance insights
            </p>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatusBadge state={connectionState} />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unreadCount} new alerts
              </Badge>
            )}
          </div>
        </div>

        <KPICards />

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="risk">Risk & Compliance</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TransactionVolumeChart />
              <RevenueBreakdown />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <GeographicDistribution />
              <TopAgentsLeaderboard />
            </div>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-6">
            <TransactionVolumeChart />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SettlementTrend />
              <RevenueBreakdown />
            </div>
          </TabsContent>

          <TabsContent value="agents" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <OnboardingFunnel />
              <TopAgentsLeaderboard />
            </div>
            <GeographicDistribution />
          </TabsContent>

          <TabsContent value="risk" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <FraudDetectionChart />
              <KYCApprovalTrend />
            </div>
            <SettlementTrend />
          </TabsContent>
        </Tabs>

        {notifications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {notifications.slice(0, 10).map((notif: any) => (
                  <div
                    key={notif.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-muted/30"
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${notif.severity === "critical" ? "bg-red-500" : notif.severity === "warning" ? "bg-amber-500" : "bg-blue-500"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {notif.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {notif.body}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {notif.channel}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(notif.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
