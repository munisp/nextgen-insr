// 2026-10-01 (R1a): Real client for the platform monolith's tRPC API.
// Replaces the fabricated claim refs / payment receipts / policy statuses
// that this service previously invented locally. Configuration is read once
// at startup and is FAIL-FAST: PLATFORM_API_URL has no localhost default and
// PLATFORM_SERVICE_TOKEN is required. Every call honestly propagates failure
// (PlatformUnavailableError) — callers must fail closed and never invent data.

export interface PlatformConfig {
  baseUrl: string;
  serviceToken: string;
  timeoutMs: number;
}

export class PlatformConfigError extends Error {}

export class PlatformUnavailableError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "PlatformUnavailableError";
    this.statusCode = statusCode;
  }
}

export function loadPlatformConfig(
  env: NodeJS.ProcessEnv = process.env
): PlatformConfig {
  const rawUrl = (env.PLATFORM_API_URL ?? "").trim();
  if (!rawUrl) {
    // Fail-fast: no silent localhost fallback in production code.
    throw new PlatformConfigError(
      "PLATFORM_API_URL is not configured — whatsapp-bot cannot reach the " +
        "platform API and must not start (fail-closed)."
    );
  }
  const serviceToken = (env.PLATFORM_SERVICE_TOKEN ?? "").trim();
  if (!serviceToken) {
    throw new PlatformConfigError(
      "PLATFORM_SERVICE_TOKEN is not configured — whatsapp-bot cannot " +
        "authenticate to the platform API and must not start (fail-closed)."
    );
  }
  const timeoutMs = Number(env.PLATFORM_API_TIMEOUT_MS ?? 8000);
  return {
    baseUrl: rawUrl.replace(/\/+$/, ""),
    serviceToken,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000,
  };
}

export interface CatalogProduct {
  id: number;
  name: string | null;
  minPremium: string | null;
  maxCoverageAmount: string | null;
}

export interface PremiumCalculation {
  // Shape returned by insuranceProductCatalog.calculatePremium (superjson
  // `json` payload). We only rely on fields actually produced by the server.
  premium?: number;
  annualPremium?: number;
  currency?: string;
  [key: string]: unknown;
}

export class PlatformClient {
  private readonly cfg: PlatformConfig;

  constructor(cfg: PlatformConfig) {
    this.cfg = cfg;
  }

  /** GET-style tRPC query against /api/trpc/<procedure> (superjson wire format). */
  private async query<T>(procedure: string, input: unknown): Promise<T> {
    const url =
      `${this.cfg.baseUrl}/api/trpc/${procedure}` +
      `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.cfg.serviceToken}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new PlatformUnavailableError(
        `platform unreachable for ${procedure}: ${
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

  /** List active motor insurance products from the real catalog. */
  async listMotorProducts(): Promise<CatalogProduct[]> {
    const result = await this.query<{ data: CatalogProduct[]; total: number }>(
      "insuranceProductCatalog.listProducts",
      { productType: "motor", isActive: true, limit: 5, offset: 0 }
    );
    if (!result || !Array.isArray(result.data)) {
      throw new PlatformUnavailableError(
        "platform catalog returned an unexpected shape"
      );
    }
    return result.data;
  }

  /** Compute a real premium quote for a product + sum insured. */
  async calculatePremium(
    productId: number,
    sumInsured: number
  ): Promise<PremiumCalculation> {
    return this.query<PremiumCalculation>(
      "insuranceProductCatalog.calculatePremium",
      { productId, sumInsured, durationMonths: 12, coverageType: "motor" }
    );
  }
}
