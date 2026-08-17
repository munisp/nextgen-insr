import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function CardRequestPage() {
  // F-12 (wave-4b): no card-request store is delivered — cardRequest.list
  // and .analytics are fail-loud NOT_IMPLEMENTED. Honest unavailable
  // state; the query stays wired.
  const { isError } = trpc.cardRequest.list.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Card Requests</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — card requests, inventory and delivery tracking are not delivered
          on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports card requests as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
