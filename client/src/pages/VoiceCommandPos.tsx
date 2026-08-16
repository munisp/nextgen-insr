import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function VoiceCommandPos() {
  const stats = trpc.voiceCommandPos.getSummary.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Voice Commands</h1>
          <p className="text-muted-foreground">Manage and monitor commands</p>
        </div>
        <button
          onClick={() => toast("Feature active")}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          Refresh
        </button>
      </div>

      {stats.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : stats.data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(stats.data)
              .slice(0, 4)
              .map(([key, value]) => (
                <div
                  key={key}
                  className="bg-card border border-border rounded-lg p-4"
                >
                  <p className="text-sm text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </p>
                  <p className="text-2xl font-bold mt-1">{String(value)}</p>
                </div>
              ))}
          </div>
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Commands Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Object.entries(stats.data)
                .slice(4)
                .map(([key, value]) => (
                  <div key={key} className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                    <p className="text-lg font-semibold">
                      {Array.isArray(value) ? value.join(", ") : String(value)}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
