import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** SLO monitoring — real SLO definitions + incidents (sloMonitorRouter). */
export default function SloMonitor() {
  const slos = trpc.sloMonitor.getSlos.useQuery(undefined, { retry: false });
  const incidents = trpc.sloMonitor.getIncidents.useQuery({}, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">SLO Monitor</h1>
      {slos.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load SLOs: {slos.error.message}
        </CardContent></Card>
      )}
      {slos.data && slos.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No SLO definitions configured.</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {slos.data?.map(s => (
          <Card key={s.id}><CardContent className="py-4 space-y-1">
            <div className="font-semibold">{s.serviceName}</div>
            <div className="text-sm text-muted-foreground">
              {s.sloName} — target {String(s.targetValue)} ({s.metricType})
            </div>
          </CardContent></Card>
        ))}
      </div>
      <h2 className="text-xl font-semibold">Incidents</h2>
      {incidents.data && incidents.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No incidents recorded.</p>
      )}
      {incidents.data?.map(i => (
        <Card key={i.id}><CardContent className="py-4 space-y-1">
          <div className="font-semibold">Incident #{i.id}: {i.title ?? `SLO #${i.sloId}`}</div>
          <div className="text-sm text-muted-foreground">
            Status: {i.status} · Opened {String(i.openedAt)}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}
