import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** J28 group insurance — real group policies organised by the user (groupInsuranceRouter). */
export default function GroupInsurance() {
  const policies = trpc.groupInsurance.listGroupPolicies.useQuery(undefined, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Group Insurance</h1>
      {policies.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load group policies: {policies.error.message}
        </CardContent></Card>
      )}
      {policies.data && policies.data.length === 0 && (
        <Card><CardContent className="py-6 text-muted-foreground">
          You have not organised any group policies.
        </CardContent></Card>
      )}
      {policies.data?.map(g => (
        <Card key={g.id}><CardContent className="py-4 space-y-1">
          <div className="font-semibold">{g.groupName ?? `Group policy #${g.id}`}</div>
          <div className="text-sm text-muted-foreground">
            Status: {g.status} · Created {String(g.createdAt)}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}
