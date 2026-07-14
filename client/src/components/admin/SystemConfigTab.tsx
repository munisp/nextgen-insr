// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * SystemConfigTab — Admin-settable key-value configuration table
 * Reads from system_config DB table via trpc.systemConfig.list
 * Allows admins to edit values inline via trpc.systemConfig.set
 */
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { toast } from "sonner";

const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.02 240)";
const GREEN = "oklch(0.65 0.18 160)";
const BLUE = "oklch(0.60 0.22 260)";
const GOLD = "oklch(0.78 0.18 80)";
const RED = "oklch(0.60 0.22 25)";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

interface ConfigEntry {
  id: number;
  key: string;
  value: string;
  description: string | null;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export function SystemConfigTab() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.systemConfig.list.useQuery();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const setConfig = trpc.systemConfig.set.useMutation({
    onSuccess: result => {
      toast.success(`Config "${result.key}" updated`);
      setEditingKey(null);
      utils.systemConfig.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleEdit = (entry: ConfigEntry) => {
    setEditingKey(entry.key);
    setEditValue(entry.value);
    setEditDesc(entry.description ?? "");
  };

  const handleSave = (key: string) => {
    if (!editValue.trim()) {
      toast.error("Value cannot be empty");
      return;
    }
    setConfig.mutate({
      key,
      value: editValue.trim(),
      description: editDesc.trim() || undefined,
    });
  };

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) {
      toast.error("Key and value are required");
      return;
    }
    setConfig.mutate(
      {
        key: newKey.trim(),
        value: newValue.trim(),
        description: newDesc.trim() || undefined,
      },
      {
        onSuccess: () => {
          setNewKey("");
          setNewValue("");
          setNewDesc("");
          setShowAddForm(false);
        },
      }
    );
  };

  const entries: ConfigEntry[] = (data?.entries ?? []) as ConfigEntry[];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-lg font-black text-white"
            style={{ fontFamily: DISP }}
          >
            System Configuration
          </div>
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            Admin-settable operational parameters. Changes take effect
            immediately without redeployment.
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: "oklch(0.60 0.22 260 / 0.2)",
            color: BLUE,
            fontFamily: DISP,
          }}
        >
          {showAddForm ? "✕ Cancel" : "+ Add Config"}
        </button>
      </div>

      {/* Add new config form */}
      {showAddForm && (
        <div
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            New Configuration Entry
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-gray-400 uppercase tracking-wider"
                style={{ fontFamily: DISP }}
              >
                Key
              </label>
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="e.g. max_daily_cash_out"
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  color: "white",
                  fontFamily: MONO,
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-gray-400 uppercase tracking-wider"
                style={{ fontFamily: DISP }}
              >
                Value
              </label>
              <input
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="e.g. 500000"
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  color: "white",
                  fontFamily: MONO,
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-gray-400 uppercase tracking-wider"
                style={{ fontFamily: DISP }}
              >
                Description (optional)
              </label>
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="What does this control?"
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  color: "white",
                  fontFamily: DISP,
                }}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{
                background: "transparent",
                color: "oklch(0.55 0.015 230)",
                fontFamily: DISP,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={setConfig.isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{
                background: BLUE,
                color: "white",
                fontFamily: DISP,
                opacity: setConfig.isPending ? 0.6 : 1,
              }}
            >
              {setConfig.isPending ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </div>
      )}

      {/* Config table */}
      {isLoading ? (
        <div
          className="text-center py-12 text-gray-500"
          style={{ fontFamily: DISP }}
        >
          Loading configuration…
        </div>
      ) : error ? (
        <div
          className="text-center py-12"
          style={{ color: RED, fontFamily: DISP }}
        >
          Failed to load configuration: {error.message}
        </div>
      ) : entries.length === 0 ? (
        <div
          className="text-center py-12 text-gray-600"
          style={{ fontFamily: DISP }}
        >
          No configuration entries yet. Click "+ Add Config" to create one.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map(entry => (
            <div
              key={entry.key}
              className="rounded-2xl p-5 flex flex-col gap-3"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              {/* Key + meta row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div
                    className="text-sm font-bold text-white truncate"
                    style={{ fontFamily: MONO }}
                  >
                    {entry.key}
                  </div>
                  {entry.description && (
                    <div
                      className="text-xs text-gray-500"
                      style={{ fontFamily: DISP }}
                    >
                      {entry.description}
                    </div>
                  )}
                  <div
                    className="text-xs text-gray-600 mt-1"
                    style={{ fontFamily: MONO }}
                  >
                    Last updated:{" "}
                    {new Date(entry.updatedAt).toLocaleString("en-NG")}
                    {entry.updatedBy && (
                      <span className="ml-2 text-gray-500">
                        by {entry.updatedBy}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {editingKey === entry.key ? (
                    <>
                      <button
                        onClick={() => setEditingKey(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{
                          background: "transparent",
                          color: "oklch(0.55 0.015 230)",
                          fontFamily: DISP,
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSave(entry.key)}
                        disabled={setConfig.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{
                          background: GREEN,
                          color: "white",
                          fontFamily: DISP,
                          opacity: setConfig.isPending ? 0.6 : 1,
                        }}
                      >
                        {setConfig.isPending ? "Saving…" : "✓ Save"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleEdit(entry)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{
                        background: "oklch(0.60 0.22 260 / 0.2)",
                        color: BLUE,
                        fontFamily: DISP,
                      }}
                    >
                      ✎ Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Value row */}
              {editingKey === entry.key ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <label
                      className="text-xs text-gray-400 uppercase tracking-wider"
                      style={{ fontFamily: DISP }}
                    >
                      Value
                    </label>
                    <input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="px-3 py-2 rounded-lg text-sm outline-none w-full"
                      style={{
                        background: BG,
                        border: `1px solid ${BLUE}`,
                        color: "white",
                        fontFamily: MONO,
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      className="text-xs text-gray-400 uppercase tracking-wider"
                      style={{ fontFamily: DISP }}
                    >
                      Description
                    </label>
                    <input
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      className="px-3 py-2 rounded-lg text-sm outline-none w-full"
                      style={{
                        background: BG,
                        border: `1px solid ${BORDER}`,
                        color: "white",
                        fontFamily: DISP,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div
                    className="px-3 py-2 rounded-lg text-sm font-bold flex-1"
                    style={{
                      background: BG,
                      border: `1px solid ${BORDER}`,
                      color: GOLD,
                      fontFamily: MONO,
                    }}
                  >
                    {entry.value}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div
        className="rounded-xl p-4 text-xs text-gray-500"
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          fontFamily: DISP,
        }}
      >
        <div className="font-semibold text-gray-400 mb-2">
          Well-known configuration keys
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <span style={{ color: GOLD, fontFamily: MONO }}>
              dead_letter_auto_retry_threshold
            </span>{" "}
            — Max ERP dead-letter queue size for auto-retry (default: 5)
          </div>
          <div>
            <span style={{ color: GOLD, fontFamily: MONO }}>
              alert_throttle_window_minutes
            </span>{" "}
            — Min minutes between VAPID push alerts (default: 30)
          </div>
          <div>
            <span style={{ color: GOLD, fontFamily: MONO }}>
              max_daily_cash_out
            </span>{" "}
            — Per-agent daily claim payout ceiling in NGN
          </div>
          <div>
            <span style={{ color: GOLD, fontFamily: MONO }}>
              settlement_hour_wat
            </span>{" "}
            — Hour (WAT) at which daily settlement cron fires
          </div>
        </div>
      </div>
    </div>
  );
}
