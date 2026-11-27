import { InsureTechInsurance } from "../client";
import { Quote, PaymentMethod, EmbeddedConfig } from "../types";

export class CheckoutFlow {
  private client: InsureTechInsurance;
  private config: EmbeddedConfig;

  constructor(config: EmbeddedConfig) {
    this.config = config;
    this.client = new InsureTechInsurance(config);
  }

  generateCheckoutHTML(quote: Quote): string {
    const primaryColor = this.config.theme?.primaryColor || "#1a73e8";

    return `
      <div id="insuretech-checkout" style="
        font-family: system-ui, sans-serif;
        max-width: 480px;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        padding: 24px;
        background: white;
      ">
        <h3 style="margin: 0 0 16px 0;">Complete Your Purchase</h3>

        <div style="background: #f0f7ff; padding: 12px; border-radius: 8px; margin-bottom: 16px;">
          <strong>Premium: &#x20A6;${quote.breakdown.total.toLocaleString()}</strong>
          <span style="color: #666;"> / ${quote.premiumFrequency}</span>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 600; margin-bottom: 8px;">Payment Method</label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button data-method="mobile_money" style="padding: 12px; border: 2px solid ${primaryColor}; border-radius: 8px; background: white; cursor: pointer;">
              &#x1F4F1; Mobile Money
            </button>
            <button data-method="bank_transfer" style="padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer;">
              &#x1F3E6; Bank Transfer
            </button>
            <button data-method="card" style="padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer;">
              &#x1F4B3; Debit Card
            </button>
            <button data-method="ussd" style="padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; background: white; cursor: pointer;">
              &#x260E; USSD
            </button>
          </div>
        </div>

        <div id="mobile-money-fields" style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 600; margin-bottom: 4px;">Mobile Number</label>
          <input type="tel" placeholder="+234 800 000 0000" style="width: 100%; padding: 10px; border: 1px solid #e0e0e0; border-radius: 8px; box-sizing: border-box;" />
          <label style="display: block; font-weight: 600; margin-top: 8px; margin-bottom: 4px;">Provider</label>
          <select style="width: 100%; padding: 10px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <option value="opay">OPay</option>
            <option value="palmpay">PalmPay</option>
            <option value="mtn_momo">MTN MoMo</option>
            <option value="airtel_money">Airtel Money</option>
          </select>
        </div>

        <button style="
          width: 100%; padding: 14px;
          background: ${primaryColor}; color: white;
          border: none; border-radius: 8px;
          font-size: 16px; font-weight: 600; cursor: pointer;
        ">
          Pay &#x20A6;${quote.breakdown.total.toLocaleString()}
        </button>
      </div>
    `;
  }

  async processPayment(quoteId: string, method: PaymentMethod, details: Record<string, string>) {
    return this.client.purchasePolicy(quoteId, {
      quoteId,
      method,
      mobileNumber: details.mobileNumber,
      provider: details.provider,
    });
  }
}
