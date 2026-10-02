/**
 * MemberEndorsements.tsx — /member/endorsements (W7-B5, 2026-10-02)
 *
 * Wired to the REAL member endorsements router
 * (server/routers/memberEndorsements.ts):
 *   - memberEndorsements.myEndorsements     (caller-scoped list + real count)
 *   - memberEndorsements.requestEndorsement (mutation; ownership-guarded
 *     server-side)
 * Policy picker source: memberPolicies.myPolicies (caller's own policies).
 * Optional ?policy=<id> preselects the picker (linked from
 * MemberPolicyDetail).
 *
 * premiumAdjustment/sumInsuredAdjustment are member-proposed REQUEST fields
 * only (no funds movement — see router header); the form labels them as
 * such. Honest states only: no fabricated rows; server errors surfaced
 * verbatim.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

/** Endorsement types = server zod enum exactly
 * (memberEndorsements.requestEndorsement input). */
const ENDORSEMENT_TYPES = [
  "addition",
  "deletion",
  "modification",
  "extension",
  "reduction",
  "cancellation",
  "reinstatement",
] as const;

/** Preselected policy id from ?policy=<positive int>, else null. */
function preselectedPolicyId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("policy");
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function MemberEndorsements() {
  const utils = trpc.useUtils();
  const [policyId, setPolicyId] = useState<string>(
    preselectedPolicyId()?.toString() ?? ""
  );
  const [type, setType] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [premiumAdjustment, setPremiumAdjustment] = useState<string>("");
  const [sumInsuredAdjustment, setSumInsuredAdjustment] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const endorsementsQuery = trpc.memberEndorsements.myEndorsements.useQuery(
    undefined,
    { retry: false }
  );
  const pickerQuery = trpc.memberPolicies.myPolicies.useQuery(undefined, {
    retry: false,
  });

  const requestMutation =
    trpc.memberEndorsements.requestEndorsement.useMutation({
      onSuccess: () => {
        setFormError(null);
        setType("");
        setEffectiveDate("");
        setDescription("");
        setPremiumAdjustment("");
        setSumInsuredAdjustment("");
        toast.success("Endorsement requested");
        utils.memberEndorsements.myEndorsements.invalidate();
      },
      onError: (err) => {
        setFormError(err.message);
        toast.error(err.message);
      },
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const pid = Number(policyId);
    if (!Number.isInteger(pid) || pid <= 0) {
      setFormError("Select the policy to endorse.");
      return;
    }
    if (!type) {
      setFormError("Select an endorsement type.");
      return;
    }
    if (!effectiveDate) {
      setFormError("Enter the effective date.");
      return;
    }
    if (!description.trim()) {
      setFormError("Describe the requested change.");
      return;
    }
    const premAdj = premiumAdjustment.trim()
      ? Number(premiumAdjustment)
      : undefined;
    const sumAdj = sumInsuredAdjustment.trim()
      ? Number(sumInsuredAdjustment)
      : undefined;
    if (premAdj !== undefined && !Number.isFinite(premAdj)) {
      setFormError("Enter a valid premium adjustment.");
      return;
    }
    if (sumAdj !== undefined && !Number.isFinite(sumAdj)) {
      setFormError("Enter a valid sum-insured adjustment.");
      return;
    }
    // Input shape = server zod schema exactly
    // (memberEndorsements.requestEndorsement); optional adjustment fields are
    // only sent when provided.
    requestMutation.mutate({
      policyId: pid,
      type: type as (typeof ENDORSEMENT_TYPES)[number],
      effectiveDate,
      description: description.trim(),
      ...(premAdj !== undefined ? { premiumAdjustment: premAdj } : {}),
      ...(sumAdj !== undefined ? { sumInsuredAdjustment: sumAdj } : {}),
    });
  };

  const endorsements = endorsementsQuery.data?.endorsements ?? [];
  const myPolicies = pickerQuery.data?.policies ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="My Endorsements"
          description="Endorsement requests and changes on your policies."
        >
          {endorsementsQuery.isLoading ? (
            <MemberLoading label="Loading your endorsements" />
          ) : endorsementsQuery.isError ? (
            <MemberError message={endorsementsQuery.error.message} />
          ) : endorsements.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no endorsements yet.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endorsement #</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Premium adj.</TableHead>
                    <TableHead>Sum insured adj.</TableHead>
                    <TableHead>Approved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endorsements.map((en) => (
                    <TableRow key={en.id}>
                      <TableCell className="font-mono">
                        {en.endorsementNumber}
                      </TableCell>
                      <TableCell className="font-mono">
                        {en.policyNumber}
                      </TableCell>
                      <TableCell>{en.type}</TableCell>
                      <TableCell>{fmtDate(en.effectiveDate)}</TableCell>
                      <TableCell>
                        {fmtNgn(Number(en.premiumAdjustment ?? 0))}
                      </TableCell>
                      <TableCell>
                        {fmtNgn(Number(en.sumInsuredAdjustment ?? 0))}
                      </TableCell>
                      <TableCell>{fmtDate(en.approvedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground pt-4">
                {endorsementsQuery.data?.count ?? endorsements.length}{" "}
                endorsement{endorsementsQuery.data?.count === 1 ? "" : "s"} on
                your account.
              </p>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="Request an Endorsement"
          description="Request a change to one of your policies. Proposed adjustments are requests for staff review — no payment is taken here."
        >
          <form onSubmit={submit} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="endorsement-policy">Policy</Label>
              {pickerQuery.isLoading ? (
                <MemberLoading label="Loading your policies" />
              ) : pickerQuery.isError ? (
                <MemberError message={pickerQuery.error.message} />
              ) : (
                <select
                  id="endorsement-policy"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={policyId}
                  onChange={(e) => setPolicyId(e.target.value)}
                >
                  <option value="">Select a policy…</option>
                  {myPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.policyNumber} — {p.productName ?? "policy"} (
                      {p.status})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endorsement-type">Type</Label>
              <select
                id="endorsement-type"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">Select a type…</option>
                {ENDORSEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="endorsement-effective">Effective date</Label>
              <Input
                id="endorsement-effective"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endorsement-description">Description</Label>
              <Textarea
                id="endorsement-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4096}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endorsement-premium-adj">
                Proposed premium adjustment (NGN, optional)
              </Label>
              <Input
                id="endorsement-premium-adj"
                type="number"
                step="any"
                value={premiumAdjustment}
                onChange={(e) => setPremiumAdjustment(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endorsement-sum-adj">
                Proposed sum-insured adjustment (NGN, optional)
              </Label>
              <Input
                id="endorsement-sum-adj"
                type="number"
                step="any"
                value={sumInsuredAdjustment}
                onChange={(e) => setSumInsuredAdjustment(e.target.value)}
              />
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={requestMutation.isPending}>
              {requestMutation.isPending
                ? "Requesting…"
                : "Request endorsement"}
            </Button>
          </form>
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
