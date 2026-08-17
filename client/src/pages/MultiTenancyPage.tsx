import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Activity } from "lucide-react";

export default function MultiTenancyPage() {
  const { data } = trpc.multiTenancy.dashboard.useQuery();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Multi-Tenancy Management</h1>
        <p className="text-muted-foreground">
          Tenant provisioning, resource allocation, white-label configuration
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Tenants", value: data?.totalTenants ?? 0 },
          { label: "Active", value: data?.activeTenants ?? 0 },
          {
            label: "Total Agents",
            value: (data?.totalAgents ?? 0).toLocaleString(),
          },
          {
            label: "Total Transactions",
            value: (data?.totalTransactions ?? 0).toLocaleString(),
          },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tenants</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Agents</th>
                <th className="text-left p-2">Plan</th>
                <th className="text-left p-2">Volume/mo</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.tenants ?? []).map((t: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2">{t.agents}</td>
                  <td className="p-2">
                    <Badge>{t.plan}</Badge>
                  </td>
                  <td className="p-2">{t.monthlyVolume?.toLocaleString()}</td>
                  <td className="p-2">
                    <Badge
                      variant={
                        t.status === "active" ? "default" : "destructive"
                      }
                    >
                      {t.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
