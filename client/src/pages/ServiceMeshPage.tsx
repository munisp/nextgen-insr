import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function ServiceMeshPage() {
  // F-12 (wave-4b): the service mesh is not delivered — the dashboard proc was a
  // zero-payload and is now fail-loud. Honest unavailable state; the
  // query stays wired.
  const { isError } = trpc.serviceMesh.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Service Mesh</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — the service mesh is not delivered on this platform
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
