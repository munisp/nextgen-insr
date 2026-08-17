import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Smartphone, Signal, Wifi, Phone } from "lucide-react";

export default function AirtimeVendingPage() {
  const [tab, setTab] = useState<"airtime" | "data" | "bundles">("airtime");
  const airtimeTxns = trpc.airtimeVending.getHistory.useQuery({
    type: "airtime",
    limit: 20,
  });
  const dataTxns = trpc.airtimeVending.getHistory.useQuery({
    type: "data",
    limit: 20,
  });
  // F-12 (S87-02): airtimeVending.dataBundles is not delivered — the bundle
  // catalog renders an honest empty state.
  const bundles: { data?: Array<Record<string, unknown>>; isLoading: boolean } = { data: undefined, isLoading: false };
  const analytics = trpc.airtimeVending.getSummary.useQuery({});

  const networks = ["MTN", "Airtel", "Glo", "9mobile"];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Airtime & Data Vending</h1>
          <p className="text-muted-foreground">
            Airtime top-up and data bundle sales for all Nigerian networks
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN {(analytics.data?.volumeNGN ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Transactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {(analytics.data?.total ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Commission
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN {(analytics.data?.commissionNGN ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Success Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                —%
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "airtime" ? "default" : "outline"}
            onClick={() => setTab("airtime")}
          >
            <Phone className="h-4 w-4 mr-1" />
            Airtime
          </Button>
          <Button
            variant={tab === "data" ? "default" : "outline"}
            onClick={() => setTab("data")}
          >
            <Wifi className="h-4 w-4 mr-1" />
            Data
          </Button>
          <Button
            variant={tab === "bundles" ? "default" : "outline"}
            onClick={() => setTab("bundles")}
          >
            <Signal className="h-4 w-4 mr-1" />
            Bundles
          </Button>
        </div>

        {(tab === "airtime" || tab === "data") && (
          <Card>
            <CardHeader>
              <CardTitle>
                {tab === "airtime" ? "Airtime" : "Data"} Transactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Ref</th>
                      <th className="text-left p-2">Network</th>
                      <th className="text-left p-2">Phone</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === "airtime"
                      ? airtimeTxns
                      : dataTxns
                    ).data?.data?.map((t: any) => (
                      <tr key={t.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{t.reference}</td>
                        <td className="p-2">
                          <Badge>{t.network}</Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">{t.phone}</td>
                        <td className="p-2 text-right font-bold">
                          NGN {t.amount?.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              t.status === "successful"
                                ? "default"
                                : t.status === "pending"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {t.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(t.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "bundles" && (
          <Card>
            <CardHeader>
              <CardTitle>Available Data Bundles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {((bundles.data ?? []) as any[]).map((b: any) => (
                  <div key={b.id} className="border rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <Badge>{b.network}</Badge>
                      <span className="font-bold">
                        NGN {b.price?.toLocaleString()}
                      </span>
                    </div>
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.dataSize} &bull; {b.validity}
                    </p>
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
