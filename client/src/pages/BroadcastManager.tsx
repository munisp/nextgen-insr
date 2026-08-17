/**
 * BroadcastManager — Admin page to compose, schedule, and manage system-wide announcements
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

const TYPE_STYLES: Record<string, string> = {
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  maintenance: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  feature: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-slate-500/20 text-slate-400",
  medium: "bg-blue-500/20 text-blue-400",
  high: "bg-orange-500/20 text-orange-400",
  urgent: "bg-red-500/20 text-red-400",
};

function ComposeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<
    "info" | "warning" | "critical" | "maintenance" | "feature"
  >("info");
  const [priority, setPriority] = useState<
    "low" | "medium" | "high" | "urgent"
  >("medium");
  const [target, setTarget] = useState<
    "all" | "agents" | "admins" | "merchants"
  >("all");
  const [pinned, setPinned] = useState(false);
  const [channels, setChannels] = useState<string[]>(["banner", "inbox"]);

  const createMutation = trpc.broadcast.create.useMutation({
    onSuccess: () => {
      toast.success("Announcement published");
      setOpen(false);
      setTitle("");
      setContent("");
      onCreated();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleChannel = (ch: string) => {
    setChannels(prev =>
      prev.includes(ch) ? prev.filter((c: any) => c !== ch) : [...prev, ch]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Compose Announcement</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compose Announcement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Announcement title"
            />
          </div>
          <div>
            <Label>Content</Label>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Announcement body..."
              rows={4}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v: any) => setPriority(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Target</Label>
              <Select value={target} onValueChange={(v: any) => setTarget(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="agents">Agents Only</SelectItem>
                  <SelectItem value="admins">Admins Only</SelectItem>
                  <SelectItem value="merchants">Merchants Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Delivery Channels</Label>
            <div className="flex flex-wrap gap-2">
              {["banner", "inbox", "push", "email", "sms"].map((ch: any) => (
                <Button
                  key={ch}
                  size="sm"
                  variant={channels.includes(ch) ? "default" : "outline"}
                  className="h-7 text-xs capitalize"
                  onClick={() => toggleChannel(ch)}
                >
                  {ch}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={pinned} onCheckedChange={setPinned} />
            <Label>Pin to top</Label>
          </div>
          <Button
            onClick={() =>
              createMutation.mutate({
                title,
                content,
                type,
                priority,
                target,
                pinned,
                channels: channels as any,
              })
            }
            disabled={
              !title ||
              !content ||
              channels.length === 0 ||
              createMutation.isPending
            }
            className="w-full"
          >
            {createMutation.isPending
              ? "Publishing..."
              : "Publish Announcement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function BroadcastManager() {
  const utils = trpc.useUtils();
  const { data: listData, isLoading } = trpc.broadcast.list.useQuery({});
  const { data: stats } = trpc.broadcast.stats.useQuery();

  const pinMutation = trpc.broadcast.togglePin.useMutation({
    onSuccess: () => {
      utils.broadcast.list.invalidate();
      utils.broadcast.stats.invalidate();
    },
  });
  const deleteMutation = trpc.broadcast.delete.useMutation({
    onSuccess: () => {
      utils.broadcast.list.invalidate();
      utils.broadcast.stats.invalidate();
      toast.success("Announcement deleted");
    },
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Broadcast Manager</h1>
            <p className="text-sm text-muted-foreground mt-1">
              System-wide announcements for all users
            </p>
          </div>
          <ComposeDialog
            onCreated={() => {
              utils.broadcast.list.invalidate();
              utils.broadcast.stats.invalidate();
            }}
          />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold mt-1">{stats?.total ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold mt-1 text-emerald-500">
                {stats?.active ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Pinned</p>
              <p className="text-2xl font-bold mt-1 text-amber-500">
                {stats?.pinned ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Unread</p>
              <p className="text-2xl font-bold mt-1 text-blue-500">
                {listData?.unread ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="warning">Warning</TabsTrigger>
            <TabsTrigger value="critical">Critical</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="feature">Feature</TabsTrigger>
          </TabsList>

          {["all", "info", "warning", "critical", "maintenance", "feature"].map(
            (tab: any) => (
              <TabsContent key={tab} value={tab} className="space-y-3 mt-4">
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading announcements...
                  </div>
                ) : (
                  (listData?.announcements ?? [])
                    .filter((a: any) => tab === "all" || a.type === tab)
                    .map((a: any) => (
                      <Card
                        key={a.id}
                        className={a.pinned ? "border-amber-500/30" : ""}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                {a.pinned && (
                                  <span className="text-amber-400 text-xs">
                                    📌
                                  </span>
                                )}
                                <span className="font-medium">{a.title}</span>
                                <Badge
                                  variant="outline"
                                  className={TYPE_STYLES[a.type]}
                                >
                                  {a.type}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={PRIORITY_STYLES[a.priority]}
                                >
                                  {a.priority}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {a.target}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                {a.content}
                              </p>
                              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                                <span>
                                  Published:{" "}
                                  {new Date(a.publishedAt).toLocaleDateString()}
                                </span>
                                <span>Read: {a.readBy.length}</span>
                                <span>Dismissed: {a.dismissedBy.length}</span>
                                <span>Channels: {a.channels.join(", ")}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-4">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => pinMutation.mutate({ id: a.id })}
                              >
                                {a.pinned ? "Unpin" : "Pin"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-red-400"
                                onClick={() =>
                                  deleteMutation.mutate({ id: a.id })
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                )}
              </TabsContent>
            )
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
