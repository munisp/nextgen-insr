/**
 * notificationInboxApi.ts — R3 batch 6 PWA bindings (2026-10-01, R3-b6)
 *
 * Typed tRPC-over-HTTP bindings for the notificationInbox router — ALREADY mounted and caller-scoped
 * (server/routers/notificationInbox.ts, mounted as `notificationInbox`;
 * list/getStats/markAllRead scope recipientId = String(ctx.user.id) since
 * F-12 wave-4b; markRead/delete were id-only IDORs until the 2026-10-01
 * R3-b6-fix scoped them to the caller). B6 adds NO router — this module binds the existing mount on
 * the monolith appRouter at /api/trpc (superjson transformer). Same
 * envelope/credentials conventions as memberClaimsApi.ts: inputs travel as
 * `{ json: ... }`, results are unwrapped from `result.data.json`, requests
 * are same-origin with credentials: "include".
 *
 * Degradation contract (same as memberClaimsApi): NOT_FOUND/FORBIDDEN/
 * 404/403 resolve to `null` ONLY as a defensive fallback for deployments
 * whose backend predates the mount; pages MUST render a disclosed "not
 * available on this deployment" empty state. Genuine errors throw. No data
 * is ever fabricated by this module.
 */

const TRPC_BASE = "/api/trpc";

interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: {
    message?: string;
    code?: number | string;
    data?: { code?: string; httpStatus?: number };
  };
}

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED). */
export class NotificationInboxApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "NotificationInboxApiError";
  }
}

function isUnavailableError(error: NotificationInboxApiError): boolean {
  return (
    error.trpcCode === "NOT_FOUND" ||
    error.trpcCode === "FORBIDDEN" ||
    error.httpStatus === 404 ||
    error.httpStatus === 403
  );
}

async function trpcCall<T>(
  path: string,
  type: "query" | "mutation",
  input?: unknown,
  { unavailableAsNull = false }: { unavailableAsNull?: boolean } = {}
): Promise<T | null> {
  let response: Response;
  try {
    if (type === "query") {
      const qs =
        input === undefined
          ? ""
          : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
      response = await fetch(`${TRPC_BASE}/${path}${qs}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } else {
      response = await fetch(`${TRPC_BASE}/${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ json: input ?? null }),
      });
    }
  } catch (error) {
    throw new NotificationInboxApiError(
      `Network error contacting ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let envelope: TrpcEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as TrpcEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope || envelope.error) {
    const err = new NotificationInboxApiError(
      envelope?.error?.message ?? `Request failed (HTTP ${response.status})`,
      envelope?.error?.data?.code ??
        (typeof envelope?.error?.code === "string"
          ? envelope.error.code
          : undefined),
      envelope?.error?.data?.httpStatus ?? response.status
    );
    if (unavailableAsNull && isUnavailableError(err)) return null;
    throw err;
  }
  const data = envelope.result?.data;
  const unwrapped =
    data != null && typeof data === "object" && "json" in data
      ? (data as { json?: T }).json
      : (data as T | undefined);
  return (unwrapped ?? null) as T | null;
}

// ── R3-b6 notifications surface (REAL — server/routers/notificationInbox.ts)
// Proc names verified against the mount: list / getStats / markRead /
// markAllRead / delete (archive/bulkDelete/getUnreadCounts/toggleStar are
// NOT_IMPLEMENTED in the source and are NOT bound here).

export interface NotificationItem {
  id: number;
  channelId: number | null;
  recipientId: string;
  recipientType: string;
  subject: string | null;
  body: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  retryCount: number | null;
  createdAt: string | null;
}

export interface NotificationStats {
  total: number;
  unread: number;
  archived: number;
}

export const notificationInboxApi = {
  list: (params?: { status?: string; limit?: number; offset?: number }) =>
    trpcCall<{ notifications: NotificationItem[]; total: number }>(
      "notificationInbox.list",
      "query",
      params,
      { unavailableAsNull: true }
    ),

  getStats: () =>
    trpcCall<NotificationStats>("notificationInbox.getStats", "query", undefined, {
      unavailableAsNull: true,
    }),

  markRead: (input: { notificationId: number }) =>
    trpcCall<{ success: boolean; notification?: NotificationItem }>(
      "notificationInbox.markRead",
      "mutation",
      input
    ),

  markAllRead: () =>
    trpcCall<{ success: boolean }>(
      "notificationInbox.markAllRead",
      "mutation",
      null
    ),

  deleteNotification: (input: { notificationId: number }) =>
    trpcCall<{ success: boolean }>(
      "notificationInbox.delete",
      "mutation",
      input
    ),
};
