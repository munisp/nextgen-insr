import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function AccountOpeningPage() {
  // F-12 (wave-4b): no account-applications store is delivered —
  // accountOpening.list/.analytics are fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the query stays wired.
  const { isError } = trpc.accountOpening.list.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Account Opening</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — account-opening applications are not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports account opening as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
