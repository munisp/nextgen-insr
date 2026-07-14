import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function AgentManagementDashboard() {
  const agentsQ = trpc.agentMgmt.listAll.useQuery(undefined, { retry: false });
  const topUpQ = trpc.agentMgmt.listTopUpRequests.useQuery(
    { status: "pending" },
    { retry: false }
  );
  const setActiveMut = trpc.agentMgmt.setActive.useMutation({
    onSuccess: () => {
      toast.success("Agent status updated");
      agentsQ.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Agent Management</h1>
            <p className="text-gray-400 text-sm">
              Manage agents, roles, activation status, and float top-up requests
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Total Agents",
              value: String(
                Array.isArray(agentsQ.data) ? agentsQ.data.length : 0
              ),
              color: "text-white",
            },
            {
              label: "Active",
              value: String(
                Array.isArray(agentsQ.data)
                  ? agentsQ.data.filter((a: any) => a.isActive).length
                  : 0
              ),
              color: "text-green-400",
            },
            {
              label: "Top-Up Requests",
              value: String(
                Array.isArray(topUpQ.data) ? topUpQ.data.length : 0
              ),
              color: "text-amber-400",
            },
          ].map((kpi, i) => (
            <Card key={i} className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400">{kpi.label}</div>
                <div className={`text-2xl font-bold ${kpi.color}`}>
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Agent List</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2">Name</th>
                  <th className="text-left py-2">Code</th>
                  <th className="text-left py-2">Role</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(agentsQ.data) ? agentsQ.data : []).map(
                  (a: any, i: number) => (
                    <tr
                      key={i}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="py-2 text-gray-200">
                        {a.name || a.openId}
                      </td>
                      <td className="py-2 text-gray-400 font-mono text-xs">
                        {a.agentId || `AGT-${a.id}`}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline">{a.role || "user"}</Badge>
                      </td>
                      <td className="py-2">
                        <Badge
                          className={a.isActive ? "bg-green-600" : "bg-red-600"}
                        >
                          {a.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-gray-300 border-gray-600"
                          onClick={() =>
                            setActiveMut.mutate({
                              agentId: a.id,
                              isActive: !a.isActive,
                            })
                          }
                        >
                          {a.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  )
                )}
                {(!agentsQ.data ||
                  (Array.isArray(agentsQ.data) &&
                    agentsQ.data.length === 0)) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      No agents found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
