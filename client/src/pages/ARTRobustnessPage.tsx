import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function ARTRobustnessPage() {
  // F-12 (wave-4b): the ART (adversarial robustness testing) engine is not
  // delivered — every artRobustness procedure is fail-loud NOT_IMPLEMENTED.
  // Honest unavailable state; the health query stays wired so the loud
  // backend error surfaces if the engine is ever delivered.
  const { isError } = trpc.artRobustness.health.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ART Robustness</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — adversarial robustness testing is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports the ART engine as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
