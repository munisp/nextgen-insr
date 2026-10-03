// 2026-10-01 (R1a): Real client for the platform monolith's tRPC API.
// 2026-10-03 (W8-B2): transport + config DELEGATED to @insureportal/channel-core
// (generalized from this very file — same superjson wire format, same
// fail-fast config, same PlatformUnavailableError semantics, plus an
// x-channel-service attribution header). What stays here is whatsapp-specific:
//   - loadPlatformConfig(env) binds serviceName="whatsapp-bot" so the
//     fail-closed error messages name this service exactly as before;
//   - PlatformClient gains the catalog procedures this bot's motor-quote flow
//     uses (listMotorProducts / calculatePremium).
// Every call honestly propagates failure (PlatformUnavailableError) — callers
// must fail closed and never invent data.
import {
  PlatformClient as CorePlatformClient,
  PlatformConfig,
  PlatformConfigError,
  PlatformUnavailableError,
  loadPlatformConfig as coreLoadPlatformConfig,
} from "@insureportal/channel-core";

export { PlatformConfig, PlatformConfigError, PlatformUnavailableError };

/** Fail-fast env config; service identity is fixed to this bot. */
export function loadPlatformConfig(
  env: NodeJS.ProcessEnv = process.env
): PlatformConfig {
  return coreLoadPlatformConfig("whatsapp-bot", env);
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

export class PlatformClient extends CorePlatformClient {
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
