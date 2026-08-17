import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function EscalationChains() {
  // F-12 (wave-4b): no escalation-chain store or runner is delivered — all
  // escalationChains procedures are fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the chains query stays wired.
  const { isError } = trpc.escalationChains.listChains.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Escalation Chains</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — escalation-chain management is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports escalation chains as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
