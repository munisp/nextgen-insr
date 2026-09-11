/**
 * ollamaClient.ts — B13: real Ollama HTTP client for the compliance chatbot.
 *
 * Talks to a real Ollama deployment over HTTP (OLLAMA_URL env var) with a
 * hard timeout. NEVER fabricates a model response: any unreachable host,
 * non-2xx status, timeout, or malformed payload maps to a fail-loud
 * TRPCError PRECONDITION_FAILED whose message starts 'ollama_unavailable'
 * and names the probed URL host. A canned compliance answer is worse than
 * none — fabricated regulatory guidance is not an option.
 *
 * Transport seam: this module calls the global `fetch` exactly once per
 * request (in postJson). Tests may stub ONLY that boundary
 * (vi.stubGlobal('fetch', ...)); everything above it — URL construction,
 * timeout wiring, error mapping, payload validation — is the real code.
 */
import { TRPCError } from "@trpc/server";

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatResult {
  content: string;
  model: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function config() {
  const baseUrl = process.env.OLLAMA_URL;
  const model = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.2:3b";
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "", 10);
  return {
    baseUrl: baseUrl?.replace(/\/+$/, "") ?? null,
    model,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The single fetch-boundary call. Everything else in this module is pure. */
async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { ok: res.ok, status: res.status, json: () => res.json() };
}

/**
 * Real Ollama /api/chat call (non-streaming). Fails loud — see module header.
 */
export async function ollamaChat(
  messages: OllamaChatMessage[],
  opts?: { model?: string; timeoutMs?: number }
): Promise<OllamaChatResult> {
  const cfg = config();
  if (!cfg.baseUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "ollama_unavailable: OLLAMA_URL is not configured on this deployment — the compliance chatbot requires a real Ollama endpoint",
    });
  }
  const host = hostOf(cfg.baseUrl);
  const model = opts?.model ?? cfg.model;
  const timeoutMs = opts?.timeoutMs ?? cfg.timeoutMs;
  const started = Date.now();

  let res: Awaited<ReturnType<typeof postJson>>;
  try {
    res = await postJson(
      `${cfg.baseUrl}/api/chat`,
      { model, messages, stream: false },
      timeoutMs
    );
  } catch (err) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ollama_unavailable: could not reach Ollama at ${host} (${err instanceof Error ? err.message : String(err)})`,
    });
  }
  if (!res.ok) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ollama_unavailable: Ollama at ${host} returned HTTP ${res.status}`,
    });
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ollama_unavailable: Ollama at ${host} returned a non-JSON response body`,
    });
  }
  const p = payload as {
    model?: unknown;
    message?: { content?: unknown };
  };
  const content = p?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ollama_unavailable: Ollama at ${host} returned a malformed chat payload (no message.content)`,
    });
  }
  return {
    content,
    model: typeof p.model === "string" ? p.model : model,
    durationMs: Date.now() - started,
  };
}

/** Exposed for honest status reporting (never used to fabricate answers). */
export function ollamaStatus():
  | { configured: false }
  | { configured: true; host: string; model: string } {
  const cfg = config();
  if (!cfg.baseUrl) return { configured: false };
  return { configured: true, host: hostOf(cfg.baseUrl), model: cfg.model };
}
