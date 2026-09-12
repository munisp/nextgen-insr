import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** J23 P2P risk pooling — real pools in 'forming' status (p2pPoolsRouter). */
export default function P2pPools() {
  const pools = trpc.p2pPools.listPools.useQuery({}, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">P2P Insurance Pools</h1>
      {pools.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load pools: {pools.error.message}
        </CardContent></Card>
      )}
      {pools.data && pools.data.length === 0 && (
        <Card><CardContent className="py-6 text-muted-foreground">
          No pools are currently forming.
        </CardContent></Card>
      )}
      {pools.data?.map(p => (
        <Card key={p.id}><CardContent className="py-4 space-y-1">
          <div className="font-semibold">{p.poolName ?? `Pool #${p.id}`}</div>
          <div className="text-sm">Product: {p.productType}</div>
          <div className="text-sm">
            Contribution: ₦{Number(p.contributionAmount ?? 0).toLocaleString()} ({p.contributionFrequency})
          </div>
          <div className="text-sm text-muted-foreground">Status: {p.status}</div>
        </CardContent></Card>
      ))}
    </div>
  );
}
