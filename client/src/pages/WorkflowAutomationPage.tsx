import { trpc } from "@/lib/trpc";

export default function WorkflowAutomationPage() {
  const { data, isLoading } = trpc.workflowAutomation.dashboard.useQuery();
  const approve = trpc.workflowAutomation.approveStep.useMutation();

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
              <p className="text-2xl font-bold">{data.activeWorkflows}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Completed Today</p>
              <p className="text-2xl font-bold">{data.completedToday}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Pending Approvals</p>
              <p className="text-2xl font-bold">{data.pendingApprovals}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Avg Completion</p>
              <p className="text-2xl font-bold">{data.avgCompletionTime}</p>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Workflow Definitions</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Workflow</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Instances</th>
                    <th className="text-left p-2">Avg Duration</th>
                    <th className="text-right p-2">SLA %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workflows.map((w: any) => (
                    <tr key={w.id} className="border-b">
                      <td className="p-2 font-medium">{w.name}</td>
                      <td className="p-2">{w.type}</td>
                      <td className="p-2 text-right">{w.instances}</td>
                      <td className="p-2">{w.avgDuration}</td>
                      <td className="p-2 text-right">{w.slaCompliance}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Approval Queue</h2>
            <div className="border rounded p-4 space-y-3">
              {data.approvalQueue.map((a: any) => (
                <div
                  key={a.id}
                  className="flex justify-between items-center border-b pb-3"
                >
                  <div>
                    <p className="font-medium text-sm">{a.workflow}</p>
                    <p className="text-xs text-muted-foreground">
                      Step: {a.currentStep} • Priority:{" "}
                      <span
                        className={
                          a.priority === "critical"
                            ? "text-red-500"
                            : a.priority === "high"
                              ? "text-orange-500"
                              : ""
                        }
                      >
                        {a.priority}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1 bg-green-600 text-white rounded text-xs"
                      onClick={() =>
                        approve.mutate({
                          workflowId: a.id,
                          stepId: "s1",
                          decision: "approve",
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs"
                      onClick={() =>
                        approve.mutate({
                          workflowId: a.id,
                          stepId: "s1",
                          decision: "reject",
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
