import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function CacheManagement() {
  const cacheQ = trpc.cache.list.useQuery();
  const invalidate = trpc.cache.invalidate.useMutation({
    onSuccess: () => {
      cacheQ.refetch();
      toast.success("Cache invalidated");
    },
  });
  const invalidateAll = trpc.cache.invalidateAll.useMutation({
    onSuccess: d => {
      cacheQ.refetch();
      toast.success(`${d.invalidated} caches invalidated`);
    },
  });

  const strategyColor: Record<string, string> = {
    ttl: "bg-blue-600",
    event_driven: "bg-green-600",
    manual: "bg-orange-600",
    write_through: "bg-purple-600",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Cache Management</h1>
            <p className="text-gray-400">
              Redis cache entries, hit rates, and invalidation
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => invalidateAll.mutate()}
            >
              Invalidate All
            </Button>
            <a href="/" className="text-sm text-gray-400 hover:text-white">
              ← Back
            </a>
          </div>
        </div>

        {/* Overall Hit Rate */}
        {cacheQ.data && (
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-green-400">
                  {cacheQ.data.avgHitRate}%
                </div>
                <div className="text-sm text-gray-400">Average Hit Rate</div>
              </div>
              <div className="text-sm text-gray-400">
                {cacheQ.data.total} cache patterns
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cache Entries */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Cache Entries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {cacheQ.data?.entries.map(entry => (
                <div key={entry.key} className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-blue-400">
                        {entry.key}
                      </span>
                      <Badge
                        className={`${strategyColor[entry.strategy]} text-white text-xs`}
                      >
                        {entry.strategy.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => invalidate.mutate({ key: entry.key })}
                    >
                      Invalidate
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Hit Rate</span>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${entry.hitRate}%` }}
                          />
                        </div>
                        <span className="text-green-400 text-xs">
                          {entry.hitRate}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-500">TTL</span>
                      <div className="text-white mt-1">
                        {entry.ttlSeconds >= 3600
                          ? `${(entry.ttlSeconds / 3600).toFixed(1)}h`
                          : `${(entry.ttlSeconds / 60).toFixed(0)}m`}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-500">Size</span>
                      <div className="text-white mt-1">{entry.size}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Invalidated</span>
                      <div className="text-white mt-1 text-xs">
                        {entry.lastInvalidatedAt
                          ? new Date(entry.lastInvalidatedAt).toLocaleString()
                          : "Never"}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Pattern: {entry.pattern}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
