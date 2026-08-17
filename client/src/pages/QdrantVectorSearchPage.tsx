import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Database, Brain, Loader2 } from "lucide-react";

export default function QdrantVectorSearchPage() {
  const [searchQuery, setSearchQuery] = useState("cash withdrawal");
  const [ragQuery, setRagQuery] = useState("");
  const health = trpc.qdrantVectorSearch.health.useQuery();
  const analytics = trpc.qdrantVectorSearch.analytics.useQuery();
  const collectionStats = trpc.qdrantVectorSearch.collectionStats.useQuery();
  const searchResults = trpc.qdrantVectorSearch.semanticSearch.useQuery(
    { query: searchQuery, collection: "transactions", limit: 10 },
    { enabled: searchQuery.length > 2 }
  );
  const ragMut = trpc.qdrantVectorSearch.ragAnswer.useMutation();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Qdrant Vector Search</h1>
          <p className="text-muted-foreground">
            Semantic search, RAG pipeline, and fraud detection embeddings
          </p>
        </div>
        <Badge
          variant={
            health.data?.qdrant === "connected" ? "default" : "secondary"
          }
        >
          {health.data?.qdrant === "connected" ? "Connected" : "Fallback Mode"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Collections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.collections
                ? Object.keys(analytics.data.collections).length
                : 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Vectors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(analytics.data?.totalVectors ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Embedding Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {analytics.data?.embeddingModel ?? "nomic-embed-text"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Knowledge Docs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.data?.knowledgeDocsCount ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">
            <Search className="w-4 h-4 mr-1" />
            Semantic Search
          </TabsTrigger>
          <TabsTrigger value="rag">
            <Brain className="w-4 h-4 mr-1" />
            RAG Query
          </TabsTrigger>
          <TabsTrigger value="collections">
            <Database className="w-4 h-4 mr-1" />
            Collections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Semantic Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Search transactions, agents, documents..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              {searchResults.isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching...
                </div>
              )}
              {searchResults.data?.results && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Found {searchResults.data.results.length} results (
                    {searchResults.data.source})
                  </p>
                  {searchResults.data.results.map((r: any, i) => (
                    <div
                      key={i}
                      className="p-3 border rounded-lg flex justify-between items-center"
                    >
                      <div>
                        <p className="font-medium">
                          {String(r.payload?.type ?? "Transaction")} —{" "}
                          {String(r.payload?.channel ?? "POS")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Score: {(r.score * 100).toFixed(1)}% | Amount: NGN{" "}
                          {Number(r.payload?.amount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={r.score > 0.8 ? "default" : "secondary"}>
                        {(r.score * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rag" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>RAG Knowledge Query</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Ask about CBN regulations, fraud patterns, agent policies..."
                  value={ragQuery}
                  onChange={e => setRagQuery(e.target.value)}
                />
                <Button
                  onClick={() => ragMut.mutate({ question: ragQuery })}
                  disabled={!ragQuery || ragMut.isPending}
                >
                  {ragMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {ragMut.data && (
                <div className="space-y-3">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="font-medium mb-2">Answer:</p>
                    <p>{String(ragMut.data.answer)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">
                      Contexts ({ragMut.data.contexts?.length ?? 0}):
                    </p>
                    {ragMut.data.contexts?.map((c: any, i) => (
                      <div key={i} className="p-2 border rounded mb-1 text-sm">
                        <Badge variant="outline" className="mr-2">
                          Score: {(c.score * 100).toFixed(0)}%
                        </Badge>
                        {c.text.slice(0, 200)}...
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collections" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {collectionStats.data?.collections &&
              Object.entries(collectionStats.data.collections).map(
                ([key, c]) => (
                  <Card key={key}>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        {key}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Points:</span>{" "}
                          {(c as any).count.toLocaleString()}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Status:</span>{" "}
                          <Badge variant="default" className="text-xs">
                            {(c as any).status}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
