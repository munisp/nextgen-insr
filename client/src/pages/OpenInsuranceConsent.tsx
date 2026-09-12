import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SCOPES = ["policies:read", "claims:read", "no_claims_bonus:read", "premium_history:read"] as const;

/**
 * Open Insurance — consent-based data access (openInsuranceRouter.getData).
 * Requires a real consent token issued by grantConsent; invalid/revoked/expired
 * tokens fail loud from the backend.
 */
export default function OpenInsuranceConsent() {
  const [consentToken, setConsentToken] = useState("");
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("policies:read");
  const [submitted, setSubmitted] = useState(false);

  const data = trpc.openInsurance.getData.useQuery(
    { consentToken, scope },
    { enabled: submitted && consentToken.length > 0, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Open Insurance Data Access</h1>
      <div className="flex gap-2 max-w-xl">
        <Input
          placeholder="Consent token"
          value={consentToken}
          onChange={e => { setConsentToken(e.target.value); setSubmitted(false); }}
        />
        <select
          className="border rounded px-3 py-2 bg-background"
          value={scope}
          onChange={e => setScope(e.target.value as typeof scope)}
        >
          {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button disabled={!consentToken} onClick={() => setSubmitted(true)}>Fetch</Button>
      </div>
      {data.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Access denied or failed: {data.error.message}
        </CardContent></Card>
      )}
      {submitted && data.isSuccess && (
        <Card><CardContent className="py-4">
          <pre className="text-xs overflow-auto">{JSON.stringify(data.data, null, 2)}</pre>
        </CardContent></Card>
      )}
    </div>
  );
}
