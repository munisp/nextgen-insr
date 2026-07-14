/**
 * KpiCard — Reusable KPI metric card for all insurance role dashboards.
 * Supports trend indicators, sparklines, status badges, and skeleton loading.
 */
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

export type KpiTrend = "up" | "down" | "flat";
export type KpiStatus = "good" | "warning" | "critical" | "neutral";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: KpiTrend;
  trendValue?: string;
  status?: KpiStatus;
  icon?: React.ElementType;
  accentColor?: string;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const statusColors: Record<KpiStatus, string> = {
  good:     "var(--risk-low)",
  warning:  "var(--risk-medium)",
  critical: "var(--risk-critical)",
  neutral:  "var(--text-secondary)",
};

const trendIcons: Record<KpiTrend, React.ElementType> = {
  up:   TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  status = "neutral",
  icon: Icon,
  accentColor,
  loading = false,
  onClick,
  className,
}: KpiCardProps) {
  const TrendIcon = trend ? trendIcons[trend] : null;
  const statusColor = statusColors[status];
  const accent = accentColor ?? "var(--insurance-primary)";

  if (loading) {
    return (
      <div className={cn("kpi-card rounded-xl p-4 animate-pulse", className)}
           style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        <div className="h-3 w-24 rounded bg-muted mb-3" />
        <div className="h-8 w-32 rounded bg-muted mb-2" />
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "kpi-card rounded-xl p-4 transition-all duration-200",
        onClick && "cursor-pointer hover:shadow-lg hover:-translate-y-0.5",
        className
      )}
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderLeft: `3px solid ${accent}`,
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
        </span>
        {Icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `${accent}18`, color: accent }}
          >
            <Icon size={14} strokeWidth={2} />
          </span>
        )}
      </div>

      {/* Value */}
      <div
        className="text-2xl font-bold tracking-tight mb-1"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
      >
        {value}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        {subtitle && (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </span>
        )}
        {TrendIcon && trendValue && (
          <span
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: statusColor }}
          >
            <TrendIcon size={12} />
            {trendValue}
          </span>
        )}
        {status === "critical" && !TrendIcon && (
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: statusColor }}>
            <AlertTriangle size={12} />
            Critical
          </span>
        )}
      </div>
    </div>
  );
}

export default KpiCard;
