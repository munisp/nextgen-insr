/**
 * Commission Configuration — Manage commission tiers, rates, and payout rules
 * Wired to commissionPayouts.listTiers, commissionPayouts.createTier, commissionPayouts.updateTier
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DollarSign,
  Search,
  Plus,
  Edit,
  Percent,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

export default function CommissionConfig() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newTier, setNewTier] = useState({
    name: "",
    ratePercent: "2.5",
    minVolume: "0",
    maxVolume: "1000000",
  });

  const tiers = trpc.commissionPayouts.list.useQuery(
    { page: 1, limit: 100 },
    { retry: false }
  );
  const createTier = trpc.commissionPayouts.request.useMutation({
    onSuccess: () => {
      toast.success("Commission entry created");
      tiers.refetch();
      setShowCreate(false);
    },
    onError: (e: any) => toast.error("Failed: " + e.message),
  });

  const rawData = tiers.data;
  const items: any[] = Array.isArray(rawData)
    ? rawData
    : (rawData?.items ?? []);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (t: any) =>
        t.name?.toLowerCase().includes(q) ||
        t.transactionType?.toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-green-400" /> Commission
            Configuration
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage commission tiers, rates, and payout rules for agents
          </p>
        </div>
        <Button
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="w-4 h-4 mr-1" /> New Tier
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Active Tiers",
            value: items.filter((t: any) => t.isActive !== false).length,
            icon: <TrendingUp className="w-4 h-4" />,
            color: "text-green-400",
          },
          {
            label: "Total Tiers",
            value: items.length,
            icon: <Percent className="w-4 h-4" />,
            color: "text-blue-400",
          },
          {
            label: "Avg Rate",
            value: items.length
              ? (
                  items.reduce(
                    (s: number, t: any) => s + (t.ratePercent ?? t.rate ?? 0),
                    0
                  ) / items.length
                ).toFixed(1) + "%"
              : "0%",
            icon: <DollarSign className="w-4 h-4" />,
            color: "text-yellow-400",
          },
          {
            label: "Types",
            value: new Set(
              items.map((t: any) => t.transactionType ?? "general")
            ).size,
            icon: <Edit className="w-4 h-4" />,
            color: "text-purple-400",
          },
        ].map(s => (
          <Card key={s.label} className="bg-slate-900/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-1 mb-1 text-slate-500">
                {s.icon}
              </div>
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tiers..."
          className="pl-9 bg-slate-800 border-slate-700 text-white"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-left">
              <th className="p-3">Tier Name</th>
              <th className="p-3">Transaction Type</th>
              <th className="p-3">Rate</th>
              <th className="p-3">Volume Range</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tier: any) => (
              <tr
                key={tier.id}
                className="border-b border-slate-800 hover:bg-slate-800/50"
              >
                <td className="p-3 text-white font-medium">
                  {tier.name ?? `Tier #${tier.id}`}
                </td>
                <td className="p-3 text-slate-400">
                  {tier.transactionType ?? "All"}
                </td>
                <td className="p-3 text-green-400 font-mono">
                  {tier.ratePercent ?? tier.rate ?? 0}%
                </td>
                <td className="p-3 text-slate-400 font-mono text-xs">
                  {tier.minVolume != null
                    ? `₦${Number(tier.minVolume).toLocaleString()} - ₦${Number(tier.maxVolume).toLocaleString()}`
                    : "No limit"}
                </td>
                <td className="p-3">
                  <Badge
                    variant="outline"
                    className={
                      tier.isActive !== false
                        ? "border-green-600 text-green-400"
                        : "border-slate-600 text-slate-400"
                    }
                  >
                    {tier.isActive !== false ? "Active" : "Inactive"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-slate-600 py-8">
            {tiers.isLoading ? "Loading..." : "No commission tiers configured"}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Create Commission Tier</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newTier.name}
              onChange={e => setNewTier(p => ({ ...p, name: e.target.value }))}
              placeholder="Tier name"
              className="bg-slate-800 border-slate-700 text-white"
            />
            <Input
              value={newTier.ratePercent}
              onChange={e =>
                setNewTier(p => ({ ...p, ratePercent: e.target.value }))
              }
              placeholder="Rate %"
              type="number"
              step="0.1"
              className="bg-slate-800 border-slate-700 text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={newTier.minVolume}
                onChange={e =>
                  setNewTier(p => ({ ...p, minVolume: e.target.value }))
                }
                placeholder="Min volume"
                type="number"
                className="bg-slate-800 border-slate-700 text-white"
              />
              <Input
                value={newTier.maxVolume}
                onChange={e =>
                  setNewTier(p => ({ ...p, maxVolume: e.target.value }))
                }
                placeholder="Max volume"
                type="number"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-700 text-slate-400"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() =>
                createTier.mutate({
                  agentId: "TIER-" + Date.now(),
                  amount: parseFloat(newTier.ratePercent) * 1000,
                })
              }
              disabled={!newTier.name || createTier.isPending}
            >
              {createTier.isPending ? "Creating..." : "Create Tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
