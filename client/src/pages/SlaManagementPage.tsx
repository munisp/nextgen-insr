import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";

export default function SlaManagementPage() {
  const { data } = trpc.slaManagement.dashboard.useQuery();

  const statusIcon = (s: string) =>
    s === "met" ? (
      <CheckCircle className="w-4 h-4 text-green-500" />
    ) : s === "at_risk" ? (
      <AlertTriangle className="w-4 h-4 text-yellow-500" />
    ) : (
      <XCircle className="w-4 h-4 text-red-500" />
    );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SLA Management</h1>
        <p className="text-muted-foreground">
          Service level agreement tracking and compliance
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: "Overall Compliance",
            value: `${data?.overallCompliance ?? 0}%`,
          },
          { label: "Met", value: data?.metCount ?? 0 },
          { label: "At Risk", value: data?.atRiskCount ?? 0 },
          { label: "Breached", value: data?.breachedCount ?? 0 },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>SLA Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(data?.slas ?? []).map((s: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  {statusIcon(s.status)}
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Target: {s.target} | Actual: {s.actual}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      s.status === "met"
                        ? "default"
                        : s.status === "at_risk"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {s.status}
                  </Badge>
                  {s.penaltyNgn > 0 && (
                    <span className="text-xs text-red-500">
                      ₦{s.penaltyNgn.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
