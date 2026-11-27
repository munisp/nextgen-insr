import { InsureTechInsurance } from "../client";
import { InsuranceProduct, Quote, EmbeddedConfig } from "../types";

export class QuoteWidget {
  private client: InsureTechInsurance;
  private config: EmbeddedConfig;

  constructor(config: EmbeddedConfig) {
    this.config = config;
    this.client = new InsureTechInsurance(config);
  }

  generateHTML(product: InsuranceProduct, quote: Quote): string {
    const primaryColor = this.config.theme?.primaryColor || "#1a73e8";
    const fontFamily = this.config.theme?.fontFamily || "system-ui, sans-serif";
    const borderRadius = this.config.theme?.borderRadius || "12px";

    return `
      <div id="insuretech-quote-widget" style="
        font-family: ${fontFamily};
        max-width: 400px;
        border: 1px solid #e0e0e0;
        border-radius: ${borderRadius};
        padding: 24px;
        background: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      ">
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="
            width: 40px; height: 40px;
            background: ${primaryColor};
            border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            color: white; font-size: 20px; margin-right: 12px;
          ">&#x1F6E1;</div>
          <div>
            <div style="font-weight: 600; font-size: 16px;">${product.name}</div>
            <div style="color: #666; font-size: 13px;">${product.description}</div>
          </div>
        </div>

        <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #666;">Base Premium</span>
            <span>&#x20A6;${quote.breakdown.basePremium.toLocaleString()}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #666;">VAT (7.5%)</span>
            <span>&#x20A6;${quote.breakdown.tax.toLocaleString()}</span>
          </div>
          ${quote.breakdown.discount > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #22c55e;">Discount</span>
            <span style="color: #22c55e;">-&#x20A6;${quote.breakdown.discount.toLocaleString()}</span>
          </div>` : ""}
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 8px 0;" />
          <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 18px;">
            <span>Total</span>
            <span style="color: ${primaryColor};">&#x20A6;${quote.breakdown.total.toLocaleString()}/${quote.premiumFrequency}</span>
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 8px;">Coverage: &#x20A6;${quote.coverage.toLocaleString()}</div>
          ${product.features.map(f => `<div style="color: #666; font-size: 13px; padding: 2px 0;">&#x2713; ${f}</div>`).join("")}
        </div>

        <button
          onclick="window.InsureTechCheckout && window.InsureTechCheckout('${quote.id}')"
          style="
            width: 100%;
            padding: 12px;
            background: ${primaryColor};
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
          "
        >
          Get Covered Now
        </button>

        <div style="text-align: center; margin-top: 8px; color: #999; font-size: 11px;">
          Powered by InsureTech Insurance
        </div>
      </div>
    `;
  }
}
