/**
 * SecurityTab — Admin Panel security controls
 *
 * Sections:
 *  1. Security Audit Log  — live fraud_alerts feed with filter, severity badges, mark-reviewed
 *  2. Pending Reversals   — transactions with status "pending_reversal_approval"
 *  3. Velocity Limits     — per-tier maxTxPerHour / maxSingleTxAmount / maxDailyVolume
 *  4. Platform Settings   — key/value security toggles (thresholds, feature flags)
 */
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { toast } from "sonner";

const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.02 240)";
const GREEN = "oklch(0.65 0.18 160)";
const RED = "oklch(0.60 0.22 25)";
const GOLD = "oklch(0.78 0.18 80)";
const BLUE = "oklch(0.60 0.22 260)";
const ORANGE = "oklch(0.70 0.20 50)";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const fmt = (n: number) =>
  `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({
  title,
  sub,
  badge,
}: {
  title: string;
  sub?: string;
  badge?: number;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div>
        <div
          className="text-sm font-black text-white"
          style={{ fontFamily: DISP }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            {sub}
          </div>
        )}
      </div>
      {badge != null && badge > 0 && (
        <span
          className="px-2 py-0.5 rounded-full text-xs font-bold"
          style={{
            background: "oklch(0.60 0.22 25 / 0.25)",
            color: RED,
            border: `1px solid ${RED}`,
            fontFamily: MONO,
          }}
        >
          {badge} HIGH
        </span>
      )}
    </div>
  );
}

// ─── Severity badge ───────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    high: { bg: "oklch(0.60 0.22 25 / 0.2)", fg: RED },
    medium: { bg: "oklch(0.70 0.20 50 / 0.2)", fg: ORANGE },
    low: { bg: "oklch(0.78 0.18 80 / 0.2)", fg: GOLD },
    critical: { bg: "oklch(0.50 0.25 15 / 0.25)", fg: "oklch(0.80 0.25 15)" },
  };
  const c = colors[severity?.toLowerCase()] ?? {
    bg: "oklch(0.22 0.02 240)",
    fg: "oklch(0.6 0.01 240)",
  };
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider"
      style={{
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.fg}`,
        fontFamily: MONO,
      }}
    >
      {severity}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    open: { bg: "oklch(0.60 0.22 25 / 0.15)", fg: RED },
    resolved: { bg: "oklch(0.65 0.18 160 / 0.15)", fg: GREEN },
    active: { bg: "oklch(0.60 0.22 25 / 0.15)", fg: RED },
  };
  const c = colors[status?.toLowerCase()] ?? {
    bg: "oklch(0.22 0.02 240)",
    fg: "oklch(0.6 0.01 240)",
  };
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
      style={{ background: c.bg, color: c.fg, fontFamily: MONO }}
    >
      {status}
    </span>
  );
}

// ─── 1. Security Audit Log ────────────────────────────────────────────────────
const ALERT_TYPES = [
  "ALL",
  "VELOCITY_BREACH",
  "DEVICE_TOKEN_FAILURE",
  "FLOAT_LOCK_EVENT",
  "SUSPICIOUS_PATTERN",
  "DUPLICATE_TRANSACTION",
  "LARGE_CASH_OUT",
  "RAPID_SUCCESSION",
];

