import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, BookOpen } from "lucide-react";

export default function IncidentManagementPage() {
  const { data } = trpc.incidentManagement.dashboard.useQuery();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Incident Management</h1>
        <p className="text-muted-foreground">
          Incident tracking, runbooks, post-mortems
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Open Incidents", value: data?.openIncidents ?? 0 },
          { label: "Resolved (Month)", value: data?.resolvedThisMonth ?? 0 },
          { label: "MTTR", value: `${data?.mttrMinutes ?? 0} min` },
          { label: "P1 Active", value: data?.p1Count ?? 0 },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Active Incidents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.incidents ?? []).map((inc: any, i: number) => (
                <div key={i} className="p-3 rounded bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{inc.title}</span>
                    <Badge
                      variant={
                        inc.severity === "P1" ? "destructive" : "secondary"
                      }
                    >
                      {inc.severity}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Badge variant="outline">{inc.status}</Badge>
                    <span>Assigned: {inc.assignee}</span>
                    <span>{new Date(inc.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" /> Runbooks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.runbooks ?? []).map((rb: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{rb.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {rb.steps} steps
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Last used: {new Date(rb.lastUsed).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
