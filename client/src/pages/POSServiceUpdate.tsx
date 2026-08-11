import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

/**
 * POSServiceUpdate — POS terminal service/update records.
 * Backed by the posServiceUpdate tRPC router (service_records table).
 */
export default function POSServiceUpdate() {
  const [search, setSearch] = useState("");
  const stats = trpc.posServiceUpdate.getStats.useQuery();
  const list = trpc.posServiceUpdate.list.useQuery({ limit: 20, offset: 0 });

  const records = (list.data?.data ?? []).filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(r.id).includes(q) || String(r.terminalId).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">POS Service Updates</h1>
          <p className="text-muted-foreground">
            Service and maintenance records for POS terminals
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            stats.refetch();
            list.refetch();
          }}
          disabled={stats.isFetching || list.isFetching}
        >
          <RefreshCw className="w-4 h-4 mr-1" />
          {stats.isFetching || list.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {stats.error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            Failed to load statistics: {stats.error.message}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="h-16 animate-pulse bg-muted rounded" />
                </CardContent>
              </Card>
            ))
          : stats.data
            ? Object.entries(stats.data).map(([key, value]) => (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {typeof value === "number"
                        ? value.toLocaleString()
                        : String(value)}
                    </div>
                  </CardContent>
                </Card>
              ))
            : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Service Records</CardTitle>
          <Input
            placeholder="Search by record or terminal ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="text-muted-foreground text-center py-8">
              Loading service records…
            </div>
          ) : list.error ? (
            <div className="text-destructive text-center py-8">
              Failed to load records: {list.error.message}
            </div>
          ) : records.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              No service records found.
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3 text-left">Record ID</th>
                    <th className="p-3 text-left">Terminal ID</th>
                    <th className="p-3 text-left">Recorded At</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="p-3 font-mono">{r.id}</td>
                      <td className="p-3">
                        <Badge variant="outline">{String(r.terminalId)}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {r.createdAt
                          ? new Date(r.createdAt).toLocaleString("en-NG")
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
  );
}
