/**
 * SharedLayoutGallery — Browse, import, and fork team-shared dashboard layouts
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
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Search,
  Share2,
  GitFork,
  Eye,
  LayoutGrid,
  Copy,
  ExternalLink,
  Lock,
  Unlock,
  Users,
} from "lucide-react";

const PERMISSION_ICONS: Record<string, any> = {
  "view-only": Lock,
  "can-edit": Unlock,
  "can-fork": GitFork,
};

export default function SharedLayoutGallery() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"popular" | "recent" | "forks">(
    "popular"
  );
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [importDialog, setImportDialog] = useState<{
    open: boolean;
    token: string;
  }>({ open: false, token: "" });
  const [shareTokenInput, setShareTokenInput] = useState("");
  const { data, isLoading } = trpc.sharedLayouts.gallery.useQuery({
    search: search || undefined,
    tag: selectedTag,
    sortBy,
  });
  const importMutation = trpc.sharedLayouts.import.useMutation({
    onSuccess: data => {
      toast.success(`Imported "${data.name}" layout`);
      setImportDialog({ open: false, token: "" });
    },
    onError: err => toast.error(err.message),
  });
  const forkMutation = trpc.sharedLayouts.fork.useMutation({
    onSuccess: () => toast.success("Layout forked to your collection"),
    onError: err => toast.error(err.message),
  });

  const layouts = data?.layouts ?? [];
  const tags = data?.tags ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header controls */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search layouts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Most Viewed</SelectItem>
              <SelectItem value="recent">Most Recent</SelectItem>
              <SelectItem value="forks">Most Forked</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => setImportDialog({ open: true, token: "" })}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Import by Link
          </Button>
        </div>

        {/* Tag filters */}
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={!selectedTag ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedTag(undefined)}
          >
            All
          </Badge>
          {tags.map((tag: any) => (
            <Badge
              key={tag}
              variant={selectedTag === tag ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() =>
                setSelectedTag(tag === selectedTag ? undefined : tag)
              }
            >
              {tag}
            </Badge>
          ))}
        </div>

        {/* Layout gallery grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i: any) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-24 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : layouts.length === 0 ? (
          <Card className="p-12 text-center">
            <LayoutGrid className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No shared layouts found</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {layouts.map((layout: any) => {
              const PermIcon = PERMISSION_ICONS[layout.permission] || Lock;
              return (
                <Card
                  key={layout.id}
                  className="hover:border-primary/30 transition-colors"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">
                          {layout.name}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {layout.description}
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] flex items-center gap-1"
                      >
                        <PermIcon className="w-3 h-3" />
                        {layout.permission}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-2">
                    {/* Mini layout preview */}
                    <div className="bg-muted/30 rounded-md p-2 h-20 grid grid-cols-12 gap-1">
                      {layout.widgets
                        .slice(0, 4)
                        .map((w: string, i: number) => (
                          <div
                            key={i}
                            className="bg-primary/10 rounded text-[8px] text-center flex items-center justify-center text-muted-foreground col-span-3"
                          >
                            {w.split("-")[0]}
                          </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {layout.ownerName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {layout.viewCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-3 h-3" />
                        {layout.forkCount}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {layout.tags.map((tag: string) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/shared-layout/${layout.shareToken}`
                        );
                        toast.success("Share link copied!");
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy Link
                    </Button>
                    {layout.permission !== "view-only" && (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() =>
                          forkMutation.mutate({
                            shareToken: layout.shareToken,
                            userId: "me",
                            userName: "You",
                          })
                        }
                      >
                        <GitFork className="w-3 h-3 mr-1" />
                        Fork
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {/* Import dialog */}
        <Dialog
          open={importDialog.open}
          onOpenChange={o => setImportDialog({ open: o, token: "" })}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Layout by Share Link</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Paste share token or URL..."
                value={shareTokenInput}
                onChange={e => setShareTokenInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Enter the share token (e.g., tok_abc123) or the full share URL
                from a team member.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setImportDialog({ open: false, token: "" })}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const token = shareTokenInput.includes("/")
                    ? shareTokenInput.split("/").pop()!
                    : shareTokenInput;
                  importMutation.mutate({ shareToken: token });
                }}
                disabled={!shareTokenInput.trim()}
              >
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
