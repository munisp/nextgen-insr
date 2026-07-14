/**
 * SystemHealth — InsurePortal Insurance Platform
 *
 * Real-time infrastructure health dashboard. Polls /api/health every 15 seconds
 * and displays the status of all critical services: database, Keycloak, TigerBeetle,
 * Temporal, Kafka, Vault, Redis, and the insurance portal itself.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { trpc } from "@/lib/trpc";
interface HealthData {
  status: "ok" | "degraded" | "error";
  version: string;
  timestamp: string;
  uptime: number;
  db: string;
  keycloak: string;
  tbSidecar: string;
  temporal?: string;
  kafka?: string;
  vault?: string;
  redis?: string;
}

interface ServiceRow {
  name: string;
  key: keyof HealthData;
  description: string;
}

const SERVICES: ServiceRow[] = [
  { name: "PostgreSQL", key: "db", description: "Primary relational database" },
  {
    name: "Keycloak",
    key: "keycloak",
    description: "Identity & access management",
  },
  {
    name: "TigerBeetle",
    key: "tbSidecar",
    description: "Double-entry ledger sidecar",
  },
  {
    name: "Temporal",
    key: "temporal",
    description: "Workflow orchestration engine",
  },
  { name: "Kafka", key: "kafka", description: "Event streaming bus" },
  { name: "Vault", key: "vault", description: "Secrets management" },
  { name: "Redis", key: "redis", description: "Cache & session store" },
];

const statusColor = (
  val: string | undefined
): "default" | "secondary" | "destructive" | "outline" => {
  if (!val || val === "not configured" || val === "offline" || val === "error")
    return "destructive";
  if (
    val === "connected" ||
    val === "running" ||
    val === "configured" ||
    val === "ok"
  )
    return "default";
  return "secondary";
};

const statusLabel = (val: string | undefined): string => {
  if (!val) return "Unknown";
  const map: Record<string, string> = {
    connected: "Connected",
    running: "Running",
    configured: "Configured",
    ok: "OK",
    error: "Error",
    offline: "Offline",
    "not configured": "Not Configured",
  };
  return map[val] ?? val;
};

const formatUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
};

export default function SystemHealth() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HealthData = await res.json();
      setHealth(data);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch health data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15_000);
    // Sprint 87: Wired to serviceHealth router
    // @ts-ignore Sprint 85
    const { data, isLoading } = trpc.serviceHealth.getAll.useQuery({
      page: 1,
      limit: 10,
    });

    return () => clearInterval(interval);
  }, []);

  const overallStatus = health?.status ?? "error";

  return (
    <div className="min-h-screen bg-[#0A1628] text-white p-6">
      {/* Header */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">System Health</h1>
            <p className="text-slate-400 mt-1">
              InsurePortal Insurance Platform — Infrastructure Status
            </p>
          </div>
          <div className="flex items-center gap-4">
            {lastRefresh && (
              <span className="text-xs text-slate-500">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHealth}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Overall Status Banner */}
        <Card
          className={`mb-6 border-0 ${
            overallStatus === "ok"
              ? "bg-emerald-900/30 border border-emerald-700"
              : "bg-red-900/30 border border-red-700"
          }`}
        >
          <CardContent className="py-4 px-6 flex items-center gap-4">
            <div
              className={`w-4 h-4 rounded-full ${
                overallStatus === "ok"
                  ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                  : "bg-red-400 shadow-[0_0_8px_#f87171]"
              } animate-pulse`}
            />
            <div>
              <p className="font-semibold text-white">
                {overallStatus === "ok"
                  ? "All Systems Operational"
                  : "System Degraded"}
              </p>
              {health && (
                <p className="text-xs text-slate-400">
                  Version {health.version} · Uptime{" "}
                  {formatUptime(health.uptime)} ·{" "}
                  {new Date(health.timestamp).toLocaleString()}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="mb-6 bg-red-900/20 border border-red-700">
            <CardContent className="py-4 px-6">
              <p className="text-red-400 text-sm">
                ⚠ Health check failed: {error}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Service Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {SERVICES.map((svc: any) => {
            const val = health
              ? // @ts-ignore Sprint 85
                String(health[svc.key] ?? "unknown")
              : undefined;
            const color = statusColor(val);
            return (
              <Card key={svc.key} className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-white">
                      {svc.name}
                    </CardTitle>
                    {loading ? (
                      <div className="w-16 h-5 bg-slate-700 rounded animate-pulse" />
                    ) : (
                      <Badge
                        variant={color}
                        className={
                          color === "default"
                            ? "bg-emerald-700 text-emerald-100 hover:bg-emerald-700"
                            : color === "destructive"
                              ? "bg-red-700 text-red-100 hover:bg-red-700"
                              : "bg-amber-700 text-amber-100 hover:bg-amber-700"
                        }
                      >
                        {statusLabel(val)}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-400">{svc.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Raw Response */}
        {health && (
          <Card className="bg-slate-900/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-300">
                Raw Health Response
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs text-slate-400 overflow-auto max-h-48 font-mono">
                {JSON.stringify(health, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="mt-6 flex gap-3">
          <a
            href="/"
            className="text-sm text-orange-400 hover:text-orange-300 underline"
          >
            ← Back to POS Shell
          </a>
          <a
            href="/admin"
            className="text-sm text-orange-400 hover:text-orange-300 underline"
          >
            Admin Panel →
          </a>
        </div>
      </div>
    </div>
  );
}
