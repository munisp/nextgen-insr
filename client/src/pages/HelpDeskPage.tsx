import { trpc } from "@/lib/trpc";

export default function HelpDeskPage() {
  // F-12 (wave-4b): dashboard/knowledgeBase are fail-loud (no help-desk
  // backend beyond chat-session stats) — the page binds the REAL getStats
  // counts; everything else renders honest unavailable states.
  const { data, isLoading } = trpc.helpDesk.getStats.useQuery();
  const { isError: kbUnavailable } = trpc.helpDesk.knowledgeBase.useQuery(
    undefined,
    { retry: false }
  );

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
              <p className="text-sm text-muted-foreground">Resolved Tickets</p>
              <p className="text-2xl font-bold">{data.resolvedTickets}</p>
            </div>
            {/* F-12: no resolution-time or SLA telemetry is delivered */}
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Avg Resolution</p>
              <p className="text-2xl font-bold">—</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">SLA Compliance</p>
              <p className="text-2xl font-bold">—</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h2 className="text-lg font-semibold mb-3">By Category</h2>
              <div className="border rounded p-4 text-sm text-muted-foreground">
                — category breakdowns are not delivered on this platform
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-3">By Priority</h2>
              <div className="border rounded p-4 text-sm text-muted-foreground">
                — priority breakdowns are not delivered on this platform
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
                  {/* F-12: no ticket-list proc is delivered */}
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      — ticket listing is not delivered on this platform
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {/* F-12 (wave-4b): knowledgeBase is fail-loud — no KB store. */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Knowledge Base</h2>
        <div className="border rounded p-4 text-sm text-muted-foreground">
          — the knowledge base is not delivered on this platform
          {kbUnavailable && (
            <span className="block mt-1 text-xs">
              (backend reports the knowledge base as not implemented)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
