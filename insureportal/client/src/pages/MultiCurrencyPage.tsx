import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DashboardLayout from "@/components/DashboardLayout";

export default function MultiCurrencyPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, refetch } = trpc.multiCurrency.dashboard.useQuery();
  if (isLoading)
    return (
      <DashboardLayout>
        <div className="p-8 text-center animate-pulse">Loading...</div>
      </DashboardLayout>
    );
  const d = data as any;
  const entries = Object.entries(d ?? {});
  const numericEntries = entries
    .filter(([_, v]) => typeof v === "number" || typeof v === "string")
    .slice(0, 6);
  const arrayEntries = entries.filter(([_, v]) => Array.isArray(v));
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Multi-Currency</h1>
            <p className="text-muted-foreground">
              Exchange rates insurance_regions and FX settlements
            </p>
          </div>
          <Button onClick={() => refetch()}>Refresh</Button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {numericEntries.map(([k, v]) => (
            <Card key={k}>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">
                  {typeof v === "number" ? v.toLocaleString() : String(v)}
                </div>
                <p className="text-sm text-muted-foreground capitalize">
                  {k.replace(/([A-Z])/g, " $1").trim()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        {arrayEntries.map(([key, arr]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="capitalize">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder={`Search ${key}...`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="mb-4"
              />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {(arr as any[]).length > 0 &&
                      Object.keys((arr as any[])[0])
                        .slice(0, 6)
                        .map(col => (
                          <th key={col} className="p-3 capitalize">
                            {col.replace(/([A-Z])/g, " $1").trim()}
                          </th>
                        ))}
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(arr as any[])
                    .filter(
                      item =>
                        !search ||
                        JSON.stringify(item)
                          .toLowerCase()
                          .includes(search.toLowerCase())
                    )
                    .slice(0, 20)
                    .map((item: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/50">
                        {Object.values(item)
                          .slice(0, 6)
                          .map((val: any, j: number) => (
                            <td key={j} className="p-3">
                              {typeof val === "boolean" ? (
                                <Badge
                                  className={
                                    val ? "bg-green-500" : "bg-red-500"
                                  }
                                >
                                  {val ? "Yes" : "No"}
                                </Badge>
                              ) : typeof val === "number" ? (
                                val.toLocaleString()
                              ) : typeof val === "string" && val.length > 40 ? (
                                val.slice(0, 40) + "..."
                              ) : (
                                String(val ?? "N/A")
                              )}
                            </td>
                          ))}
                        <td className="p-3">
                          <Button size="sm" variant="outline">
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  {(arr as any[]).length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="p-8 text-center text-muted-foreground"
                      >
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
