/**
 * InsurePortal Insurance Platform — Fraud Rules Admin Tab
 * CRUD interface for managing real-time fraud detection rules.
 */
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { toast } from "sonner";

const BG = "oklch(0.10 0.015 260)";
const CARD = "oklch(0.14 0.015 260)";
const BORDER = "oklch(0.22 0.015 260)";
const BLUE = "oklch(0.65 0.22 260)";
const GREEN = "oklch(0.65 0.18 160)";
const GOLD = "oklch(0.75 0.18 80)";
const RED = "oklch(0.60 0.22 25)";
const DISP = "'Inter', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type RuleCategory =
  | "velocity"
  | "geofence"
  | "device_fingerprint"
  | "amount_anomaly"
  | "time_of_day"
  | "blacklist"
  | "custom";

const CATEGORY_COLORS: Record<string, string> = {
  velocity: BLUE,
  geofence: GREEN,
  device_fingerprint: GOLD,
  amount_anomaly: RED,
  time_of_day: "oklch(0.65 0.18 300)",
  blacklist: RED,
  custom: "oklch(0.65 0.015 230)",
};

const EMPTY_FORM = {
  name: "",
  category: "velocity" as RuleCategory,
  description: "",
  threshold: 0.7,
  windowSeconds: 3600,
  maxCount: 5,
  enabled: true,
};

