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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export default function ServiceFleetPage() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const statsQuery = trpc.insuranceServiceFleet.getStats.useQuery();

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Terminal Fleet
            </h1>
            <p className="text-muted-foreground mt-1">
              insurance service fleet management, diagnostics, and firmware
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-64"
            />
            <Button
              onClick={() => toast.success("Data refreshed successfully")}
            >
              Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {statsQuery.isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i}>
                      <CardContent className="p-6">
                        <div className="h-20 animate-pulse bg-muted rounded" />
                      </CardContent>
                    </Card>
                  ))
                : statsQuery.data
                  ? Object.entries(statsQuery.data)
                      .slice(0, 4)
                      .map(([key, value]) => (
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
                <CardTitle>Terminal Fleet Dashboard</CardTitle>
                <CardDescription>
                  Real-time metrics and operational data
                </CardDescription>
              </CardHeader>
              <CardContent>
                {statsQuery.isLoading ? (
                  <div className="h-64 animate-pulse bg-muted rounded" />
                ) : statsQuery.data ? (
                  <div className="space-y-4">
                    {Object.entries(statsQuery.data).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <span className="text-sm font-medium capitalize">
                          {key.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <Badge variant="outline">
                          {typeof value === "object"
                            ? JSON.stringify(value).slice(0, 50)
                            : typeof value === "number"
                              ? value.toLocaleString()
                              : String(value)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No data available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details">
            <Card>
              <CardHeader>
                <CardTitle>Detailed View</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Select items from the overview to view details.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Configure Terminal Fleet settings and preferences.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => toast.success("Configuration updated")}
                  >
                    Save Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
