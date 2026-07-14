import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Send, Globe, ArrowLeftRight, TrendingUp } from "lucide-react";

export default function RemittancePage() {
  const [tab, setTab] = useState<"transfers" | "insurance_regions" | "rates">(
    "transfers"
  );
  // @ts-ignore Sprint 85
  const transfers = trpc.remittanceDedicated.history.useQuery({ limit: 20 });
  // @ts-ignore Sprint 85
  const insurance_regions = trpc.remittanceDedicated.partners.useQuery();
  // @ts-ignore Sprint 85
  const rates = trpc.remittanceDedicated.analytics.useQuery();
  // @ts-ignore Sprint 85
  const analytics = trpc.remittanceDedicated.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Remittance</h1>
          <p className="text-muted-foreground">
            Domestic and international money transfers — IMTOs, bank transfers,
            mobile money
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
                NGN {(analytics.data?.totalVolume ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Transfers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {(analytics.data?.totalTransactions ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Partners
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {insurance_regions.data?.partners?.length ?? 0}
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
                NGN {(analytics.data?.totalCommission ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "transfers" ? "default" : "outline"}
            onClick={() => setTab("transfers")}
          >
            <Send className="h-4 w-4 mr-1" />
            Transfers
          </Button>
          <Button
            variant={tab === "insurance_regions" ? "default" : "outline"}
            onClick={() => setTab("insurance_regions")}
          >
            <Globe className="h-4 w-4 mr-1" />
            InsuranceRegions
          </Button>
          <Button
            variant={tab === "rates" ? "default" : "outline"}
            onClick={() => setTab("rates")}
          >
            <ArrowLeftRight className="h-4 w-4 mr-1" />
            Exchange Rates
          </Button>
        </div>

        {tab === "transfers" && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Transfers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Ref</th>
                      <th className="text-left p-2">Sender</th>
                      <th className="text-left p-2">Recipient</th>
                      <th className="text-left p-2">InsuranceRegion</th>
                      <th className="text-right p-2">Send Amt</th>
                      <th className="text-right p-2">Receive Amt</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.data?.transactions?.map((t: any) => (
                      <tr key={t.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{t.reference}</td>
                        <td className="p-2">{t.senderName}</td>
                        <td className="p-2">{t.recipientName}</td>
                        <td className="p-2">
                          <Badge>{t.insurance_region}</Badge>
                        </td>
                        <td className="p-2 text-right">
                          {t.sendCurrency} {t.sendAmount?.toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-bold">
                          {t.receiveCurrency}{" "}
                          {t.receiveAmount?.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              t.status === "completed"
                                ? "default"
                                : t.status === "pending"
                                  ? "secondary"
                                  : "destructive"
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
        )}

        {tab === "insurance_regions" && (
          <Card>
            <CardHeader>
              <CardTitle>Transfer InsuranceRegions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {insurance_regions.data?.partners?.map((c: any) => (
                  <div key={c.id} className="border rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold">{c.name}</span>
                      <Badge variant={c.active ? "default" : "secondary"}>
                        {c.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.sourceCountry} → {c.destCountry}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs">
                        Fee:{" "}
                        {c.feeType === "flat"
                          ? `NGN ${c.fee?.toLocaleString()}`
                          : `${c.feePercent}%`}
                      </span>
                      <span className="text-xs">{c.provider}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "rates" && (
          <Card>
            <CardHeader>
              <CardTitle>Exchange Rates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Pair</th>
                      <th className="text-right p-2">Buy Rate</th>
                      <th className="text-right p-2">Sell Rate</th>
                      <th className="text-right p-2">Mid Rate</th>
                      <th className="text-left p-2">Provider</th>
                      <th className="text-left p-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.data?.byPartner?.map((r: any) => (
                      <tr key={r.id} className="border-b">
                        <td className="p-2 font-bold">
                          {r.baseCurrency}/{r.quoteCurrency}
                        </td>
                        <td className="p-2 text-right">
                          {r.buyRate?.toFixed(2)}
                        </td>
                        <td className="p-2 text-right">
                          {r.sellRate?.toFixed(2)}
                        </td>
                        <td className="p-2 text-right font-bold">
                          {r.midRate?.toFixed(2)}
                        </td>
                        <td className="p-2">{r.provider}</td>
                        <td className="p-2 text-xs">
                          {new Date(r.updatedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
