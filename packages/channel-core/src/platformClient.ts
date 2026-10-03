// 2026-10-03 (W8-B1): tRPC client factory for the platform monolith's member
// routers, generalized from whatsapp-bot/src/clients/platform.ts (R1a).
// Configuration is FAIL-FAST: the base URL has no localhost default and the
// service token is required. Every call honestly propagates failure
// (PlatformUnavailableError) — callers must fail closed and never invent data.
//
// Wire format: superjson over the monolith's /api/trpc/<procedure> endpoint
// (GET for queries, POST for mutations), Bearer service-token auth.

export interface PlatformConfig {
  baseUrl: string;
  serviceToken: string;
  timeoutMs: number;
  /** Caller identity for logs/headers, e.g. "whatsapp-bot", "ussd-gateway". */
  serviceName: string;
}

export class PlatformConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformConfigError";
  }
}

export class PlatformUnavailableError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "PlatformUnavailableError";
    this.statusCode = statusCode;
  }
}

// 2026-10-03 (W8-B7): sane-bounds for the request timeout. Values outside
// this range are a config error, not something to silently coerce.
export const PLATFORM_TIMEOUT_MIN_MS = 100;
export const PLATFORM_TIMEOUT_MAX_MS = 120_000;
export const PLATFORM_TIMEOUT_DEFAULT_MS = 8000;

/**
 * Validate a fully-formed config object (fail-closed at construction so a
 * bad config never defers to a first-call failure). Throws
 * PlatformConfigError naming the exact problem. Returns the normalized cfg.
 */
