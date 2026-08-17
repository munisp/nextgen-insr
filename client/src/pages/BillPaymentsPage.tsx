import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Tv, Droplets, Receipt } from "lucide-react";

export default function BillPaymentsPage() {
  const [category, setCategory] = useState<string>("");
  const payments = trpc.billPayments.getHistory.useQuery({
    category: category || undefined,
    limit: 20,
  });
  const billers = trpc.billPayments.getBillers.useQuery();
  const analytics = trpc.billPayments.getSummary.useQuery({});

  const categories = [
    { key: "electricity", label: "Electricity", icon: Zap },
    { key: "cable_tv", label: "Cable TV", icon: Tv },
    { key: "water", label: "Water", icon: Droplets },
    { key: "internet", label: "Internet", icon: Receipt },
    { key: "waste", label: "Waste", icon: Receipt },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Bill Payments</h1>
          <p className="text-muted-foreground">
            NEPA/PHCN, DSTV/GOtv, water, internet, and waste bill payments
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
                Active Billers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {billers.data?.billers?.length ?? 0}
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

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={!category ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory("")}
          >
            All
          </Button>
          {categories.map(c => (
            <Button
              key={c.key}
              variant={category === c.key ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory(c.key)}
            >
              <c.icon className="h-3 w-3 mr-1" />
              {c.label}
            </Button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Bill Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Ref</th>
                    <th className="text-left p-2">Biller</th>
                    <th className="text-left p-2">Category</th>
                    <th className="text-left p-2">Customer</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data?.payments?.map((p: any) => (
                    <tr key={p.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{p.reference}</td>
                      <td className="p-2">{p.billerName}</td>
                      <td className="p-2">
                        <Badge>{p.category}</Badge>
                      </td>
                      <td className="p-2">{p.customerName}</td>
                      <td className="p-2 text-right font-bold">
                        NGN {p.amount?.toLocaleString()}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            p.status === "successful"
                              ? "default"
                              : p.status === "pending"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">
                        {new Date(p.createdAt).toLocaleString()}
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
            <CardTitle>Registered Billers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {billers.data?.billers?.map((b: any) => (
                <div key={b.id} className="border rounded p-3">
                  <p className="font-semibold text-sm">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.category} &bull; {b.code}
                  </p>
                  <Badge
                    variant={b.active ? "default" : "secondary"}
                    className="mt-1"
                  >
                    {b.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
