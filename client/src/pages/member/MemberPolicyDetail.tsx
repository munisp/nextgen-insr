/**
 * MemberPolicyDetail.tsx — /member/policies/:id (W7-B5, 2026-10-02)
 *
 * Wired to the REAL member policies router (server/routers/memberPolicies.ts):
 *   - memberPolicies.myPolicy (ownership-checked single-policy view)
 *
 * myPolicy returns NO documents/coverage-line breakdown — only the flat
 * policy row fields + product name/description. Honest-contract choice
 * (2026-10-02, W7-B5): the page renders ONLY the fields the procedure
 * actually returns; a documents section is omitted entirely rather than
 * fabricated.
 *
 * Honest states only: loading skeletons, NOT_FOUND/error card, real fields.
 */
import { trpc } from "@/lib/trpc";
import { Link, useParams } from "wouter";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function MemberPolicyDetail() {
  const params = useParams<{ id: string }>();
  const policyId = Number(params.id);
  // 2026-10-02 (W7-B5): a malformed :id never reaches the server — the
  // procedure input is z.number().int().positive(), so guard client-side
  // and render an honest error instead of issuing an invalid call.
  const validId = Number.isInteger(policyId) && policyId > 0;

  const policyQuery = trpc.memberPolicies.myPolicy.useQuery(
    { id: policyId },
    { retry: false, enabled: validId }
  );

  const p = policyQuery.data;

  return (
    <MemberLayout>
      <div className="space-y-6">
        <div>
          <Link href="/member/policies">
            <Button variant="outline" size="sm">
              ← Back to policies
            </Button>
          </Link>
        </div>
        <MemberSection
          title="Policy Details"
          description="Full view of this policy as held on your account."
        >
          {!validId ? (
            <MemberError message="Invalid policy id in the address." />
          ) : policyQuery.isLoading ? (
            <MemberLoading label="Loading policy details" />
          ) : policyQuery.isError ? (
            <MemberError message={policyQuery.error.message} />
          ) : !p ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Policy not found.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg">{p.policyNumber}</span>
                <Badge variant="secondary">{p.status}</Badge>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Product" value={p.productName ?? "—"} />
                <Field label="Coverage type" value={p.coverageType ?? "—"} />
                <Field
                  label="Sum insured"
                  value={fmtNgn(Number(p.sumInsured ?? 0))}
                />
                <Field
                  label="Annual premium"
                  value={fmtNgn(Number(p.annualPremium ?? 0))}
                />
                <Field label="Start date" value={fmtDate(p.startDate)} />
                <Field label="End date" value={fmtDate(p.endDate)} />
                <Field label="Renewal date" value={fmtDate(p.renewalDate)} />
                <Field
                  label="Certificate number"
                  value={p.certificateNumber ?? "—"}
                />
                <Field label="Currency" value={p.currency} />
                <Field label="Created" value={fmtDate(p.createdAt)} />
              </dl>
              {p.productDescription ? (
                <div>
                  <h3 className="text-sm text-muted-foreground mb-1">
                    Product description
                  </h3>
                  <p className="text-sm whitespace-pre-line">
                    {p.productDescription}
                  </p>
                </div>
              ) : null}
              <nav
                aria-label="Policy servicing"
                className="flex flex-wrap gap-2 pt-2 border-t"
              >
                <Link href={`/member/renewals?policy=${p.id}`}>
                  <Button variant="outline" size="sm">
                    Renewals
                  </Button>
                </Link>
                <Link href={`/member/beneficiaries?policy=${p.id}`}>
                  <Button variant="outline" size="sm">
                    Beneficiaries
                  </Button>
                </Link>
                <Link href={`/member/endorsements?policy=${p.id}`}>
                  <Button variant="outline" size="sm">
                    Endorsements
                  </Button>
                </Link>
              </nav>
            </div>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
