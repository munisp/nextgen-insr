// 2026-10-03 (W8-B4): Real client for the platform monolith's tRPC API,
// following the whatsapp-bot W8-B2 pattern. Transport + config are DELEGATED
// to @insureportal/channel-core (same superjson wire format, same fail-fast
// config, same PlatformUnavailableError semantics, plus an x-channel-service
// attribution header). What stays here is ai-chatbot-specific:
//   - loadPlatformConfig(env) binds serviceName="ai-chatbot" so fail-closed
//     error messages name this service;
//   - PlatformClient exposes ONLY the procedures that are member-safe for
//     this unauthenticated chat surface: insuranceProductCatalog.listProducts
//     is a serviceOrUserProcedure (catalog data, no member PII). Member-scoped
//     procedures (policy lookup, claim filing/status, premium payment) are
//     protectedProcedure and require member auth this service does not have —
//     those intents stay honest-unavailable (see engine/chat.ts).
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

/** Fail-fast env config; service identity is fixed to this service. */
export function loadPlatformConfig(
  env: NodeJS.ProcessEnv = process.env
): PlatformConfig {
  return coreLoadPlatformConfig("ai-chatbot", env);
}

export interface CatalogProduct {
  id: number;
  name: string | null;
  minPremium: string | null;
  maxCoverageAmount: string | null;
}

export class PlatformClient extends CorePlatformClient {
  /** List active insurance products of a type from the real catalog. */
  async listProducts(productType: string): Promise<CatalogProduct[]> {
    const result = await this.query<{ data: CatalogProduct[]; total: number }>(
      "insuranceProductCatalog.listProducts",
      { productType, isActive: true, limit: 5, offset: 0 }
    );
    if (!result || !Array.isArray(result.data)) {
      throw new PlatformUnavailableError(
        "platform catalog returned an unexpected shape"
      );
    }
    return result.data;
  }
}
