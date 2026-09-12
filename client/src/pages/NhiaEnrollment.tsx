import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** J25 NHIA — real enrollment record for the signed-in customer (nhiaRouter). */
export default function NhiaEnrollment() {
  const enrollment = trpc.nhia.getEnrollment.useQuery(undefined, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">NHIA Integration</h1>
      {enrollment.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load enrollment: {enrollment.error.message}
        </CardContent></Card>
      )}
      {enrollment.data === null && (
        <Card><CardContent className="py-6 text-muted-foreground">
          You are not enrolled with the NHIA through this platform.
        </CardContent></Card>
      )}
      {enrollment.data && (
        <Card><CardContent className="py-6 space-y-1">
          <div className="font-semibold">Enrollment #{enrollment.data.id}</div>
          <div className="text-sm">Status: {enrollment.data.status}</div>
          <div className="text-sm text-muted-foreground">
            Enrolled: {String(enrollment.data.createdAt)}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
