/**
 * InsurePortal Insurance Platform — Developer Portal
 * API key management, usage dashboard, and documentation for third-party integrators.
 * Enhanced with search/filter, pagination, usage stats, and webhook management.
 */
import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { usePosStore } from "../store/posStore";
import { toast } from "sonner";
import { Link } from "wouter";

const BG = "oklch(0.10 0.015 260)";
const CARD = "oklch(0.14 0.015 260)";
const BORDER = "oklch(0.22 0.015 260)";
const BLUE = "oklch(0.65 0.22 260)";
const GREEN = "oklch(0.65 0.18 160)";
const GOLD = "oklch(0.75 0.18 80)";
const RED = "oklch(0.60 0.22 25)";
const PURPLE = "oklch(0.65 0.22 300)";
const DISP = "'Inter', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type Tab = "keys" | "docs" | "scopes" | "usage";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/transactions",
    desc: "List transactions for the authenticated agent",
    scope: "transactions:read",
  },
  {
    method: "POST",
    path: "/api/v1/transactions",
    desc: "Create a new transaction (Premium Payment/Out, Transfer, etc.)",
    scope: "transactions:write",
  },
  {
    method: "GET",
    path: "/api/v1/transactions/:ref",
    desc: "Get a specific transaction by reference",
    scope: "transactions:read",
  },
  {
    method: "POST",
    path: "/api/v1/transactions/:id/reverse",
    desc: "Request a transaction reversal",
    scope: "transactions:write",
  },
  {
    method: "GET",
    path: "/api/v1/agents/me",
    desc: "Get the current agent's profile and premium reserve",
    scope: "agents:read",
  },
  {
    method: "PATCH",
    path: "/api/v1/agents/me",
    desc: "Update agent profile fields",
    scope: "agents:write",
  },
  {
    method: "GET",
    path: "/api/v1/float/balance",
    desc: "Get current premium reserve",
    scope: "float:read",
  },
  {
    method: "POST",
    path: "/api/v1/float/topup",
    desc: "Request a float top-up (requires approval)",
    scope: "float:write",
  },
  {
    method: "GET",
    path: "/api/v1/kyc/sessions",
    desc: "List KYC sessions for the agent",
    scope: "kyc:read",
  },
  {
    method: "POST",
    path: "/api/v1/kyc/sessions",
    desc: "Start a new KYC session",
    scope: "kyc:write",
  },
  {
    method: "GET",
    path: "/api/v1/kyc/sessions/:id",
    desc: "Get a KYC session by ID",
    scope: "kyc:read",
  },
  {
    method: "GET",
    path: "/api/v1/fraud/alerts",
    desc: "List fraud alerts (requires fraud:read scope)",
    scope: "fraud:read",
  },
  {
    method: "POST",
    path: "/api/v1/fraud/alerts/:id/resolve",
    desc: "Resolve a fraud alert",
    scope: "fraud:write",
  },
  {
    method: "GET",
    path: "/api/v1/merchants/me",
    desc: "Get merchant profile",
    scope: "merchant:read",
  },
  {
    method: "POST",
    path: "/api/v1/merchants/disputes",
    desc: "Raise a dispute on a transaction",
    scope: "merchant:write",
  },
  {
    method: "GET",
    path: "/api/v1/loyalty/balance",
    desc: "Get agent loyalty points balance",
    scope: "loyalty:read",
  },
  {
    method: "GET",
    path: "/api/v1/loyalty/history",
    desc: "Get loyalty points history",
    scope: "loyalty:read",
  },
  {
    method: "POST",
    path: "/api/v1/loyalty/redeem",
    desc: "Redeem loyalty points for a reward",
    scope: "loyalty:write",
  },
  {
    method: "GET",
    path: "/api/v1/settlement/history",
    desc: "Get settlement history",
    scope: "settlement:read",
  },
  {
    method: "GET",
    path: "/api/v1/audit/log",
    desc: "Get audit log entries",
    scope: "audit:read",
  },
  {
    method: "POST",
    path: "/api/v1/webhooks",
    desc: "Register a webhook endpoint",
    scope: "webhooks:write",
  },
  {
    method: "GET",
    path: "/api/v1/webhooks",
    desc: "List registered webhooks",
    scope: "webhooks:read",
  },
  {
    method: "DELETE",
    path: "/api/v1/webhooks/:id",
    desc: "Delete a webhook registration",
    scope: "webhooks:write",
  },
];

