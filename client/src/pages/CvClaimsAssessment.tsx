import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** AI CV claims — real damage assessments from cvDamageAssessments (cvClaimsRouter). */
export default function CvClaimsAssessment() {
  const [claimId, setClaimId] = useState("");
  const id = Number(claimId);
  const enabled = Number.isInteger(id) && id > 0;

  const assessments = trpc.cvClaims.getAssessments.useQuery(
    { claimId: id },
    { enabled, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">CV Claims Assessment</h1>
      <div className="max-w-md">
        <Input
          placeholder="Claim ID"
          value={claimId}
          onChange={e => setClaimId(e.target.value)}
        />
      </div>
      {assessments.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load assessments: {assessments.error.message}
        </CardContent></Card>
      )}
      {assessments.data && assessments.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No CV damage assessments recorded for this claim.
        </p>
      )}
      {assessments.data?.map(a => (
        <Card key={a.id}><CardContent className="py-4 space-y-1">
          <div className="font-semibold">Assessment #{a.id}</div>
          <div className="text-sm">Type: {a.damageType}</div>
          <div className="text-sm">
            Estimated repair cost: ₦{Number(a.estimatedRepairCost ?? 0).toLocaleString()}
          </div>
          <div className="text-sm text-muted-foreground">
            Assessed: {String(a.assessedAt)}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}
