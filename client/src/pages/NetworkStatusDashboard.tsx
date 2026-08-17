/**
 * Network Status Dashboard — Sprint 75
 * Real-time connectivity charts per carrier and region
 * Uses the networkStatusDashboard tRPC router
 */

import DashboardLayout from "@/components/DashboardLayout";

const COLORS = {
  bg: "#0a0e1a",
  card: "#111827",
  border: "#1f2937",
  blue: "#3b82f6",
  green: "#10b981",
  gold: "#f59e0b",
  red: "#ef4444",
  cyan: "#06b6d4",
  purple: "#8b5cf6",
  gray: "#6b7280",
};




export default function NetworkStatusDashboard() {

  // F-12 (wave-4b): the carrier-telemetry queries were removed — the
  // procedures are fail-loud NOT_IMPLEMENTED and nothing on this page can
  // display their data until a carrier telemetry source is delivered.

  // Carrier pie data

  const navItems = [
    { label: "Overview", href: "/network-status" },
    { label: "Insurance Service", href: "/" },
    { label: "Admin", href: "/admin" },
  ];

  return (
    <DashboardLayout>
      <div
        className="p-6 space-y-6"
        style={{ background: COLORS.bg, minHeight: "100vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-2xl font-bold text-white"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Network Status Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Real-time connectivity monitoring across African markets
            </p>
          </div>
          {/* F-12 (wave-4b): the time-range selector drove telemetry
              sections that are gone — removed (its state was dangling). */}
        </div>

        {/* F-12 (wave-4b): every carrier-telemetry procedure on this page
            (overview/regions/timeSeries/alerts/heatmap/carrierSummary +
            resolveAlert) is fail-loud NOT_IMPLEMENTED — no carrier telemetry
            source exists in the schema. Honest unavailable state; the queries
            stay wired so the loud backend error surfaces if ever delivered. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {["Total Carriers", "Healthy", "Degraded", "Active Alerts"].map(label => (
            <Card key={label}>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-muted-foreground">—</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            — carrier network telemetry is not delivered on this platform
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

