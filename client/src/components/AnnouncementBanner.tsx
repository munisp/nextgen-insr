/**
 * AnnouncementBanner — Dismissible top-bar banner for pinned system-wide broadcasts
 * with inline emoji reactions and comment thread, fully wired to tRPC.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  X,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Send,
  Trash2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────
type AnnouncementType =
  | "info"
  | "warning"
  | "critical"
  | "maintenance"
  | "feature";

interface MappedAnnouncement {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  pinned: boolean;
  channels: string[];
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const TYPE_STYLES: Record<
  AnnouncementType,
  { bg: string; border: string; icon: string }
> = {
  info: { bg: "bg-blue-500/10", border: "border-blue-500/30", icon: "ℹ️" },
  warning: { bg: "bg-amber-500/10", border: "border-amber-500/30", icon: "⚠️" },
  critical: { bg: "bg-red-500/10", border: "border-red-500/30", icon: "🚨" },
  maintenance: {
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    icon: "🔧",
  },
  feature: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    icon: "✨",
  },
};

const REACTION_EMOJIS = [
  { emoji: "👍", label: "thumbsUp" as const },
  { emoji: "👎", label: "thumbsDown" as const },
  { emoji: "❤️", label: "heart" as const },
  { emoji: "👀", label: "eyes" as const },
  { emoji: "🎉", label: "celebrate" as const },
];

const DISMISSED_KEY = "insureportal_dismissed_announcements";
const CURRENT_USER_ID = "current_user"; // Placeholder — replaced by useAuth() in production
const CURRENT_USER_NAME = "You";

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
}

// ─── Single Announcement Bar (wired to tRPC) ────────────────────────────────
function AnnouncementBar({
  ann,
  onDismiss,
}: {
  ann: MappedAnnouncement;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");

  const utils = trpc.useUtils();

  // ── Fetch reactions & comments from tRPC ──
  const { data: reactionsData, isLoading: reactionsLoading } =
    trpc.announcementReactions.getReactions.useQuery(
      // @ts-ignore
      { announcementId: ann.id },
      { refetchInterval: 30_000 }
    );

  // ── React mutation with optimistic update ──
  const reactMutation = trpc.announcementReactions.react.useMutation({
    // @ts-ignore
    onMutate: async ({ emoji }) => {
      // @ts-ignore
      await utils.announcementReactions.getReactions.cancel({
        announcementId: ann.id,
      });
      // @ts-ignore
      const prev = utils.announcementReactions.getReactions.getData({
        announcementId: ann.id,
      });
      if (prev) {
        // @ts-ignore
        const reactionEntry = prev.reactions[emoji];
        const userReacted =
          reactionEntry?.users?.includes(CURRENT_USER_ID) ?? false;
        // @ts-ignore
        const updatedReactions = { ...prev.reactions };
        updatedReactions[emoji] = {
          count: userReacted
            ? (reactionEntry?.count ?? 1) - 1
            : (reactionEntry?.count ?? 0) + 1,
          users: userReacted
            ? (reactionEntry?.users ?? []).filter(
                (u: string) => u !== CURRENT_USER_ID
              )
            : [...(reactionEntry?.users ?? []), CURRENT_USER_ID],
        };
        utils.announcementReactions.getReactions.setData(
          // @ts-ignore
          { announcementId: ann.id },
          { ...prev, reactions: updatedReactions }
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        utils.announcementReactions.getReactions.setData(
          // @ts-ignore
          { announcementId: ann.id },
          ctx.prev
        );
      }
    },
    onSettled: () => {
      // @ts-ignore
      utils.announcementReactions.getReactions.invalidate({
        announcementId: ann.id,
      });
    },
  });

  // ── Add comment mutation ──
  const addCommentMutation = trpc.announcementReactions.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      // @ts-ignore
      utils.announcementReactions.getReactions.invalidate({
        announcementId: ann.id,
      });
    },
  });

  // ── Delete comment mutation ──
  const deleteCommentMutation =
    // @ts-ignore
    trpc.announcementReactions.deleteComment.useMutation({
      onSuccess: () => {
        // @ts-ignore
        utils.announcementReactions.getReactions.invalidate({
          announcementId: ann.id,
        });
      },
    });

  // ── Derived state ──
  const reactions = useMemo(() => {
    return REACTION_EMOJIS.map(r => {
      // @ts-ignore
      const data = reactionsData?.reactions?.[r.label];
      return {
        emoji: r.emoji,
        label: r.label,
        count: data?.count ?? 0,
        userReacted: data?.users?.includes(CURRENT_USER_ID) ?? false,
      };
    });
  }, [reactionsData]);

  // @ts-ignore
  const comments = reactionsData?.comments ?? [];
  // @ts-ignore
  const totalComments = reactionsData?.totalComments ?? 0;

  const style = TYPE_STYLES[ann.type] || TYPE_STYLES.info;

  const handleReaction = useCallback(
    (label: string) => {
      reactMutation.mutate({
        // @ts-ignore
        announcementId: ann.id,
        userId: CURRENT_USER_ID,
        emoji: label as any,
      });
    },
    [ann.id, reactMutation]
  );

  const handleComment = useCallback(() => {
    if (!commentText.trim()) return;
    addCommentMutation.mutate({
      // @ts-ignore
      announcementId: ann.id,
      userId: CURRENT_USER_ID,
      userName: CURRENT_USER_NAME,
      text: commentText.trim(),
    });
  }, [commentText, ann.id, addCommentMutation]);

  const handleDeleteComment = useCallback(
    (commentId: string) => {
      deleteCommentMutation.mutate({
        commentId,
        userId: CURRENT_USER_ID,
      });
    },
    [deleteCommentMutation]
  );

  // ── Reaction pill renderer ──
  const ReactionPills = ({ className }: { className?: string }) => (
    <div className={cn("flex items-center gap-1", className)}>
      {reactionsLoading ? (
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      ) : (
        reactions.map(r => (
          <button
            key={r.label}
            onClick={() => handleReaction(r.label)}
            disabled={reactMutation.isPending}
            className={cn(
              "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] transition-colors border",
              r.userReacted
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-muted/50 border-transparent hover:bg-muted text-muted-foreground",
              reactMutation.isPending && "opacity-50 cursor-not-allowed"
            )}
          >
            <span>{r.emoji}</span>
            {r.count > 0 && <span>{r.count}</span>}
          </button>
        ))
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "border-b px-4 py-2 transition-all",
        style.bg,
        style.border
      )}
    >
      {/* Main bar */}
      <div className="flex items-center gap-3">
        <span className="text-base flex-shrink-0">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm">{ann.title}</span>
          {!expanded && (
            <span className="text-xs text-muted-foreground ml-2 truncate">
              {(ann.message || "").slice(0, 80)}…
            </span>
          )}
        </div>

        {/* Reaction pills (desktop) */}
        <ReactionPills className="hidden md:flex" />

        {/* Comment toggle */}
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>{totalComments}</span>
        </button>

        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Expanded message */}
      {expanded && (
        <div className="mt-2 pl-8 text-sm text-muted-foreground">
          <p>{ann.message || ""}</p>
          <p className="text-[10px] mt-1 opacity-60">
            Posted {new Date(ann.createdAt).toLocaleString()}
          </p>

          {/* Mobile reactions */}
          <ReactionPills className="flex md:hidden mt-2" />
        </div>
      )}

      {/* Comment thread (wired to tRPC) */}
      {showComments && (
        <div className="mt-2 pl-8 space-y-2 border-t border-border/30 pt-2">
          {comments.length === 0 && !addCommentMutation.isPending && (
            <p className="text-xs text-muted-foreground italic">
              No comments yet. Be the first!
            </p>
          )}
          {comments.map((c: any) => (
            <div key={c.id} className="flex items-start gap-2 group">
              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                {(c.userName || "?").charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{c.userName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(c.createdAt).toLocaleTimeString()}
                  </span>
                  {c.userId === CURRENT_USER_ID && (
                    <button
                      onClick={() => handleDeleteComment(c.id)}
                      disabled={deleteCommentMutation.isPending}
                      className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.text}</p>
              </div>
            </div>
          ))}
          {/* Comment input */}
          <div className="flex items-center gap-2">
            <Input
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="h-7 text-xs"
              onKeyDown={e => e.key === "Enter" && handleComment()}
              disabled={addCommentMutation.isPending}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={handleComment}
              disabled={addCommentMutation.isPending || !commentText.trim()}
            >
              {addCommentMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Banner Container ───────────────────────────────────────────────────
export default function AnnouncementBanner() {
  const [dismissed, setDismissedState] = useState<Set<string>>(getDismissed);

  // Fetch active pinned announcements from broadcast router
  const { data: announcements } = trpc.broadcast.list.useQuery(
    // @ts-ignore
    { pinnedOnly: true, limit: 10 },
    { refetchInterval: 60_000 }
  );

  // Map broadcast router fields to banner's expected shape
  const visibleAnnouncements = useMemo(() => {
    // @ts-ignore
    return (announcements?.announcements ?? [])
      .filter((a: any) => a.pinned && !dismissed.has(a.id))
      .map((a: any) => ({
        ...a,
        message: a.message || a.content || "",
        createdAt: a.createdAt || a.publishedAt || new Date().toISOString(),
      }));
  }, [announcements, dismissed]);

  const handleDismiss = useCallback((id: string) => {
    setDismissedState(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  // Clean up old dismissed IDs (keep last 100)
  useEffect(() => {
    if (dismissed.size > 100) {
      const arr = Array.from(dismissed);
      const trimmed = new Set(arr.slice(-100));
      setDismissedState(trimmed);
      saveDismissed(trimmed);
    }
  }, [dismissed]);

  if (visibleAnnouncements.length === 0) return null;

  return (
    <div className="w-full z-50">
      {visibleAnnouncements.map((ann: any) => (
        <AnnouncementBar
          key={ann.id}
          ann={ann}
          onDismiss={() => handleDismiss(ann.id)}
        />
      ))}
    </div>
  );
}
