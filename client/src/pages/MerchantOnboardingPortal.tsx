import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function MerchantOnboardingPortal() {
  const [search, setSearch] = useState("");
  const stats = trpc.merchantOnboardingPortal.getStats.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Merchant Onboarding Portal</h1>
          <p className="text-muted-foreground">
            Self-service merchant registration and KYC verification
          </p>
        </div>
        <Button onClick={() => toast.success("Action triggered")}>
          New Entry
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.data &&
          Object.entries(stats.data)
            .slice(0, 8)
            .map(([key, value]) => (
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
            ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
          <Input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-center py-8">
            {stats.isLoading
              ? "Loading data..."
              : "Data loaded — connect to live database for full records"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
