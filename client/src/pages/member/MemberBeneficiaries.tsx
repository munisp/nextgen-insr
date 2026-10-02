/**
 * MemberBeneficiaries.tsx — /member/beneficiaries (W7-B5, 2026-10-02)
 *
 * Wired to the REAL member beneficiaries router
 * (server/routers/memberBeneficiaries.ts):
 *   - memberBeneficiaries.myBeneficiaries   (per-policy list, nationalId
 *     masked server-side)
 *   - memberBeneficiaries.upsertBeneficiary (add/edit; minor-guardian and
 *     100%-sum rules enforced server-side, errors surfaced verbatim)
 *   - memberBeneficiaries.removeBeneficiary (with inline confirm)
 * Policy picker source: memberPolicies.myPolicies (caller's own policies).
 * Optional ?policy=<id> preselects the picker (linked from
 * MemberPolicyDetail).
 *
 * Honest states only: no fabricated rows; server validation errors surface
 * in the form, never swallowed.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

/** Preselected policy id from ?policy=<positive int>, else null. */
function preselectedPolicyId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("policy");
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface BeneficiaryFormState {
  beneficiaryId: number | null;
  name: string;
  relationship: string;
  percentage: string;
  dateOfBirth: string;
  isMinor: boolean;
  guardianName: string;
  nationalId: string;
}

const EMPTY_FORM: BeneficiaryFormState = {
  beneficiaryId: null,
  name: "",
  relationship: "",
  percentage: "",
  dateOfBirth: "",
  isMinor: false,
  guardianName: "",
  nationalId: "",
};