function SecurityAuditSection() {
  const utils = trpc.useUtils();
  const [severity, setSeverity] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">(
    "ALL"
  );
  const [type, setType] = useState("ALL");
  const [page, setPage] = useState(0);
  const [csvEnabled, setCsvEnabled] = useState(false);
  const PAGE_SIZE = 20;

  const { data, isLoading, refetch } =
    trpc.transactions.getSecurityAuditLog.useQuery(
      {
        severity,
        type: type === "ALL" ? undefined : type,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      },
      { refetchInterval: 30_000 }
    );

  // CSV export — only fires when csvEnabled=true
  const { isFetching: csvFetching } =
    trpc.transactions.exportSecurityAuditCsv.useQuery(
      {
        severity: severity === "ALL" ? "ALL" : (severity.toLowerCase() as any),
        type: type === "ALL" ? undefined : type,
      },
      {
        enabled: csvEnabled,
        staleTime: 0,
        onSettled: () => setCsvEnabled(false),
        onSuccess: (d: { csv: string; rowCount: number }) => {
          const blob = new Blob([d.csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `insureportal-security-audit-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`Exported ${d.rowCount} alerts to CSV`);
        },
        onError: (e: any) => toast.error(`Export failed: ${e.message}`),
      } as any
    );

  const snoozeAlert = trpc.transactions.snoozeAlert.useMutation({
    onSuccess: () => {
      toast.success("Alert snoozed for 15 min");
      utils.transactions.getSecurityAuditLog.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const escalateAlert = trpc.transactions.escalateAlert.useMutation({
    onSuccess: () => {
      toast.success("Alert escalated to supervisor");
      utils.transactions.getSecurityAuditLog.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const markReviewed = trpc.transactions.markAlertReviewed.useMutation({
    onSuccess: () => {
      toast.success("Alert marked as reviewed");
      utils.transactions.getSecurityAuditLog.invalidate();
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });

  const alerts = data?.alerts ?? [];
  const total = data?.total ?? 0;
  const highUnreviewed = data?.highUnreviewed ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <SectionHeader
        title="Security Audit Log"
        sub="Live fraud alerts — velocity breaches, device token failures, float lock events. Auto-refreshes every 30s."
        badge={highUnreviewed}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Severity filter */}
        <div className="flex gap-1">
          {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map(s => (
            <button
              key={s}
              onClick={() => {
                setSeverity(s);
                setPage(0);
              }}
              className="px-3 py-1 rounded-lg text-xs font-bold transition-all"
              style={{
                background:
                  severity === s
                    ? s === "HIGH"
                      ? "oklch(0.60 0.22 25 / 0.3)"
                      : s === "MEDIUM"
                        ? "oklch(0.70 0.20 50 / 0.3)"
                        : s === "LOW"
                          ? "oklch(0.78 0.18 80 / 0.3)"
                          : "oklch(0.60 0.22 260 / 0.3)"
                    : "transparent",
                color:
                  severity === s
                    ? s === "HIGH"
                      ? RED
                      : s === "MEDIUM"
                        ? ORANGE
                        : s === "LOW"
                          ? GOLD
                          : BLUE
                    : "oklch(0.5 0.01 240)",
                border: `1px solid ${severity === s ? (s === "HIGH" ? RED : s === "MEDIUM" ? ORANGE : s === "LOW" ? GOLD : BLUE) : BORDER}`,
                fontFamily: MONO,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <select
          value={type}
          onChange={e => {
            setType(e.target.value);
            setPage(0);
          }}
          className="px-3 py-1 rounded-lg text-xs bg-transparent border text-white"
          style={{ borderColor: BORDER, fontFamily: MONO, background: BG }}
        >
          {ALERT_TYPES.map(t => (
            <option key={t} value={t} style={{ background: "#0a0e1a" }}>
              {t}
            </option>
          ))}
        </select>

        <button
          onClick={() => refetch()}
          className="px-3 py-1 rounded-lg text-xs font-bold transition-all"
          style={{
            background: "oklch(0.60 0.22 260 / 0.2)",
            color: BLUE,
            border: `1px solid ${BLUE}`,
            fontFamily: DISP,
          }}
        >
          ↻ Refresh
        </button>
        <button
          onClick={() => setCsvEnabled(true)}
          disabled={csvFetching || csvEnabled}
          className="px-3 py-1 rounded-lg text-xs font-bold transition-all ml-auto disabled:opacity-50"
          style={{
            background: "oklch(0.65 0.18 160 / 0.2)",
            color: GREEN,
            border: `1px solid ${GREEN}`,
            fontFamily: DISP,
          }}
        >
          {csvFetching || csvEnabled ? "⏳ Exporting…" : "↓ Download CSV"}
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: "Total Alerts", value: total, color: BLUE },
          { label: "Unreviewed HIGH", value: highUnreviewed, color: RED },
          {
            label: "Showing",
            value: `${alerts.length} of ${total}`,
            color: GOLD,
          },
        ].map(s => (
          <div
            key={s.label}
            className="px-3 py-2 rounded-xl flex flex-col gap-0.5"
            style={{ background: BG, border: `1px solid ${BORDER}` }}
          >
            <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
              {s.label}
            </div>
            <div
              className="text-sm font-black"
              style={{ color: s.color, fontFamily: MONO }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div
          className="text-xs text-gray-500 animate-pulse py-4 text-center"
          style={{ fontFamily: MONO }}
        >
          Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div
          className="text-xs text-gray-500 py-6 text-center"
          style={{ fontFamily: MONO }}
        >
          ✓ No alerts match the current filters
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {[
                  "ID",
                  "Severity",
                  "Type",
                  "Agent",
                  "Amount",
                  "Reason",
                  "Score",
                  "Status",
                  "Time",
                  "Action",
                ].map(h => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-gray-400 uppercase tracking-wider font-semibold whitespace-nowrap"
                    style={{ fontFamily: DISP }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert: any, i: number) => (
                <tr
                  key={alert.id}
                  style={{
                    background: i % 2 === 0 ? BG : "transparent",
                    borderBottom: `1px solid ${BORDER}`,
                    opacity: alert.status === "resolved" ? 0.55 : 1,
                  }}
                >
                  <td
                    className="px-3 py-2 text-gray-500"
                    style={{ fontFamily: MONO }}
                  >
                    #{alert.id}
                  </td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={alert.severity} />
                  </td>
                  <td
                    className="px-3 py-2 text-gray-300 whitespace-nowrap"
                    style={{ fontFamily: MONO }}
                  >
                    {alert.type}
                  </td>
                  <td
                    className="px-3 py-2 font-semibold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {alert.agentId ? `#${alert.agentId}` : "—"}
                  </td>
                  <td
                    className="px-3 py-2 font-bold whitespace-nowrap"
                    style={{ color: GOLD, fontFamily: MONO }}
                  >
                    {alert.amount != null ? fmt(alert.amount) : "—"}
                  </td>
                  <td
                    className="px-3 py-2 text-gray-400 max-w-[200px]"
                    style={{ fontFamily: DISP }}
                  >
                    <span title={alert.reason} className="block truncate">
                      {alert.reason}
                    </span>
                  </td>
                  <td
                    className="px-3 py-2 text-gray-400"
                    style={{ fontFamily: MONO }}
                  >
                    {alert.fraudScore != null
                      ? (alert.fraudScore * 100).toFixed(0) + "%"
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={alert.status} />
                  </td>
                  <td
                    className="px-3 py-2 text-gray-500 whitespace-nowrap"
                    style={{ fontFamily: MONO }}
                  >
                    {new Date(alert.createdAt).toLocaleString("en-NG", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    {alert.status !== "resolved" ? (
                      <div className="flex gap-1 flex-wrap">
                        <button
                          onClick={() =>
                            snoozeAlert.mutate({
                              alertId: alert.id,
                              minutesToSnooze: 15,
                            })
                          }
                          disabled={
                            snoozeAlert.isPending ||
                            alert.status === "investigating"
                          }
                          title="Snooze 15 min — re-escalates automatically if unresolved"
                          className="px-2 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-40 whitespace-nowrap"
                          style={{
                            background: "oklch(0.65 0.18 60 / 0.15)",
                            color: GOLD,
                            border: `1px solid ${GOLD}`,
                            fontFamily: DISP,
                          }}
                        >
                          Snooze
                        </button>
                        <button
                          onClick={() =>
                            escalateAlert.mutate({ alertId: alert.id })
                          }
                          disabled={
                            escalateAlert.isPending ||
                            alert.status === "escalated"
                          }
                          title="Escalate to supervisor — sends notification"
                          className="px-2 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-40 whitespace-nowrap"
                          style={{
                            background: "oklch(0.60 0.22 25 / 0.15)",
                            color: RED,
                            border: `1px solid ${RED}`,
                            fontFamily: DISP,
                          }}
                        >
                          Escalate
                        </button>
                        <button
                          onClick={() =>
                            markReviewed.mutate({
                              alertId: alert.id,
                              resolution: "Reviewed by admin",
                            })
                          }
                          disabled={markReviewed.isPending}
                          title="Mark as resolved"
                          className="px-2 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-40 whitespace-nowrap"
                          style={{
                            background: "oklch(0.65 0.18 160 / 0.15)",
                            color: GREEN,
                            border: `1px solid ${GREEN}`,
                            fontFamily: DISP,
                          }}
                        >
                          Resolve
                        </button>
                      </div>
                    ) : (
                      <span
                        className="text-xs text-gray-600"
                        style={{ fontFamily: DISP }}
                      >
                        {alert.assignedTo ? `by ${alert.assignedTo}` : "Done"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40"
            style={{
              background: "transparent",
              color: BLUE,
              border: `1px solid ${BORDER}`,
              fontFamily: DISP,
            }}
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
            Page {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-40"
            style={{
              background: "transparent",
              color: BLUE,
              border: `1px solid ${BORDER}`,
              fontFamily: DISP,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 2. Pending Reversals ─────────────────────────────────────────────────────
function PendingReversalsSection() {
  const utils = trpc.useUtils();
  const { data: pending, isLoading } =
    trpc.transactions.pendingReversals.useQuery();
  const approve = trpc.transactions.approveReversal.useMutation({
    onSuccess: () => {
      toast.success("Reversal approved — transaction reversed");
      utils.transactions.pendingReversals.invalidate();
    },
    onError: (e: any) => toast.error(`Approval failed: ${e.message}`),
  });
  const reject = trpc.transactions.rejectReversal.useMutation({
    onSuccess: () => {
      toast.success("Reversal request rejected");
      utils.transactions.pendingReversals.invalidate();
    },
    onError: (e: any) => toast.error(`Rejection failed: ${e.message}`),
  });

  const [rejectReason, setRejectReason] = useState<Record<number, string>>({});

  if (isLoading) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <SectionHeader
          title="Pending Reversal Approvals"
          sub="Reversals above threshold awaiting admin sign-off"
        />
        <div
          className="text-xs text-gray-500 animate-pulse"
          style={{ fontFamily: MONO }}
        >
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <SectionHeader
        title="Pending Reversal Approvals"
        sub={`${pending?.length ?? 0} reversal(s) awaiting admin sign-off`}
      />
      {!pending || pending.length === 0 ? (
        <div
          className="text-xs text-gray-500 py-4 text-center"
          style={{ fontFamily: MONO }}
        >
          ✓ No pending reversals
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {[
                  "Ref",
                  "Agent",
                  "Type",
                  "Amount",
                  "Customer",
                  "Submitted",
                  "Reason",
                  "Actions",
                ].map(h => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-gray-400 uppercase tracking-wider font-semibold"
                    style={{ fontFamily: DISP }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pending.map((tx: any, i: number) => (
                <tr
                  key={tx.id}
                  style={{
                    background: i % 2 === 0 ? BG : "transparent",
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  <td
                    className="px-3 py-2 text-gray-400"
                    style={{ fontFamily: MONO }}
                  >
                    {tx.ref}
                  </td>
                  <td
                    className="px-3 py-2 font-semibold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {tx.agentCode ?? `#${tx.agentId}`}
                  </td>
                  <td
                    className="px-3 py-2 text-gray-300"
                    style={{ fontFamily: DISP }}
                  >
                    {tx.type}
                  </td>
                  <td
                    className="px-3 py-2 font-bold"
                    style={{ color: GOLD, fontFamily: MONO }}
                  >
                    {fmt(tx.amount)}
                  </td>
                  <td
                    className="px-3 py-2 text-gray-400"
                    style={{ fontFamily: DISP }}
                  >
                    {tx.customerName ?? tx.customerPhone ?? "—"}
                  </td>
                  <td
                    className="px-3 py-2 text-gray-500"
                    style={{ fontFamily: MONO }}
                  >
                    {new Date(tx.createdAt).toLocaleString("en-NG")}
                  </td>
                  <td
                    className="px-3 py-2 text-gray-400 max-w-[140px] truncate"
                    style={{ fontFamily: DISP }}
                  >
                    {tx.failureReason ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => approve.mutate({ transactionId: tx.id })}
                        disabled={approve.isPending}
                        className="px-3 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                        style={{
                          background: "oklch(0.65 0.18 160 / 0.2)",
                          color: GREEN,
                          border: `1px solid ${GREEN}`,
                          fontFamily: DISP,
                        }}
                      >
                        Approve
                      </button>
                      <div className="flex gap-1">
                        <input
                          value={rejectReason[tx.id] ?? ""}
                          onChange={e =>
                            setRejectReason(p => ({
                              ...p,
                              [tx.id]: e.target.value,
                            }))
                          }
                          placeholder="Reason…"
                          className="flex-1 px-2 py-1 rounded-lg text-xs bg-transparent border text-white"
                          style={{ borderColor: BORDER, fontFamily: DISP }}
                        />
                        <button
                          onClick={() => {
                            const reason = rejectReason[tx.id];
                            if (!reason || reason.trim().length < 5) {
                              toast.error("Provide a reason (min 5 chars)");
                              return;
                            }
                            reject.mutate({ transactionId: tx.id, reason });
                          }}
                          disabled={reject.isPending}
                          className="px-2 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                          style={{
                            background: "oklch(0.60 0.22 25 / 0.2)",
                            color: RED,
                            border: `1px solid ${RED}`,
                            fontFamily: DISP,
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── 3. Velocity Limits ───────────────────────────────────────────────────────
function VelocityLimitsSection() {
  const utils = trpc.useUtils();
  const { data: limits, isLoading } =
    trpc.transactions.getVelocityLimits.useQuery();
  const update = trpc.transactions.updateVelocityLimit.useMutation({
    onSuccess: () => {
      toast.success("Velocity limit updated");
      utils.transactions.getVelocityLimits.invalidate();
    },
    onError: (e: any) => toast.error(`Update failed: ${e.message}`),
  });

  const [editing, setEditing] = useState<
    Record<
      string,
      {
        maxTxPerHour: number;
        maxSingleTxAmount: number;
        maxDailyVolume: number;
      }
    >
  >({});

  const tierColors: Record<string, string> = {
    Bronze: "oklch(0.65 0.15 60)",
    Silver: "oklch(0.75 0.05 220)",
    Gold: GOLD,
    Platinum: "oklch(0.75 0.12 280)",
  };

  if (isLoading) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <SectionHeader
          title="Velocity Limits"
          sub="Per-tier transaction rate and amount controls"
        />
        <div
          className="text-xs text-gray-500 animate-pulse"
          style={{ fontFamily: MONO }}
        >
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <SectionHeader
        title="Velocity Limits"
        sub="Per-tier transaction rate and amount controls — changes take effect immediately"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {(limits ?? []).map((lim: any) => {
          const e = editing[lim.tier] ?? {
            maxTxPerHour: lim.maxTxPerHour,
            maxSingleTxAmount: lim.maxSingleTxAmount,
            maxDailyVolume: lim.maxDailyVolume,
          };
          const isDirty =
            e.maxTxPerHour !== lim.maxTxPerHour ||
            e.maxSingleTxAmount !== lim.maxSingleTxAmount ||
            e.maxDailyVolume !== lim.maxDailyVolume;
          const tierColor = tierColors[lim.tier] ?? BLUE;

          return (
            <div
              key={lim.tier}
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{
                background: BG,
                border: `1px solid ${isDirty ? tierColor : BORDER}`,
              }}
            >
              <div
                className="text-xs font-black uppercase tracking-widest"
                style={{ color: tierColor, fontFamily: DISP }}
              >
                {lim.tier}
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Max Tx / Hour
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={e.maxTxPerHour}
                    onChange={ev =>
                      setEditing(p => ({
                        ...p,
                        [lim.tier]: {
                          ...e,
                          maxTxPerHour: Number(ev.target.value),
                        },
                      }))
                    }
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-transparent border text-white"
                    style={{ borderColor: BORDER, fontFamily: MONO }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Max Single Tx (₦)
                  </span>
                  <input
                    type="number"
                    min={1000}
                    value={e.maxSingleTxAmount}
                    onChange={ev =>
                      setEditing(p => ({
                        ...p,
                        [lim.tier]: {
                          ...e,
                          maxSingleTxAmount: Number(ev.target.value),
                        },
                      }))
                    }
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-transparent border text-white"
                    style={{ borderColor: BORDER, fontFamily: MONO }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Max Daily Volume (₦)
                  </span>
                  <input
                    type="number"
                    min={10000}
                    value={e.maxDailyVolume}
                    onChange={ev =>
                      setEditing(p => ({
                        ...p,
                        [lim.tier]: {
                          ...e,
                          maxDailyVolume: Number(ev.target.value),
                        },
                      }))
                    }
                    className="w-full px-2 py-1.5 rounded-lg text-xs bg-transparent border text-white"
                    style={{ borderColor: BORDER, fontFamily: MONO }}
                  />
                </label>
              </div>
              <button
                onClick={() => {
                  update.mutate({ tier: lim.tier, ...e });
                  setEditing(p => {
                    const n = { ...p };
                    delete n[lim.tier];
                    return n;
                  });
                }}
                disabled={!isDirty || update.isPending}
                className="w-full py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                style={{
                  background: isDirty ? `${tierColor}33` : "transparent",
                  color: isDirty ? tierColor : "oklch(0.4 0.01 240)",
                  border: `1px solid ${isDirty ? tierColor : BORDER}`,
                  fontFamily: DISP,
                }}
              >
                {isDirty ? "Save Changes" : "No Changes"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 4. Platform Settings ─────────────────────────────────────────────────────
function PlatformSettingsSection() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } =
    trpc.transactions.getPlatformSettings.useQuery();
  const update = trpc.transactions.updatePlatformSetting.useMutation({
    onSuccess: () => {
      toast.success("Setting updated");
      utils.transactions.getPlatformSettings.invalidate();
    },
    onError: (e: any) => toast.error(`Update failed: ${e.message}`),
  });

  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const BOOLEAN_KEYS = new Set([
    "velocity_limits_enabled",
    "customer_sms_enabled",
    "enrollment_token_required",
    "settlement_float_lock",
    "geofencing_enabled",
  ]);

  const NUMERIC_KEYS = new Set([
    "reversal_approval_threshold",
    "supervisor_topup_threshold",
    "float_topup_approval_threshold",
  ]);

  const settingLabels: Record<string, { label: string; desc: string }> = {
    reversal_approval_threshold: {
      label: "Reversal Approval Threshold (₦)",
      desc: "Reversals above this amount require admin approval",
    },
    velocity_limits_enabled: {
      label: "Velocity Limits",
      desc: "Enable per-tier transaction rate and amount limits",
    },
    customer_sms_enabled: {
      label: "Customer SMS Confirmation",
      desc: "Send SMS to customer on Cash Out / Transfer / Card / QR / NFC",
    },
    enrollment_token_required: {
      label: "Enrollment Token Enforcement",
      desc: "Require valid device token on every transaction",
    },
    supervisor_topup_threshold: {
      label: "Supervisor Top-Up Threshold (₦)",
      desc: "Float top-ups above this amount require supervisor approval",
    },
    float_topup_approval_threshold: {
      label: "Float Top-Up Approval Threshold (₦)",
      desc: "Alias for supervisor top-up threshold",
    },
    settlement_float_lock: {
      label: "Settlement Float Lock",
      desc: "Lock agent floats during daily settlement window",
    },
    geofencing_enabled: {
      label: "Geofence Enforcement",
      desc: "Block transactions when agent device is outside assigned geofence zone",
    },
  };

  if (isLoading) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <SectionHeader
          title="Platform Security Settings"
          sub="Global feature flags and approval thresholds"
        />
        <div
          className="text-xs text-gray-500 animate-pulse"
          style={{ fontFamily: MONO }}
        >
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <SectionHeader
        title="Platform Security Settings"
        sub="Global feature flags and approval thresholds — changes take effect immediately"
      />
      <div className="flex flex-col gap-3">
        {(settings ?? []).map((s: any) => {
          const meta = settingLabels[s.key] ?? {
            label: s.key,
            desc: s.description ?? "",
          };
          const isBoolean = BOOLEAN_KEYS.has(s.key);
          const isNumeric = NUMERIC_KEYS.has(s.key);
          const currentVal = editValues[s.key] ?? s.value;
          const isDirty = currentVal !== s.value;

          return (
            <div
              key={s.key}
              className="flex items-center justify-between gap-4 p-3 rounded-xl"
              style={{
                background: BG,
                border: `1px solid ${isDirty ? GOLD : BORDER}`,
              }}
            >
              <div className="flex-1">
                <div
                  className="text-xs font-bold text-white"
                  style={{ fontFamily: DISP }}
                >
                  {meta.label}
                </div>
                <div
                  className="text-xs text-gray-500 mt-0.5"
                  style={{ fontFamily: DISP }}
                >
                  {meta.desc}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isBoolean ? (
                  <button
                    onClick={() => {
                      const newVal = s.value === "true" ? "false" : "true";
                      update.mutate({ key: s.key, value: newVal });
                    }}
                    className="relative w-12 h-6 rounded-full transition-all"
                    style={{
                      background:
                        s.value === "true"
                          ? "oklch(0.65 0.18 160 / 0.4)"
                          : "oklch(0.22 0.02 240)",
                      border: `1px solid ${s.value === "true" ? GREEN : BORDER}`,
                    }}
                  >
                    <div
                      className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                      style={{
                        background:
                          s.value === "true" ? GREEN : "oklch(0.4 0.01 240)",
                        left: s.value === "true" ? "calc(100% - 22px)" : "2px",
                      }}
                    />
                  </button>
                ) : isNumeric ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={currentVal}
                      onChange={ev =>
                        setEditValues(p => ({ ...p, [s.key]: ev.target.value }))
                      }
                      className="w-28 px-2 py-1 rounded-lg text-xs bg-transparent border text-white text-right"
                      style={{
                        borderColor: isDirty ? GOLD : BORDER,
                        fontFamily: MONO,
                      }}
                    />
                    {isDirty && (
                      <button
                        onClick={() => {
                          update.mutate({ key: s.key, value: currentVal });
                          setEditValues(p => {
                            const n = { ...p };
                            delete n[s.key];
                            return n;
                          });
                        }}
                        className="px-2 py-1 rounded-lg text-xs font-bold"
                        style={{
                          background: "oklch(0.78 0.18 80 / 0.2)",
                          color: GOLD,
                          border: `1px solid ${GOLD}`,
                          fontFamily: DISP,
                        }}
                      >
                        Save
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      value={currentVal}
                      onChange={ev =>
                        setEditValues(p => ({ ...p, [s.key]: ev.target.value }))
                      }
                      className="w-40 px-2 py-1 rounded-lg text-xs bg-transparent border text-white"
                      style={{
                        borderColor: isDirty ? GOLD : BORDER,
                        fontFamily: MONO,
                      }}
                    />
                    {isDirty && (
                      <button
                        onClick={() => {
                          update.mutate({ key: s.key, value: currentVal });
                          setEditValues(p => {
                            const n = { ...p };
                            delete n[s.key];
                            return n;
                          });
                        }}
                        className="px-2 py-1 rounded-lg text-xs font-bold"
                        style={{
                          background: "oklch(0.78 0.18 80 / 0.2)",
                          color: GOLD,
                          border: `1px solid ${GOLD}`,
                          fontFamily: DISP,
                        }}
                      >
                        Save
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function SecurityTab() {
  return (
    <div className="flex flex-col gap-6">
      <div
        className="text-lg font-black text-white"
        style={{ fontFamily: DISP }}
      >
        Security Controls
      </div>
      <SecurityAuditSection />
      <PendingReversalsSection />
      <VelocityLimitsSection />
      <PlatformSettingsSection />
    </div>
  );
}
