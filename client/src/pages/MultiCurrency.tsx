import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
} from "recharts";
import {
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Calculator,
  BarChart3,
  Globe,
  Clock,
  Zap,
  ArrowRight,
  Minus,
  History,
} from "lucide-react";

// ── Sparkline Mini Component ─────────────────────────────────────────────────

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * 60},${30 - ((v - min) / range) * 28}`
    )
    .join(" ");

  return (
    <svg width="60" height="30" viewBox="0 0 60 30" className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Conversion History Item ──────────────────────────────────────────────────

interface ConversionRecord {
  id: number;
  from: string;
  to: string;
  amount: number;
  result: number;
  rate: number;
  time: Date;
}

export default function MultiCurrency() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [baseCurrency, setBaseCurrency] = useState("NGN");
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("rates");

  // Calculator state
  const [calcFrom, setCalcFrom] = useState("NGN");
  const [calcTo, setCalcTo] = useState("USD");
  const [calcAmount, setCalcAmount] = useState("1000");
  const [conversionHistory, setConversionHistory] = useState<
    ConversionRecord[]
  >([]);
  const [historyCounter, setHistoryCounter] = useState(0);

  // Chart state
  const [chartFrom, setChartFrom] = useState("NGN");
  const [chartTo, setChartTo] = useState("USD");
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "90d" | "1y">(
    "30d"
  );

  // ── Queries ────────────────────────────────────────────────────────────────
  const ratesQuery = trpc.fxRates.getRates.useQuery(
    { base: baseCurrency, category: activeCategory },
    { refetchInterval: 60000 }
  );

  const parsedCalcAmount = parseFloat(calcAmount) || 0;
  const convertQuery = trpc.fxRates.convert.useQuery(
    {
      from: calcFrom,
      to: calcTo,
      amount: parsedCalcAmount > 0 ? parsedCalcAmount : 1,
    },
    { enabled: parsedCalcAmount > 0 }
  );

  const historicalQuery = trpc.fxRates.historical.useQuery(
    { from: chartFrom, to: chartTo, period: chartPeriod },
    { enabled: activeTab === "charts" }
  );

  const currenciesQuery = trpc.fxRates.currencies.useQuery();
  const refreshMutation = trpc.fxRates.refresh.useMutation({
    onSuccess: () => ratesQuery.refetch(),
  });

  // ── Derived Data ───────────────────────────────────────────────────────────
  const filteredRates = useMemo(() => {
    if (!ratesQuery.data?.rates) return [];
    if (!searchQuery) return ratesQuery.data.rates;
    const q = searchQuery.toLowerCase();
    return ratesQuery.data.rates.filter(
      r => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [ratesQuery.data?.rates, searchQuery]);

  const currencyOptions = useMemo(() => {
    return currenciesQuery.data?.currencies || [];
  }, [currenciesQuery.data]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSwap = useCallback(() => {
    setCalcFrom(calcTo);
    setCalcTo(calcFrom);
  }, [calcFrom, calcTo]);

  const addToHistory = useCallback(() => {
    if (convertQuery.data && parsedCalcAmount > 0) {
      setConversionHistory(prev => [
        {
          id: historyCounter,
          from: convertQuery.data!.from,
          to: convertQuery.data!.to,
          amount: convertQuery.data!.amount,
          result: convertQuery.data!.converted,
          rate: convertQuery.data!.midMarketRate,
          time: new Date(),
        },
        ...prev.slice(0, 9),
      ]);
      setHistoryCounter(c => c + 1);
    }
  }, [convertQuery.data, parsedCalcAmount, historyCounter]);

  // Auto-add to history when conversion completes
  useEffect(() => {
    if (convertQuery.data && parsedCalcAmount > 0) {
      addToHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertQuery.data?.converted]);

  const handleQuickPair = useCallback((from: string, to: string) => {
    setCalcFrom(from);
    setCalcTo(to);
    setActiveTab("calculator");
  }, []);

  const formatRate = (rate: number) => {
    if (rate >= 1000) return rate.toFixed(2);
    if (rate >= 1) return rate.toFixed(4);
    return rate.toFixed(6);
  };

  // ── Currency Select Component ──────────────────────────────────────────────
  const CurrencySelect = ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
  }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full bg-background">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        {currencyOptions.map((c: any) => (
          <SelectItem key={c.code} value={c.code}>
            <span className="flex items-center gap-2">
              <span>{c.flag}</span>
              <span className="font-medium">{c.code}</span>
              <span className="text-muted-foreground text-xs">{c.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-blue-500" />
              Multi-Currency Exchange
            </h1>
            <p className="text-muted-foreground mt-1">
              {ratesQuery.data?.totalCurrencies || 0} currencies from{" "}
              {ratesQuery.data?.source || "..."} &middot; Updated{" "}
              {ratesQuery.data?.cachedAt
                ? new Date(ratesQuery.data.cachedAt).toLocaleTimeString()
                : "..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={baseCurrency} onValueChange={setBaseCurrency}>
              <SelectTrigger className="w-[140px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["NGN", "USD", "EUR", "GBP", "KES", "GHS", "ZAR"].map(
                  (c: any) => (
                    <SelectItem key={c} value={c}>
                      Base: {c}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshMutation.isPending ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 md:w-auto md:inline-grid">
            <TabsTrigger value="rates" className="gap-1">
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline">Rates</span>
            </TabsTrigger>
            <TabsTrigger value="calculator" className="gap-1">
              <Calculator className="h-4 w-4" />
              <span className="hidden sm:inline">Calculator</span>
            </TabsTrigger>
            <TabsTrigger value="charts" className="gap-1">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Charts</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Rates Tab ───────────────────────────────────────────────── */}
          <TabsContent value="rates" className="space-y-4">
            {/* Popular Pairs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Popular Pairs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {ratesQuery.data?.popularPairs?.map((pair, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleQuickPair(pair.from, pair.to)}
                    >
                      {pair.from} <ArrowRight className="h-3 w-3 mx-1" />{" "}
                      {pair.to}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Category Filters + Search */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-wrap gap-1.5">
                {ratesQuery.data?.categories?.map((cat: any) => (
                  <Button
                    key={cat.id}
                    variant={activeCategory === cat.id ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    {cat.label}
                  </Button>
                ))}
              </div>
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search currencies..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Rate Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 text-xs font-medium text-muted-foreground">
                          Currency
                        </th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground">
                          Rate (1 {baseCurrency})
                        </th>
                        <th className="text-right p-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">
                          24h Change
                        </th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground hidden md:table-cell">
                          7d Trend
                        </th>
                        <th className="text-center p-3 text-xs font-medium text-muted-foreground">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ratesQuery.isLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b">
                            <td colSpan={5} className="p-3">
                              <div className="h-6 bg-muted animate-pulse rounded" />
                            </td>
                          </tr>
                        ))
                      ) : filteredRates.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-muted-foreground"
                          >
                            No currencies found
                          </td>
                        </tr>
                      ) : (
                        filteredRates.map((rate: any) => (
                          <tr
                            key={rate.code}
                            className="border-b hover:bg-muted/30 transition-colors"
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{rate.flag}</span>
                                <div>
                                  <div className="font-medium text-sm">
                                    {rate.code}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {rate.name}
                                  </div>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] hidden lg:inline-flex"
                                >
                                  {rate.category}
                                </Badge>
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono text-sm">
                              {rate.symbol} {formatRate(rate.rate)}
                            </td>
                            <td className="p-3 text-right hidden sm:table-cell">
                              <span
                                className={`inline-flex items-center gap-1 text-xs font-medium ${
                                  rate.change24h > 0
                                    ? "text-green-500"
                                    : rate.change24h < 0
                                      ? "text-red-500"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {rate.change24h > 0 ? (
                                  <TrendingUp className="h-3 w-3" />
                                ) : rate.change24h < 0 ? (
                                  <TrendingDown className="h-3 w-3" />
                                ) : (
                                  <Minus className="h-3 w-3" />
                                )}
                                {rate.change24h > 0 ? "+" : ""}
                                {rate.change24h.toFixed(2)}%
                              </span>
                            </td>
                            <td className="p-3 text-center hidden md:table-cell">
                              {rate.sparkline && (
                                <Sparkline
                                  data={rate.sparkline}
                                  positive={rate.change24h >= 0}
                                />
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs"
                                onClick={() => {
                                  setCalcFrom(baseCurrency);
                                  setCalcTo(rate.code);
                                  setActiveTab("calculator");
                                }}
                              >
                                Convert
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Calculator Tab ───────────────────────────────────────────── */}
          <TabsContent value="calculator" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Main Calculator */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-blue-500" />
                    Currency Converter
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* From */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      You send
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="number"
                          value={calcAmount}
                          onChange={e => setCalcAmount(e.target.value)}
                          className="text-2xl h-14 font-mono"
                          placeholder="0.00"
                          min="0"
                          step="any"
                        />
                      </div>
                      <div className="w-[180px]">
                        <CurrencySelect
                          value={calcFrom}
                          onChange={setCalcFrom}
                          label="From"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Swap Button */}
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full h-10 w-10 hover:rotate-180 transition-transform duration-300"
                      onClick={handleSwap}
                    >
                      <ArrowUpDown className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* To */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      They receive
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="h-14 rounded-md border bg-muted/30 flex items-center px-4">
                          <span className="text-2xl font-mono">
                            {convertQuery.isLoading ? (
                              <span className="animate-pulse">...</span>
                            ) : convertQuery.data ? (
                              convertQuery.data.converted.toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )
                            ) : (
                              "0.00"
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="w-[180px]">
                        <CurrencySelect
                          value={calcTo}
                          onChange={setCalcTo}
                          label="To"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Rate Details */}
                  {convertQuery.data && (
                    <div className="rounded-lg bg-muted/30 p-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Mid-market rate
                        </span>
                        <span className="font-mono">
                          1 {calcFrom} ={" "}
                          {formatRate(convertQuery.data.midMarketRate)} {calcTo}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Effective rate
                        </span>
                        <span className="font-mono">
                          1 {calcFrom} ={" "}
                          {formatRate(convertQuery.data.effectiveRate)} {calcTo}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Inverse rate
                        </span>
                        <span className="font-mono">
                          1 {calcTo} ={" "}
                          {formatRate(convertQuery.data.inverseRate)} {calcFrom}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm border-t pt-2 mt-2">
                        <span className="text-muted-foreground">
                          Spread ({convertQuery.data.spread}%)
                        </span>
                        <span className="font-mono text-yellow-500">
                          {convertQuery.data.fee.toLocaleString()} {calcTo}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Source: {convertQuery.data.source} &middot;{" "}
                        {new Date(
                          convertQuery.data.timestamp
                        ).toLocaleTimeString()}
                      </div>
                    </div>
                  )}

                  {/* Quick Pairs */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Quick pairs
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { f: "NGN", t: "USD" },
                        { f: "NGN", t: "GBP" },
                        { f: "NGN", t: "EUR" },
                        { f: "USD", t: "EUR" },
                        { f: "GHS", t: "NGN" },
                        { f: "KES", t: "USD" },
                        { f: "ZAR", t: "GBP" },
                        { f: "USD", t: "BTC" },
                      ].map((pair, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            setCalcFrom(pair.f);
                            setCalcTo(pair.t);
                          }}
                        >
                          {pair.f}/{pair.t}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Conversion History */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <History className="h-4 w-4" />
                    Recent Conversions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {conversionHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Calculator className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p>No conversions yet</p>
                      <p className="text-xs mt-1">
                        Your recent conversions will appear here
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {conversionHistory.map((item: any) => (
                        <div
                          key={item.id}
                          className="rounded-lg border p-2.5 text-xs cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => {
                            setCalcFrom(item.from);
                            setCalcTo(item.to);
                            setCalcAmount(item.amount.toString());
                          }}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-medium">
                              {item.amount.toLocaleString()} {item.from}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium">
                              {item.result.toLocaleString()} {item.to}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-1 flex justify-between">
                            <span>Rate: {formatRate(item.rate)}</span>
                            <span>{item.time.toLocaleTimeString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Charts Tab ───────────────────────────────────────────────── */}
          <TabsContent value="charts" className="space-y-4">
            {/* Chart Controls */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      From
                    </label>
                    <CurrencySelect
                      value={chartFrom}
                      onChange={setChartFrom}
                      label="From"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="rounded-full shrink-0 mb-0.5"
                    onClick={() => {
                      setChartFrom(chartTo);
                      setChartTo(chartFrom);
                    }}
                  >
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      To
                    </label>
                    <CurrencySelect
                      value={chartTo}
                      onChange={setChartTo}
                      label="To"
                    />
                  </div>
                  <div className="flex gap-1">
                    {(["7d", "30d", "90d", "1y"] as const).map((p: any) => (
                      <Button
                        key={p}
                        variant={chartPeriod === p ? "default" : "outline"}
                        size="sm"
                        onClick={() => setChartPeriod(p)}
                      >
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats Cards */}
            {historicalQuery.data?.stats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-xs text-muted-foreground">
                      Period Change
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        historicalQuery.data.stats.change >= 0
                          ? "text-green-500"
                          : "text-red-500"
                      }`}
                    >
                      {historicalQuery.data.stats.change >= 0 ? "+" : ""}
                      {historicalQuery.data.stats.change}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-xs text-muted-foreground">High</p>
                    <p className="text-lg font-bold font-mono">
                      {formatRate(historicalQuery.data.stats.high)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-xs text-muted-foreground">Low</p>
                    <p className="text-lg font-bold font-mono">
                      {formatRate(historicalQuery.data.stats.low)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-xs text-muted-foreground">Average</p>
                    <p className="text-lg font-bold font-mono">
                      {formatRate(historicalQuery.data.stats.average)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-xs text-muted-foreground">Volatility</p>
                    <p className="text-lg font-bold">
                      {historicalQuery.data.stats.volatility}%
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Main Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                  {chartFrom}/{chartTo} Exchange Rate
                  <Badge variant="outline" className="ml-auto text-xs">
                    {historicalQuery.data?.source || "..."}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historicalQuery.isLoading ? (
                  <div className="h-[400px] flex items-center justify-center">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : historicalQuery.data?.data ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <AreaChart data={historicalQuery.data.data}>
                      <defs>
                        <linearGradient
                          id="rateGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#3b82f6"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#3b82f6"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#333"
                        opacity={0.3}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={v => {
                          const d = new Date(v);
                          return chartPeriod === "7d"
                            ? d.toLocaleDateString(undefined, {
                                weekday: "short",
                              })
                            : chartPeriod === "1y"
                              ? d.toLocaleDateString(undefined, {
                                  month: "short",
                                  year: "2-digit",
                                })
                              : d.toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                });
                        }}
                        interval={
                          chartPeriod === "7d"
                            ? 0
                            : chartPeriod === "30d"
                              ? 4
                              : chartPeriod === "90d"
                                ? 13
                                : 30
                        }
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        domain={["auto", "auto"]}
                        tickFormatter={v => formatRate(v)}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value: number) => [
                          formatRate(value),
                          `${chartFrom}/${chartTo}`,
                        ]}
                        labelFormatter={label =>
                          new Date(label).toLocaleDateString(undefined, {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })
                        }
                      />
                      {historicalQuery.data.stats && (
                        <ReferenceLine
                          y={historicalQuery.data.stats.average}
                          stroke="#f59e0b"
                          strokeDasharray="5 5"
                          label={{
                            value: "Avg",
                            position: "right",
                            fill: "#f59e0b",
                            fontSize: 11,
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="rate"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#rateGradient)"
                        dot={false}
                        activeDot={{ r: 5, stroke: "#3b82f6", strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Chart Pairs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Quick Chart Pairs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {[
                    { f: "NGN", t: "USD" },
                    { f: "NGN", t: "GBP" },
                    { f: "NGN", t: "EUR" },
                    { f: "USD", t: "EUR" },
                    { f: "GHS", t: "USD" },
                    { f: "KES", t: "USD" },
                    { f: "ZAR", t: "USD" },
                    { f: "USD", t: "BTC" },
                    { f: "ETH", t: "USD" },
                  ].map((pair, i) => (
                    <Button
                      key={i}
                      variant={
                        chartFrom === pair.f && chartTo === pair.t
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setChartFrom(pair.f);
                        setChartTo(pair.t);
                      }}
                    >
                      {pair.f}/{pair.t}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
