import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banknote, FileText, Clock, CheckCircle } from "lucide-react";

export default function LoanDisbursementPage() {
  const [tab, setTab] = useState<"loans" | "applications" | "repayments">(
    "loans"
  );
  const loans = trpc.loanDisbursement.list.useQuery({ limit: 20 });
  const applications = trpc.loanDisbursement.list.useQuery({ limit: 20 });
  const repayments = trpc.loanDisbursement.list.useQuery({ limit: 20 });
  const analytics = trpc.loanDisbursement.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Loan Disbursement</h1>
          <p className="text-muted-foreground">
            Micro-loan origination, disbursement, and repayment tracking
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Disbursed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                NGN {(analytics.data?.totalDisbursed ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Disbursed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.totalDisbursed ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.totalOutstanding?.toLocaleString() ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                NPL Ratio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-yellow-600">
                {analytics.data?.defaultRate ?? 0}%
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "loans" ? "default" : "outline"}
            onClick={() => setTab("loans")}
          >
            <Banknote className="h-4 w-4 mr-1" />
            Active Loans
          </Button>
          <Button
            variant={tab === "applications" ? "default" : "outline"}
            onClick={() => setTab("applications")}
          >
            <FileText className="h-4 w-4 mr-1" />
            Applications
          </Button>
          <Button
            variant={tab === "repayments" ? "default" : "outline"}
            onClick={() => setTab("repayments")}
          >
            <Clock className="h-4 w-4 mr-1" />
            Repayments
          </Button>
        </div>

        {tab === "loans" && (
          <Card>
            <CardHeader>
              <CardTitle>Active Loans</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Loan ID</th>
                      <th className="text-left p-2">Borrower</th>
                      <th className="text-left p-2">Product</th>
                      <th className="text-right p-2">Principal</th>
                      <th className="text-right p-2">Outstanding</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.data?.applications?.map((l: any) => (
                      <tr key={l.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{l.loanId}</td>
                        <td className="p-2">{l.borrowerName}</td>
                        <td className="p-2">{l.productName}</td>
                        <td className="p-2 text-right">
                          NGN {l.principal?.toLocaleString()}
                        </td>
                        <td className="p-2 text-right font-bold">
                          NGN {l.outstanding?.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              l.status === "active"
                                ? "default"
                                : l.status === "overdue"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {l.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(l.dueDate).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "applications" && (
          <Card>
            <CardHeader>
              <CardTitle>Loan Applications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Applicant</th>
                      <th className="text-left p-2">Product</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Tenure</th>
                      <th className="text-left p-2">Credit Score</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.data?.applications?.map((a: any) => (
                      <tr key={a.id} className="border-b">
                        <td className="p-2">{a.applicantName}</td>
                        <td className="p-2">{a.productName}</td>
                        <td className="p-2 text-right">
                          NGN {a.amount?.toLocaleString()}
                        </td>
                        <td className="p-2">{a.tenure} months</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              a.creditScore > 600 ? "default" : "destructive"
                            }
                          >
                            {a.creditScore}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              a.status === "approved"
                                ? "default"
                                : a.status === "pending"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "repayments" && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Repayments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Loan ID</th>
                      <th className="text-left p-2">Borrower</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Method</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repayments.data?.applications?.map((r: any) => (
                      <tr key={r.id} className="border-b">
                        <td className="p-2 font-mono text-xs">{r.loanId}</td>
                        <td className="p-2">{r.borrowerName}</td>
                        <td className="p-2 text-right font-bold">
                          NGN {r.amount?.toLocaleString()}
                        </td>
                        <td className="p-2">{r.method}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              r.status === "successful"
                                ? "default"
                                : "destructive"
                            }
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(r.paidAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
