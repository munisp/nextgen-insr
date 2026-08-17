import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { MapPin, Search, Shield } from "lucide-react";

// F-12 (S87-02): rewritten against the DELIVERED router (registered as
// `geofencing`, not `geoFencing`). The previous version hid the mismatch
// behind @ts-nocheck + 7 @ts-ignore (4 of which were literal text rendered
// into the JSX) and consumed phantom fields (summary, region, agents,
// violations). Real sources: geofencing.list ({zones, total} of
// geofence_zones rows), geofencing.getStats ({totalZones, activeZones,
// totalChecks}), geofencing.toggle ({id, active}). Per-zone agent counts and
// violation totals have no delivered schema source and are not shown.
export default function AgentGeoFencingPage() {
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.geofencing.list.useQuery({ limit: 50 });
  const { data: stats } = trpc.geofencing.getStats.useQuery();
  const toggleMut = trpc.geofencing.toggle.useMutation({
    onSuccess: () => {
      toast.success("Geo-fence updated");
      utils.geofencing.list.invalidate();
      utils.geofencing.getStats.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const zones = (data?.zones ?? []).filter(
    z => !search || z.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="w-6 h-6" /> Agent Geo-Fencing
          </h1>
          <p className="text-muted-foreground mt-1">
            Define and enforce geographic boundaries for agent operations
          </p>
        </div>
        <Button onClick={() => toast.info("Creating zone...")}>
          <MapPin className="w-4 h-4 mr-1" /> Create Zone
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{stats?.totalZones ?? 0}</p>
            <p className="text-sm text-muted-foreground">Total Zones</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {stats?.activeZones ?? 0}
            </p>
            <p className="text-sm text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {stats?.totalChecks ?? 0}
            </p>
            <p className="text-sm text-muted-foreground">Point Checks</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search zones..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : zones.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No geo-fence zones configured
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {zones.map(z => {
            const radiusM = z.radiusMeters ?? z.radiusMetres ?? null;
            return (
              <Card key={z.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${z.isActive ? "bg-green-100" : "bg-gray-100"}`}
                      >
                        {z.isActive ? (
                          <Shield className="w-4 h-4 text-green-600" />
                        ) : (
                          <MapPin className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{z.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {z.type}
                          {z.description ? ` · ${z.description}` : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={z.isActive ? "outline" : "default"}
                      disabled={toggleMut.isPending}
                      onClick={() =>
                        toggleMut.mutate({
                          id: String(z.id),
                          active: !z.isActive,
                        })
                      }
                    >
                      {z.isActive ? "Disable" : "Enable"}
                    </Button>
                  </div>
                  <div className="text-center text-sm">
                    <p className="font-medium">
                      {radiusM != null ? `${(Number(radiusM) / 1000).toFixed(1)}km` : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">Radius</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
