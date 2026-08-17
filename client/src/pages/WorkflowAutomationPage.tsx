import { trpc } from "@/lib/trpc";

export default function WorkflowAutomationPage() {
  const { data, isLoading } = trpc.workflowAutomation.dashboard.useQuery({});

  if (isLoading)
    return <div className="p-8 text-center">Loading workflows...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Workflow Automation</h1>

      {data && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Active Workflows</p>
              <p className="text-2xl font-bold">{data.summary.active}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Completed Today</p>
              {/* F-12 (wave-4b): no completion telemetry is delivered */}
              <p className="text-2xl font-bold">—</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Pending Approvals</p>
              {/* F-12 (wave-4b): no approval-queue store is delivered */}
              <p className="text-2xl font-bold">—</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Avg Completion</p>
              <p className="text-2xl font-bold">—</p>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Workflow Definitions</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Workflow</th>
                    <th className="text-left p-2">Category</th>
                    <th className="text-right p-2">Instances</th>
                    <th className="text-left p-2">Avg Duration</th>
                    <th className="text-right p-2">SLA (hours)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* F-12 (wave-4b): real rows are workflowDefinitions records;
                      instance counts and avg durations have no delivered
                      source — "—". */}
                  {data.recentItems.map(w => (
                    <tr key={w.id} className="border-b">
                      <td className="p-2 font-medium">{w.name}</td>
                      <td className="p-2">{w.category ?? "—"}</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2">—</td>
                      <td className="p-2 text-right">{w.slaHours ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Approval Queue</h2>
            <div className="border rounded p-4 text-sm text-muted-foreground">
              {/* F-12 (wave-4b): no approval-queue store is delivered; the
                  approve/reject actions had no real backing rows. */}
              — approval queues are not delivered on this platform
            </div>
          </div>

        </>
      )}
    </div>
  );
}
