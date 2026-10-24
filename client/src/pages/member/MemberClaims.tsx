/**
 * MemberClaims.tsx — /member/claims
 *
 * Wired to the REAL member claims router (server/routers/memberClaims.ts):
 *   - memberClaims.myClaims          (caller-scoped list + real count)
 *   - memberClaims.myPoliciesPicker  (caller's ACTIVE policies for the form)
 *   - memberClaims.fileClaim         (mutation; ownership re-verified
 *     server-side, foreign ids are non-enumerating NOT_FOUND)
 *   - memberClaims.getClaimPrefill   (W11-B1b, 2026-10-05: read-only prefill
 *     panel — policy snapshot + member contact + last claim on the selected
 *     policy; NOT_FOUND degrades silently, the form stays usable)
 *
 * Honest states only: loading skeletons, empty state, error card.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
// 2026-10-24 (W11-B2c): UX instrumentation (fail-silent, field NAMES only).
import { trackEvent } from "@/lib/uxTrack";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

export default function MemberClaims() {
  const utils = trpc.useUtils();
  // 2026-10-24 (W11-B2c): form_started once per page mount.
  useEffect(() => {
    trackEvent("member-claims", "form_started");
  }, []);
  const [policyId, setPolicyId] = useState<string>("");
  const [claimType, setClaimType] = useState<string>("");
  const [incidentDate, setIncidentDate] = useState<string>("");
  const [claimedAmount, setClaimedAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const claimsQuery = trpc.memberClaims.myClaims.useQuery(undefined, {
    retry: false,
  });
  const pickerQuery = trpc.memberClaims.myPoliciesPicker.useQuery(undefined, {
    retry: false,
  });

  // 2026-10-05 (W11-B1b): claim-form prefill. When a policy is selected, the
  // server returns the caller-owned policy snapshot + member contact + the
  // member's last claim on that policy (memberClaims.getClaimPrefill). A
  // NOT_FOUND (foreign/nonexistent id — unreachable from the real picker)
  // degrades silently: the form stays fully usable, nothing is fabricated.
  const selectedPolicyId = Number(policyId);
  const prefillEnabled =
    policyId !== "" && Number.isInteger(selectedPolicyId) && selectedPolicyId > 0;
  const prefillQuery = trpc.memberClaims.getClaimPrefill.useQuery(
    { policyId: prefillEnabled ? selectedPolicyId : 0 },
    { enabled: prefillEnabled, retry: false }
  );
  if (prefillQuery.isError) {
    console.warn(
      "memberClaims.getClaimPrefill failed; prefill disabled:",
      prefillQuery.error.message
    );
  }
  const prefill = prefillEnabled ? prefillQuery.data : undefined;

  const fileMutation = trpc.memberClaims.fileClaim.useMutation({
    onSuccess: () => {
      setFormError(null);
      setClaimType("");
      setIncidentDate("");
      setClaimedAmount("");
      setDescription("");
      toast.success("Claim filed");
      // 2026-10-24 (W11-B2c): the claim was accepted server-side — the form
      // flow is complete (no typed values are tracked).
      trackEvent("member-claims", "completed");
      utils.memberClaims.myClaims.invalidate();
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
    const amount = Number(claimedAmount);
    if (!Number.isInteger(pid) || pid <= 0) {
      setFormError("Select the policy this claim belongs to.");
      return;
    }
    if (!claimType.trim()) {
      setFormError("Enter a claim type.");
      return;
    }
    if (!incidentDate) {
      setFormError("Enter the incident date.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter a valid claimed amount.");
      return;
    }
    if (!description.trim()) {
      setFormError("Describe the incident.");
      return;
    }
    fileMutation.mutate({
      policyId: pid,
      claimType: claimType.trim(),
      incidentDate,
      claimedAmount: amount,
      incidentDescription: description.trim(),
    });
  };

  const claims = claimsQuery.data?.claims ?? [];
  const activePolicies = pickerQuery.data?.policies ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="My Claims"
          description="Claims filed under your account."
        >
          {claimsQuery.isLoading ? (
            <MemberLoading label="Loading your claims" />
          ) : claimsQuery.isError ? (
            <MemberError message={claimsQuery.error.message} />
          ) : claims.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have not filed any claims.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim #</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Claimed</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Incident Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">
                        {c.claimNumber}
                      </TableCell>
                      <TableCell className="font-mono">
                        {c.policyNumber}
                      </TableCell>
                      <TableCell>{c.claimType}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{c.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {fmtNgn(Number(c.claimedAmount ?? 0))}
                      </TableCell>
                      <TableCell>
                        {c.approvedAmount != null
                          ? fmtNgn(Number(c.approvedAmount))
                          : "—"}
                      </TableCell>
                      <TableCell>{fmtDate(c.incidentDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground pt-4">
                {claimsQuery.data?.count ?? claims.length} claim(s) on your
                account.
              </p>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="File a Claim"
          description="Only active policies on your account can be claimed against."
        >
          {pickerQuery.isLoading ? (
            <MemberLoading label="Loading your active policies" />
          ) : pickerQuery.isError ? (
            <MemberError message={pickerQuery.error.message} />
          ) : activePolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              You have no active policies to claim against.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="claim-policy">Policy</Label>
                  <Select value={policyId} onValueChange={setPolicyId}>
                    <SelectTrigger id="claim-policy">
                      <SelectValue placeholder="Select policy" />
                    </SelectTrigger>
                    <SelectContent>
                      {activePolicies.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.policyNumber} — {p.productName ?? "policy"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="claim-type">Claim type</Label>
                  <Input
                    id="claim-type"
                    value={claimType}
                    onChange={(e) => setClaimType(e.target.value)}
                    maxLength={64}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-date">Incident date</Label>
                  <Input
                    id="incident-date"
                    type="date"
                    value={incidentDate}
                    onChange={(e) => setIncidentDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="claimed-amount">Claimed amount (NGN)</Label>
                  <Input
                    id="claimed-amount"
                    type="number"
                    min="1"
                    step="any"
                    value={claimedAmount}
                    onChange={(e) => setClaimedAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              {prefill ? (
                <div
                  className="text-sm border rounded-md p-3 space-y-2"
                  data-testid="claim-prefill"
                >
                  <p className="text-xs text-muted-foreground">
                    Prefilled from your policy and member records — review
                    before filing; these fields are read-only here.
                  </p>
                  <dl className="grid grid-cols-2 gap-2">
                    <dt className="text-muted-foreground">Policy #</dt>
                    <dd className="font-mono">{prefill.policy.policyNumber}</dd>
                    {prefill.policy.productName ? (
                      <>
                        <dt className="text-muted-foreground">Product</dt>
                        <dd>{prefill.policy.productName}</dd>
                      </>
                    ) : null}
                    {prefill.policy.coverageType ? (
                      <>
                        <dt className="text-muted-foreground">Coverage</dt>
                        <dd>{prefill.policy.coverageType}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">Sum insured</dt>
                    <dd>{fmtNgn(Number(prefill.policy.sumInsured ?? 0))}</dd>
                    {prefill.member ? (
                      <>
                        <dt className="text-muted-foreground">Contact</dt>
                        <dd>
                          {prefill.member.firstName} {prefill.member.lastName}
                          {prefill.member.email
                            ? ` · ${prefill.member.email}`
                            : ""}
                          {prefill.member.phone
                            ? ` · ${prefill.member.phone}`
                            : ""}
                        </dd>
                      </>
                    ) : null}
                    {prefill.policy.assetDetails ? (
                      <>
                        <dt className="text-muted-foreground">Asset details</dt>
                        <dd className="font-mono text-xs break-all">
                          {JSON.stringify(prefill.policy.assetDetails)}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {prefill.lastClaim ? (
                    <p className="text-xs text-muted-foreground">
                      Your last claim on this policy:{" "}
                      <span className="font-mono">
                        {prefill.lastClaim.claimNumber}
                      </span>{" "}
                      ({prefill.lastClaim.status},{" "}
                      {fmtDate(prefill.lastClaim.createdAt)}).
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="incident-description">
                  Incident description
                </Label>
                <Textarea
                  id="incident-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                  required
                />
              </div>
              {formError ? (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" disabled={fileMutation.isPending}>
                {fileMutation.isPending ? "Filing…" : "File claim"}
              </Button>
            </form>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