export function FraudRulesTab() {
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const rulesQ = trpc.fraud.listRules.useQuery(undefined, { retry: 1 });

  const createMut = trpc.fraud.createRule.useMutation({
    onSuccess: () => {
      toast.success("Fraud rule created");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      rulesQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const updateMut = trpc.fraud.updateRule.useMutation({
    onSuccess: () => {
      toast.success("Fraud rule updated");
      setEditId(null);
      rulesQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const deleteMut = trpc.fraud.deleteRule.useMutation({
    onSuccess: () => {
      toast.success("Fraud rule deleted");
      rulesQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const toggleMut = trpc.fraud.toggleRule.useMutation({
    onSuccess: () => rulesQ.refetch(),
    onError: e => toast.error(e.message),
  });

  const seedMut = trpc.fraud.seedDefaultRules.useMutation({
    onSuccess: res => {
      toast.success(res.message);
      rulesQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const rules = rulesQ.data ?? [];

  function RuleForm({
    onSubmit,
    onCancel,
  }: {
    onSubmit: () => void;
    onCancel: () => void;
  }) {
    return (
      <div
        className="rounded-xl p-5"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div className="text-sm font-bold text-white mb-4">
          {editId ? "Edit Rule" : "New Fraud Rule"}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Rule Name
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
              placeholder="e.g. High Velocity Transactions"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Category</label>
            <select
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
              value={form.category}
              onChange={e =>
                setForm(f => ({
                  ...f,
                  category: e.target.value as RuleCategory,
                }))
              }
            >
              {(
                [
                  "velocity",
                  "geofence",
                  "device_fingerprint",
                  "amount_anomaly",
                  "time_of_day",
                  "blacklist",
                  "custom",
                ] as RuleCategory[]
              ).map(c => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs text-gray-400 mb-1 block">
              Description
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
              placeholder="Describe what this rule detects…"
              value={form.description}
              onChange={e =>
                setForm(f => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Fraud Score Threshold (0.0 – 1.0)
            </label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
              value={form.threshold}
              onChange={e =>
                setForm(f => ({
                  ...f,
                  threshold: parseFloat(e.target.value) || 0,
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Window (seconds)
            </label>
            <input
              type="number"
              min="60"
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
              value={form.windowSeconds}
              onChange={e =>
                setForm(f => ({
                  ...f,
                  windowSeconds: parseInt(e.target.value) || 3600,
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              Max Count (per window)
            </label>
            <input
              type="number"
              min="1"
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
              value={form.maxCount}
              onChange={e =>
                setForm(f => ({
                  ...f,
                  maxCount: parseInt(e.target.value) || 5,
                }))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="rule-enabled"
              checked={form.enabled}
              onChange={e =>
                setForm(f => ({ ...f, enabled: e.target.checked }))
              }
            />
            <label htmlFor="rule-enabled" className="text-xs text-gray-300">
              Enable rule immediately
            </label>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: saving ? BORDER : BLUE }}
          >
            {saving ? "Saving…" : editId ? "Update Rule" : "Create Rule"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-gray-400"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" style={{ fontFamily: DISP }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-black text-white">
            Fraud Detection Rules
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {rules.length} rules configured · Real-time engine active
          </div>
        </div>
        {!showCreate && !editId && (
          <button
            onClick={() => {
              setShowCreate(true);
              setForm(EMPTY_FORM);
            }}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: BLUE }}
          >
            + New Rule
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <RuleForm
          onSubmit={async () => {
            if (!form.name) {
              toast.error("Rule name required");
              return;
            }
            setSaving(true);
            try {
              await createMut.mutateAsync({
                name: form.name,
                category: form.category,
                description: form.description,
                threshold: form.threshold,
                windowSeconds: form.windowSeconds,
                maxCount: form.maxCount,
                enabled: form.enabled,
              });
            } finally {
              setSaving(false);
            }
          }}
          onCancel={() => {
            setShowCreate(false);
            setForm(EMPTY_FORM);
          }}
        />
      )}

      {/* Rules list */}
      {rulesQ.isLoading && (
        <div className="text-gray-400 text-sm">Loading rules…</div>
      )}
      <div className="flex flex-col gap-3">
        {rules.map((rule: any) => (
          <div key={rule.id}>
            {editId === rule.id ? (
              <RuleForm
                onSubmit={async () => {
                  setSaving(true);
                  try {
                    await updateMut.mutateAsync({
                      id: rule.id,
                      name: form.name,
                      category: form.category,
                      description: form.description,
                      threshold: form.threshold,
                      windowSeconds: form.windowSeconds,
                      maxCount: form.maxCount,
                      enabled: form.enabled,
                    });
                  } finally {
                    setSaving(false);
                  }
                }}
                onCancel={() => setEditId(null)}
              />
            ) : (
              <div
                className="rounded-xl p-4"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-sm font-bold text-white">
                        {rule.name}
                      </div>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{
                          background: `${CATEGORY_COLORS[rule.category] ?? BLUE}20`,
                          color: CATEGORY_COLORS[rule.category] ?? BLUE,
                        }}
                      >
                        {rule.category?.replace(/_/g, " ")}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{
                          background: rule.enabled
                            ? "oklch(0.65 0.18 160 / 0.15)"
                            : "oklch(0.60 0.22 25 / 0.15)",
                          color: rule.enabled ? GREEN : RED,
                        }}
                      >
                        {rule.enabled ? "Active" : "Disabled"}
                      </span>
                    </div>
                    {rule.description && (
                      <div className="text-xs text-gray-400 mb-2">
                        {rule.description}
                      </div>
                    )}
                    <div
                      className="flex flex-wrap gap-3 text-xs text-gray-500"
                      style={{ fontFamily: MONO }}
                    >
                      <span>
                        Threshold:{" "}
                        <span style={{ color: GOLD }}>{rule.threshold}</span>
                      </span>
                      {rule.windowSeconds && (
                        <span>
                          Window:{" "}
                          <span style={{ color: BLUE }}>
                            {rule.windowSeconds}s
                          </span>
                        </span>
                      )}
                      {rule.maxCount && (
                        <span>
                          Max:{" "}
                          <span style={{ color: BLUE }}>{rule.maxCount}</span>
                        </span>
                      )}
                      <span>
                        Hits:{" "}
                        <span
                          style={{ color: rule.hitCount > 0 ? RED : GREEN }}
                        >
                          {rule.hitCount ?? 0}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() =>
                        toggleMut.mutate({
                          id: rule.id,
                          enabled: !rule.enabled,
                        })
                      }
                      className="px-3 py-1 rounded-lg text-xs font-semibold"
                      style={{
                        background: rule.enabled
                          ? "oklch(0.60 0.22 25 / 0.1)"
                          : "oklch(0.65 0.18 160 / 0.1)",
                        color: rule.enabled ? RED : GREEN,
                      }}
                    >
                      {rule.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => {
                        setEditId(rule.id);
                        setForm({
                          name: rule.name,
                          category: rule.category as RuleCategory,
                          description: rule.description ?? "",
                          threshold: rule.threshold,
                          windowSeconds: rule.windowSeconds ?? 3600,
                          maxCount: rule.maxCount ?? 5,
                          enabled: rule.enabled,
                        });
                      }}
                      className="px-3 py-1 rounded-lg text-xs font-semibold"
                      style={{
                        background: "oklch(0.65 0.22 260 / 0.1)",
                        color: BLUE,
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (!confirm(`Delete rule "${rule.name}"?`)) return;
                        deleteMut.mutate({ id: rule.id });
                      }}
                      className="px-3 py-1 rounded-lg text-xs font-semibold"
                      style={{
                        background: "oklch(0.60 0.22 25 / 0.1)",
                        color: RED,
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {rules.length === 0 && !rulesQ.isLoading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="text-4xl">🛡️</div>
            <div className="text-sm font-semibold text-white">
              No fraud rules configured
            </div>
            <div className="text-xs text-gray-500 text-center max-w-sm">
              Your fraud detection engine has no active rules. Seed the 10
              production-ready default rules (velocity limits, amount anomalies,
              geofence checks, device fingerprinting, blacklist, and more) or
              create custom rules manually.
            </div>
            <button
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{
                background: BLUE,
                color: "#fff",
                opacity: seedMut.isPending ? 0.6 : 1,
              }}
            >
              {seedMut.isPending ? "Seeding…" : "⚡ Seed 10 Default Rules"}
            </button>
            <div className="text-xs text-gray-600">
              or use the &quot;+ New Rule&quot; button above to create one
              manually
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
