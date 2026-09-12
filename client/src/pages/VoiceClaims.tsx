import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** Voice-first claims — real transcripts for the signed-in customer (voiceClaimsRouter). */
export default function VoiceClaims() {
  const transcripts = trpc.voiceClaims.getTranscripts.useQuery({ limit: 10 }, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Voice Claims</h1>
      {transcripts.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load transcripts: {transcripts.error.message}
        </CardContent></Card>
      )}
      {transcripts.data && transcripts.data.length === 0 && (
        <Card><CardContent className="py-6 text-muted-foreground">
          No voice claim transcripts yet.
        </CardContent></Card>
      )}
      {transcripts.data?.map(t => (
        <Card key={t.id}><CardContent className="py-4 space-y-1">
          <div className="font-semibold">Transcript #{t.id}</div>
          <p className="text-sm">{t.transcript}</p>
          <div className="text-xs text-muted-foreground">
            Processed: {String(t.processedAt)}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}
