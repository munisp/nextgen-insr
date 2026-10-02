/**
 * MemberClaims.tsx — /member/claims
 *
 * Wired to the REAL member claims router (server/routers/memberClaims.ts):
 *   - memberClaims.myClaims          (caller-scoped list + real count)
 *   - memberClaims.myPoliciesPicker  (caller's ACTIVE policies for the form)
 *   - memberClaims.fileClaim         (mutation; ownership re-verified
 *     server-side, foreign ids are non-enumerating NOT_FOUND)
 *
 * Honest states only: loading skeletons, empty state, error card.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
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

  const fileMutation = trpc.memberClaims.fileClaim.useMutation({
    onSuccess: () => {
      setFormError(null);
      setClaimType("");
      setIncidentDate("");
      setClaimedAmount("");
      setDescription("");
      toast.success("Claim filed");
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
