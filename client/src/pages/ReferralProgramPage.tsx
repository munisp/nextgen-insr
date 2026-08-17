import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift, Users, TrendingUp, Award } from "lucide-react";

export default function ReferralProgramPage() {
  const referrals = trpc.referralProgramDedicated.list.useQuery({ limit: 20 });
  const rewards = trpc.referralProgramDedicated.leaderboard.useQuery();
  const tiers = trpc.referralProgramDedicated.tiers.useQuery();
  const analytics = trpc.referralProgramDedicated.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Referral Program</h1>
          <p className="text-muted-foreground">
            Agent referral tracking, reward tiers, and incentive management
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Referrals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.totalReferrals ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Conversion Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.conversionRate ?? 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Bonus Paid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN {(analytics.data?.totalBonusPaid ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Qualified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.qualified ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5" /> Reward Tiers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {tiers.data?.tiers?.map((t: any) => (
                  <div
                    key={t.id}
                    className="border rounded p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.minReferrals}+ referrals &bull; {t.description}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary">
                        NGN {t.rewardAmount?.toLocaleString()}
                      </p>
                      <Badge>{t.type}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" /> Recent Rewards
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {rewards.data?.leaderboard?.map((r: any) => (
                  <div
                    key={r.id}
                    className="border rounded p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-semibold">{r.referrerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.tier} &bull; {r.reason}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">
                        NGN {r.amount?.toLocaleString()}
                      </p>
                      <Badge
                        variant={r.status === "paid" ? "default" : "secondary"}
                      >
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Recent Referrals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Referrer</th>
                    <th className="text-left p-2">Referred</th>
                    <th className="text-left p-2">Code</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Converted</th>
                    <th className="text-left p-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.data?.referrals?.map((r: any) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{r.referrerName}</td>
                      <td className="p-2">{r.referredName}</td>
                      <td className="p-2 font-mono text-xs">{r.code}</td>
                      <td className="p-2">
                        <Badge
                          variant={
                            r.status === "converted"
                              ? "default"
                              : r.status === "pending"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="p-2">{r.converted ? "Yes" : "No"}</td>
                      <td className="p-2 text-xs">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
