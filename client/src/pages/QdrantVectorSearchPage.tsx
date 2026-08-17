import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function QdrantVectorSearchPage() {
  // F-12 (wave-4b): no Qdrant/vector-search backend is delivered — every
  // qdrantVectorSearch procedure is fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; health query stays wired.
  const { isError } = trpc.qdrantVectorSearch.health.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Vector Search</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — semantic vector search is not delivered on this platform (no
          vector database backend)
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports the vector service as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
