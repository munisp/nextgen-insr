// @ts-nocheck
/**
 * FloatTopUpTab — Admin Panel tab for approving/rejecting agent float top-up requests.
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
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const fmt = (n: number) =>
  `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FilterStatus = "pending" | "approved" | "rejected" | "all";

export default function FloatTopUpTab() {
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [rejectModal, setRejectModal] = useState<{
    id: number;
    agentId: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveModal, setApproveModal] = useState<{
    id: number;
    agentId: string;
    amount: number;
  } | null>(null);
  const [approveNotes, setApproveNotes] = useState("");

  const {
    data: requests,
    refetch,
    isLoading,
  } = trpc.agentMgmt.listTopUpRequests.useQuery({ status: filter });

  const approveMut = trpc.agentMgmt.approveTopUp.useMutation({
    onSuccess: data => {
      toast.success(`Float credited: ${fmt(data.amountCredited)}`);
      refetch();
      setApproveModal(null);
      setApproveNotes("");
    },
    onError: e => toast.error(`Approval failed: ${e.message}`),
  });

  const rejectMut = trpc.agentMgmt.rejectTopUp.useMutation({
    onSuccess: () => {
      toast.success("Request rejected");
      refetch();
      setRejectModal(null);
      setRejectReason("");
    },
    onError: e => toast.error(`Rejection failed: ${e.message}`),
  });

  const pendingCount = (requests ?? []).filter(
    r => r.status === "pending"
  ).length;
  const totalPending = (requests ?? [])
    .filter(r => r.status === "pending")
    .reduce((s, r) => s + r.requestedAmount, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-lg font-black text-white"
            style={{ fontFamily: DISP }}
          >
            Float Top-Up Requests
          </div>
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            {pendingCount} pending · {fmt(totalPending)} awaiting approval
          </div>
        </div>
        {/* Filter tabs */}
        <div
          className="flex gap-1 p-1 rounded-xl"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {(["pending", "approved", "rejected", "all"] as FilterStatus[]).map(
            s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
                style={{
                  background: filter === s ? BLUE : "transparent",
                  color: filter === s ? "white" : "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                {s}
              </button>
            )
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: "Pending Requests",
            value: (requests ?? []).filter(r => r.status === "pending").length,
            color: GOLD,
          },
          {
            label: "Approved Today",
            value: (requests ?? []).filter(r => r.status === "approved").length,
            color: GREEN,
          },
          {
            label: "Rejected Today",
            value: (requests ?? []).filter(r => r.status === "rejected").length,
            color: RED,
          },
        ].map(c => (
          <div
            key={c.label}
            className="rounded-2xl p-4 flex flex-col gap-1"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs text-gray-500 uppercase tracking-widest"
              style={{ fontFamily: DISP }}
            >
              {c.label}
            </div>
            <div
              className="text-2xl font-black"
              style={{ color: c.color, fontFamily: MONO }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Requests table */}
      <div
        className="overflow-x-auto rounded-xl"
        style={{ border: `1px solid ${BORDER}` }}
      >
        {isLoading ? (
          <div
            className="flex items-center justify-center h-32 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            Loading requests…
          </div>
        ) : (requests ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-2xl">✓</div>
            <div className="text-sm text-gray-500" style={{ fontFamily: DISP }}>
              No {filter} requests
            </div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr
                style={{
                  background: CARD,
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                {[
                  "Agent",
                  "Name",
                  "Current Float",
                  "Requested Amount",
                  "Status",
                  "Submitted",
                  "Notes",
                  "Actions",
                ].map(h => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                    style={{ fontFamily: DISP }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(requests ?? []).map((req, i) => (
                <tr
                  key={req.id}
                  style={{
                    background: i % 2 === 0 ? BG : CARD,
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  <td
                    className="px-3 py-3 font-bold"
                    style={{ color: BLUE, fontFamily: MONO }}
                  >
                    {req.agentId ?? "—"}
                  </td>
                  <td
                    className="px-3 py-3 text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {req.agentName ?? "—"}
                  </td>
                  <td
                    className="px-3 py-3"
                    style={{ color: GREEN, fontFamily: MONO }}
                  >
                    {fmt(req.agentFloat ?? 0)}
                  </td>
                  <td
                    className="px-3 py-3 font-black text-base"
                    style={{ color: GOLD, fontFamily: MONO }}
                  >
                    {fmt(req.requestedAmount)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
                      style={{
                        background:
                          req.status === "approved"
                            ? "oklch(0.65 0.18 160 / 0.15)"
                            : req.status === "rejected"
                              ? "oklch(0.60 0.22 25 / 0.15)"
                              : "oklch(0.78 0.18 80 / 0.15)",
                        color:
                          req.status === "approved"
                            ? GREEN
                            : req.status === "rejected"
                              ? RED
                              : GOLD,
                        fontFamily: DISP,
                      }}
                    >
                      {req.status}
                    </span>
                  </td>
                  <td
                    className="px-3 py-3 text-gray-500"
                    style={{ fontFamily: MONO }}
                  >
                    {new Date(req.createdAt).toLocaleString("en-NG", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td
                    className="px-3 py-3 text-gray-500 max-w-32 truncate"
                    style={{ fontFamily: DISP }}
                  >
                    {req.notes ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    {req.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setApproveModal({
                              id: req.id,
                              agentId: req.agentId ?? "",
                              amount: req.requestedAmount,
                            })
                          }
                          className="px-3 py-1 rounded-lg text-xs font-bold text-white"
                          style={{ background: GREEN, fontFamily: DISP }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() =>
                            setRejectModal({
                              id: req.id,
                              agentId: req.agentId ?? "",
                            })
                          }
                          className="px-3 py-1 rounded-lg text-xs font-bold text-white"
                          style={{ background: RED, fontFamily: DISP }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {req.status !== "pending" && (
                      <span
                        className="text-xs text-gray-600"
                        style={{ fontFamily: DISP }}
                      >
                        by {req.approvedBy ?? "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Approve modal */}
      {approveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <div
            className="rounded-2xl p-6 w-96 flex flex-col gap-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-base font-black text-white"
              style={{ fontFamily: DISP }}
            >
              Approve Float Top-Up
            </div>
            <div
              className="rounded-xl p-4 flex flex-col gap-2"
              style={{ background: BG }}
            >
              <div className="flex justify-between text-sm">
                <span className="text-gray-500" style={{ fontFamily: DISP }}>
                  Agent
                </span>
                <span
                  className="font-bold"
                  style={{ color: BLUE, fontFamily: MONO }}
                >
                  {approveModal.agentId}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500" style={{ fontFamily: DISP }}>
                  Amount to Credit
                </span>
                <span
                  className="font-black text-lg"
                  style={{ color: GREEN, fontFamily: MONO }}
                >
                  {fmt(approveModal.amount)}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                Notes (optional)
              </label>
              <textarea
                value={approveNotes}
                onChange={e => setApproveNotes(e.target.value)}
                placeholder="e.g. Approved for peak trading period"
                className="px-3 py-2 rounded-xl text-sm text-white bg-transparent border outline-none resize-none h-20"
                style={{
                  borderColor: BORDER,
                  fontFamily: DISP,
                  background: BG,
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setApproveModal(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: "oklch(0.22 0.02 240)",
                  color: "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  approveMut.mutate({
                    requestId: approveModal.id,
                    notes: approveNotes || undefined,
                  })
                }
                disabled={approveMut.isPending}
                className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: GREEN,
                  fontFamily: DISP,
                  opacity: approveMut.isPending ? 0.5 : 1,
                }}
              >
                {approveMut.isPending ? "Crediting…" : "Approve & Credit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <div
            className="rounded-2xl p-6 w-96 flex flex-col gap-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-base font-black text-white"
              style={{ fontFamily: DISP }}
            >
              Reject Request — {rejectModal.agentId}
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                Reason for rejection *
              </label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Insufficient documentation provided"
                className="px-3 py-2 rounded-xl text-sm text-white bg-transparent border outline-none resize-none h-24"
                style={{
                  borderColor: BORDER,
                  fontFamily: DISP,
                  background: BG,
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: "oklch(0.22 0.02 240)",
                  color: "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (rejectReason.trim().length < 5) {
                    toast.error("Please provide a reason (min 5 characters)");
                    return;
                  }
                  rejectMut.mutate({
                    requestId: rejectModal.id,
                    reason: rejectReason,
                  });
                }}
                disabled={rejectMut.isPending}
                className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: RED,
                  fontFamily: DISP,
                  opacity: rejectMut.isPending ? 0.5 : 1,
                }}
              >
                {rejectMut.isPending ? "Rejecting…" : "Reject Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
