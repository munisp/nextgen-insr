import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FileText, Search, CheckCircle, XCircle, Clock } from "lucide-react";

export default function KycDocumentManagementPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.kycDocumentManagement.list.useQuery();
  const approveMut = trpc.kycDocumentManagement.approve.useMutation({
    onSuccess: () => toast.success("KYC approved"),
  });
  const rejectMut = trpc.kycDocumentManagement.reject.useMutation({
    onSuccess: () => toast.success("KYC rejected"),
  });
  const docs = (data?.documents || []).filter(
    (d: any) =>
      !search || d.agentName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6" /> KYC Document Management
        </h1>
        <p className="text-muted-foreground mt-1">
          Review, approve, and manage agent KYC documentation
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.summary?.total || 0}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">
              {data?.summary?.pending || 0}
            </p>
            <p className="text-sm text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {data?.summary?.approved || 0}
            </p>
            <p className="text-sm text-muted-foreground">Approved</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-red-600">
              {data?.summary?.rejected || 0}
            </p>
            <p className="text-sm text-muted-foreground">Rejected</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {docs.map((d: any, i: number) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${d.status === "approved" ? "bg-green-100" : d.status === "rejected" ? "bg-red-100" : "bg-yellow-100"}`}
                  >
                    {d.status === "approved" ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : d.status === "rejected" ? (
                      <XCircle className="w-5 h-5 text-red-600" />
                    ) : (
                      <Clock className="w-5 h-5 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{d.agentName}</p>
                    <p className="text-sm text-muted-foreground">
                      {d.documentType} • {d.docNumber}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {d.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => approveMut.mutate({ id: d.id })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          rejectMut.mutate({ id: d.id, reason: "Incomplete" })
                        }
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  <span
                    className={`px-2 py-1 rounded text-xs ${d.status === "approved" ? "bg-green-100 text-green-700" : d.status === "rejected" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}
                  >
                    {d.status}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
