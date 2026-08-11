import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Wallet, AlertTriangle, Lock, Users } from "lucide-react";

function formatNaira(n: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(n);
}

/**
 * FloatManagementPage — Agent premium reserve (float) overview.
 * Backed by the floatManagement tRPC router (getSummary / getBalance).
 */
export default function FloatManagementPage() {
  const summary = trpc.floatManagement.getSummary.useQuery();
  const [agentIdInput, setAgentIdInput] = useState("");
  const [lookupId, setLookupId] = useState<number | null>(null);
  const balance = trpc.floatManagement.getBalance.useQuery(
    { agentId: lookupId ?? 0 },
    { enabled: lookupId !== null, retry: 0 }
  );

  const s = summary.data;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Float Management</h1>
            <p className="text-sm text-muted-foreground">
              Agent premium reserve balances, limits, and lock status
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => summary.refetch()}
            disabled={summary.isFetching}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {summary.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {summary.error && (
          <Card>
            <CardContent className="py-4 text-sm text-destructive">
              Failed to load float summary: {summary.error.message}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {summary.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="h-16 animate-pulse bg-muted rounded" />
                </CardContent>
              </Card>
            ))
          ) : s ? (
            <>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Wallet className="h-4 w-4" /> Total Float
                  </div>
                  <div className="text-2xl font-bold">
                    {formatNaira(s.totalFloatNGN)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    across {s.totalAgents.toLocaleString()} agents
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Users className="h-4 w-4" /> Active Agents
                  </div>
                  <div className="text-2xl font-bold">
                    {s.activeAgents.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    of {s.totalAgents.toLocaleString()} total
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <AlertTriangle className="h-4 w-4" /> Below Minimum Float
                  </div>
                  <div className="text-2xl font-bold">
                    {s.agentsBelowMinFloat.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    minimum {formatNaira(s.minFloatNGN)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <Lock className="h-4 w-4" /> Locked Agents
                  </div>
                  <div className="text-2xl font-bold">
                    {s.lockedAgents.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    float currently locked
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        {s && (
          <Card>
            <CardHeader>
              <CardTitle>Float Policy Limits</CardTitle>
              <CardDescription>
                CBN agent banking guidelines enforced by the platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Minimum Float</div>
                  <div className="font-semibold">{formatNaira(s.minFloatNGN)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Maximum Float</div>
                  <div className="font-semibold">{formatNaira(s.maxFloatNGN)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Daily Top-Up Limit</div>
                  <div className="font-semibold">
                    {formatNaira(s.dailyTopUpLimitNGN)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Agent Balance Lookup</CardTitle>
            <CardDescription>
              Look up the live float balance for an agent by numeric ID
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 max-w-sm">
              <Input
                type="number"
                min={1}
                placeholder="Agent ID"
                value={agentIdInput}
                onChange={e => setAgentIdInput(e.target.value)}
              />
              <Button
                onClick={() => {
                  const id = Number(agentIdInput);
                  if (Number.isInteger(id) && id > 0) setLookupId(id);
                }}
                disabled={!agentIdInput || balance.isFetching}
              >
                {balance.isFetching ? "Loading…" : "Look Up"}
              </Button>
            </div>
            {lookupId !== null && balance.error && (
              <div className="text-sm text-destructive">
                {balance.error.message}
              </div>
            )}
            {lookupId !== null && balance.data && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Agent Code</div>
                  <div className="font-semibold font-mono">
                    {balance.data.agentCode}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Balance</div>
                  <div className="font-semibold">
                    {formatNaira(balance.data.balanceNGN)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Source</div>
                  <div className="font-semibold">{balance.data.source}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Float Locked</div>
                  <div className="font-semibold">
                    {balance.data.floatLocked ? "Yes" : "No"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    Daily Top-Up Remaining
                  </div>
                  <div className="font-semibold">
                    {formatNaira(balance.data.dailyTopUpRemaining)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Can Transact</div>
                  <div className="font-semibold">
                    {balance.data.canTransact ? "Yes" : "No"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
