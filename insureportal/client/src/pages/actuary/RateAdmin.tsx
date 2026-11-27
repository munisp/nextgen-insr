/**
 * RateAdmin.tsx — W34-D (2026-11-28) actuary_admin rate administration page
 * (design Appendix E: "RateAdmin (version lifecycle, NAICOM filing ref
 * capture)"). Surfaces:
 *   - rate-version lifecycle (draft → filing → approved → retired) via
 *     trpc.actuaryAdmin.upsertRateVersion, with NAICOM filing-ref capture
 *     at the filing stage (required by the router gate);
 *   - referral-rule CRUD + priority ordering via manageReferralRules;
 *   - assumption-set upsert with the naicomFilingReady attestation gate.
 *
 * All mutations are actuary_admin Permify-gated server-side (fail-closed);
 * the page surfaces gate errors verbatim and renders honest empty states.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import ActuaryFeatureGate from "./ActuaryFeatureGate";
import { ACTUARY_PRODUCT_LINES } from "./featureFlag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved"
      ? "default"
      : status === "retired"
        ? "outline"
        : "secondary";
  return <Badge variant={variant as never}>{status}</Badge>;
}

function RateAdminBody() {
  const [notice, setNotice] = useState<string | null>(null);
  const versions = trpc.actuaryAdmin.listRateVersions.useQuery({});
  const rules = trpc.actuaryAdmin.listReferralRules.useQuery({});
  const utils = trpc.useUtils();

  const refresh = () => {
    utils.actuaryAdmin.listRateVersions.invalidate();
    utils.actuaryAdmin.listReferralRules.invalidate();
  };

  // ── New rate version form state ───────────────────────────────────────
  const [newLine, setNewLine] = useState<string>("motor");
  const [newVersion, setNewVersion] = useState("");
  const [newFilingRef, setNewFilingRef] = useState("");
  const lifecycle = trpc.actuaryAdmin.upsertRateVersion.useMutation({
    onSuccess: r => {
      setNotice(`Version #${r.id} → status '${r.status}'.`);
      refresh();
    },
    onError: e => setNotice(`Lifecycle action refused: ${e.message}`),
  });

  // Filing-ref capture per row transition.
  const [rowFilingRef, setRowFilingRef] = useState<Record<number, string>>({});

  // ── New referral rule form state ──────────────────────────────────────
  const [ruleLine, setRuleLine] = useState<string>("motor");
  const [ruleReason, setRuleReason] = useState("");
  const [rulePredicate, setRulePredicate] = useState("");
  const [rulePriority, setRulePriority] = useState("100");
  const ruleMut = trpc.actuaryAdmin.manageReferralRules.useMutation({
    onSuccess: () => {
      setNotice("Referral rule saved.");
      refresh();
    },
    onError: e => setNotice(`Rule action refused: ${e.message}`),
  });

  // ── Assumption set form state ─────────────────────────────────────────
  const [asName, setAsName] = useState("");
  const [asScope, setAsScope] = useState<"pricing" | "reserving" | "capital" | "life">("pricing");
  const [asVersion, setAsVersion] = useState("");
  const [asPayload, setAsPayload] = useState("");
  const [asReady, setAsReady] = useState(false);
  const asMut = trpc.actuaryAdmin.upsertAssumptionSet.useMutation({
    onSuccess: r =>
      setNotice(
        `Assumption set #${r.id} saved (naicomFilingReady=${r.naicomFilingReady}).`
      ),
    onError: e => setNotice(`Assumption set refused: ${e.message}`),
  });

  const runAction = (
    productLine: string,
    version: string,
    action: "create" | "submitFiling" | "approve" | "retire",
    id?: number
  ) =>
    lifecycle.mutate({
      productLine,
      version,
      action,
      ...(action === "submitFiling" && id && rowFilingRef[id]
        ? { naicomFilingRef: rowFilingRef[id] }
        : {}),
    });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Rate Administration</h1>
          <p className="text-muted-foreground">
            Rate-version lifecycle, referral rules, and NAICOM filing
            readiness — actuary_admin only
          </p>
        </div>

        {notice && (
          <Card>
            <CardContent className="pt-6 text-sm">{notice}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Rate Versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Line</p>
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={newLine}
                  onChange={e => setNewLine(e.target.value)}
                >
                  {ACTUARY_PRODUCT_LINES.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Version</p>
                <Input
                  value={newVersion}
                  onChange={e => setNewVersion(e.target.value)}
                  placeholder="2026.09"
                  className="w-32"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  NAICOM filing ref (optional at draft)
                </p>
                <Input
                  value={newFilingRef}
                  onChange={e => setNewFilingRef(e.target.value)}
                  placeholder="NAICOM/…"
                  className="w-48"
                />
              </div>
              <Button
                disabled={lifecycle.isPending || !newVersion}
                onClick={() =>
                  lifecycle.mutate(
                    {
                      productLine: newLine,
                      version: newVersion,
                      action: "create",
                      ...(newFilingRef ? { naicomFilingRef: newFilingRef } : {}),
                    },
                    { onSuccess: () => setNewVersion("") }
                  )
                }
              >
                Create draft
              </Button>
            </div>

            {versions.isError ? (
              <p className="text-sm text-muted-foreground">
                Version list unavailable: {versions.error?.message}.
              </p>
            ) : (versions.data?.versions.length ?? 0) === 0 &&
              !versions.isLoading ? (
              <p className="text-sm text-muted-foreground">
                No rate versions exist yet. Create the first draft above —
                nothing is seeded by this page.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {(versions.data?.versions ?? []).map(v => (
                  <li key={v.id} className="border-b pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">
                          {v.lineCode ?? `#${v.productLineId}`} · {v.version}
                        </span>{" "}
                        <StatusBadge status={v.status} />
                        {v.naicomFilingRef && (
                          <span className="text-xs text-muted-foreground ml-2">
                            filing: {v.naicomFilingRef}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 items-center">
                        {v.status === "draft" && (
                          <>
                            <Input
                              value={rowFilingRef[v.id] ?? ""}
                              onChange={e =>
                                setRowFilingRef(s => ({
                                  ...s,
                                  [v.id]: e.target.value,
                                }))
                              }
                              placeholder="NAICOM filing ref (required)"
                              className="w-56 h-8"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={lifecycle.isPending}
                              onClick={() =>
                                runAction(
                                  v.lineCode ?? "",
                                  v.version,
                                  "submitFiling",
                                  v.id
                                )
                              }
                            >
                              Submit filing
                            </Button>
                          </>
                        )}
                        {v.status === "filing" && (
                          <Button
                            size="sm"
                            disabled={lifecycle.isPending}
                            onClick={() =>
                              runAction(
                                v.lineCode ?? "",
                                v.version,
                                "approve"
                              )
                            }
                          >
                            Approve
                          </Button>
                        )}
                        {v.status === "approved" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={lifecycle.isPending}
                            onClick={() =>
                              runAction(
                                v.lineCode ?? "",
                                v.version,
                                "retire"
                              )
                            }
                          >
                            Retire
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Referral Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Line</p>
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={ruleLine}
                  onChange={e => setRuleLine(e.target.value)}
                >
                  {ACTUARY_PRODUCT_LINES.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Reason code
                </p>
                <Input
                  value={ruleReason}
                  onChange={e => setRuleReason(e.target.value)}
                  placeholder="SI_THRESHOLD"
                  className="w-40"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Predicate (JSON)
                </p>
                <Input
                  value={rulePredicate}
                  onChange={e => setRulePredicate(e.target.value)}
                  placeholder='{"sumInsured":{">=":500000000}}'
                  className="w-72"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Priority</p>
                <Input
                  value={rulePriority}
                  onChange={e => setRulePriority(e.target.value)}
                  className="w-20"
                />
              </div>
              <Button
                disabled={ruleMut.isPending || !ruleReason}
                onClick={() => {
                  let predicate: Record<string, unknown>;
                  try {
                    predicate = JSON.parse(rulePredicate || "{}") as Record<
                      string,
                      unknown
                    >;
                  } catch {
                    setNotice("Predicate is not valid JSON — nothing saved.");
                    return;
                  }
                  ruleMut.mutate({
                    action: "upsert",
                    rule: {
                      productLine: ruleLine,
                      predicate,
                      action: "refer",
                      reasonCode: ruleReason,
                      priority: Number.parseInt(rulePriority, 10) || 100,
                      isActive: true,
                    },
                  });
                }}
              >
                Add rule
              </Button>
            </div>

            {(rules.data?.rules.length ?? 0) === 0 && !rules.isLoading ? (
              <p className="text-sm text-muted-foreground">
                No referral rules defined — the rating engine then applies
                only exposure-limit and accumulation checks (design §4.g).
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(rules.data?.rules ?? []).map(r => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between border-b pb-1"
                  >
                    <span>
                      [{r.priority}] {r.lineCode ?? `#${r.productLineId}`} ·{" "}
                      {r.reasonCode} → {r.action}{" "}
                      <code className="text-xs">
                        {JSON.stringify(r.predicate)}
                      </code>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ruleMut.isPending || !r.isActive}
                      onClick={() =>
                        ruleMut.mutate({
                          action: "disable",
                          rule: {
                            id: r.id,
                            productLine: r.lineCode ?? "",
                            predicate: {},
                            action: "refer",
                            reasonCode: r.reasonCode,
                            priority: r.priority,
                            isActive: false,
                          },
                        })
                      }
                    >
                      {r.isActive ? "Disable" : "Inactive"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assumption Set (NAICOM filing-ready gate)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Name</p>
                <Input
                  value={asName}
                  onChange={e => setAsName(e.target.value)}
                  className="w-48"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Scope</p>
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={asScope}
                  onChange={e =>
                    setAsScope(
                      e.target.value as "pricing" | "reserving" | "capital" | "life"
                    )
                  }
                >
                  {(["pricing", "reserving", "capital", "life"] as const).map(
                    s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Version</p>
                <Input
                  value={asVersion}
                  onChange={e => setAsVersion(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>
            <Textarea
              value={asPayload}
              onChange={e => setAsPayload(e.target.value)}
              placeholder='{"expenseRatio":0.32,"profitMargin":0.06}'
              className="text-xs"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={asReady}
                onCheckedChange={v => setAsReady(v === true)}
              />
              NAICOM filing ready (human attestation — recorded with your
              identity)
            </label>
            <Button
              disabled={asMut.isPending || !asName || !asVersion}
              onClick={() => {
                let payload: Record<string, unknown>;
                try {
                  payload = JSON.parse(asPayload || "{}") as Record<
                    string,
                    unknown
                  >;
                } catch {
                  setNotice("Payload is not valid JSON — nothing saved.");
                  return;
                }
                asMut.mutate({
                  name: asName,
                  scope: asScope,
                  version: asVersion,
                  payload,
                  naicomFilingReady: asReady,
                });
              }}
            >
              Save assumption set
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

export default function ActuaryRateAdmin() {
  return (
    <ActuaryFeatureGate>
      <RateAdminBody />
    </ActuaryFeatureGate>
  );
}
