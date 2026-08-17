import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Shield, AlertTriangle } from "lucide-react";

export default function GeoFencingPage() {
  const zones = trpc.geoFenceDedicated.zones.useQuery();
  const violations = trpc.geoFenceDedicated.agentLocations.useQuery();
  const analytics = trpc.geoFenceDedicated.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Geo-Fencing</h1>
          <p className="text-muted-foreground">
            Agent territory management and location-based compliance
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Zones
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {zones.data?.zones?.length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Zones
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {zones.data?.zones?.filter((z: any) => z.isActive !== false).length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Agents Tracked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                —
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Online Agents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                —
              </p>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" /> Geo-Fence Zones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {zones.data?.zones?.map((z: any) => (
                <div key={z.id} className="border rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{z.name}</span>
                    <Badge
                      variant={z.status === "active" ? "default" : "secondary"}
                    >
                      {z.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {z.state} &bull; {z.type} &bull; {z.radius}km radius
                  </p>
                  <p className="text-xs mt-1">{z.agentCount} agents assigned</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Recent Violations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Agent</th>
                    <th className="text-left p-2">Zone</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Severity</th>
                    <th className="text-left p-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {/* F-12 (wave-4b): agentLocations is fail-loud — no
                      location-tracking store. Rows render only if the
                      backend delivers real data. */}
                  {violations.isError && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">
                        — agent location tracking is not delivered on this platform
                      </td>
                    </tr>
                  )}
                  {(violations.data as { locations?: Array<Record<string, unknown>> } | undefined)?.locations?.map((v: any) => (
                    <tr key={v.id} className="border-b">
                      <td className="p-2">{v.agentName}</td>
                      <td className="p-2">{v.zoneName}</td>
                      <td className="p-2">{v.type}</td>
                      <td className="p-2">
                        <Badge
                          variant={
                            v.severity === "high" ? "destructive" : "secondary"
                          }
                        >
                          {v.severity}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">
                        {new Date(v.detectedAt).toLocaleString()}
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
