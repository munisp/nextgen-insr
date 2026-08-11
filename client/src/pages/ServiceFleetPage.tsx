import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

/**
 * ServiceFleetPage — Insurance service fleet management.
 * Backed by the insuranceServiceFleet tRPC router (insurance_services table).
 */
export default function ServiceFleetPage() {
  const [search, setSearch] = useState("");
  const statsQuery = trpc.insuranceServiceFleet.getStats.useQuery();
  const listQuery = trpc.insuranceServiceFleet.list.useQuery({
    limit: 20,
    offset: 0,
    search: search || undefined,
  });

  const items = listQuery.data?.items ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Service Fleet
            </h1>
            <p className="text-muted-foreground mt-1">
              Insurance service fleet status, provisioning, and diagnostics
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              statsQuery.refetch();
              listQuery.refetch();
            }}
            disabled={statsQuery.isFetching || listQuery.isFetching}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            {statsQuery.isFetching || listQuery.isFetching
              ? "Refreshing…"
              : "Refresh"}
          </Button>
        </div>

        {statsQuery.error && (
          <Card>
            <CardContent className="py-4 text-sm text-destructive">
              Failed to load fleet statistics: {statsQuery.error.message}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {statsQuery.isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="h-16 animate-pulse bg-muted rounded" />
                  </CardContent>
                </Card>
              ))
            : statsQuery.data
              ? Object.entries(statsQuery.data).map(([key, value]) => (
                  <Card key={key}>
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </p>
                      <p className="text-2xl font-bold mt-1">
                        {typeof value === "number"
                          ? value.toLocaleString()
                          : String(value)}
                      </p>
                    </CardContent>
                  </Card>
                ))
              : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Fleet Terminals</CardTitle>
            <CardDescription>
              Registered insurance service terminals
            </CardDescription>
            <Input
              placeholder="Search by serial number or model…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <div className="text-muted-foreground text-center py-8">
                Loading fleet…
              </div>
            ) : listQuery.error ? (
              <div className="text-destructive text-center py-8">
                Failed to load fleet: {listQuery.error.message}
              </div>
            ) : items.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">
                No terminals found.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3 text-left">Serial Number</th>
                      <th className="p-3 text-left">Model</th>
                      <th className="p-3 text-center">Status</th>
                      <th className="p-3 text-left">Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => (
                      <tr key={t.id} className="border-t">
                        <td className="p-3 font-mono">{t.serialNumber}</td>
                        <td className="p-3">{t.model}</td>
                        <td className="p-3 text-center">
                          <Badge
                            variant={
                              t.status === "active" ? "default" : "outline"
                            }
                          >
                            {t.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {t.createdAt
                            ? new Date(t.createdAt).toLocaleDateString("en-NG")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