export default function MemberBeneficiaries() {
  const utils = trpc.useUtils();
  const [policyId, setPolicyId] = useState<string>(
    preselectedPolicyId()?.toString() ?? ""
  );
  const [form, setForm] = useState<BeneficiaryFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);

  const pid = Number(policyId);
  const validPolicyId = Number.isInteger(pid) && pid > 0;

  const pickerQuery = trpc.memberPolicies.myPolicies.useQuery(undefined, {
    retry: false,
  });
  const beneficiariesQuery = trpc.memberBeneficiaries.myBeneficiaries.useQuery(
    { policyId: pid },
    { retry: false, enabled: validPolicyId }
  );

  // Reset the form when switching policies so an edit never leaks across
  // policies (the server scopes beneficiaryId to policyId anyway).
  useEffect(() => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setConfirmRemoveId(null);
  }, [policyId]);

  const upsertMutation =
    trpc.memberBeneficiaries.upsertBeneficiary.useMutation({
      onSuccess: () => {
        setForm(EMPTY_FORM);
        setFormError(null);
        toast.success("Beneficiary saved");
        utils.memberBeneficiaries.myBeneficiaries.invalidate();
      },
      onError: (err) => {
        setFormError(err.message);
        toast.error(err.message);
      },
    });

  const removeMutation =
    trpc.memberBeneficiaries.removeBeneficiary.useMutation({
      onSuccess: () => {
        setConfirmRemoveId(null);
        toast.success("Beneficiary removed");
        utils.memberBeneficiaries.myBeneficiaries.invalidate();
      },
      onError: (err) => {
        setFormError(err.message);
        toast.error(err.message);
      },
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validPolicyId) {
      setFormError("Select the policy this beneficiary belongs to.");
      return;
    }
    if (!form.name.trim()) {
      setFormError("Enter the beneficiary's name.");
      return;
    }
    if (!form.relationship.trim()) {
      setFormError("Enter the relationship.");
      return;
    }
    const pct = Number(form.percentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      setFormError("Enter a percentage between 0 and 100.");
      return;
    }
    // Client mirrors the server rule for a fast honest error; the server
    // re-enforces it regardless.
    if (form.isMinor && !form.guardianName.trim()) {
      setFormError("A minor beneficiary requires a guardian name.");
      return;
    }
    // Input shape = server zod schema exactly
    // (memberBeneficiaries.upsertBeneficiary); optional fields are only sent
    // when non-empty so server defaults apply.
    upsertMutation.mutate({
      policyId: pid,
      name: form.name.trim(),
      relationship: form.relationship.trim(),
      percentage: pct,
      ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
      isMinor: form.isMinor,
      ...(form.guardianName.trim()
        ? { guardianName: form.guardianName.trim() }
        : {}),
      ...(form.nationalId.trim() ? { nationalId: form.nationalId.trim() } : {}),
      ...(form.beneficiaryId != null
        ? { beneficiaryId: form.beneficiaryId }
        : {}),
    });
  };

  const items = validPolicyId ? beneficiariesQuery.data?.items ?? [] : [];
  const myPolicies = pickerQuery.data?.policies ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Beneficiaries"
          description="Beneficiaries on a policy you hold."
        >
          <div className="space-y-2 max-w-md mb-6">
            <Label htmlFor="beneficiary-policy">Policy</Label>
            {pickerQuery.isLoading ? (
              <MemberLoading label="Loading your policies" />
            ) : pickerQuery.isError ? (
              <MemberError message={pickerQuery.error.message} />
            ) : (
              <select
                id="beneficiary-policy"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={policyId}
                onChange={(e) => setPolicyId(e.target.value)}
              >
                <option value="">Select a policy…</option>
                {myPolicies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.policyNumber} — {p.productName ?? "policy"}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!validPolicyId ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Select a policy to view its beneficiaries.
            </p>
          ) : beneficiariesQuery.isLoading ? (
            <MemberLoading label="Loading beneficiaries" />
          ) : beneficiariesQuery.isError ? (
            <MemberError message={beneficiariesQuery.error.message} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              This policy has no beneficiaries yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Percentage</TableHead>
                  <TableHead>Date of birth</TableHead>
                  <TableHead>Guardian</TableHead>
                  <TableHead>National ID</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.name}</TableCell>
                    <TableCell>{b.relationship}</TableCell>
                    <TableCell>{Number(b.percentage)}%</TableCell>
                    <TableCell>{fmtDate(b.dateOfBirth)}</TableCell>
                    <TableCell>{b.guardianName ?? "—"}</TableCell>
                    <TableCell className="font-mono">
                      {b.nationalId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setForm({
                              beneficiaryId: b.id,
                              name: b.name,
                              relationship: b.relationship,
                              percentage: String(Number(b.percentage)),
                              dateOfBirth: b.dateOfBirth
                                ? new Date(b.dateOfBirth)
                                    .toISOString()
                                    .slice(0, 10)
                                : "",
                              isMinor: Boolean(b.isMinor),
                              guardianName: b.guardianName ?? "",
                              // nationalId is masked in list responses —
                              // never prefill it from a masked value; the
                              // member re-enters it only to change it.
                              nationalId: "",
                            })
                          }
                        >
                          Edit
                        </Button>
                        {confirmRemoveId === b.id ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={removeMutation.isPending}
                              onClick={() =>
                                removeMutation.mutate({
                                  policyId: pid,
                                  beneficiaryId: b.id,
                                })
                              }
                            >
                              Confirm remove
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmRemoveId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmRemoveId(b.id)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        <MemberSection
          title={
            form.beneficiaryId != null ? "Edit Beneficiary" : "Add Beneficiary"
          }
          description="Percentages across a policy may not exceed 100%."
        >
          <form onSubmit={submit} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="ben-name">Full name</Label>
              <Input
                id="ben-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ben-relationship">Relationship</Label>
              <Input
                id="ben-relationship"
                value={form.relationship}
                onChange={(e) =>
                  setForm({ ...form, relationship: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ben-percentage">Percentage (%)</Label>
              <Input
                id="ben-percentage"
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.percentage}
                onChange={(e) =>
                  setForm({ ...form, percentage: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ben-dob">Date of birth (optional)</Label>
              <Input
                id="ben-dob"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) =>
                  setForm({ ...form, dateOfBirth: e.target.value })
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="ben-minor"
                checked={form.isMinor}
                onCheckedChange={(v) =>
                  setForm({ ...form, isMinor: v === true })
                }
              />
              <Label htmlFor="ben-minor">Beneficiary is a minor</Label>
            </div>
            {form.isMinor ? (
              <div className="space-y-2">
                <Label htmlFor="ben-guardian">Guardian name</Label>
                <Input
                  id="ben-guardian"
                  value={form.guardianName}
                  onChange={(e) =>
                    setForm({ ...form, guardianName: e.target.value })
                  }
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ben-national-id">National ID (optional)</Label>
              <Input
                id="ben-national-id"
                value={form.nationalId}
                onChange={(e) =>
                  setForm({ ...form, nationalId: e.target.value })
                }
              />
              {form.beneficiaryId != null ? (
                <p className="text-xs text-muted-foreground">
                  Leave blank to keep the stored value.
                </p>
              ) : null}
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending
                  ? "Saving…"
                  : form.beneficiaryId != null
                    ? "Save changes"
                    : "Add beneficiary"}
              </Button>
              {form.beneficiaryId != null ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setFormError(null);
                  }}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
