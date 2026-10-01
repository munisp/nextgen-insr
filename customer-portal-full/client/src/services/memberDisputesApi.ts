/**
 * memberDisputesApi.ts — R3 batch 2 PWA bindings (2026-10-01, R3-b2)
 *
 * Typed tRPC-over-HTTP bindings for the memberDisputes router
 * (server/routers/memberDisputes.ts, mounted as `memberDisputes` on the
 * monolith appRouter at /api/trpc, superjson transformer). Same
 * envelope/credentials conventions as memberClaimsApi.ts: inputs travel as
 * `{ json: ... }`, results are unwrapped from `result.data.json`, requests
 * are same-origin with credentials: "include" (the member's session cookie —
 * no tokens stored).
 *
 * Degradation contract (same as memberClaimsApi): NOT_FOUND/FORBIDDEN/
 * 404/403 resolve to `null` ONLY as a defensive fallback for deployments
 * whose backend predates the mount; pages MUST render a disclosed "not
 * available on this deployment" empty state. Genuine errors (network, 5xx,
 * UNAUTHORIZED, PRECONDITION_FAILED, BAD_REQUEST) throw so pages can surface
 * the server's exact reason. No data is ever fabricated by this module, and
 * the fabricated customerDisputePortal.getStats constants are never consumed.
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

/** Thrown for genuine failures (network, 5xx, UNAUTHORIZED, …). */
export class MemberDisputesApiError extends Error {
  constructor(
    message: string,
    readonly trpcCode?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "MemberDisputesApiError";
  }
}

/** Same feature-detection contract as memberClaimsApi.isUnavailableError. */
function isUnavailableError(error: MemberDisputesApiError): boolean {
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
    throw new MemberDisputesApiError(
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
    const err = new MemberDisputesApiError(
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

// ── R3-b2 member disputes surface (REAL — server/routers/memberDisputes.ts)
// disputes.amount is a numeric(15,2) column — serialized as a string over
// the wire.

export interface MemberDisputeItem {
  id: number;
  ref: string;
  transactionId: number | null;
  transactionRef: string | null;
  status: string;
  priority: string;
  type: string | null;
  reason: string | null;
  amount: string | null;
  createdAt: string;
}

export interface MemberDisputeDetail extends MemberDisputeItem {
  description: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}

export interface MemberDisputeMessage {
  id: number;
  senderType: string | null;
  senderName: string | null;
  content: string | null;
  createdAt: string;
}

export interface MemberDisputeEvidence {
  id: number;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: string;
}

export interface FileDisputeResult {
  id: number;
  ref: string;
  status: string;
}

export const memberDisputesApi = {
  myDisputes: (params?: { status?: string; limit?: number; offset?: number }) =>
    trpcCall<{ disputes: MemberDisputeItem[]; count: number }>(
      "memberDisputes.myDisputes",
      "query",
      params,
      { unavailableAsNull: true }
    ),

  myDispute: (input: { id: number }) =>
    trpcCall<{
      dispute: MemberDisputeDetail;
      messages: MemberDisputeMessage[];
      evidence: MemberDisputeEvidence[];
    }>("memberDisputes.myDispute", "query", input, { unavailableAsNull: true }),

  fileDispute: (input: {
    transactionId: number;
    reason: string;
    description: string;
    amount: number;
  }) => trpcCall<FileDisputeResult>("memberDisputes.fileDispute", "mutation", input),

  replyDispute: (input: { disputeId: number; content: string }) =>
    trpcCall<{ id: number; senderType: "customer" }>(
      "memberDisputes.replyDispute",
      "mutation",
      input
    ),
};
