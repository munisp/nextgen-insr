import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  FileCheck,
  Search,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react";

export default function RegulatoryCompliancePage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.regulatoryComplianceChecks.list.useQuery();
  const runCheckMut = trpc.regulatoryComplianceChecks.runCheck.useMutation({
    onSuccess: () => toast.success("Compliance check completed"),
  });
  const checks = (data?.checks || []).filter(
    (c: any) => !search || c.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck className="w-6 h-6" /> Regulatory Compliance
          </h1>
          <p className="text-muted-foreground mt-1">
            AML/CFT, KYC, PCI-DSS, and regulatory filing compliance checks
          </p>
        </div>
        <Button
          onClick={() => runCheckMut.mutate({})}
          disabled={runCheckMut.isPending}
        >
          Run All Checks
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold">{data?.summary?.total || 0}</p>
            <p className="text-sm text-muted-foreground">Total Checks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-600">
              {data?.summary?.passed || 0}
            </p>
            <p className="text-sm text-muted-foreground">Passed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-red-600">
              {data?.summary?.failed || 0}
            </p>
            <p className="text-sm text-muted-foreground">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">
              {data?.summary?.warnings || 0}
            </p>
            <p className="text-sm text-muted-foreground">Warnings</p>
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4" />
        <Input
          placeholder="Search checks..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {checks.map((c: any, i: number) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${c.status === "passed" ? "bg-green-100" : c.status === "failed" ? "bg-red-100" : "bg-yellow-100"}`}
                  >
                    {c.status === "passed" ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : c.status === "failed" ? (
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    ) : (
                      <Clock className="w-5 h-5 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.category} • Last run: {c.lastRun || "Never"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded text-xs font-medium ${c.status === "passed" ? "bg-green-100 text-green-700" : c.status === "failed" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}
                >
                  {c.status?.toUpperCase()}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
