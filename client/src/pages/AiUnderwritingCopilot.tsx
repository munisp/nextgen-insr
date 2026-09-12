import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/**
 * AI underwriting copilot — wired to the real ollamaLLM router. The backend
 * procedures currently fail loud (NOT_IMPLEMENTED — no delivered Ollama
 * health/model source), so this page renders the honest unavailable state.
 */
export default function AiUnderwritingCopilot() {
  const { isError, error } = trpc.ollamaLLM.health.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">AI Underwriting Copilot</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — AI underwriting copilot is not available on this deployment
          {isError && (
            <span className="block mt-2 text-xs">
              (backend: {error.message})
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
