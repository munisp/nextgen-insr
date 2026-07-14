/**
 * SkeletonDashboard — Role-aware skeleton loader for dashboard pages.
 * Used as the Suspense fallback for all lazy-loaded role dashboards.
 */
import { useAuth } from "@/_core/auth";

function SkeletonBox({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-lg animate-pulse ${className}`}
      style={{ background: "var(--card-border)", ...style }}
    />
  );
}

function KpiCardSkeleton() {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
    >
      <div className="flex items-center justify-between">
        <SkeletonBox style={{ width: "60%", height: "12px" }} />
        <SkeletonBox style={{ width: "32px", height: "32px", borderRadius: "8px" }} />
      </div>
      <SkeletonBox style={{ width: "45%", height: "28px" }} />
      <SkeletonBox style={{ width: "35%", height: "10px" }} />
    </div>
  );
}

function ChartSkeleton({ height = 180 }: { height?: number }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
    >
      <SkeletonBox style={{ width: "40%", height: "14px", marginBottom: "16px" }} />
      <SkeletonBox style={{ width: "100%", height: `${height}px`, borderRadius: "8px" }} />
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
    >
      <SkeletonBox style={{ width: "30%", height: "14px", marginBottom: "16px" }} />
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBox style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0 }} />
            <div className="flex-1 flex flex-col gap-1.5">
              <SkeletonBox style={{ width: `${55 + (i % 3) * 15}%`, height: "11px" }} />
              <SkeletonBox style={{ width: `${30 + (i % 4) * 10}%`, height: "9px" }} />
            </div>
            <SkeletonBox style={{ width: "60px", height: "24px", borderRadius: "12px" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Role-specific skeleton layouts
const ROLE_LAYOUTS: Record<string, { kpiCount: number; charts: number[]; tableRows: number }> = {
  underwriter:         { kpiCount: 6, charts: [180, 160], tableRows: 6 },
  actuary:             { kpiCount: 5, charts: [200, 160], tableRows: 4 },
  "claims-adjuster":   { kpiCount: 6, charts: [160],      tableRows: 8 },
  broker:              { kpiCount: 5, charts: [180],       tableRows: 6 },
  policyholder:        { kpiCount: 3, charts: [],          tableRows: 4 },
  "compliance-officer":{ kpiCount: 5, charts: [160],       tableRows: 6 },
  regulator:           { kpiCount: 4, charts: [200, 180],  tableRows: 5 },
  reinsurer:           { kpiCount: 5, charts: [180],       tableRows: 5 },
  "billing-admin":     { kpiCount: 5, charts: [180, 160],  tableRows: 6 },
  supervisor:          { kpiCount: 6, charts: [160],       tableRows: 8 },
  beneficiary:         { kpiCount: 2, charts: [],          tableRows: 3 },
  admin:               { kpiCount: 8, charts: [200, 160],  tableRows: 8 },
  "super-admin":       { kpiCount: 8, charts: [200, 160],  tableRows: 8 },
  default:             { kpiCount: 4, charts: [180],       tableRows: 5 },
};

export function SkeletonDashboard() {
  const { user } = useAuth();
  const role = (user as any)?.platformRole ?? "default";
  const layout = ROLE_LAYOUTS[role] ?? ROLE_LAYOUTS.default;

  return (
    <div
      className="min-h-screen p-4 sm:p-6"
      style={{ background: "var(--bg-primary)" }}
      aria-busy="true"
      aria-label="Loading dashboard…"
    >
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col gap-2">
          <SkeletonBox style={{ width: "200px", height: "22px" }} />
          <SkeletonBox style={{ width: "140px", height: "13px" }} />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBox style={{ width: "80px", height: "34px", borderRadius: "8px" }} />
          <SkeletonBox style={{ width: "34px", height: "34px", borderRadius: "50%" }} />
        </div>
      </div>

      {/* KPI cards grid */}
      <div
        className="grid gap-4 mb-6"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 180px), 1fr))",
        }}
      >
        {Array.from({ length: layout.kpiCount }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>

      {/* Charts */}
      {layout.charts.length > 0 && (
        <div
          className="grid gap-4 mb-6"
          style={{
            gridTemplateColumns: layout.charts.length > 1 ? "repeat(auto-fit, minmax(280px, 1fr))" : "1fr",
          }}
        >
          {layout.charts.map((h, i) => (
            <ChartSkeleton key={i} height={h} />
          ))}
        </div>
      )}

      {/* Table */}
      {layout.tableRows > 0 && <TableSkeleton rows={layout.tableRows} />}
    </div>
  );
}

export default SkeletonDashboard;
