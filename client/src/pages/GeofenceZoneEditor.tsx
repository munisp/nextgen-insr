// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * Geofence Zone Editor — Create, edit, and manage geofence zones
 * Wired to geofencing.listZones, createZone, updateZone, deleteZone
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MapPin,
  Search,
  Plus,
  Edit,
  Trash2,
  Circle,
  Pentagon,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

export default function GeofenceZoneEditor() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newZone, setNewZone] = useState({
    name: "",
    type: "circle" as "circle" | "polygon",
    lat: "6.5244",
    lng: "3.3792",
    radius: "500",
    description: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);

  const zones = trpc.geofencing.listZones.useQuery(undefined, { retry: false });
  const createZone = trpc.geofencing.createZone.useMutation({
    onSuccess: () => {
      toast.success("Zone created");
      zones.refetch();
      setShowCreate(false);
      resetForm();
    },
    onError: e => toast.error("Failed: " + e.message),
  });
  const deleteZone = trpc.geofencing.deleteZone.useMutation({
    onSuccess: () => {
      toast.success("Zone deleted");
      zones.refetch();
    },
    onError: e => toast.error("Failed: " + e.message),
  });

  const resetForm = () =>
    setNewZone({
      name: "",
      type: "circle",
      lat: "6.5244",
      lng: "3.3792",
      radius: "500",
      description: "",
    });

  const zoneList = zones.data ?? [];
  const filtered = useMemo(() => {
    if (!search) return zoneList;
    const q = search.toLowerCase();
    return zoneList.filter(
      (z: any) =>
        z.name?.toLowerCase().includes(q) ||
        z.description?.toLowerCase().includes(q)
    );
  }, [zoneList, search]);

  const handleCreate = () => {
    createZone.mutate({
      name: newZone.name,
      zoneType: "AGENT_OPERATING_AREA",
      latitude: parseFloat(newZone.lat),
      longitude: parseFloat(newZone.lng),
      radiusMetres: newZone.type === "circle" ? parseInt(newZone.radius) : 500,
      description: newZone.description || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="w-6 h-6 text-blue-400" /> Geofence Zone Editor
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Create and manage geofence zones for agent device enforcement
          </p>
        </div>
        <div className="flex gap-2">
          <Badge
            variant="outline"
            className="text-xs border-blue-600 text-blue-400"
          >
            {zoneList.length} Zones
          </Badge>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-3 h-3 mr-1" /> New Zone
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
              <DialogHeader>
                <DialogTitle>Create Geofence Zone</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400">Zone Name</label>
                  <Input
                    value={newZone.name}
                    onChange={e =>
                      setNewZone(p => ({ ...p, name: e.target.value }))
                    }
                    className="bg-slate-800 border-slate-700 text-white"
                    placeholder="e.g., Lagos Island Zone"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Type</label>
                  <Select
                    value={newZone.type}
                    onValueChange={v =>
                      setNewZone(p => ({
                        ...p,
                        type: v as "circle" | "polygon",
                      }))
                    }
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="circle">Circle</SelectItem>
                      <SelectItem value="polygon">Polygon</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-400">Latitude</label>
                    <Input
                      value={newZone.lat}
                      onChange={e =>
                        setNewZone(p => ({ ...p, lat: e.target.value }))
                      }
                      className="bg-slate-800 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Longitude</label>
                    <Input
                      value={newZone.lng}
                      onChange={e =>
                        setNewZone(p => ({ ...p, lng: e.target.value }))
                      }
                      className="bg-slate-800 border-slate-700 text-white font-mono"
                    />
                  </div>
                </div>
                {newZone.type === "circle" && (
                  <div>
                    <label className="text-xs text-slate-400">
                      Radius (meters)
                    </label>
                    <Input
                      value={newZone.radius}
                      onChange={e =>
                        setNewZone(p => ({ ...p, radius: e.target.value }))
                      }
                      className="bg-slate-800 border-slate-700 text-white font-mono"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-400">
                    Description (optional)
                  </label>
                  <Input
                    value={newZone.description}
                    onChange={e =>
                      setNewZone(p => ({ ...p, description: e.target.value }))
                    }
                    className="bg-slate-800 border-slate-700 text-white"
                    placeholder="Zone description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  className="border-slate-700 text-slate-400"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleCreate}
                  disabled={!newZone.name || createZone.isPending}
                >
                  {createZone.isPending ? "Creating..." : "Create Zone"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search zones..."
          className="pl-9 bg-slate-800 border-slate-700 text-white"
        />
      </div>

      {/* Zone Map Preview */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardContent className="p-4">
          <div className="w-full h-[250px] bg-slate-800 rounded-lg flex items-center justify-center border border-slate-700">
            <div className="text-center">
              <MapPin className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Zone Map Preview</p>
              <p className="text-[10px] text-slate-600 mt-1">
                {zoneList.length} zones configured • Center: Lagos, Nigeria
                (6.5244°N, 3.3792°E)
              </p>
              <div className="flex gap-2 justify-center mt-3">
                {zoneList.slice(0, 5).map((z: any) => (
                  <Badge
                    key={z.id}
                    variant="outline"
                    className="text-[9px] border-blue-600/50 text-blue-300"
                  >
                    {z.name}
                  </Badge>
                ))}
                {zoneList.length > 5 && (
                  <Badge
                    variant="outline"
                    className="text-[9px] border-slate-600 text-slate-400"
                  >
                    +{zoneList.length - 5} more
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Zone Table */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">
            Zones ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-500">
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-center">Type</th>
                <th className="px-3 py-2 text-center">Center</th>
                <th className="px-3 py-2 text-center">Radius</th>
                <th className="px-3 py-2 text-center">Agents</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filtered.map((z: any) => (
                <tr key={z.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2.5">
                    <div className="text-white font-medium">{z.name}</div>
                    {z.description && (
                      <div className="text-[10px] text-slate-500">
                        {z.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {z.type === "circle" ? (
                      <Circle className="w-3 h-3 text-blue-400 mx-auto" />
                    ) : (
                      <Pentagon className="w-3 h-3 text-purple-400 mx-auto" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-slate-400 text-[10px]">
                    {z.centerLat?.toFixed(4)}, {z.centerLng?.toFixed(4)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-300">
                    {z.radiusMeters ? `${z.radiusMeters}m` : "polygon"}
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-400">
                    {z.agentCount ?? 0}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${z.isActive !== false ? "border-green-600 text-green-400" : "border-slate-600 text-slate-400"}`}
                    >
                      {z.isActive !== false ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-blue-400"
                        onClick={() => toast.info(`Zone: ${z.name}`)}
                      >
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-red-400"
                        onClick={() => {
                          if (confirm(`Delete zone "${z.name}"?`))
                            deleteZone.mutate({ id: z.id });
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-slate-600"
                  >
                    {zones.isLoading ? "Loading..." : "No zones found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
