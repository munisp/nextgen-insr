import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserPlus, Building, FileCheck, TrendingUp } from "lucide-react";

export default function AccountOpeningPage() {
  const [tab, setTab] = useState<"applications" | "accounts" | "banks">(
    "applications"
  );
  const applications = trpc.accountOpening.list.useQuery({ limit: 20 });
  const accounts = trpc.accountOpening.list.useQuery({ limit: 20 });
  const banks = trpc.accountOpening.analytics.useQuery();
  const analytics = trpc.accountOpening.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Account Opening</h1>
          <p className="text-muted-foreground">
            Agent-facilitated bank account opening — Tier 1, 2, 3 accounts per
            CBN guidelines
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Opened
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.data?.total ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Pending KYC
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
                Conversion Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.conversionRate ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Partner Banks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {Object.keys(banks.data?.byBank ?? {}).length ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "applications" ? "default" : "outline"}
            onClick={() => setTab("applications")}
          >
            <FileCheck className="h-4 w-4 mr-1" />
            Applications
          </Button>
          <Button
            variant={tab === "accounts" ? "default" : "outline"}
            onClick={() => setTab("accounts")}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            Accounts
          </Button>
          <Button
            variant={tab === "banks" ? "default" : "outline"}
            onClick={() => setTab("banks")}
          >
            <Building className="h-4 w-4 mr-1" />
            Banks
          </Button>
        </div>

        {tab === "applications" && (
          <Card>
            <CardHeader>
              <CardTitle>Account Applications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Applicant</th>
                      <th className="text-left p-2">Bank</th>
                      <th className="text-left p-2">Tier</th>
                      <th className="text-left p-2">BVN</th>
                      <th className="text-left p-2">Agent</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.data?.applications?.map((a: any) => (
                      <tr key={a.id} className="border-b">
                        <td className="p-2">{a.applicantName}</td>
                        <td className="p-2">{a.bankName}</td>
                        <td className="p-2">
                          <Badge>Tier {a.tier}</Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {a.bvn ? `${a.bvn.slice(0, 4)}****` : "N/A"}
                        </td>
                        <td className="p-2">{a.agentName}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              a.status === "approved"
                                ? "default"
                                : a.status === "pending"
                                  ? "secondary"
                                  : a.status === "rejected"
                                    ? "destructive"
                                    : "outline"
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(a.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "accounts" && (
          <Card>
            <CardHeader>
              <CardTitle>Opened Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Account No</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Bank</th>
                      <th className="text-left p-2">Tier</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.data?.applications?.map((a: any) => (
                      <tr key={a.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{a.accountNo}</td>
                        <td className="p-2">{a.customerName}</td>
                        <td className="p-2">{a.bankName}</td>
                        <td className="p-2">
                          <Badge>Tier {a.tier}</Badge>
                        </td>
                        <td className="p-2">{a.accountType}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              a.status === "active" ? "default" : "secondary"
                            }
                          >
                            {a.status}
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

        {tab === "banks" && (
          <Card>
            <CardHeader>
              <CardTitle>Partner Banks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Object.entries(banks.data?.byBank ?? {})?.map((b: any) => (
                  <div key={b.id} className="border rounded p-3">
                    <p className="font-bold">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.code} &bull; {b.tiersSupported?.join(", ")}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs">
                        {b.accountsOpened} accounts
                      </span>
                      <Badge variant={b.active ? "default" : "secondary"}>
                        {b.active ? "Active" : "Inactive"}
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
