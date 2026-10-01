/**
 * supportApi.ts — R3 batch 1 member helpdesk PWA bindings (2026-10-01, R3)
 *
 * Typed tRPC-over-HTTP bindings for the member helpdesk surface
 * (server/routers/memberHelpDesk.ts, mounted as `memberHelpDesk` on the
 * monolith appRouter at /api/trpc with the superjson transformer). Follows
 * the innovationApi.ts conventions exactly: inputs travel as `{ json: ... }`,
 * results are unwrapped from `result.data.json`, requests are same-origin
 * with credentials: "include" (the member session cookie — no tokens stored
 * or cached here).
 *
 * Binding status (2026-10-01, R3 — all bindings REAL):
 *  - memberHelpDesk.myTickets     REAL — caller-scoped ticket list
 *  - memberHelpDesk.myTicket      REAL — caller-scoped ticket + thread
 *  - memberHelpDesk.createTicket  REAL — owner forced server-side to caller
 *  - memberHelpDesk.replyTicket   REAL — ownership-checked thread append
 *
 * The NOT_FOUND/FORBIDDEN → null degradation is retained ONLY as a defensive
 * fallback for deployments running an older backend that predates this
 * mount: pages MUST treat `null` as "feature not available on this
 * deployment" and render the disclosed UnavailableState. Genuine errors
 * (network, 5xx, UNAUTHORIZED) still throw so pages can show an honest
 * error state. No tickets, messages, or FAQs are ever fabricated.
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
export class SupportApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "SupportApiError";
  }
}

/**
 * 2026-10-01 (R3) — Feature-detection contract, same as innovationApi.ts:
 * tRPC NOT_FOUND / HTTP 404 (mount absent) or FORBIDDEN / 403 (gated)
 * resolve to `null` so pages render the disclosed "not available yet"
 * state instead of crashing.
 */
function isUnavailableError(error: SupportApiError): boolean {
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
    throw new SupportApiError(
      `Network error contacting ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let envelope: TrpcEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as TrpcEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope || envelope.error) {
    const err = new SupportApiError(
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

// ── memberHelpDesk.* (REAL — server/routers/memberHelpDesk.ts, 2026-10-01, R3)
// Types mirror drizzle/schema.ts chat_sessions / chat_messages columns.

export type TicketStatus = "open" | "assigned" | "resolved" | "escalated";

export interface SupportTicket {
  id: number;
  sessionRef: string;
  category: string | null;
  subject: string | null;
  status: TicketStatus;
  supportAgentName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: number;
  sessionId: number;
  senderType: "agent" | "support" | "system";
  senderName: string | null;
  content: string;
  isRead: boolean | null;
  createdAt: string;
}

export const supportApi = {
  myTickets: (params?: { status?: TicketStatus; limit?: number }) =>
    trpcCall<{ tickets: SupportTicket[]; total: number }>(
      "memberHelpDesk.myTickets",
      "query",
      params,
      { unavailableAsNull: true }
    ),
  myTicket: (id: number) =>
    trpcCall<{ ticket: SupportTicket; messages: SupportMessage[] }>(
      "memberHelpDesk.myTicket",
      "query",
      { id },
      { unavailableAsNull: true }
    ),
  createTicket: (input: {
    subject: string;
    description: string;
    priority?: "low" | "medium" | "high";
  }) =>
    trpcCall<SupportTicket>("memberHelpDesk.createTicket", "mutation", input),
  replyTicket: (input: { ticketId: number; content: string }) =>
    trpcCall<{ success: boolean }>(
      "memberHelpDesk.replyTicket",
      "mutation",
      input
    ),
};
