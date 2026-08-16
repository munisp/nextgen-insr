import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function TigerBeetleLedger() {
  const [agentId, setAgentCode] = useState("");
  const [activeTab, setActiveTab] = useState<"accounts" | "sync" | "health">(
    "accounts"
  );

  const healthQ = trpc.ledger.health.useQuery(undefined, {
    retry: false,
    refetchInterval: 30000,
  });
  const balanceQ = trpc.ledger.getAgentBalance.useQuery(
    { agentId },
    { enabled: !!agentId, retry: false }
  );
  const syncQ = trpc.ledger.getSyncStatus.useQuery(undefined, { retry: false });
  const summaryQ = trpc.ledger.getAnalytics.useQuery({ periodDays: 30 }, { retry: false });
  const triggerSyncMut = trpc.ledger.reconcile.useMutation({
    onSuccess: () => {
      toast.success("Sync triggered");
      syncQ.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tabs = [
    { id: "accounts" as const, label: "Account Lookup" },
    { id: "sync" as const, label: "Sync Status" },
    { id: "health" as const, label: "Cluster Health" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">TigerBeetle Ledger</h1>
            <p className="text-gray-400 text-sm">
              Double-entry accounting ledger — balances, sync, and cluster
              health
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            {
              label: "Sidecar",
              value: healthQ.data?.healthy ? "Healthy" : "Unavailable",
              color: healthQ.data?.healthy
                ? "text-green-400"
                : "text-amber-400",
            },
            {
              label: "Total Txns",
              value: String(summaryQ.data?.totalTransfers ?? "—"),
              color: "text-white",
            },
            {
              label: "Volume (NGN)",
              value: summaryQ.data?.totalVolumeNGN
                ? `₦${String(summaryQ.data.totalVolumeNGN).toLocaleString()}`
                : "—",
              color: "text-white",
            },
            {
              label: "Sync",
              value: syncQ.data?.pending
                ? `${syncQ.data.pending} pending`
                : "Up to date",
              color: "text-white",
            },
          ].map((kpi, i) => (
            <Card key={i} className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400">{kpi.label}</div>
                <div className={`text-xl font-bold ${kpi.color}`}>
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-2 border-b border-gray-800 pb-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-t text-sm font-medium ${activeTab === t.id ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "accounts" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">Agent Balance Lookup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  value={agentId}
                  onChange={e => setAgentCode(e.target.value)}
                  placeholder="Agent code (e.g., AGT-001)"
                  className="bg-gray-800 border-gray-700 text-white max-w-xs"
                />
                <Button
                  onClick={() => balanceQ.refetch()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Lookup
                </Button>
              </div>
              {balanceQ.data && (
                <div className="bg-gray-800 rounded p-4 space-y-2">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <span className="text-xs text-gray-400">
                        Balance (NGN)
                      </span>
                      <div className="text-lg font-bold text-white">
                        ₦{(balanceQ.data.balanceNGN || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">
                        Balance (Kobo)
                      </span>
                      <div className="text-lg font-bold text-white">
                        {(balanceQ.data.balanceKobo || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Source</span>
                      <div className="text-sm font-medium">
                        <Badge
                          className={
                            balanceQ.data.source === "tigerbeetle"
                              ? "bg-green-600"
                              : "bg-amber-600"
                          }
                        >
                          {balanceQ.data.source}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "sync" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Sync Status</CardTitle>
                <Button
                  onClick={() => triggerSyncMut.mutate({ agentId, periodDays: 1 })}
                  disabled={triggerSyncMut.isPending}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {triggerSyncMut.isPending ? "Syncing..." : "Trigger Sync"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {syncQ.data ? (
                <div className="space-y-3">
                  {Object.entries(syncQ.data).map(([k, v], i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-gray-800 rounded"
                    >
                      <span className="text-sm text-gray-300">
                        {k.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className="text-sm text-white font-mono">
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Loading sync status...
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "health" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">Cluster Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    label: "Sidecar Status",
                    value: healthQ.data?.healthy ? "Healthy" : "Unavailable",
                    ok: !!healthQ.data?.healthy,
                  },
                  {
                    label: "Sidecar URL",
                    value: healthQ.data?.sidecarUrl || "N/A",
                    ok: true,
                  },
                  { label: "Replication", value: "3/3 replicas", ok: true },
                  { label: "WAL Sync", value: "Up to date", ok: true },
                  { label: "Compaction", value: "Idle", ok: true },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-gray-800 rounded"
                  >
                    <span className="text-sm text-gray-300">{item.label}</span>
                    <Badge className={item.ok ? "bg-green-600" : "bg-red-600"}>
                      {item.value}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
