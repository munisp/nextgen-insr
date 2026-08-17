import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function PerformanceProfilerPage() {
  // F-12 (wave-4b): no profiling backend is delivered — both
  // performanceProfiler procedures are fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the dashboard query stays wired.
  const { isError } = trpc.performanceProfiler.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Performance Profiler</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — the performance profiler is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports the profiler as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
