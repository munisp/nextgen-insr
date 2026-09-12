import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Climate risk scoring — real persisted scores + service/heuristic path (climateRiskRouter). */
export default function ClimateRiskExplorer() {
  const [lat, setLat] = useState("6.5244");   // Lagos
  const [lon, setLon] = useState("3.3792");
  const [submitted, setSubmitted] = useState(false);
  const latitude = Number(lat);
  const longitude = Number(lon);
  const valid = !Number.isNaN(latitude) && !Number.isNaN(longitude);

  const risk = trpc.climateRisk.getRiskScore.useQuery(
    { latitude, longitude },
    { enabled: submitted && valid, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Climate Risk Scoring</h1>
      <div className="flex gap-2 max-w-xl">
        <Input placeholder="Latitude" value={lat} onChange={e => { setLat(e.target.value); setSubmitted(false); }} />
        <Input placeholder="Longitude" value={lon} onChange={e => { setLon(e.target.value); setSubmitted(false); }} />
        <Button disabled={!valid} onClick={() => setSubmitted(true)}>Score</Button>
      </div>
      {risk.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to score location: {risk.error.message}
        </CardContent></Card>
      )}
      {submitted && risk.data && (
        <Card><CardContent className="py-4">
          <pre className="text-xs overflow-auto">{JSON.stringify(risk.data, null, 2)}</pre>
        </CardContent></Card>
      )}
    </div>
  );
}
