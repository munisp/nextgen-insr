import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function ReportTemplateDesigner() {
  // F-12 (wave-4b): the report template designer is not delivered — the procs are fail-loud
  // NOT_IMPLEMENTED. Honest unavailable state; the query stays wired.
  const { isError } = trpc.reportTemplate.list.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Report Template Designer</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — the report template designer is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports this feature as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
