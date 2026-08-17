/**
 * ReportTemplateDesigner — Visual report template builder with widget catalog and grid layout
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  BarChart3,
  PieChart,
  LineChart,
  AreaChart,
  Table,
  Type,
  Plus,
  Trash2,
  Save,
  Eye,
  FileText,
  Settings,
  GripVertical,
  Star,
  Copy,
  Download,
} from "lucide-react";

const WIDGET_ICONS: Record<string, any> = {
  chart: BarChart3,
  kpi: LineChart,
  table: Table,
  text: Type,
};

const CHART_ICONS: Record<string, any> = {
  line: LineChart,
  bar: BarChart3,
  area: AreaChart,
  pie: PieChart,
  scatter: BarChart3,
  radar: PieChart,
  funnel: BarChart3,
};

export default function ReportTemplateDesigner() {
  const [tab, setTab] = useState("templates");
  const [search, setSearch] = useState("");
  const [editTemplate, setEditTemplate] = useState<any>(null);
  const [createDialog, setCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPageSize, setNewPageSize] = useState<"A4" | "letter" | "A3">("A4");
  const [newOrientation, setNewOrientation] = useState<
    "portrait" | "landscape"
  >("landscape");

  const { data: catalogData } = trpc.reportTemplate.widgetCatalog.useQuery();
  const { data: templatesData, isLoading } = trpc.reportTemplate.list.useQuery({
    search: search || undefined,
  });
  const utils = trpc.useUtils();

  const createMutation = trpc.reportTemplate.create.useMutation({
    onSuccess: () => {
      toast.success("Template created");
      setCreateDialog(false);
      setNewName("");
      setNewDesc("");
      utils.reportTemplate.list.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = trpc.reportTemplate.delete.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      utils.reportTemplate.list.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const setDefaultMutation = trpc.reportTemplate.setDefault.useMutation({
    onSuccess: () => {
      toast.success("Default template updated");
      utils.reportTemplate.list.invalidate();
    },
  });

  const catalog = catalogData ?? [];
  const templates = templatesData?.templates ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="templates">My Templates</TabsTrigger>
              <TabsTrigger value="catalog">Widget Catalog</TabsTrigger>
            </TabsList>
            <Button onClick={() => setCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Template
            </Button>
          </div>

          {/* Templates List */}
          <TabsContent value="templates" className="space-y-4 mt-4">
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2].map((i: any) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader>
                      <div className="h-4 bg-muted rounded w-3/4" />
                    </CardHeader>
                    <CardContent>
                      <div className="h-32 bg-muted rounded" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : templates.length === 0 ? (
              <Card className="p-12 text-center">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No templates yet. Create your first report template.
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map((t: any) => (
                  <Card
                    key={t.id}
                    className="hover:border-primary/30 transition-colors"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {t.name}
                            {t.isDefault && (
                              <Badge variant="default" className="text-[10px]">
                                Default
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {t.description}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {t.pageSize} {t.orientation}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-2">
                      {/* Widget preview grid */}
                      <div className="bg-muted/30 rounded-md p-2 min-h-[80px]">
                        <div className="grid grid-cols-12 gap-1">
                          {t.widgets.map((w: any, i: number) => {
                            const Icon = w.chartType
                              ? CHART_ICONS[w.chartType] || BarChart3
                              : WIDGET_ICONS[w.type] || BarChart3;
                            return (
                              <div
                                key={i}
                                className="bg-primary/10 rounded p-1 flex flex-col items-center justify-center text-[8px] text-muted-foreground"
                                style={{
                                  gridColumn: `span ${Math.min(w.position?.w ?? 3, 6)}`,
                                }}
                              >
                                <Icon className="w-3 h-3 mb-0.5" />
                                {w.title?.slice(0, 12)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                        <span>{t.widgets.length} widgets</span>
                        <span>Used {t.usageCount}x</span>
                        <span>by {t.ownerName}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="pt-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditTemplate(t)}
                      >
                        <Settings className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                      {!t.isDefault && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setDefaultMutation.mutate({ id: t.id })
                          }
                        >
                          <Star className="w-3 h-3 mr-1" />
                          Set Default
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate({ id: t.id })}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Widget Catalog */}
          <TabsContent value="catalog" className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {catalog.map((w: any) => {
                const Icon = w.chartType
                  ? CHART_ICONS[w.chartType] || BarChart3
                  : WIDGET_ICONS[w.type] || BarChart3;
                return (
                  <Card
                    key={w.id}
                    className="cursor-pointer hover:border-primary/30 transition-colors"
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className="p-2 rounded-md bg-primary/10">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{w.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {w.type}
                          {w.chartType ? ` / ${w.chartType}` : ""}
                        </p>
                        <Badge variant="secondary" className="text-[10px] mt-1">
                          {w.dataSource}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {/* Create Dialog */}
        <Dialog open={createDialog} onOpenChange={setCreateDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Report Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Monthly Operations Report"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Describe this template..."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Page Size</Label>
                  <Select
                    value={newPageSize}
                    onValueChange={(v: any) => setNewPageSize(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="letter">Letter</SelectItem>
                      <SelectItem value="A3">A3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Orientation</Label>
                  <Select
                    value={newOrientation}
                    onValueChange={(v: any) => setNewOrientation(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="landscape">Landscape</SelectItem>
                      <SelectItem value="portrait">Portrait</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialog(false)}>
                Cancel
              </Button>
              <Button
                disabled={!newName.trim()}
                onClick={() =>
                  createMutation.mutate({
                    name: newName,
                    description: newDesc,
                    ownerId: "me",
                    ownerName: "You",
                    widgets: [],
                    pageSize: newPageSize,
                    orientation: newOrientation,
                  })
                }
              >
                Create Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog
          open={!!editTemplate}
          onOpenChange={o => !o && setEditTemplate(null)}
        >
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit: {editTemplate?.name}</DialogTitle>
            </DialogHeader>
            {editTemplate && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Page Size</Label>
                    <p className="text-sm">{editTemplate.pageSize}</p>
                  </div>
                  <div>
                    <Label>Orientation</Label>
                    <p className="text-sm">{editTemplate.orientation}</p>
                  </div>
                </div>
                <div>
                  <Label>Widgets ({editTemplate.widgets.length})</Label>
                  <div className="space-y-2 mt-2">
                    {editTemplate.widgets.map((w: any, i: number) => {
                      const Icon = w.chartType
                        ? CHART_ICONS[w.chartType] || BarChart3
                        : WIDGET_ICONS[w.type] || BarChart3;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-3 p-2 bg-muted/30 rounded-md"
                        >
                          <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                          <Icon className="w-4 h-4 text-primary" />
                          <span className="text-sm flex-1">{w.title}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {w.position?.w ?? 6}x{w.position?.h ?? 2}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag widgets from the catalog tab to add them. Resize by
                  adjusting grid position values.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTemplate(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
