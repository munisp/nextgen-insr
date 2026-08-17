import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitBranch, Search, Shield, Loader2, Network } from "lucide-react";

export default function FalkorDBGraphPage() {
  const [neighborId, setNeighborId] = useState("");
  const health = trpc.falkordbGraph.health.useQuery();
  const analytics = trpc.falkordbGraph.analytics.useQuery();
  const [neighborNodeId, setNeighborNodeId] = useState("AGT-001");
  const neighborsQuery = trpc.falkordbGraph.getNeighbors.useQuery(
    { nodeId: neighborNodeId },
    { enabled: neighborNodeId.length > 0 }
  );
  const pathQuery = trpc.falkordbGraph.shortestPath.useQuery(
    { from: "AGT-001", to: "AGT-005" },
    { enabled: false }
  );
  const fraudRingsQuery = trpc.falkordbGraph.fraudRings.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FalkorDB Graph Knowledge Base</h1>
          <p className="text-muted-foreground">
            GNN-powered entity relationships, fraud ring detection, and
            knowledge graph
          </p>
        </div>
        <Badge
          variant={
            health.data?.falkordb === "connected" ? "default" : "secondary"
          }
        >
          {health.data?.falkordb ?? "Loading..."}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Nodes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.totalNodes ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Edges
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.totalEdges ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Avg Degree
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.avgDegree?.toFixed(1) ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Fraud Rings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {analytics.data?.fraudRings ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="neighbors">
        <TabsList>
          <TabsTrigger value="neighbors">
            <Search className="w-4 h-4 mr-1" />
            Explore Neighbors
          </TabsTrigger>
          <TabsTrigger value="fraud">
            <Shield className="w-4 h-4 mr-1" />
            Fraud Rings
          </TabsTrigger>
          <TabsTrigger value="algorithms">
            <Network className="w-4 h-4 mr-1" />
            Algorithms
          </TabsTrigger>
        </TabsList>

        <TabsContent value="neighbors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Graph Node Neighbors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter node ID (e.g., AGT-001)"
                  value={neighborId}
                  onChange={e => setNeighborId(e.target.value)}
                />
                <Button
                  onClick={() => setNeighborNodeId(neighborId)}
                  disabled={!neighborId}
                >
                  <Search className="w-4 h-4" />
                </Button>
              </div>
              {neighborsQuery.isLoading && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              )}
              {neighborsQuery.data && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {neighborsQuery.data.nodes?.length ?? 0} neighbors found
                  </p>
                  {neighborsQuery.data.nodes?.map((n: any, i: number) => (
                    <div key={i} className="p-3 border rounded-lg">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">
                            {n.properties?.name ?? n.id ?? `Node ${i}`}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Label: {n.label}
                          </p>
                        </div>
                        <Badge>{n.label}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fraud" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Fraud Ring Detection (GNN)</CardTitle>
                <Badge
                  variant={
                    fraudRingsQuery.data?.rings?.length
                      ? "destructive"
                      : "default"
                  }
                >
                  {fraudRingsQuery.data?.rings?.length ?? 0} rings detected
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {fraudRingsQuery.isLoading && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Analyzing
                  graph...
                </div>
              )}
              {fraudRingsQuery.data?.rings && (
                <div className="space-y-3">
                  {fraudRingsQuery.data.rings.map((ring, i) => (
                    <div
                      key={i}
                      className="p-4 border rounded-lg border-destructive/30 bg-destructive/5"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <p className="font-medium">
                          Ring #{i + 1} — {ring.ring?.length ?? 0} entities
                        </p>
                        <Badge variant="destructive">
                          Risk: {ring.riskScore}%
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {ring.ring?.map((nodeId, j) => (
                          <Badge key={j} variant="outline">
                            {nodeId}
                          </Badge>
                        ))}
                      </div>
                      {ring.evidence?.length > 0 && (
                        <div className="text-sm text-muted-foreground">
                          Evidence: {ring.evidence.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="algorithms" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Graph Algorithms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="font-medium mb-2">Available Algorithms:</p>
                  <div className="flex flex-wrap gap-2">
                    {analytics.data?.algorithms?.map((algo, i) => (
                      <Badge key={i} variant="outline">
                        {algo}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <p className="font-medium">Node Labels</p>
                    {analytics.data?.nodesByLabel &&
                      Object.entries(analytics.data.nodesByLabel).map(
                        ([label, count]) => (
                          <div
                            key={label}
                            className="flex justify-between text-sm mt-1"
                          >
                            <span>{label}</span>
                            <Badge variant="secondary">{count as number}</Badge>
                          </div>
                        )
                      )}
                  </div>
                  <div className="p-4 border rounded-lg">
                    <p className="font-medium">Edge Types</p>
                    {analytics.data?.edgesByType &&
                      Object.entries(analytics.data.edgesByType).map(
                        ([type, count]) => (
                          <div
                            key={type}
                            className="flex justify-between text-sm mt-1"
                          >
                            <span>{type}</span>
                            <Badge variant="secondary">{count as number}</Badge>
                          </div>
                        )
                      )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
