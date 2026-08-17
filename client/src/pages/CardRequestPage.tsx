import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, Package, Truck, CheckCircle } from "lucide-react";

export default function CardRequestPage() {
  const [tab, setTab] = useState<"requests" | "inventory" | "delivery">(
    "requests"
  );
  const requests = trpc.cardRequest.list.useQuery({ limit: 20 });
  const inventory = trpc.cardRequest.list.useQuery({ limit: 20 });
  const deliveries = trpc.cardRequest.list.useQuery({ limit: 20 });
  const analytics = trpc.cardRequest.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Card Requests</h1>
          <p className="text-muted-foreground">
            Debit card, prepaid card, and virtual card issuance management
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.data?.total ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Cards Issued
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.byStatus?.approved ??
                  analytics.data?.total ??
                  0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-yellow-600">
                {analytics.data?.byStatus?.pending ?? 0}
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
                {analytics.data?.totalFees ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "requests" ? "default" : "outline"}
            onClick={() => setTab("requests")}
          >
            <CreditCard className="h-4 w-4 mr-1" />
            Requests
          </Button>
          <Button
            variant={tab === "inventory" ? "default" : "outline"}
            onClick={() => setTab("inventory")}
          >
            <Package className="h-4 w-4 mr-1" />
            Inventory
          </Button>
          <Button
            variant={tab === "delivery" ? "default" : "outline"}
            onClick={() => setTab("delivery")}
          >
            <Truck className="h-4 w-4 mr-1" />
            Deliveries
          </Button>
        </div>

        {tab === "requests" && (
          <Card>
            <CardHeader>
              <CardTitle>Card Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Request ID</th>
                      <th className="text-left p-2">Customer</th>
                      <th className="text-left p-2">Card Type</th>
                      <th className="text-left p-2">Scheme</th>
                      <th className="text-left p-2">Agent</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.data?.requests?.map((r: any) => (
                      <tr key={r.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{r.requestId}</td>
                        <td className="p-2">{r.customerName}</td>
                        <td className="p-2">
                          <Badge>{r.cardType}</Badge>
                        </td>
                        <td className="p-2">{r.scheme}</td>
                        <td className="p-2">{r.agentName}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              r.status === "delivered"
                                ? "default"
                                : r.status === "processing"
                                  ? "secondary"
                                  : r.status === "rejected"
                                    ? "destructive"
                                    : "outline"
                            }
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(r.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "inventory" && (
          <Card>
            <CardHeader>
              <CardTitle>Card Inventory</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {inventory.data?.requests?.map((item: any) => (
                  <div key={item.id} className="border rounded p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold">{item.cardType}</span>
                      <Badge>{item.scheme}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">In Stock:</span>
                        <p className="font-bold text-green-600">
                          {item.inStock}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Allocated:
                        </span>
                        <p className="font-bold">{item.allocated}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Damaged:</span>
                        <p className="font-bold text-red-600">{item.damaged}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Reorder Level:
                        </span>
                        <p className="font-bold">{item.reorderLevel}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "delivery" && (
          <Card>
            <CardHeader>
              <CardTitle>Card Deliveries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Tracking</th>
                      <th className="text-left p-2">Customer</th>
                      <th className="text-left p-2">Destination</th>
                      <th className="text-left p-2">Courier</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">ETA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.data?.requests?.map((d: any) => (
                      <tr key={d.id} className="border-b">
                        <td className="p-2 font-mono text-xs">
                          {d.trackingNo}
                        </td>
                        <td className="p-2">{d.customerName}</td>
                        <td className="p-2 text-xs">{d.destination}</td>
                        <td className="p-2">{d.courier}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              d.status === "delivered"
                                ? "default"
                                : d.status === "in_transit"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {d.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {d.eta ? new Date(d.eta).toLocaleDateString() : "N/A"}
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
