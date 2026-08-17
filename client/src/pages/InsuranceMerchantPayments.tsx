import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Store, QrCode, CreditCard, TrendingUp } from "lucide-react";

export default function MerchantPaymentsPage() {
  const [tab, setTab] = useState<"transactions" | "merchants" | "qr">(
    "transactions"
  );
  const transactions = trpc.merchantPayments.list.useQuery({ limit: 20 });
  const merchants = trpc.merchantPayments.list.useQuery({ limit: 20 });
  const qrCodes = trpc.merchantPayments.list.useQuery({ limit: 20 });
  const analytics = trpc.merchantPayments.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Merchant Payments</h1>
          <p className="text-muted-foreground">
            QR code, NFC, and POS merchant payment acceptance
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
                Transactions
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
                Active Merchants
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.active ?? 0}
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
                {analytics.data?.totalTransactions ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "transactions" ? "default" : "outline"}
            onClick={() => setTab("transactions")}
          >
            <CreditCard className="h-4 w-4 mr-1" />
            Transactions
          </Button>
          <Button
            variant={tab === "merchants" ? "default" : "outline"}
            onClick={() => setTab("merchants")}
          >
            <Store className="h-4 w-4 mr-1" />
            Merchants
          </Button>
          <Button
            variant={tab === "qr" ? "default" : "outline"}
            onClick={() => setTab("qr")}
          >
            <QrCode className="h-4 w-4 mr-1" />
            QR Codes
          </Button>
        </div>

        {tab === "transactions" && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Ref</th>
                      <th className="text-left p-2">Merchant</th>
                      <th className="text-left p-2">Method</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.data?.merchants?.map((t: any) => (
                      <tr key={t.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{t.reference}</td>
                        <td className="p-2">{t.merchantName}</td>
                        <td className="p-2">
                          <Badge>{t.method}</Badge>
                        </td>
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

        {tab === "merchants" && (
          <Card>
            <CardHeader>
              <CardTitle>Registered Merchants</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Category</th>
                      <th className="text-left p-2">LGA</th>
                      <th className="text-right p-2">Volume</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {merchants.data?.merchants?.map((m: any) => (
                      <tr key={m.id} className="border-b">
                        <td className="p-2 font-semibold">{m.businessName}</td>
                        <td className="p-2">{m.category}</td>
                        <td className="p-2">
                          {m.lga}, {m.state}
                        </td>
                        <td className="p-2 text-right">
                          NGN {m.totalVolume?.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              m.status === "active" ? "default" : "secondary"
                            }
                          >
                            {m.status}
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

        {tab === "qr" && (
          <Card>
            <CardHeader>
              <CardTitle>QR Codes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {qrCodes.data?.merchants?.map((q: any) => (
                  <div key={q.id} className="border rounded p-3">
                    <p className="font-semibold">{q.merchantName}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {q.code}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs">{q.type}</span>
                      <Badge variant={q.active ? "default" : "secondary"}>
                        {q.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
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