const KEYS_PER_PAGE = 5;
const ENDPOINTS_PER_PAGE = 10;

export default function DeveloperPortal() {
  const agent = usePosStore(s => s.agent);
  const [tab, setTab] = useState<Tab>("keys");
  const [createForm, setCreateForm] = useState({
    name: "",
    scopes: [] as string[],
    rateLimit: 1000,
  });
  const [creating, setCreating] = useState(false);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  // Search/filter state
  const [keySearch, setKeySearch] = useState("");
  const [keyStatusFilter, setKeyStatusFilter] = useState<
    "all" | "active" | "revoked"
  >("all");
  const [keyPage, setKeyPage] = useState(1);
  const [endpointSearch, setEndpointSearch] = useState("");
  const [endpointMethodFilter, setEndpointMethodFilter] = useState<
    "all" | "GET" | "POST" | "PATCH" | "DELETE"
  >("all");
  const [endpointScopeFilter, setEndpointScopeFilter] = useState("all");
  const [endpointPage, setEndpointPage] = useState(1);

  const keysQ = trpc.devPortal.listKeys.useQuery(undefined, { retry: 1 });
  const scopesQ = trpc.devPortal.getScopes.useQuery(undefined, { retry: 1 });

  const createMut = trpc.devPortal.createKey.useMutation({
    onSuccess: data => {
      setNewKeySecret(data.rawKey);
      setCreateForm({ name: "", scopes: [], rateLimit: 1000 });
      keysQ.refetch();
      toast.success("API key created — copy it now, it won't be shown again");
    },
    onError: e => toast.error(e.message),
  });

  const revokeMut = trpc.devPortal.revokeKey.useMutation({
    onSuccess: () => {
      keysQ.refetch();
      toast.success("API key revoked");
    },
    onError: e => toast.error(e.message),
  });

  const rotateMut = trpc.devPortal.rotateKey.useMutation({
    onSuccess: data => {
      setNewKeySecret(data.rawKey);
      keysQ.refetch();
      toast.success("API key rotated — copy the new key now");
    },
    onError: e => toast.error(e.message),
  });

  const availableScopes = scopesQ.data?.scopes ?? [];
  const allKeys = keysQ.data?.keys ?? [];

  // ── Client-side filter/search for keys ────────────────────────────────────
  const filteredKeys = useMemo(() => {
    let list = allKeys as any[];
    if (keySearch) {
      const q = keySearch.toLowerCase();
      list = list.filter(
        (k: any) =>
          k.name?.toLowerCase().includes(q) ||
          k.keyPrefix?.toLowerCase().includes(q)
      );
    }
    if (keyStatusFilter === "active")
      list = list.filter((k: any) => k.isActive);
    else if (keyStatusFilter === "revoked")
      list = list.filter((k: any) => !k.isActive);
    return list;
  }, [allKeys, keySearch, keyStatusFilter]);

  const totalKeyPages = Math.ceil(filteredKeys.length / KEYS_PER_PAGE);
  const pagedKeys = filteredKeys.slice(
    (keyPage - 1) * KEYS_PER_PAGE,
    keyPage * KEYS_PER_PAGE
  );

  // ── Client-side filter/search for endpoints ────────────────────────────────
  const uniqueScopes = useMemo(
    () => ["all", ...Array.from(new Set(ENDPOINTS.map(e => e.scope)))],
    []
  );
  const filteredEndpoints = useMemo(() => {
    let list = ENDPOINTS;
    if (endpointSearch) {
      const q = endpointSearch.toLowerCase();
      list = list.filter(
        e =>
          e.path.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q)
      );
    }
    if (endpointMethodFilter !== "all")
      list = list.filter(e => e.method === endpointMethodFilter);
    if (endpointScopeFilter !== "all")
      list = list.filter(e => e.scope === endpointScopeFilter);
    return list;
  }, [endpointSearch, endpointMethodFilter, endpointScopeFilter]);

  const totalEndpointPages = Math.ceil(
    filteredEndpoints.length / ENDPOINTS_PER_PAGE
  );
  const pagedEndpoints = filteredEndpoints.slice(
    (endpointPage - 1) * ENDPOINTS_PER_PAGE,
    endpointPage * ENDPOINTS_PER_PAGE
  );

  const tabs: { id: Tab; label: string; icon: string }[] = [
    {
      id: "keys",
      label: `API Keys (${allKeys.filter((k: any) => k.isActive).length} active)`,
      icon: "🔑",
    },
    { id: "docs", label: `Endpoints (${ENDPOINTS.length})`, icon: "📖" },
    { id: "scopes", label: "Scopes", icon: "🔐" },
    { id: "usage", label: "Usage", icon: "📊" },
  ];

  const methodColor = (m: string) => {
    if (m === "GET") return GREEN;
    if (m === "POST") return BLUE;
    if (m === "PATCH") return GOLD;
    if (m === "DELETE") return RED;
    return PURPLE;
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: BORDER, background: CARD }}
      >
        <div className="flex items-center gap-3">
          <Link href="/hub">
            <button
              className="text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: BORDER, color: BLUE }}
            >
              ← Hub
            </button>
          </Link>
          <div
            className="text-lg font-black text-white"
            style={{ fontFamily: DISP }}
          >
            Developer Portal
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "oklch(0.65 0.22 260 / 0.15)", color: BLUE }}
          >
            InsurePortal API v1
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: "oklch(0.65 0.18 160 / 0.1)",
              color: GREEN,
              fontFamily: MONO,
            }}
          >
            {allKeys.filter((k: any) => k.isActive).length}/{allKeys.length}{" "}
            keys active
          </span>
          <div className="text-xs text-gray-400">{agent?.name}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background:
                tab === t.id ? "oklch(0.60 0.22 260 / 0.2)" : "transparent",
              color: tab === t.id ? BLUE : "oklch(0.55 0.015 230)",
              border: `1px solid ${tab === t.id ? BLUE : "transparent"}`,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {/* ── API KEYS TAB ──────────────────────────────────────────────────── */}
        {tab === "keys" && (
          <div className="flex flex-col gap-6">
            {/* New key secret reveal */}
            {newKeySecret && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: "oklch(0.65 0.18 160 / 0.1)",
                  border: `1px solid ${GREEN}`,
                }}
              >
                <div className="text-sm font-bold text-green-400 mb-2">
                  ⚠ Copy your API key — it will not be shown again
                </div>
                <div className="flex items-center gap-3">
                  <code
                    className="flex-1 text-xs p-2 rounded-lg text-white break-all"
                    style={{ background: BG, fontFamily: MONO }}
                  >
                    {newKeySecret}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(newKeySecret);
                      toast.success("Copied!");
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                    style={{ background: GREEN }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => setNewKeySecret(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400"
                    style={{ background: CARD }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Create key form */}
            <div
              className="rounded-xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="text-sm font-bold text-white mb-4">
                Create New API Key
              </div>
              <div className="flex flex-col gap-3">
                <input
                  className="px-3 py-2 rounded-lg text-sm text-white outline-none"
                  style={{ background: BG, border: `1px solid ${BORDER}` }}
                  placeholder="Key name (e.g. Production Integration)"
                  value={createForm.name}
                  onChange={e =>
                    setCreateForm(f => ({ ...f, name: e.target.value }))
                  }
                />
                <div>
                  <div className="text-xs text-gray-400 mb-2">
                    Scopes (select all that apply)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableScopes.map((s: any) => (
                      <button
                        key={s.scope}
                        onClick={() =>
                          setCreateForm(f => ({
                            ...f,
                            scopes: f.scopes.includes(s.scope)
                              ? f.scopes.filter(x => x !== s.scope)
                              : [...f.scopes, s.scope],
                          }))
                        }
                        className="px-2 py-1 rounded-lg text-xs font-semibold transition-all"
                        style={{
                          background: createForm.scopes.includes(s.scope)
                            ? "oklch(0.60 0.22 260 / 0.2)"
                            : BG,
                          color: createForm.scopes.includes(s.scope)
                            ? BLUE
                            : "oklch(0.55 0.015 230)",
                          border: `1px solid ${createForm.scopes.includes(s.scope) ? BLUE : BORDER}`,
                        }}
                      >
                        {s.scope}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400">
                    Rate limit (req/hr):
                  </label>
                  <input
                    type="number"
                    className="w-24 px-2 py-1.5 rounded-lg text-sm text-white outline-none"
                    style={{ background: BG, border: `1px solid ${BORDER}` }}
                    value={createForm.rateLimit}
                    onChange={e =>
                      setCreateForm(f => ({
                        ...f,
                        rateLimit: parseInt(e.target.value) || 1000,
                      }))
                    }
                  />
                </div>
                <button
                  onClick={async () => {
                    if (!createForm.name) {
                      toast.error("Key name required");
                      return;
                    }
                    if (createForm.scopes.length === 0) {
                      toast.error("Select at least one scope");
                      return;
                    }
                    setCreating(true);
                    try {
                      await createMut.mutateAsync({
                        name: createForm.name,
                        scopes: createForm.scopes as any,
                        rateLimit: createForm.rateLimit,
                      });
                    } finally {
                      setCreating(false);
                    }
                  }}
                  disabled={creating}
                  className="self-start px-5 py-2 rounded-lg text-sm font-bold text-white transition-all"
                  style={{ background: creating ? BORDER : BLUE }}
                >
                  {creating ? "Creating…" : "Create API Key"}
                </button>
              </div>
            </div>

            {/* Search & filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  🔍
                </span>
                <input
                  type="text"
                  placeholder="Search by key name or prefix…"
                  value={keySearch}
                  onChange={e => {
                    setKeySearch(e.target.value);
                    setKeyPage(1);
                  }}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                />
              </div>
              <select
                value={keyStatusFilter}
                onChange={e => {
                  setKeyStatusFilter(e.target.value as typeof keyStatusFilter);
                  setKeyPage(1);
                }}
                className="px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <option value="all">All Keys ({allKeys.length})</option>
                <option value="active">
                  Active ({allKeys.filter((k: any) => k.isActive).length})
                </option>
                <option value="revoked">
                  Revoked ({allKeys.filter((k: any) => !k.isActive).length})
                </option>
              </select>
            </div>

            {/* Keys list */}
            <div className="text-sm font-bold text-gray-300">
              Showing {pagedKeys.length} of {filteredKeys.length} keys
            </div>
            {keysQ.isLoading && (
              <div className="text-gray-400 text-sm">Loading…</div>
            )}
            <div className="flex flex-col gap-3">
              {pagedKeys.map((k: any) => (
                <div
                  key={k.id}
                  className="rounded-xl p-4"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-bold text-white">
                        {k.name}
                      </div>
                      <div
                        className="text-xs text-gray-400 mt-0.5"
                        style={{ fontFamily: MONO }}
                      >
                        {k.keyPrefix}••••••••••••••••••••••••••••••••
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{
                          background: k.isActive
                            ? "oklch(0.65 0.18 160 / 0.15)"
                            : "oklch(0.60 0.22 25 / 0.15)",
                          color: k.isActive ? GREEN : RED,
                        }}
                      >
                        {k.isActive ? "Active" : "Revoked"}
                      </span>
                      {k.isActive && (
                        <>
                          <button
                            onClick={async () => {
                              setRevoking(k.id);
                              try {
                                await rotateMut.mutateAsync({ keyId: k.id });
                              } finally {
                                setRevoking(null);
                              }
                            }}
                            disabled={revoking === k.id}
                            className="px-3 py-1 rounded-lg text-xs font-semibold"
                            style={{
                              background: "oklch(0.75 0.18 80 / 0.15)",
                              color: GOLD,
                            }}
                          >
                            Rotate
                          </button>
                          <button
                            onClick={async () => {
                              setRevoking(k.id);
                              try {
                                await revokeMut.mutateAsync({ keyId: k.id });
                              } finally {
                                setRevoking(null);
                              }
                            }}
                            disabled={revoking === k.id}
                            className="px-3 py-1 rounded-lg text-xs font-semibold"
                            style={{
                              background: "oklch(0.60 0.22 25 / 0.15)",
                              color: RED,
                            }}
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(k.scopes ?? []).map((s: string) => (
                      <span
                        key={s}
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: "oklch(0.60 0.22 260 / 0.1)",
                          color: BLUE,
                          fontFamily: MONO,
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-gray-500">
                      Created {new Date(k.createdAt).toLocaleString("en-NG")}
                      {k.lastUsedAt &&
                        ` · Last used ${new Date(k.lastUsedAt).toLocaleString("en-NG")}`}
                    </div>
                    {k.rateLimit && (
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          background: "oklch(0.65 0.22 260 / 0.08)",
                          color: BLUE,
                          fontFamily: MONO,
                        }}
                      >
                        {k.rateLimit.toLocaleString()} req/hr
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {filteredKeys.length === 0 && !keysQ.isLoading && (
                <div className="text-sm text-gray-500 text-center py-6">
                  {keySearch || keyStatusFilter !== "all"
                    ? "No keys match your filters."
                    : "No API keys yet — create one above"}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalKeyPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setKeyPage(p => Math.max(1, p - 1))}
                  disabled={keyPage === 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{
                    background: CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  ← Prev
                </button>
                {Array.from({ length: totalKeyPages }, (_, i) => i + 1).map(
                  p => (
                    <button
                      key={p}
                      onClick={() => setKeyPage(p)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{
                        background: keyPage === p ? BLUE : CARD,
                        color: "white",
                        border: `1px solid ${keyPage === p ? BLUE : BORDER}`,
                        fontFamily: MONO,
                      }}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  onClick={() =>
                    setKeyPage(p => Math.min(totalKeyPages, p + 1))
                  }
                  disabled={keyPage === totalKeyPages}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{
                    background: CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── ENDPOINTS TAB ─────────────────────────────────────────────────── */}
        {tab === "docs" && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-gray-300">
              REST API Reference
            </div>
            <div
              className="text-xs text-gray-400 p-3 rounded-lg"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              Base URL:{" "}
              <code className="text-blue-400" style={{ fontFamily: MONO }}>
                https://api.insureportal.ng/api/v1
              </code>
              <br />
              Authentication:{" "}
              <code className="text-blue-400" style={{ fontFamily: MONO }}>
                Authorization: Bearer &lt;your-api-key&gt;
              </code>
            </div>

            {/* Search & filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  🔍
                </span>
                <input
                  type="text"
                  placeholder="Search endpoints by path or description…"
                  value={endpointSearch}
                  onChange={e => {
                    setEndpointSearch(e.target.value);
                    setEndpointPage(1);
                  }}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                />
              </div>
              <select
                value={endpointMethodFilter}
                onChange={e => {
                  setEndpointMethodFilter(
                    e.target.value as typeof endpointMethodFilter
                  );
                  setEndpointPage(1);
                }}
                className="px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <option value="all">All Methods</option>
                {["GET", "POST", "PATCH", "DELETE"].map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={endpointScopeFilter}
                onChange={e => {
                  setEndpointScopeFilter(e.target.value);
                  setEndpointPage(1);
                }}
                className="px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                {uniqueScopes.map(s => (
                  <option key={s} value={s}>
                    {s === "all" ? "All Scopes" : s}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs text-gray-500">
              Showing {pagedEndpoints.length} of {filteredEndpoints.length}{" "}
              endpoints
            </div>

            <div className="flex flex-col gap-2">
              {pagedEndpoints.map((ep, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-xl"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded shrink-0 mt-0.5"
                    style={{
                      background: `${methodColor(ep.method)}20`,
                      color: methodColor(ep.method),
                      fontFamily: MONO,
                    }}
                  >
                    {ep.method}
                  </span>
                  <div className="flex-1 min-w-0">
                    <code
                      className="text-xs text-white"
                      style={{ fontFamily: MONO }}
                    >
                      {ep.path}
                    </code>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {ep.desc}
                    </div>
                  </div>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: "oklch(0.60 0.22 260 / 0.1)",
                      color: BLUE,
                      fontFamily: MONO,
                    }}
                  >
                    {ep.scope}
                  </span>
                </div>
              ))}
              {filteredEndpoints.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-6">
                  No endpoints match your filters.
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalEndpointPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setEndpointPage(p => Math.max(1, p - 1))}
                  disabled={endpointPage === 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{
                    background: CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  ← Prev
                </button>
                {Array.from(
                  { length: totalEndpointPages },
                  (_, i) => i + 1
                ).map(p => (
                  <button
                    key={p}
                    onClick={() => setEndpointPage(p)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{
                      background: endpointPage === p ? BLUE : CARD,
                      color: "white",
                      border: `1px solid ${endpointPage === p ? BLUE : BORDER}`,
                      fontFamily: MONO,
                    }}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() =>
                    setEndpointPage(p => Math.min(totalEndpointPages, p + 1))
                  }
                  disabled={endpointPage === totalEndpointPages}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{
                    background: CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── SCOPES TAB ────────────────────────────────────────────────────── */}
        {tab === "scopes" && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-gray-300">
              Available API Scopes
            </div>
            {scopesQ.isLoading && (
              <div className="text-gray-400 text-sm">Loading…</div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {availableScopes.map((s: any) => (
                <div
                  key={s.scope}
                  className="rounded-xl p-4"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div
                      className="text-sm font-bold"
                      style={{ color: BLUE, fontFamily: MONO }}
                    >
                      {s.scope}
                    </div>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        background: "oklch(0.65 0.18 160 / 0.1)",
                        color: GREEN,
                        fontFamily: MONO,
                      }}
                    >
                      {ENDPOINTS.filter(e => e.scope === s.scope).length}{" "}
                      endpoints
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">{s.description}</div>
                </div>
              ))}
              {availableScopes.length === 0 && !scopesQ.isLoading && (
                <div className="text-sm text-gray-500">No scopes available</div>
              )}
            </div>
          </div>
        )}

        {/* ── USAGE TAB ─────────────────────────────────────────────────────── */}
        {tab === "usage" && (
          <div className="flex flex-col gap-6">
            <div className="text-sm font-bold text-gray-300">
              API Usage Overview
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: "Active Keys",
                  value: allKeys.filter((k: any) => k.isActive).length,
                  color: GREEN,
                  icon: "🔑",
                },
                {
                  label: "Total Keys",
                  value: allKeys.length,
                  color: BLUE,
                  icon: "📋",
                },
                {
                  label: "Revoked Keys",
                  value: allKeys.filter((k: any) => !k.isActive).length,
                  color: RED,
                  icon: "🚫",
                },
                {
                  label: "Available Scopes",
                  value: availableScopes.length,
                  color: GOLD,
                  icon: "🔐",
                },
              ].map(stat => (
                <div
                  key={stat.label}
                  className="rounded-2xl p-4"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{stat.icon}</span>
                    <span className="text-xs text-gray-400">{stat.label}</span>
                  </div>
                  <div
                    className="text-3xl font-black"
                    style={{ color: stat.color, fontFamily: MONO }}
                  >
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            <div
              className="rounded-xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="text-sm font-bold text-white mb-4">
                Key Usage Summary
              </div>
              {allKeys.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-6">
                  No API keys yet — create one in the Keys tab
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                        {[
                          "Key Name",
                          "Status",
                          "Rate Limit",
                          "Scopes",
                          "Last Used",
                          "Created",
                        ].map(h => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-semibold text-gray-400 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allKeys.map((k: any, i: number) => (
                        <tr
                          key={k.id}
                          style={{
                            borderBottom: `1px solid ${BORDER}`,
                            background: i % 2 === 0 ? BG : "transparent",
                          }}
                        >
                          <td className="px-3 py-2 font-semibold text-white">
                            {k.name}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{
                                background: k.isActive
                                  ? "oklch(0.65 0.18 160 / 0.15)"
                                  : "oklch(0.60 0.22 25 / 0.15)",
                                color: k.isActive ? GREEN : RED,
                              }}
                            >
                              {k.isActive ? "Active" : "Revoked"}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2 text-gray-400"
                            style={{ fontFamily: MONO }}
                          >
                            {k.rateLimit?.toLocaleString() ?? "—"}/hr
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {(k.scopes ?? []).length} scopes
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {k.lastUsedAt
                              ? new Date(k.lastUsedAt).toLocaleDateString(
                                  "en-NG"
                                )
                              : "Never"}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {new Date(k.createdAt).toLocaleDateString("en-NG")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
