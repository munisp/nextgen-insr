import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, FileText, Users, TrendingUp } from "lucide-react";

export default function InsuranceProductsPage() {
  const [tab, setTab] = useState<"products" | "policies" | "claims">(
    "products"
  );
  const products = trpc.insuranceProducts.products.useQuery();
  const policies = trpc.insuranceProducts.policies.useQuery({ limit: 20 });
  const claims = trpc.insuranceProducts.policies.useQuery({ limit: 20 });
  const analytics = trpc.insuranceProducts.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Insurance Products</h1>
          <p className="text-muted-foreground">
            Micro-insurance products — health, crop, livestock, device, and life
            cover
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Premiums
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN{" "}
                {(analytics.data?.totalPremiumCollected ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Policies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.activePolicies ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Claims Paid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN {(analytics.data?.totalClaimsPaid ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Lapsed Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.lapsedRate ?? 0}%
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "products" ? "default" : "outline"}
            onClick={() => setTab("products")}
          >
            <Shield className="h-4 w-4 mr-1" />
            Products
          </Button>
          <Button
            variant={tab === "policies" ? "default" : "outline"}
            onClick={() => setTab("policies")}
          >
            <FileText className="h-4 w-4 mr-1" />
            Policies
          </Button>
          <Button
            variant={tab === "claims" ? "default" : "outline"}
            onClick={() => setTab("claims")}
          >
            <Users className="h-4 w-4 mr-1" />
            Claims
          </Button>
        </div>

        {tab === "products" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.data?.products?.map((p: any) => (
              <Card key={p.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold">{p.name}</h3>
                    <Badge>{p.category}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {p.description}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Premium:</span>
                      <p className="font-bold">
                        NGN {p.premiumFrom?.toLocaleString()} -{" "}
                        {p.premiumTo?.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cover:</span>
                      <p className="font-bold">
                        NGN {p.coverAmount?.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Duration:</span>
                      <p className="font-bold">{p.duration}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Provider:</span>
                      <p className="font-bold">{p.provider}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "policies" && (
          <Card>
            <CardHeader>
              <CardTitle>Active Policies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Policy No</th>
                      <th className="text-left p-2">Customer</th>
                      <th className="text-left p-2">Product</th>
                      <th className="text-right p-2">Premium</th>
                      <th className="text-right p-2">Cover</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.data?.policies?.map((p: any) => (
                      <tr key={p.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{p.policyNo}</td>
                        <td className="p-2">{p.customerName}</td>
                        <td className="p-2">{p.productName}</td>
                        <td className="p-2 text-right">
                          NGN {p.premium?.toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-bold">
                          NGN {p.coverAmount?.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              p.status === "active" ? "default" : "secondary"
                            }
                          >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(p.expiryDate).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "claims" && (
          <Card>
            <CardHeader>
              <CardTitle>Insurance Claims</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Claim ID</th>
                      <th className="text-left p-2">Policy</th>
                      <th className="text-left p-2">Claimant</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Reason</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.data?.policies?.map((c: any) => (
                      <tr key={c.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{c.claimId}</td>
                        <td className="p-2 text-xs">{c.policyNo}</td>
                        <td className="p-2">{c.claimantName}</td>
                        <td className="p-2 text-right font-bold">
                          NGN {c.amount?.toLocaleString()}
                        </td>
                        <td className="p-2 text-xs">{c.reason}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              c.status === "approved"
                                ? "default"
                                : c.status === "pending"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {c.status}
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
      </div>
    </DashboardLayout>
  );
}
