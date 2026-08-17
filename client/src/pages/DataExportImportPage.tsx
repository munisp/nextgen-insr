import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Upload } from "lucide-react";

export default function DataExportImportPage() {
  const { data } = trpc.dataExportImport.dashboard.useQuery();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Data Export / Import</h1>
        <p className="text-muted-foreground">
          Bulk data operations — CSV, XLSX, JSON, PDF
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" /> Recent Exports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.recentExports ?? []).map((e: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{e.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.records?.toLocaleString()} records • {e.sizeMb} MB
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{e.format}</Badge>
                    <Badge
                      variant={
                        e.status === "completed" ? "default" : "secondary"
                      }
                    >
                      {e.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" /> Recent Imports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.recentImports ?? []).map((imp: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-sm">{imp.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {imp.successRecords}/{imp.totalRecords} records
                    </p>
                  </div>
                  <Badge
                    variant={
                      imp.failedRecords === 0 ? "default" : "destructive"
                    }
                  >
                    {imp.failedRecords} failed
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
