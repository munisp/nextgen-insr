import { trpc } from "@/lib/trpc";

export default function HelpDeskPage() {
  const { data, isLoading } = trpc.helpDesk.dashboard.useQuery();
  const { data: kb } = trpc.helpDesk.knowledgeBase.useQuery({});

  if (isLoading)
    return <div className="p-8 text-center">Loading help desk...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Help Desk & Ticketing</h1>
      {data && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Open Tickets</p>
              <p className="text-2xl font-bold">{data.openTickets}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Resolved Today</p>
              <p className="text-2xl font-bold">{data.resolvedToday}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Avg Resolution</p>
              <p className="text-2xl font-bold">{data.avgResolutionTime}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">SLA Compliance</p>
              <p className="text-2xl font-bold">{data.slaCompliance}%</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h2 className="text-lg font-semibold mb-3">By Category</h2>
              <div className="border rounded p-4 space-y-2">
                {data.byCategory.map((c: any) => (
                  <div
                    key={c.category}
                    className="flex justify-between items-center border-b pb-2"
                  >
                    <span className="text-sm">{c.category}</span>
                    <span className="text-sm font-bold">
                      {c.count} tickets • {c.avgResolution}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-3">By Priority</h2>
              <div className="border rounded p-4 space-y-2">
                {Object.entries(data.byPriority).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between items-center border-b pb-2"
                  >
                    <span
                      className={`text-sm capitalize ${k === "critical" ? "text-red-500" : k === "high" ? "text-orange-500" : ""}`}
                    >
                      {k}
                    </span>
                    <span className="text-sm font-bold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent Tickets</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Subject</th>
                    <th className="text-left p-2">Priority</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTickets.map((t: any) => (
                    <tr key={t.id} className="border-b">
                      <td className="p-2">{t.id}</td>
                      <td className="p-2">{t.subject}</td>
                      <td className="p-2 capitalize">{t.priority}</td>
                      <td className="p-2 capitalize">{t.status}</td>
                      <td className="p-2">{t.assignee}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {kb && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Knowledge Base</h2>
          <div className="border rounded p-4 space-y-2">
            {kb.articles.map((a: any) => (
              <div
                key={a.id}
                className="flex justify-between items-center border-b pb-2"
              >
                <div>
                  <p className="font-medium text-sm">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.category} • {a.views} views
                  </p>
                </div>
                <span className="text-xs text-green-600">
                  {a.helpful}% helpful
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
