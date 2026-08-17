import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function DataExportCenter() {
  // F-12 (wave-4b): the data export center is not delivered — the procs are fail-loud
  // NOT_IMPLEMENTED. Honest unavailable state; the query stays wired.
  const { data, isError } = trpc.dataExport.list.useQuery({}, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Data Export Center</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          {isError
            ? "— the data export center is not delivered on this platform"
            : `Export jobs tracked: ${String(
                (data as { total?: number } | undefined)?.total ?? 0
              )}`}
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
