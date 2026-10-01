/**
 * Notifications.tsx — R3 batch 6 (2026-10-01, R3-b6)
 * Member notification inbox (route /notifications).
 * BINDING: REAL — notificationInbox.list / getStats / markRead /
 * markAllRead / delete (server/routers/notificationInbox.ts — ALREADY
 * mounted and caller-scoped: every proc binds
 * notification_logs.recipientId = String(ctx.user.id), F-12 wave-4b). No
 * new router was added for B6 (worklist B6-1: page-only). The source's
 * archive/bulkDelete/getUnreadCounts/toggleStar are NOT_IMPLEMENTED and are
 * deliberately not offered here. NOT_FOUND/FORBIDDEN → null is only a
 * defensive fallback for older deployments; loading/error/empty states are
 * disclosed. No notification is fabricated.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { notificationInboxApi } from "@/services/notificationInboxApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";
import { useState } from "react";

export default function Notifications() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["notificationInbox", "list"],
    queryFn: () => notificationInboxApi.list({ limit: 50 }),
    retry: 1,
  });

  const statsQuery = useQuery({
    queryKey: ["notificationInbox", "getStats"],
    queryFn: () => notificationInboxApi.getStats(),
    retry: 1,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["notificationInbox"] });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: number) =>
      notificationInboxApi.markRead({ notificationId }),
    onSuccess: () => {
      setActionError(null);
      void invalidate();
    },
    onError: error => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationInboxApi.markAllRead(),
    onSuccess: () => {
      setActionError(null);
      void invalidate();
    },
    onError: error => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (notificationId: number) =>
      notificationInboxApi.deleteNotification({ notificationId }),
    onSuccess: () => {
      setActionError(null);
      void invalidate();
    },
    onError: error => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const unread = statsQuery.data?.unread ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Notifications
        </h1>
        <p className="text-sm text-stone-500">
          Messages about your policies, claims and account.
          {statsQuery.data &&
            ` ${statsQuery.data.total} total · ${unread} unread.`}
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Bell className="h-5 w-5 text-amber-600" aria-hidden />
            Inbox
          </CardTitle>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                markAllReadMutation.mutate();
              }}
              disabled={markAllReadMutation.isPending}
              className="flex items-center gap-1 text-sm text-stone-500 hover:text-amber-700"
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark all read
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {listQuery.isLoading ? (
            <LoadingState label="Loading your notifications…" />
          ) : listQuery.isError ? (
            <ErrorState
              message="We couldn’t load your notifications. Please try again."
              onRetry={() => listQuery.refetch()}
            />
          ) : listQuery.data === null ? (
            <UnavailableState feature="Notifications" />
          ) : (listQuery.data?.notifications ?? []).length === 0 ? (
            <EmptyState
              title="No notifications"
              hint="You are all caught up."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {listQuery.data!.notifications.map(n => (
                <li
                  key={n.id}
                  className={`flex items-start justify-between gap-4 py-3 ${
                    n.status === "pending" ? "" : "opacity-70"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {n.subject ?? "Notification"}
                      {n.status === "pending" && (
                        <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-stone-600">{n.body}</p>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {n.createdAt
                        ? new Date(n.createdAt).toLocaleString()
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {n.status === "pending" && (
                      <button
                        type="button"
                        aria-label={`Mark notification ${n.id} read`}
                        className="rounded-lg p-2 text-stone-400 hover:bg-stone-50 hover:text-amber-700"
                        disabled={markReadMutation.isPending}
                        onClick={() => markReadMutation.mutate(n.id)}
                      >
                        <CheckCheck className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Delete notification ${n.id}`}
                      className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(n.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {actionError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
