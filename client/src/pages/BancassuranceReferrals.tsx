import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Bancassurance — bank-partner referral intake (bancassuranceRouter.createReferral). */
export default function BancassuranceReferrals() {
  const [partnerCode, setPartnerCode] = useState("");
  // 2026-09-19: createReferral now requires the partner's issued API key (L-P-5);
  // the partner authenticates with code + key, matching the server contract.
  const [apiKey, setApiKey] = useState("");
  const [productType, setProductType] = useState("motor");
  const referral = trpc.bancassurance.createReferral.useMutation();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Bancassurance Referrals</h1>
      <Card><CardContent className="py-4 space-y-3">
        <Input
          placeholder="Partner code"
          value={partnerCode}
          onChange={e => setPartnerCode(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Partner API key"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
        />
        <Input
          placeholder="Product type"
          value={productType}
          onChange={e => setProductType(e.target.value)}
        />
        <Button
          disabled={!partnerCode || !apiKey || referral.isPending}
          onClick={() => referral.mutate({ partnerCode, apiKey, productType })}
        >
          Create referral
        </Button>
      </CardContent></Card>
      {referral.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Referral failed: {referral.error.message}
        </CardContent></Card>
      )}
      {referral.data && (
        <Card><CardContent className="py-6">
          Referral recorded: {JSON.stringify(referral.data)}
        </CardContent></Card>
      )}
    </div>
  );
}
