import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  FileCheck,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

const docTypeLabels: Record<string, string> = {
  national_id: "National ID (NIN)",
  passport: "International Passport",
  drivers_license: "Driver's License",
  utility_bill: "Utility Bill",
  bank_statement: "Bank Statement",
  cac_certificate: "CAC Certificate",
};

const statusColors: Record<string, string> = {
  pending: "secondary",
  under_review: "outline",
  approved: "default",
  rejected: "destructive",
  expired: "destructive",
};

export default function KycVerificationWorkflow() {
  const [activeTab, setActiveTab] = useState("submit");
  const [agentId, setAgentId] = useState("agent-001");
  const [docType, setDocType] = useState<string>("national_id");
  const [docUrl, setDocUrl] = useState("");
  const [reviewId, setReviewId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  // @ts-ignore Sprint 85
  const agentStatus = trpc.sprint23.kycVerification.agentStatus.useQuery({
    agentId,
  });
  const pendingReviews =
    // @ts-ignore Sprint 85
    trpc.sprint23.kycVerification.pendingReviews.useQuery();
  const utils = trpc.useUtils();

  // @ts-ignore Sprint 85
  const submitMutation = trpc.sprint23.kycVerification.submit.useMutation({
    onSuccess: () => {
      // @ts-ignore Sprint 85
      utils.sprint23.kycVerification.agentStatus.invalidate();
      // @ts-ignore Sprint 85
      utils.sprint23.kycVerification.pendingReviews.invalidate();
      toast.success("Document submitted for verification");
      setDocUrl("");
    },
  });

  // @ts-ignore Sprint 85
  const reviewMutation = trpc.sprint23.kycVerification.review.useMutation({
    // @ts-ignore Sprint 85
    onSuccess: (_: any, vars) => {
      // @ts-ignore Sprint 85
      utils.sprint23.kycVerification.agentStatus.invalidate();
      // @ts-ignore Sprint 85
      utils.sprint23.kycVerification.pendingReviews.invalidate();
      toast.success(`Document ${vars.decision}`);
      setReviewId("");
      setRejectionReason("");
    },
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case "rejected":
        return <XCircle className="w-4 h-4 text-red-400" />;
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-400" />;
      case "expired":
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      default:
        return <FileText className="w-4 h-4 text-blue-400" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck className="w-6 h-6 text-teal-400" />
            KYC Verification Workflow
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Document submission, review, and verification for agent KYC
            compliance
          </p>
        </div>

        {/* Agent KYC Status */}
        {agentStatus.data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className={
                agentStatus.data.overallStatus === "complete"
                  ? "border-green-500/30"
                  : "border-yellow-500/30"
              }
            >
              <CardContent className="pt-6 text-center">
                <ShieldCheck
                  className={`w-8 h-8 mx-auto mb-2 ${agentStatus.data.overallStatus === "complete" ? "text-green-400" : "text-yellow-400"}`}
                />
                <p className="text-sm text-muted-foreground">Overall Status</p>
                <Badge
                  variant={
                    agentStatus.data.overallStatus === "complete"
                      ? "default"
                      : "secondary"
                  }
                  className="mt-1 capitalize"
                >
                  {agentStatus.data.overallStatus}
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-4xl font-bold text-blue-400">
                  {agentStatus.data.completionPercent}%
                </p>
                <p className="text-sm text-muted-foreground">Completion</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-4xl font-bold">
                  {agentStatus.data.documents.length}
                </p>
                <p className="text-sm text-muted-foreground">
                  Documents Submitted
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="submit">Submit Document</TabsTrigger>
            <TabsTrigger value="review">
              Review Queue ({pendingReviews.data?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="history">Document History</TabsTrigger>
          </TabsList>

          <TabsContent value="submit">
            <Card>
              <CardHeader>
                <CardTitle>Submit KYC Document</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Agent ID
                    </label>
                    <Input
                      value={agentId}
                      onChange={e => setAgentId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Document Type
                    </label>
                    <Select value={docType} onValueChange={setDocType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(docTypeLabels).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    Document URL
                  </label>
                  <Input
                    placeholder="https://storage.example.com/documents/..."
                    value={docUrl}
                    onChange={e => setDocUrl(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() =>
                    submitMutation.mutate({
                      agentId,
                      documentType: docType as any,
                      documentUrl:
                        docUrl ||
                        "https://storage.insureportal.com/kyc/sample-doc.pdf",
                    })
                  }
                  disabled={submitMutation.isPending}
                >
                  <Upload className="w-4 h-4 mr-2" /> Submit for Verification
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="review">
            <Card>
              <CardHeader>
                <CardTitle>Pending Reviews</CardTitle>
              </CardHeader>
              <CardContent>
                {!pendingReviews.data || pendingReviews.data.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>No pending reviews</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingReviews.data.map((doc: any) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            {statusIcon(doc.status)}
                            <span className="font-medium">
                              {docTypeLabels[doc.documentType] ??
                                doc.documentType}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Agent: {doc.agentId} | Submitted:{" "}
                            {new Date(doc.submittedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() =>
                              reviewMutation.mutate({
                                verificationId: doc.id,
                                reviewerId: "admin-001",
                                decision: "approved",
                              })
                            }
                          >
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setReviewId(doc.id)}
                              >
                                <XCircle className="w-4 h-4 mr-1" /> Reject
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Reject Document</DialogTitle>
                              </DialogHeader>
                              <Textarea
                                placeholder="Reason for rejection..."
                                value={rejectionReason}
                                onChange={e =>
                                  setRejectionReason(e.target.value)
                                }
                              />
                              <Button
                                variant="destructive"
                                onClick={() =>
                                  reviewMutation.mutate({
                                    verificationId: reviewId || doc.id,
                                    reviewerId: "admin-001",
                                    decision: "rejected",
                                    rejectionReason,
                                  })
                                }
                              >
                                Confirm Rejection
                              </Button>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Document History</CardTitle>
              </CardHeader>
              <CardContent>
                {!agentStatus.data?.documents ||
                agentStatus.data.documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>No documents submitted yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3">Document Type</th>
                          <th className="text-center py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Submitted</th>
                          <th className="text-left py-2 px-3">Reviewed</th>
                          <th className="text-left py-2 px-3">Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentStatus.data.documents.map((doc: any) => (
                          <tr
                            key={doc.id}
                            className="border-b border-border/50"
                          >
                            <td className="py-2 px-3">
                              {docTypeLabels[doc.documentType] ??
                                doc.documentType}
                            </td>
                            <td className="text-center py-2 px-3">
                              <div className="flex items-center justify-center gap-1">
                                {statusIcon(doc.status)}
                                <Badge
                                  variant={statusColors[doc.status] as any}
                                >
                                  {doc.status}
                                </Badge>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-xs">
                              {new Date(doc.submittedAt).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3 text-xs">
                              {doc.reviewedAt
                                ? new Date(doc.reviewedAt).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-xs">
                              {doc.expiresAt
                                ? new Date(doc.expiresAt).toLocaleDateString()
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
