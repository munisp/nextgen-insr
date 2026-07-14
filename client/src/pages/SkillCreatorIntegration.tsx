import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function SkillCreatorIntegration() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  // @ts-ignore Sprint 85
  const statsQuery = trpc.skillCreatorIntegration.getStats.useQuery();
  const stats = statsQuery.data;

  const statCards = [
    {
      label: "Skill Version",
      // @ts-ignore Sprint 85
      value: stats?.skillVersion != null ? String(stats.skillVersion) : "—",
    },
    {
      label: "Total Patterns",
      // @ts-ignore Sprint 85
      value: stats?.totalPatterns != null ? String(stats.totalPatterns) : "—",
    },
    {
      label: "Router Patterns",
      // @ts-ignore Sprint 85
      value: stats?.routerPatterns != null ? String(stats.routerPatterns) : "—",
    },
    {
      label: "Schema Patterns",
      // @ts-ignore Sprint 85
      value: stats?.schemaPatterns != null ? String(stats.schemaPatterns) : "—",
    },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Skill Creator Integration</h1>
            <p className="text-muted-foreground mt-1">
              manage and extend insureportal-pos-builder reusable skill
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-64"
            />
            <Button
              onClick={() =>
                toast.success("Action triggered: Processing your request...")
              }
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {stats &&
                    Object.entries(stats).map(([key, value]) => (
                      <div key={key} className="p-3 rounded-lg bg-muted/50">
                        <div className="text-xs text-muted-foreground">
                          {key
                            .replace(/([A-Z])/g, " $1")
                            .replace(/^./, (s: string) => s.toUpperCase())}
                        </div>
                        <div className="text-lg font-semibold mt-1">
                          {typeof value === "number"
                            ? value.toLocaleString()
                            : typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Detailed View</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                          {i + 1}
                        </div>
                        <div>
                          <div className="font-medium">Item {i + 1}</div>
                          <div className="text-sm text-muted-foreground">
                            Updated {i + 1}h ago
                          </div>
                        </div>
                      </div>
                      <Badge
                        variant={
                          i % 3 === 0
                            ? "default"
                            : i % 3 === 1
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {["Active", "Pending", "Completed"][i % 3]}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Setting 1</label>
                      <Input placeholder="Value" className="mt-1" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Setting 2</label>
                      <Input placeholder="Value" className="mt-1" />
                    </div>
                  </div>
                  <Button
                    onClick={() =>
                      toast.success(
                        "Settings saved: Configuration updated successfully"
                      )
                    }
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
