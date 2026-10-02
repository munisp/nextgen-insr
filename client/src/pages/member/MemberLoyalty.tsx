/**
 * MemberLoyalty.tsx — /member/loyalty (W7-B7, 2026-10-03)
 *
 * Wired to the REAL member loyalty router (server/routers/memberLoyalty.ts):
 *   - memberLoyalty.myBalance (earned − redeemed over the caller's ledger)
 *   - memberLoyalty.myHistory (paginated ledger, newest first)
 *
 * Identity is always resolved server-side from the session
 * (customers.keycloakSub = String(ctx.user.id)); no client-supplied id.
 *
 * REDEEM UI DELIBERATELY OMITTED (2026-10-03, W7-B7): memberLoyalty is
 * read-only by design — points are funds-adjacent (1pt = ₦1) and no
 * member-safe reward catalog/redemption mutation exists. Fail-closed rather
 * than fabricate a redemption; an honest note is shown instead.
 */
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

export default function MemberLoyalty() {
  const balanceQuery = trpc.memberLoyalty.myBalance.useQuery(undefined, {
    retry: false,
  });
  const historyQuery = trpc.memberLoyalty.myHistory.useQuery(
    { limit: 50, offset: 0 },
    { retry: false }
  );

  const balance = balanceQuery.data;
  const history = historyQuery.data?.history ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Loyalty Points"
          description="Points earned on your policies and payments."
        >
          {balanceQuery.isLoading ? (
            <MemberLoading label="Loading loyalty balance" />
          ) : balanceQuery.isError ? (
            <MemberError message={balanceQuery.error.message} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Balance</p>
                <p className="text-2xl font-bold" data-testid="loyalty-balance">
                  {balance?.balance ?? 0} pts
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Earned</p>
                <p className="text-lg">{balance?.earned ?? 0} pts</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Redeemed</p>
                <p className="text-lg">{balance?.redeemed ?? 0} pts</p>
              </div>
            </div>
          )}
        </MemberSection>

        <MemberSection
          title="Points History"
          description="Newest first."
        >
          {historyQuery.isLoading ? (
            <MemberLoading label="Loading loyalty history" />
          ) : historyQuery.isError ? (
            <MemberError message={historyQuery.error.message} />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no loyalty activity yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Balance after</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge
                        variant={row.type === "earned" ? "default" : "secondary"}
                      >
                        {row.type ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.points}</TableCell>
                    <TableCell>{row.description ?? "—"}</TableCell>
                    <TableCell>{row.balanceAfter ?? "—"}</TableCell>
                    <TableCell>{fmtDate(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        {/* 2026-10-03 (W7-B7): honest note — no member-safe redemption
            mutation exists; see header comment. */}
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          Points redemption is not available in this portal yet. Your points
          keep accumulating — redemption options will be announced when the
          rewards program launches, or contact support for more information.
        </p>
      </div>
    </MemberLayout>
  );
}
