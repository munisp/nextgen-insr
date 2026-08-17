import { trpc } from "@/lib/trpc";

export default function ConfigManagementPage() {
  const { data, isLoading } = trpc.configManagement.dashboard.useQuery({});

  if (isLoading)
    return <div className="p-8 text-center">Loading config management...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Configuration Management</h1>
      {data && (
        <>
          {/* F-12 (wave-4b): binds the REAL dashboard shape
              {totalRecords, recentItems, summary} — configs/environments/
              categories/recentChanges phantoms render honest states. */}
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Total Records</p>
              <p className="text-2xl font-bold">{data.totalRecords}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold">{data.summary.active}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Categories</p>
              <p className="text-2xl font-bold">—</p>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent Items</h2>
            <div className="border rounded p-4 space-y-2">
              {data.recentItems.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No records yet
                </p>
              )}
              {data.recentItems.map((r, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center border-b pb-2"
                >
                  <p className="font-medium text-sm">
                    {r.name ?? `Record #${r.id}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
