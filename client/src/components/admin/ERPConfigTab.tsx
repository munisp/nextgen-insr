/**
 * ERPConfigTab — ERP Webhook Configuration & Sync Admin Panel Tab
 *
 * Allows admins to:
 *   - Select ERP type (Odoo, SAP, NetSuite, QuickBooks, Sage, Dynamics 365, Custom)
 *   - Configure base URL, API key, username, database
 *   - Set field mappings (GL account, cost centre, profit centre, journal ID, currency)
 *   - Enable/disable sync and set sync interval
 *   - Test the webhook connection with live latency
 *   - Trigger a manual sync and view results
 *   - Browse the ERP sync log
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Design tokens (match AdminPanel) ─────────────────────────────────────────
const BG = "#0a0e1a";
const CARD = "#111827";
const BORDER = "#1f2937";
const BLUE = "#3b82f6";
const GREEN = "#10b981";
const RED = "#ef4444";
const GOLD = "#f59e0b";
const GRAY = "#6b7280";
const WHITE = "#f9fafb";
const MONO = "'JetBrains Mono', monospace";
const DISP = "'Space Grotesk', sans-serif";

// ── ERP type metadata ─────────────────────────────────────────────────────────
const ERP_TYPES = [
  { value: "odoo", label: "Odoo", logo: "🟣", defaultPort: 8069 },
  { value: "sap", label: "SAP S/4HANA", logo: "🔵", defaultPort: 443 },
  { value: "netsuite", label: "NetSuite", logo: "🟠", defaultPort: 443 },
  { value: "quickbooks", label: "QuickBooks", logo: "🟢", defaultPort: 443 },
  { value: "sage", label: "Sage 300", logo: "🔴", defaultPort: 443 },
  { value: "dynamics365", label: "Dynamics 365", logo: "🔷", defaultPort: 443 },
  { value: "custom", label: "Custom Webhook", logo: "⚙", defaultPort: 443 },
] as const;

// ── Default field mappings per ERP type ──────────────────────────────────────
const DEFAULT_MAPPINGS: Record<string, Record<string, string>> = {
  odoo: {
    glAccount: "1200",
    costCenter: "",
    profitCenter: "",
    journalId: "1",
    currency: "NGN",
  },
  sap: {
    glAccount: "1200",
    costCenter: "CC001",
    profitCenter: "PC001",
    journalId: "",
    currency: "NGN",
  },
  netsuite: {
    glAccount: "1200",
    costCenter: "",
    profitCenter: "",
    journalId: "",
    currency: "NGN",
  },
  quickbooks: {
    glAccount: "Accounts Receivable",
    costCenter: "",
    profitCenter: "",
    journalId: "",
    currency: "NGN",
  },
  sage: {
    glAccount: "1200",
    costCenter: "",
    profitCenter: "",
    journalId: "",
    currency: "NGN",
  },
  dynamics365: {
    glAccount: "1200",
    costCenter: "CC001",
    profitCenter: "",
    journalId: "",
    currency: "NGN",
  },
  custom: {
    glAccount: "",
    costCenter: "",
    profitCenter: "",
    journalId: "",
    currency: "NGN",
  },
};

// ── RetryButton sub-component ───────────────────────────────────────────────
function RetryButton({ logId, onDone }: { logId: number; onDone: () => void }) {
  const retrySync = trpc.erp.retrySync.useMutation({
    onSuccess: r => {
      if (r.success) toast.success(`Entry #${logId} resynced successfully`);
      else toast.error(`Retry failed: ${r.error ?? "unknown error"}`);
      onDone();
    },
    onError: e => toast.error(`Retry error: ${e.message}`),
  });
  return (
    <button
      onClick={() => retrySync.mutate({ logId })}
      disabled={retrySync.isPending}
      className="text-xs px-2 py-1 rounded-lg font-bold"
      style={{
        background: `${RED}22`,
        color: RED,
        border: `1px solid ${RED}44`,
        fontFamily: DISP,
      }}
    >
      {retrySync.isPending ? "..." : "↩ Retry"}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ERPConfigTab() {
  const utils = trpc.useUtils();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: configData, isLoading } = trpc.erp.getConfig.useQuery();
  const [logStatusFilter, setLogStatusFilter] = useState<
    "all" | "pending" | "synced" | "failed"
  >("all");
  const { data: syncLog } = trpc.erp.getSyncLog.useQuery({
    limit: 50,
    status: logStatusFilter === "all" ? undefined : logStatusFilter,
  });

  // ── Local form state ───────────────────────────────────────────────────────
  const [erpType, setErpType] = useState<string>("odoo");
  const [name, setName] = useState("Default ERP");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [database, setDatabase] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
  const [syncTx, setSyncTx] = useState(true);
  const [syncAgents, setSyncAgents] = useState(false);
  const [syncInventory, setSyncInventory] = useState(false);
  const [mappings, setMappings] = useState<Record<string, string>>(
    DEFAULT_MAPPINGS.odoo
  );
  const [activeSection, setActiveSection] = useState<
    "connection" | "mappings" | "sync" | "log"
  >("connection");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number | null;
    message: string;
  } | null>(null);
  const [syncResult, setSyncResult] = useState<{
    synced: number;
    failed: number;
    total: number;
  } | null>(null);

  // ── Populate form from server data ─────────────────────────────────────────
  useEffect(() => {
    if (!configData) return;
    setErpType(configData.erpType ?? "odoo");
    setName(configData.name ?? "Default ERP");
    setBaseUrl(configData.baseUrl ?? "");
    setApiKey(""); // never pre-fill API key from server (masked)
    setUsername(configData.username ?? "");
    setDatabase(configData.database ?? "");
    setSyncEnabled(configData.syncEnabled ?? false);
    setSyncInterval(configData.syncIntervalMinutes ?? 60);
    setSyncTx(configData.syncTransactions ?? true);
    setSyncAgents(configData.syncAgents ?? false);
    setSyncInventory(configData.syncInventory ?? false);
    const fm = (configData.fieldMappings as Record<string, string>) ?? {};
    setMappings({ ...DEFAULT_MAPPINGS[configData.erpType ?? "odoo"], ...fm });
  }, [configData]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveConfig = trpc.erp.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("ERP configuration saved");
      utils.erp.getConfig.invalidate();
    },
    onError: e => toast.error(`Save failed: ${e.message}`),
  });

  const testWebhook = trpc.erp.testWebhook.useMutation({
    onSuccess: data => {
      setTestResult(data);
      if (data.success) toast.success(data.message);
      else toast.error(data.message);
    },
    onError: e => toast.error(`Test failed: ${e.message}`),
  });

  const syncNow = trpc.erp.syncNow.useMutation({
    onSuccess: data => {
      setSyncResult(data);
      toast.success(
        `Sync complete: ${data.synced} synced, ${data.failed} failed`
      );
      utils.erp.getSyncLog.invalidate();
      utils.erp.getConfig.invalidate();
    },
    onError: e => toast.error(`Sync failed: ${e.message}`),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!baseUrl) {
      toast.error("Base URL is required");
      return;
    }
    saveConfig.mutate({
      erpType: erpType as any,
      name,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      username,
      database,
      fieldMappings: mappings,
      syncEnabled,
      syncIntervalMinutes: syncInterval,
      syncTransactions: syncTx,
      syncAgents,
      syncInventory,
    });
  };

  const handleErpTypeChange = (type: string) => {
    setErpType(type);
    setMappings(DEFAULT_MAPPINGS[type] ?? DEFAULT_MAPPINGS.custom);
  };

  const updateMapping = (key: string, value: string) => {
    setMappings(prev => ({ ...prev, [key]: value }));
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const selectedErp = ERP_TYPES.find(e => e.value === erpType);
  const lastSyncAt = configData?.lastSyncAt
    ? new Date(configData.lastSyncAt).toLocaleString()
    : "Never";
  const lastSyncStatus = configData?.lastSyncStatus ?? "never";

  const statusColor = (s: string) => {
    if (s === "success") return GREEN;
    if (s === "partial") return GOLD;
    if (s === "failed") return RED;
    return GRAY;
  };

  const syncLogStatusColor = (s: string) => {
    if (s === "synced") return GREEN;
    if (s === "failed") return RED;
    if (s === "pending") return GOLD;
    return GRAY;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        style={{ color: GRAY, fontFamily: DISP }}
      >
        Loading ERP configuration...
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-6 p-6"
      style={{ background: BG, minHeight: "100%", color: WHITE }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-xl font-bold"
            style={{ fontFamily: DISP, color: WHITE }}
          >
            ERP Integration
          </h2>
          <p className="text-sm mt-1" style={{ color: GRAY, fontFamily: DISP }}>
            Configure webhook connection to your ERP system for automated
            transaction sync
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Last sync status badge */}
          <div
            className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{
              background: `${statusColor(lastSyncStatus)}22`,
              color: statusColor(lastSyncStatus),
              border: `1px solid ${statusColor(lastSyncStatus)}44`,
              fontFamily: MONO,
            }}
          >
            Last sync: {lastSyncAt}
          </div>
          <button
            onClick={handleSave}
            disabled={saveConfig.isPending}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{
              background: BLUE,
              fontFamily: DISP,
              opacity: saveConfig.isPending ? 0.6 : 1,
            }}
          >
            {saveConfig.isPending ? "Saving..." : "💾 Save Config"}
          </button>
        </div>
      </div>

      {/* ERP Type Selector */}
      <div
        className="rounded-2xl p-4"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div
          className="text-xs font-bold mb-3"
          style={{ color: GOLD, fontFamily: DISP }}
        >
          ERP System
        </div>
        <div className="grid grid-cols-4 gap-2">
          {ERP_TYPES.map(erp => (
            <button
              key={erp.value}
              onClick={() => handleErpTypeChange(erp.value)}
              className="flex flex-col items-center gap-1 p-3 rounded-xl text-xs font-bold transition-all"
              style={{
                background: erpType === erp.value ? `${BLUE}22` : "transparent",
                border: `1px solid ${erpType === erp.value ? BLUE : BORDER}`,
                color: erpType === erp.value ? BLUE : GRAY,
                fontFamily: DISP,
              }}
            >
              <span className="text-xl">{erp.logo}</span>
              <span>{erp.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        {(["connection", "mappings", "sync", "log"] as const).map(s => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className="flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all"
            style={{
              background: activeSection === s ? BLUE : "transparent",
              color: activeSection === s ? WHITE : GRAY,
              fontFamily: DISP,
            }}
          >
            {s === "connection"
              ? "🔌 Connection"
              : s === "mappings"
                ? "🗺 Field Mapping"
                : s === "sync"
                  ? "🔄 Sync Settings"
                  : "📋 Sync Log"}
          </button>
        ))}
      </div>

      {/* ── Connection Section ── */}
      {activeSection === "connection" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-bold"
                style={{ color: GRAY, fontFamily: DISP }}
              >
                Configuration Name
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: WHITE,
                  fontFamily: DISP,
                }}
                placeholder="e.g. Production Odoo"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-bold"
                style={{ color: GRAY, fontFamily: DISP }}
              >
                Base URL{" "}
                {selectedErp && (
                  <span style={{ color: GOLD }}>({selectedErp.label})</span>
                )}
              </label>
              <input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: WHITE,
                  fontFamily: MONO,
                }}
                placeholder={`https://erp.insureportal.ng${selectedErp ? `:${selectedErp.defaultPort}` : ""}`}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-bold"
                style={{ color: GRAY, fontFamily: DISP }}
              >
                API Key / Token
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: WHITE,
                  fontFamily: MONO,
                }}
                placeholder={
                  configData?.apiKey ? "••••••••••••" : "Enter API key"
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-bold"
                style={{ color: GRAY, fontFamily: DISP }}
              >
                {erpType === "odoo" ? "Odoo Username" : "Username"}
              </label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: WHITE,
                  fontFamily: MONO,
                }}
                placeholder="admin"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-bold"
                style={{ color: GRAY, fontFamily: DISP }}
              >
                {erpType === "odoo" ? "Odoo Database" : "Database / Company"}
              </label>
              <input
                value={database}
                onChange={e => setDatabase(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: WHITE,
                  fontFamily: MONO,
                }}
                placeholder="insureportal_prod"
              />
            </div>
          </div>

          {/* Test connection */}
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className="text-xs font-bold"
                style={{ color: GOLD, fontFamily: DISP }}
              >
                Connection Test
              </div>
              <button
                onClick={() => testWebhook.mutate()}
                disabled={testWebhook.isPending || !baseUrl}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-white"
                style={{
                  background: testWebhook.isPending ? GRAY : GREEN,
                  fontFamily: DISP,
                  opacity: !baseUrl ? 0.5 : 1,
                }}
              >
                {testWebhook.isPending ? "Testing..." : "⚡ Test Connection"}
              </button>
            </div>
            {testResult && (
              <div
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{
                  background: testResult.success ? `${GREEN}11` : `${RED}11`,
                  border: `1px solid ${testResult.success ? GREEN : RED}44`,
                }}
              >
                <span className="text-lg">
                  {testResult.success ? "✅" : "❌"}
                </span>
                <div>
                  <div
                    className="text-xs font-bold"
                    style={{
                      color: testResult.success ? GREEN : RED,
                      fontFamily: DISP,
                    }}
                  >
                    {testResult.success ? "Connected" : "Connection Failed"}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: GRAY, fontFamily: MONO }}
                  >
                    {testResult.message}
                    {testResult.latencyMs !== null &&
                      ` · ${testResult.latencyMs}ms`}
                  </div>
                </div>
              </div>
            )}
            {!testResult && (
              <div
                className="text-xs"
                style={{ color: GRAY, fontFamily: DISP }}
              >
                Save your configuration and click "Test Connection" to verify
                the ERP webhook is reachable.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Field Mappings Section ── */}
      {activeSection === "mappings" && (
        <div className="flex flex-col gap-4">
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs font-bold mb-1"
              style={{ color: GOLD, fontFamily: DISP }}
            >
              Field Mappings
            </div>
            <div
              className="text-xs mb-4"
              style={{ color: GRAY, fontFamily: DISP }}
            >
              Map InsurePortal transaction fields to {selectedErp?.label ?? "ERP"}{" "}
              account codes and dimensions.
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  key: "glAccount",
                  label: "GL Account / Chart of Accounts",
                  hint: "e.g. 1200",
                },
                { key: "costCenter", label: "Cost Centre", hint: "e.g. CC001" },
                {
                  key: "profitCenter",
                  label: "Profit Centre",
                  hint: "e.g. PC001",
                },
                {
                  key: "journalId",
                  label: "Journal ID",
                  hint: "e.g. 1 (Odoo journal)",
                },
                { key: "currency", label: "Currency Code", hint: "e.g. NGN" },
                {
                  key: "taxAccount",
                  label: "Tax / VAT Account",
                  hint: "e.g. 2200",
                },
                {
                  key: "bankAccount",
                  label: "Bank Account Code",
                  hint: "e.g. 1010",
                },
                {
                  key: "commissionAccount",
                  label: "Commission Income Account",
                  hint: "e.g. 4100",
                },
              ].map(({ key, label, hint }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label
                    className="text-xs font-bold"
                    style={{ color: GRAY, fontFamily: DISP }}
                  >
                    {label}
                  </label>
                  <input
                    value={mappings[key] ?? ""}
                    onChange={e => updateMapping(key, e.target.value)}
                    className="px-3 py-2 rounded-xl text-sm outline-none"
                    style={{
                      background: BG,
                      border: `1px solid ${BORDER}`,
                      color: WHITE,
                      fontFamily: MONO,
                    }}
                    placeholder={hint}
                  />
                </div>
              ))}
            </div>
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs font-bold mb-2"
              style={{ color: GOLD, fontFamily: DISP }}
            >
              Payload Preview
            </div>
            <pre
              className="text-xs overflow-x-auto"
              style={{ color: GREEN, fontFamily: MONO }}
            >
              {JSON.stringify(
                {
                  ref: "TXN-001",
                  type: "Cash In",
                  amount: 5000,
                  fee: 50,
                  commission: 25,
                  agentId: 1,
                  channel: "Cash",
                  ...mappings,
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      )}

      {/* ── Sync Settings Section ── */}
      {activeSection === "sync" && (
        <div className="flex flex-col gap-4">
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs font-bold mb-4"
              style={{ color: GOLD, fontFamily: DISP }}
            >
              Sync Configuration
            </div>
            <div className="flex flex-col gap-4">
              {/* Enable toggle */}
              <div
                className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: BG, border: `1px solid ${BORDER}` }}
              >
                <div>
                  <div
                    className="text-sm font-bold"
                    style={{ color: WHITE, fontFamily: DISP }}
                  >
                    Enable Automatic Sync
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: GRAY, fontFamily: DISP }}
                  >
                    Automatically push new transactions to ERP on schedule
                  </div>
                </div>
                <button
                  onClick={() => setSyncEnabled(!syncEnabled)}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold"
                  style={{
                    background: syncEnabled ? `${GREEN}22` : `${GRAY}22`,
                    color: syncEnabled ? GREEN : GRAY,
                    border: `1px solid ${syncEnabled ? GREEN : GRAY}44`,
                    fontFamily: DISP,
                  }}
                >
                  {syncEnabled ? "✓ Enabled" : "Disabled"}
                </button>
              </div>
              {/* Interval */}
              <div
                className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: BG, border: `1px solid ${BORDER}` }}
              >
                <div>
                  <div
                    className="text-sm font-bold"
                    style={{ color: WHITE, fontFamily: DISP }}
                  >
                    Sync Interval
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: GRAY, fontFamily: DISP }}
                  >
                    How often to push pending transactions (minutes)
                  </div>
                </div>
                <select
                  value={syncInterval}
                  onChange={e => setSyncInterval(parseInt(e.target.value))}
                  className="px-3 py-1.5 rounded-xl text-xs outline-none"
                  style={{
                    background: CARD,
                    border: `1px solid ${BORDER}`,
                    color: WHITE,
                    fontFamily: MONO,
                  }}
                >
                  {[5, 15, 30, 60, 120, 360, 720, 1440].map(v => (
                    <option key={v} value={v}>
                      {v < 60 ? `${v} min` : `${v / 60}h`}
                    </option>
                  ))}
                </select>
              </div>
              {/* What to sync */}
              {[
                {
                  key: "syncTx",
                  label: "Sync Transactions",
                  desc: "Push all completed transactions as journal entries",
                  value: syncTx,
                  set: setSyncTx,
                },
                {
                  key: "syncAgents",
                  label: "Sync Agents",
                  desc: "Push agent profile changes as vendor/partner records",
                  value: syncAgents,
                  set: setSyncAgents,
                },
                {
                  key: "syncInventory",
                  label: "Sync Inventory",
                  desc: "Push airtime/bill product sales to inventory module",
                  value: syncInventory,
                  set: setSyncInventory,
                },
              ].map(item => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-3 rounded-xl"
                  style={{ background: BG, border: `1px solid ${BORDER}` }}
                >
                  <div>
                    <div
                      className="text-sm font-bold"
                      style={{ color: WHITE, fontFamily: DISP }}
                    >
                      {item.label}
                    </div>
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: GRAY, fontFamily: DISP }}
                    >
                      {item.desc}
                    </div>
                  </div>
                  <button
                    onClick={() => item.set(!item.value)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold"
                    style={{
                      background: item.value ? `${GREEN}22` : `${GRAY}22`,
                      color: item.value ? GREEN : GRAY,
                      border: `1px solid ${item.value ? GREEN : GRAY}44`,
                      fontFamily: DISP,
                    }}
                  >
                    {item.value ? "✓ On" : "Off"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Manual sync trigger */}
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div
                  className="text-xs font-bold"
                  style={{ color: GOLD, fontFamily: DISP }}
                >
                  Manual Sync
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{ color: GRAY, fontFamily: DISP }}
                >
                  Push all unsynced transactions to ERP immediately
                </div>
              </div>
              <button
                onClick={() => syncNow.mutate()}
                disabled={syncNow.isPending || !syncEnabled}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: syncNow.isPending ? GRAY : BLUE,
                  fontFamily: DISP,
                  opacity: !syncEnabled ? 0.5 : 1,
                }}
              >
                {syncNow.isPending ? "Syncing..." : "🔄 Sync Now"}
              </button>
            </div>
            {!syncEnabled && (
              <div
                className="text-xs"
                style={{ color: GOLD, fontFamily: DISP }}
              >
                ⚠ Enable sync above to use manual sync.
              </div>
            )}
            {syncResult && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {[
                  {
                    label: "Total Pending",
                    value: syncResult.total,
                    color: WHITE,
                  },
                  { label: "Synced", value: syncResult.synced, color: GREEN },
                  {
                    label: "Failed",
                    value: syncResult.failed,
                    color: syncResult.failed > 0 ? RED : GRAY,
                  },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className="p-3 rounded-xl text-center"
                    style={{ background: BG, border: `1px solid ${BORDER}` }}
                  >
                    <div
                      className="text-2xl font-black"
                      style={{ color, fontFamily: MONO }}
                    >
                      {value}
                    </div>
                    <div
                      className="text-xs mt-1"
                      style={{ color: GRAY, fontFamily: DISP }}
                    >
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sync Log Section ── */}
      {activeSection === "log" && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <div
            className="px-4 py-3 flex flex-col gap-3"
            style={{ background: CARD }}
          >
            <div className="flex items-center justify-between">
              <div
                className="text-xs font-bold"
                style={{ color: GOLD, fontFamily: DISP }}
              >
                ERP Sync Log
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="text-xs"
                  style={{ color: GRAY, fontFamily: MONO }}
                >
                  {syncLog?.rows?.length ?? 0} entries
                </div>
                <button
                  onClick={() => utils.erp.getSyncLog.invalidate()}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{
                    background: `${BLUE}22`,
                    color: BLUE,
                    border: `1px solid ${BLUE}44`,
                    fontFamily: DISP,
                  }}
                >
                  🔄 Refresh
                </button>
              </div>
            </div>
            {/* Filter tabs */}
            <div className="flex gap-2">
              {(["all", "pending", "synced", "failed"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setLogStatusFilter(f)}
                  className="text-xs px-3 py-1 rounded-full font-semibold transition-colors"
                  style={{
                    background:
                      logStatusFilter === f
                        ? f === "failed"
                          ? `${RED}33`
                          : f === "synced"
                            ? `${GREEN}33`
                            : f === "pending"
                              ? `${GOLD}33`
                              : `${BLUE}33`
                        : `${BORDER}`,
                    color:
                      logStatusFilter === f
                        ? f === "failed"
                          ? RED
                          : f === "synced"
                            ? GREEN
                            : f === "pending"
                              ? GOLD
                              : BLUE
                        : GRAY,
                    border: `1px solid ${
                      logStatusFilter === f
                        ? f === "failed"
                          ? RED
                          : f === "synced"
                            ? GREEN
                            : f === "pending"
                              ? GOLD
                              : BLUE
                        : BORDER
                    }44`,
                    fontFamily: DISP,
                  }}
                >
                  {f === "all"
                    ? "All"
                    : f === "pending"
                      ? "⏳ Pending"
                      : f === "synced"
                        ? "✅ Synced"
                        : "❌ Failed"}
                </button>
              ))}
            </div>
          </div>
          {!syncLog || syncLog.rows.length === 0 ? (
            <div
              className="p-8 text-center"
              style={{ color: GRAY, fontFamily: DISP }}
            >
              No sync records yet. Trigger a sync to see results here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ fontFamily: MONO }}>
                <thead>
                  <tr style={{ background: BG }}>
                    {[
                      "ID",
                      "Entity",
                      "ERP Doc",
                      "Status",
                      "Error",
                      "Synced At",
                      "Action",
                    ].map(h => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left font-bold"
                        style={{ color: GRAY }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {syncLog.rows.map(
                    (row: {
                      id: number;
                      entityType: string;
                      entityId: string;
                      erpDocName: string | null;
                      status: string;
                      errorMessage: string | null;
                      syncedAt: Date | null;
                    }) => (
                      <tr
                        key={row.id}
                        className="border-t"
                        style={{ borderColor: BORDER }}
                      >
                        <td className="px-4 py-2" style={{ color: GRAY }}>
                          {row.id}
                        </td>
                        <td className="px-4 py-2" style={{ color: WHITE }}>
                          {row.entityType}/{row.entityId}
                        </td>
                        <td className="px-4 py-2" style={{ color: BLUE }}>
                          {row.erpDocName ?? "—"}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{
                              background: `${syncLogStatusColor(row.status)}22`,
                              color: syncLogStatusColor(row.status),
                            }}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td
                          className="px-4 py-2 max-w-xs truncate"
                          style={{ color: RED }}
                        >
                          {row.errorMessage ?? "—"}
                        </td>
                        <td className="px-4 py-2" style={{ color: GRAY }}>
                          {row.syncedAt
                            ? new Date(row.syncedAt).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {row.status === "failed" && (
                            <RetryButton
                              logId={row.id}
                              onDone={() => utils.erp.getSyncLog.invalidate()}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
