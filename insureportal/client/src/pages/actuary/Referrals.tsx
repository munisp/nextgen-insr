/**
 * Referrals.tsx — W34-D (2026-11-28) underwriter referral queue (design
 * Appendix E: "Referrals (underwriter queue)"). Reads act_referrals via
 * trpc.actuary.listReferrals; decisions go to the Go pricing service
 * (POST /v1/referrals/{id}/decide — the Go service owns the audit event,
 * Appendix D) via trpc.actuary.decideReferral. The response's pgSync flag
 * surfaces honestly when the local mirror could not be updated.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import ActuaryFeatureGate from "./ActuaryFeatureGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";

type Status = "open" | "accepted" | "declined";

function ReferralsBody() {
  const [status, setStatus] = useState<Status>("open");
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const queue = trpc.actuary.listReferrals.useQuery({ status });
  const decide = trpc.actuary.decideReferral.useMutation({
    onSuccess: r => {
      setSyncNote(
        r.pgSync
          ? null
          : `Decision #${r.id} recorded by the pricing service, but the local PG mirror could not be updated (database unavailable) — the Go-side decision stands.`
      );
      queue.refetch();
    },
    onError: e => setSyncNote(`Decision failed: ${e.message}`),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Referral Queue</h1>
          <p className="text-muted-foreground">
            Automatic-referral cases raised by the rating engine (design §4.g)
          </p>
        </div>

        <div className="flex gap-2">
          {(["open", "accepted", "declined"] as const).map(s => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>

        {syncNote && (
          <Card>
            <CardContent className="pt-6 text-sm text-amber-700">
              {syncNote}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {status} referrals
              <Badge variant="outline">{queue.data?.count ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queue.isError ? (
              <p className="text-sm text-muted-foreground">
                Queue unavailable: {queue.error?.message}. Fail-closed — no
                synthetic cases are shown.
              </p>
            ) : (queue.data?.referrals.length ?? 0) === 0 && !queue.isLoading ? (
              <p className="text-sm text-muted-foreground">
                No {status} referrals — the queue is honestly empty (cases are
                created only by the rating engine&apos;s referral rules, never
                seeded here).
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {(queue.data?.referrals ?? []).map(r => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between border-b pb-2"
                  >
                    <div>
                      <p className="font-medium">{r.quoteRef}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.lineCode ?? `#${r.productLineId}`} · reasons:{" "}
                        {r.reasonCodes.join(", ") || "—"}
                      </p>
                    </div>
                    {status === "open" ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate({ id: r.id, decision: "accepted" })
                          }
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate({ id: r.id, decision: "declined" })
                          }
                        >
                          <XCircle className="h-4 w-4 mr-1" /> Decline
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="outline">{r.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

export default function ActuaryReferrals() {
  return (
    <ActuaryFeatureGate>
      <ReferralsBody />
    </ActuaryFeatureGate>
  );
}
