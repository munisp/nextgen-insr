// @ts-nocheck
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
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
  const { data: kpi } = trpc.analyticsDashboard.kpiSummary.useQuery(undefined, {
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
  const cards = [
    {
      label: "Total Transactions",
      value: formatNumber(kpi.totalTransactions),
      change: kpi.totalTransactionsChange,
    },
    {
      label: "Total Volume",
      value: formatCurrency(kpi.totalVolume),
      change: kpi.totalVolumeChange,
    },
    {
      label: "Active Agents",
      value: formatNumber(kpi.activeAgents),
      change: kpi.activeAgentsChange,
    },
    {
      label: "Commission Earned",
      value: formatCurrency(kpi.totalCommission),
      change: kpi.totalCommissionChange,
    },
    {
      label: "Fraud Detection",
      value: `${kpi.fraudDetectionRate}%`,
      change: kpi.fraudDetectionRateChange,
    },
    {
      label: "Avg Response Time",
      value: `${kpi.avgResponseTime}s`,
      change: kpi.avgResponseTimeChange,
    },
    {
      label: "KYC Approval Rate",
      value: `${kpi.kycApprovalRate}%`,
      change: kpi.kycApprovalRateChange,
    },
    {
      label: "Settlement Success",
      value: `${kpi.settlementSuccessRate}%`,
      change: kpi.settlementSuccessRateChange,
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card: any) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold">{card.value}</span>
              <ChangeIndicator value={card.change} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TransactionVolumeChart() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "365d">("30d");
  const { data } = trpc.analyticsDashboard.transactionVolume.useQuery({
    period,
    granularity: "daily",
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Transaction Volume</CardTitle>
        <div className="flex gap-1">
          {(["7d", "30d", "90d", "365d"] as const).map((p: any) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "ghost"}
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="premiumCollection"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Cash In"
              />
              <Line
                type="monotone"
                dataKey="claimPayout"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                name="Cash Out"
              />
              <Line
                type="monotone"
                dataKey="transfer"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="Transfer"
              />
              <Line
                type="monotone"
                dataKey="billPay"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
                name="Bill Pay"
              />
              <Line
                type="monotone"
                dataKey="airtime"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                name="Airtime"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-80 flex items-center justify-center text-muted-foreground">
            Loading chart...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OnboardingFunnel() {
  const { data } = trpc.analyticsDashboard.agentOnboardingFunnel.useQuery();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent Onboarding Funnel</CardTitle>
        {data && (
          <p className="text-xs text-muted-foreground">
            Overall conversion: {data.conversionRate}% | Avg activation:{" "}
            {data.avgTimeToActivation}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {data ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.stages} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="stage"
                tick={{ fontSize: 11 }}
                width={120}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Bar
                dataKey="count"
                fill="#3b82f6"
                radius={[0, 4, 4, 0]}
                name="Agents"
              >
                {data.stages.map((_, i) => (
                  <Cell
                    key={i}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={1 - i * 0.1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-80 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FraudDetectionChart() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const { data } = trpc.analyticsDashboard.fraudDetectionRates.useQuery({
    period,
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">Fraud Detection</CardTitle>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              Detection rate: {data.summary.detectionRate}% | Avg resolution:{" "}
              {data.summary.avgResolutionTime}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as const).map((p: any) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "ghost"}
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="critical"
                stackId="1"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.6}
                name="Critical"
              />
              <Area
                type="monotone"
                dataKey="high"
                stackId="1"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.5}
                name="High"
              />
              <Area
                type="monotone"
                dataKey="medium"
                stackId="1"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.4}
                name="Medium"
              />
              <Area
                type="monotone"
                dataKey="low"
                stackId="1"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.3}
                name="Low"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-72 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RevenueBreakdown() {
  const { data } = trpc.analyticsDashboard.revenueBreakdown.useQuery();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Revenue Breakdown</CardTitle>
        {data && (
          <p className="text-xs text-muted-foreground">
            Total: {formatCurrency(data.totalRevenue)} | MoM:{" "}
            <ChangeIndicator value={data.monthOverMonth} />
          </p>
        )}
      </CardHeader>
      <CardContent>
        {data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground text-center mb-2">
                By Transaction Type
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={data.byType}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percentage }) => `${name} ${percentage}%`}
                    labelLine={false}
                  >
                    {data.byType.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-muted-foreground text-center mb-2">
                By Agent Tier
              </p>
              <div className="space-y-3 mt-4">
                {data.byTier.map((tier: any) => (
                  <div
                    key={tier.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{tier.name}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {tier.agents} agents
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">
                        {formatCurrency(tier.value)}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(tier.avgPerAgent)}/agent
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GeographicDistribution() {
  const { data } = trpc.analyticsDashboard.geographicDistribution.useQuery();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Geographic Distribution</CardTitle>
        {data && (
          <p className="text-xs text-muted-foreground">
            {data.totalAgents} agents across {data.regions.length} regions |{" "}
            {formatCurrency(data.totalVolume)} total volume
          </p>
        )}
      </CardHeader>
      <CardContent>
        {data ? (
          <div className="space-y-2">
            {data.regions.map((region: any) => {
              const maxAgents = Math.max(...data.regions.map(r => r.agents));
              const widthPct = (region.agents / maxAgents) * 100;
              return (
                <div key={region.name} className="flex items-center gap-3">
                  <span className="text-sm w-28 shrink-0">{region.name}</span>
                  <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="text-[10px] text-white font-medium">
                        {region.agents}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground w-20 text-right">
                    {formatCurrency(region.volume)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettlementTrend() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const { data } = trpc.analyticsDashboard.settlementTrend.useQuery({ period });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">Settlement Reconciliation</CardTitle>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              Success rate: {data.summary.successRate}% | Avg time:{" "}
              {data.summary.avgSettlementTime}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as const).map((p: any) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "ghost"}
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="settled"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.3}
                name="Settled"
              />
              <Area
                type="monotone"
                dataKey="pending"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.3}
                name="Pending"
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.3}
                name="Failed"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-72 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KYCApprovalTrend() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const { data } = trpc.analyticsDashboard.kycApprovalTrend.useQuery({
    period,
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">KYC Approval Rate</CardTitle>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              Approval rate: {data.summary.approvalRate}% | Avg processing:{" "}
              {data.summary.avgProcessingTime}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as const).map((p: any) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "ghost"}
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Legend />
              <Bar
                dataKey="approved"
                stackId="a"
                fill="#10b981"
                name="Approved"
              />
              <Bar
                dataKey="rejected"
                stackId="a"
                fill="#ef4444"
                name="Rejected"
              />
              <Bar
                dataKey="pending"
                stackId="a"
                fill="#f59e0b"
                name="Pending"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-72 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TopAgentsLeaderboard() {
  const [sortBy, setSortBy] = useState<
    "volume" | "txCount" | "commission" | "rating"
  >("volume");
  const { data } = trpc.analyticsDashboard.topAgents.useQuery({
    sortBy,
    limit: 10,
  });
  const tierColors: Record<string, string> = {
    Diamond: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Gold: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    Silver: "bg-gray-400/20 text-gray-300 border-gray-400/30",
    Bronze: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Top Performing Agents</CardTitle>
        <Select
          value={sortBy}
          onValueChange={v => setSortBy(v as typeof sortBy)}
        >
          <SelectTrigger className="w-36 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="volume">By Volume</SelectItem>
            <SelectItem value="txCount">By Transactions</SelectItem>
            <SelectItem value="commission">By Commission</SelectItem>
            <SelectItem value="rating">By Rating</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {data ? (
          <div className="space-y-2">
            {data.agents.map((agent, i) => (
              <div
                key={agent.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 0
                      ? "bg-yellow-500/20 text-yellow-400"
                      : i === 1
                        ? "bg-gray-400/20 text-gray-300"
                        : i === 2
                          ? "bg-orange-500/20 text-orange-400"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {agent.name}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${tierColors[agent.tier] ?? ""}`}
                    >
                      {agent.tier}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {agent.code}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium">
                    {formatCurrency(agent.volume)}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {agent.txCount} txns
                  </p>
                </div>
                <div className="text-right w-16">
                  <span className="text-xs text-yellow-400">
                    {"\u2605".repeat(Math.round(agent.rating))}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {agent.rating}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-60 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
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
