/**
 * MemberNotifications.tsx — /member/notifications (W7-B8, 2026-10-04)
 *
 * Wired to the REAL notificationInbox router
 * (server/routers/notificationInbox.ts) — member-safe procedures ONLY:
 *   - notificationInbox.list        (recipientId forced to String(ctx.user.id))
 *   - notificationInbox.getStats    (session-scoped total/unread)
 *   - notificationInbox.markRead    ({ notificationId }, recipient-scoped)
 *   - notificationInbox.markAllRead (recipient-scoped)
 *   - notificationInbox.delete      ({ notificationId }, recipient-scoped)
 *
 * AUTHZ AUDIT (verified 2026-10-04, W7-B8): every wired procedure scopes
 * notification_logs.recipientId to the session user; markRead/delete also
 * NOT_FOUND on foreign ids (non-enumerating IDOR fix, R3-b6-fix). No wired
 * procedure accepts a client-supplied userId/customerId.
 *
 * NOT WIRED — honest NOT_IMPLEMENTED server-side (throw, verified
 * 2026-10-04): notificationInbox.archive, notificationInbox.bulkDelete,
 * notificationInbox.getUnreadCounts, notificationInbox.toggleStar. Rather
 * than render buttons that always fail, this page omits those actions and
 * shows an honest note. Unread count comes from getStats.unread.
 *
 * list's status filter is a free string server-side; this page offers only
 * the statuses the backend actually writes ("pending" = unread, "read",
 * "failed") plus "all".
 */
import { useState } from "react";

import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "pending":
      return "default" as const; // unread
    case "read":
      return "secondary" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

export default function MemberNotifications() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const statsQuery = trpc.notificationInbox.getStats.useQuery(undefined, {
    retry: false,
  });
  // zod-exact list input: { status?: string, limit: number, offset: number }
  // — status omitted entirely when "all".
  const listInput =
    statusFilter === "all"
      ? { limit: 50, offset: 0 }
      : { status: statusFilter, limit: 50, offset: 0 };
  const listQuery = trpc.notificationInbox.list.useQuery(listInput, {
    retry: false,
  });

  const refresh = () => {
    statsQuery.refetch();
    listQuery.refetch();
  };

  const markRead = trpc.notificationInbox.markRead.useMutation({
    onSuccess: () => {
      setActionError(null);
      refresh();
    },
    onError: (err: { message: string }) => setActionError(err.message),
  });
  const markAllRead = trpc.notificationInbox.markAllRead.useMutation({
    onSuccess: () => {
      setActionError(null);
      refresh();
    },
    onError: (err: { message: string }) => setActionError(err.message),
  });
  const deleteOne = trpc.notificationInbox.delete.useMutation({
    onSuccess: () => {
      setActionError(null);
      refresh();
    },
    onError: (err: { message: string }) => setActionError(err.message),
  });

  const stats = statsQuery.data;
  const notifications = listQuery.data?.notifications ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Notifications"
          description="Messages and alerts sent to your account."
        >
          {statsQuery.isLoading ? (
            <MemberLoading label="Loading notification stats" />
          ) : statsQuery.isError ? (
            <MemberError message={statsQuery.error.message} />
          ) : (
            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-bold" data-testid="notif-total">
                  {stats?.total ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Unread</p>
                <p className="text-2xl font-bold" data-testid="notif-unread">
                  {stats?.unread ?? 0}
                </p>
              </div>
            </div>
          )}
        </MemberSection>

        <MemberSection title="Inbox" description="Newest first.">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="w-40"
                  aria-label="Filter by status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Unread</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRead.mutate(undefined)}
                disabled={markAllRead.isPending}
              >
                Mark all read
              </Button>
            </div>
            {actionError && (
              <p
                role="alert"
                className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
              >
                {actionError}
              </p>
            )}
            {listQuery.isLoading ? (
              <MemberLoading label="Loading notifications" />
            ) : listQuery.isError ? (
              <MemberError message={listQuery.error.message} />
            ) : notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                You have no notifications.
              </p>
            ) : (
              <ul className="space-y-2">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className="border rounded-md p-3"
                    data-testid={`notification-${n.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="font-medium">
                          {n.subject ?? "Notification"}
                        </p>
                        <p className="text-sm">{n.body}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(n.createdAt)}
                        </p>
                        {/* Failed deliveries are shown honestly, never hidden. */}
                        {n.status === "failed" && n.failureReason && (
                          <p className="text-xs text-destructive">
                            Delivery failed: {n.failureReason}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge variant={statusVariant(n.status)}>
                          {n.status === "pending" ? "unread" : n.status}
                        </Badge>
                        <div className="flex gap-1">
                          {n.status === "pending" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                markRead.mutate({ notificationId: n.id })
                              }
                              disabled={markRead.isPending}
                            >
                              Mark read
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              deleteOne.mutate({ notificationId: n.id })
                            }
                            disabled={deleteOne.isPending}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* 2026-10-04 (W7-B8): archive/bulk-delete/unread-counts are
                honest NOT_IMPLEMENTED on the server — no buttons for them
                here; see header. */}
            <p className="text-xs text-muted-foreground">
              Archiving and bulk actions are not available yet.
            </p>
          </div>
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
