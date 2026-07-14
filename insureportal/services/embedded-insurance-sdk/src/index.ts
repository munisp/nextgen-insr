/**
 * Embedded Insurance SDK
 * Enables third-party platforms (e-commerce, travel, fintech) to offer
 * insurance products within their existing user flows.
 */

interface EmbeddedConfig {
  apiKey: string;
  partnerId: string;
  environment: "sandbox" | "production";
  baseUrl?: string;
}

interface InsuranceOffer {
  offerId: string;
  productId: string;
  productName: string;
  premium: number;
  currency: string;
  coverageSummary: string;
  coverageAmount: number;
  duration: string;
  termsUrl: string;
}

interface PurchaseRequest {
  offerId: string;
  customerEmail: string;
  customerPhone: string;
  customerName: string;
  metadata?: Record<string, string>;
}

interface PurchaseResult {
  policyId: string;
  status: "active" | "pending_payment";
  certificateUrl: string;
  expiresAt: string;
}

class InsurePortalSDK {
  private config: EmbeddedConfig;
  private baseUrl: string;

  constructor(config: EmbeddedConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || (
      config.environment === "production"
        ? "https://api.insureportal.ng"
        : "https://sandbox.api.insureportal.ng"
    );
  }

  async getOffers(context: {
    category: string;
    itemValue?: number;
    customerAge?: number;
    destination?: string;
  }): Promise<InsuranceOffer[]> {
    const response = await fetch(`${this.baseUrl}/v1/embedded/offers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
        "X-Partner-ID": this.config.partnerId,
      },
      body: JSON.stringify(context),
    });

    if (!response.ok) {
      throw new Error(`Failed to get offers: ${response.status}`);
    }

    return response.json();
  }

  async purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const response = await fetch(`${this.baseUrl}/v1/embedded/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
        "X-Partner-ID": this.config.partnerId,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Purchase failed: ${response.status}`);
    }

    return response.json();
  }

  async getCertificate(policyId: string): Promise<{ url: string; expiresAt: string }> {
    const response = await fetch(`${this.baseUrl}/v1/embedded/policies/${policyId}/certificate`, {
      headers: {
        "X-API-Key": this.config.apiKey,
        "X-Partner-ID": this.config.partnerId,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get certificate: ${response.status}`);
    }

    return response.json();
  }

  async fileClaim(policyId: string, claim: {
    type: string;
    description: string;
    amount: number;
    evidence?: string[];
  }): Promise<{ claimId: string; status: string }> {
    const response = await fetch(`${this.baseUrl}/v1/embedded/policies/${policyId}/claims`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
        "X-Partner-ID": this.config.partnerId,
      },
      body: JSON.stringify(claim),
    });

    if (!response.ok) {
      throw new Error(`Claim filing failed: ${response.status}`);
    }

    return response.json();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Widget rendering for checkout pages
function renderInsuranceWidget(containerId: string, config: EmbeddedConfig & { category: string }): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="insureportal-widget" style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
      <h4 style="margin:0 0 8px;font-size:14px;color:#1f2937;">Protect your purchase</h4>
      <p style="margin:0;font-size:12px;color:#6b7280;">Loading insurance options...</p>
    </div>
  `;

  const sdk = new InsurePortalSDK(config);
  sdk.getOffers({ category: config.category }).then(offers => {
    if (offers.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = offers.map(offer => `
      <div class="insureportal-offer" style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;">
        <strong>${escapeHtml(offer.productName)}</strong> — ₦${Number(offer.premium).toLocaleString()}
        <p style="font-size:12px;color:#6b7280;">${escapeHtml(offer.coverageSummary)}</p>
        <button data-offer-id="${escapeHtml(offer.offerId)}" style="background:#3b82f6;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">
          Add Protection
        </button>
      </div>
    `).join("");
  });
}

export { InsurePortalSDK, renderInsuranceWidget };
export type { EmbeddedConfig, InsuranceOffer, PurchaseRequest, PurchaseResult };
