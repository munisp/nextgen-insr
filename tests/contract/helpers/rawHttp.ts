/**
 * rawHttp.ts — raw tRPC-over-HTTP helpers for the contract suite.
 *
 * Unlike tests/e2e/helpers/http.ts (which parses the superjson envelope into
 * a convenient { data | error } view), these helpers return the UNPARSED
 * response body so tests can assert the wire envelope itself.
 */
import { expect } from "vitest";
import { apiUrl } from "../../e2e/helpers/http";

/** Raw tRPC GET — returns status + unparsed JSON body. */
export async function rawTrpcGet(
  path: string,
  input?: unknown,
  cookie?: string
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const qs =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(apiUrl(`/api/trpc/${path}${qs}`), { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Raw tRPC POST — returns status + unparsed JSON body. */
export async function rawTrpcPost(
  path: string,
  input: unknown,
  cookie?: string
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(apiUrl(`/api/trpc/${path}`), {
    method: "POST",
    headers,
    body: JSON.stringify({ json: input ?? null }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Assert the exact superjson success envelope and return the payload. */
export function expectSuccessEnvelope(raw: { status: number; body: any }): any {
  expect(raw.status).toBe(200);
  expect(raw.body).toBeTypeOf("object");
  // No error channel on success.
  expect(raw.body.error).toBeUndefined();
  expect(raw.body.result).toBeTypeOf("object");
  expect(raw.body.result.data).toBeTypeOf("object");
  expect(raw.body.result.data).toHaveProperty("json");
  return raw.body.result.data.json;
}

/** Assert the exact superjson error envelope and return error.json. */
export function expectErrorEnvelope(
  raw: { status: number; body: any },
  httpStatus: number,
  trpcCode: string
): any {
  expect(raw.status).toBe(httpStatus);
  expect(raw.body).toBeTypeOf("object");
  expect(raw.body.result).toBeUndefined();
  const err = raw.body.error;
  expect(err).toBeTypeOf("object");
  expect(err.json).toBeTypeOf("object");
  // JSON-RPC numeric code (negative) + human message.
  expect(typeof err.json.code).toBe("number");
  expect(err.json.code).toBeLessThan(0);
  expect(typeof err.json.message).toBe("string");
  expect(err.json.message.length).toBeGreaterThan(0);
  // tRPC data channel: string code + mirrored HTTP status.
  expect(err.json.data.code).toBe(trpcCode);
  expect(err.json.data.httpStatus).toBe(httpStatus);
  return err.json;
}
