import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function DbtIntegrationPage() {
  const { data: projectInfo, isLoading } =
    trpc.dbtIntegration.projectInfo.useQuery();
  const models = trpc.dbtIntegration.listModels.useQuery({
    schema: undefined as any,
  });
  const runs = trpc.dbtIntegration.list.useQuery({ limit: 10 });
  const triggerRun = trpc.dbtIntegration.triggerRun.useMutation();

  if (isLoading)
    return <div className="p-6 animate-pulse">Loading dbt Dashboard...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">dbt — Data Build Tool</h1>
          <p className="text-muted-foreground">
            SQL-based data transformation, testing, and documentation
          </p>
        </div>
        <Button
          onClick={() =>
            triggerRun.mutate({ command: "dbt run --select marts" })
          }
        >
          {triggerRun.isPending ? "Running..." : "Run dbt"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Models</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {projectInfo?.totalModels ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tests Passing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {projectInfo?.testResults?.pass ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tests Failing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {projectInfo?.testResults?.fail ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {projectInfo?.totalSources ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Models by Schema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {projectInfo?.modelsBySchema &&
              Object.entries(projectInfo.modelsBySchema).map(
                ([schema, count]) => (
                  <div key={schema} className="text-center p-3 border rounded">
                    <div className="text-xl font-bold">{count as number}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {schema}
                    </div>
                  </div>
                )
              )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Command</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Models</th>
                  <th className="text-left p-2">Tests</th>
                  <th className="text-left p-2">Errors</th>
                  <th className="text-left p-2">Completed</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data?.runs || []).map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{r.command}</td>
                    <td className="p-2">
                      <Badge
                        variant={
                          r.status === "success" ? "default" : "destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="p-2">{r.modelsRun}</td>
                    <td className="p-2">{r.testsRun}</td>
                    <td className="p-2">{r.errors}</td>
                    <td className="p-2 text-xs">
                      {r.completedAt
                        ? new Date(r.completedAt).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
