import { trpc } from "@/lib/trpc";

export default function NotificationCenterPage() {
  const { data, isLoading } = trpc.notificationCenter.dashboard.useQuery();

  if (isLoading)
    return <div className="p-8 text-center">Loading notifications...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Notification Center</h1>
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Unread</p>
              <p className="text-2xl font-bold">{data.unreadCount}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Sent (24h)</p>
              <p className="text-2xl font-bold">
                {data.totalSent24h.toLocaleString()}
              </p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Delivery Rate</p>
              <p className="text-2xl font-bold">{data.deliveryRate}%</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Channel Performance</h2>
            <div className="border rounded p-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Channel</th>
                    <th className="text-right p-2">Sent</th>
                    <th className="text-right p-2">Delivered</th>
                    <th className="text-right p-2">Rate %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((c: any) => (
                    <tr key={c.name} className="border-b">
                      <td className="p-2">{c.name}</td>
                      <td className="p-2 text-right">
                        {c.sent.toLocaleString()}
                      </td>
                      <td className="p-2 text-right">
                        {c.delivered.toLocaleString()}
                      </td>
                      <td className="p-2 text-right">{c.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent Notifications</h2>
            <div className="border rounded p-4 space-y-2">
              {data.recentNotifications.map((n: any) => (
                <div
                  key={n.id}
                  className="flex justify-between items-center border-b pb-2"
                >
                  <div>
                    <p className="font-medium text-sm">{n.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {n.channel} • {n.recipient}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${n.status === "read" ? "bg-green-100 text-green-700" : n.status === "failed" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}
                  >
                    {n.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
