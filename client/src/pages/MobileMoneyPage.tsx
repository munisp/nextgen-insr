import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Smartphone, Wallet, ArrowUpDown, TrendingUp } from "lucide-react";

export default function MobileMoneyPage() {
  const [search, setSearch] = useState("");
  const providers = trpc.mobileMoney.providers.useQuery();
  const wallets = trpc.mobileMoney.wallets.useQuery({ search, limit: 20 });
  const txns = trpc.mobileMoney.transactions.useQuery({ limit: 20 });
  const analytics = trpc.mobileMoney.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Mobile Money</h1>
          <p className="text-muted-foreground">
            MTN MoMo, Airtel Money, OPay, PalmPay wallet management
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Wallets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.activeWallets ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN {(analytics.data?.totalVolume ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Providers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {providers.data?.providers?.length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Fees
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.totalFees?.toLocaleString() ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {providers.data?.providers?.map((p: any) => (
            <Card key={p.id}>
              <CardContent className="pt-4 flex items-center gap-3">
                <Smartphone className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.type} &bull; {p.currency}
                  </p>
                </div>
                <Badge className="ml-auto">{p.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Wallets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search wallets..."
              className="mb-4 max-w-sm"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Wallet ID</th>
                    <th className="text-left p-2">Provider</th>
                    <th className="text-left p-2">Phone</th>
                    <th className="text-right p-2">Balance</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.data?.wallets?.map((w: any) => (
                    <tr key={w.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{w.id}</td>
                      <td className="p-2">{w.provider}</td>
                      <td className="p-2">{w.phone}</td>
                      <td className="p-2 text-right font-bold">
                        NGN {w.balance?.toLocaleString()}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            w.status === "active" ? "default" : "secondary"
                          }
                        >
                          {w.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5" /> Recent Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Provider</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.data?.transactions?.map((t: any) => (
                    <tr key={t.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{t.id}</td>
                      <td className="p-2">{t.type}</td>
                      <td className="p-2 text-right font-bold">
                        NGN {t.amount?.toLocaleString()}
                      </td>
                      <td className="p-2">{t.provider}</td>
                      <td className="p-2">
                        <Badge
                          variant={
                            t.status === "completed" ? "default" : "destructive"
                          }
                        >
                          {t.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