export function validatePlatformConfig(cfg: PlatformConfig): PlatformConfig {
  if (!cfg || typeof cfg !== "object") {
    throw new PlatformConfigError("platform config is missing entirely");
  }
  const name = (cfg.serviceName ?? "").trim();
  if (!name) {
    throw new PlatformConfigError(
      "platform config has no serviceName — the platform API could not " +
        "attribute this caller (fail-closed)."
    );
  }
  const rawUrl = (cfg.baseUrl ?? "").trim();
  if (!rawUrl) {
    throw new PlatformConfigError(
      `platform baseUrl is not configured — ${name} cannot reach the ` +
        "platform API and must not start (fail-closed)."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PlatformConfigError(
      `platform baseUrl for ${name} is not a valid URL: ${JSON.stringify(rawUrl)}`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PlatformConfigError(
      `platform baseUrl for ${name} must be http(s), got ` +
        JSON.stringify(parsed.protocol)
    );
  }
  if (!(cfg.serviceToken ?? "").trim()) {
    throw new PlatformConfigError(
      `platform serviceToken is not configured — ${name} cannot ` +
        "authenticate to the platform API and must not start (fail-closed)."
    );
  }
  if (
    typeof cfg.timeoutMs !== "number" ||
    !Number.isFinite(cfg.timeoutMs) ||
    cfg.timeoutMs < PLATFORM_TIMEOUT_MIN_MS ||
    cfg.timeoutMs > PLATFORM_TIMEOUT_MAX_MS
  ) {
    throw new PlatformConfigError(
      `platform timeoutMs for ${name} must be a number in ` +
        `[${PLATFORM_TIMEOUT_MIN_MS}, ${PLATFORM_TIMEOUT_MAX_MS}], got ` +
        JSON.stringify(cfg.timeoutMs)
    );
  }
  return {
    ...cfg,
    baseUrl: rawUrl.replace(/\/+$/, ""),
    serviceName: name,
    serviceToken: cfg.serviceToken.trim(),
  };
}

/**
 * Load config from env, fail-fast. `serviceName` identifies the caller in
 * error messages and the x-channel-service header so the monolith can
 * attribute traffic per channel bot.
 */
export function loadPlatformConfig(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env
): PlatformConfig {
  const rawUrl = (env.PLATFORM_API_URL ?? "").trim();
  if (!rawUrl) {
    // Fail-fast: no silent localhost fallback in production code.
    throw new PlatformConfigError(
      `PLATFORM_API_URL is not configured — ${serviceName} cannot reach the ` +
        "platform API and must not start (fail-closed)."
    );
  }
  const serviceToken = (env.PLATFORM_SERVICE_TOKEN ?? "").trim();
  if (!serviceToken) {
    throw new PlatformConfigError(
      `PLATFORM_SERVICE_TOKEN is not configured — ${serviceName} cannot ` +
        "authenticate to the platform API and must not start (fail-closed)."
    );
  }
  // 2026-10-03 (W8-B7): an explicitly-set but invalid timeout is now a loud
  // config error instead of a silent fallback to the default.
  const rawTimeout = (env.PLATFORM_API_TIMEOUT_MS ?? "").trim();
  let timeoutMs = PLATFORM_TIMEOUT_DEFAULT_MS;
  if (rawTimeout) {
    const n = Number(rawTimeout);
    if (
      !Number.isFinite(n) ||
      n < PLATFORM_TIMEOUT_MIN_MS ||
      n > PLATFORM_TIMEOUT_MAX_MS
    ) {
      throw new PlatformConfigError(
        `PLATFORM_API_TIMEOUT_MS=${JSON.stringify(rawTimeout)} is invalid — ` +
          `must be a number in [${PLATFORM_TIMEOUT_MIN_MS}, ${PLATFORM_TIMEOUT_MAX_MS}] ` +
          `(fail-closed; ${serviceName} must not start with a guessed timeout).`
      );
    }
    timeoutMs = n;
  }
  // validatePlatformConfig normalizes (trailing slashes, whitespace) and
  // re-checks every field, so this path and the DI path share one contract.
  return validatePlatformConfig({
    baseUrl: rawUrl,
    serviceToken,
    timeoutMs,
    serviceName,
  });
}

/** Factory for callers that already hold config (tests, DI containers). */
export function createPlatformClient(cfg: PlatformConfig): PlatformClient {
  return new PlatformClient(cfg);
}

export class PlatformClient {
  private readonly cfg: PlatformConfig;

  constructor(cfg: PlatformConfig) {
    // 2026-10-03 (W8-B7): validate at construction (fail-closed) so a
    // misconfigured client throws here, not on the first call.
    this.cfg = validatePlatformConfig(cfg);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.serviceToken}`,
      "content-type": "application/json",
      "x-channel-service": this.cfg.serviceName,
    };
  }

  private async request<T>(
    procedure: string,
    input: unknown,
    method: "GET" | "POST"
  ): Promise<T> {
    const base = `${this.cfg.baseUrl}/api/trpc/${procedure}`;
    const url =
      method === "GET"
        ? `${base}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
        : base;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers: this.headers(),
        ...(method === "POST"
          ? { body: JSON.stringify({ json: input }) }
          : {}),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new PlatformUnavailableError(
        `platform unreachable for ${procedure} (${this.cfg.serviceName}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    if (!resp.ok) {
      throw new PlatformUnavailableError(
        `platform rejected ${procedure} with HTTP ${resp.status}`,
        resp.status
      );
    }
    let body: any;
    try {
      body = await resp.json();
    } catch {
      throw new PlatformUnavailableError(
        `platform returned non-JSON for ${procedure}`
      );
    }
    if (body?.error) {
      throw new PlatformUnavailableError(
        `platform error for ${procedure}: ${JSON.stringify(body.error).slice(0, 300)}`
      );
    }
    // superjson: { result: { data: { json: ... } } }
    return body?.result?.data?.json as T;
  }

  /** GET-style tRPC query against /api/trpc/<procedure>. */
  query<T>(procedure: string, input: unknown): Promise<T> {
    return this.request<T>(procedure, input, "GET");
  }

  /** POST-style tRPC mutation against /api/trpc/<procedure>. */
  mutate<T>(procedure: string, input: unknown): Promise<T> {
    return this.request<T>(procedure, input, "POST");
  }
}
