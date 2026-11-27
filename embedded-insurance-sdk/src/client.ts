import axios, { AxiosInstance } from "axios";
import { v4 as uuidv4 } from "uuid";
import {
  EmbeddedConfig,
  InsuranceProduct,
  Quote,
  QuoteRequest,
  Policy,
  Claim,
  PaymentRequest,
} from "./types";

export class InsureTechInsurance {
  private http: AxiosInstance;
  private config: EmbeddedConfig;

  constructor(config: EmbeddedConfig) {
    this.config = config;
    const baseUrl =
      config.baseUrl ||
      (config.environment === "production"
        ? "https://api.insuretech.ng/v1"
        : "https://sandbox.insuretech.ng/v1");

    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        "X-API-Key": config.apiKey,
        "X-Partner-ID": config.partnerId,
        "X-Request-ID": uuidv4(),
        "Content-Type": "application/json",
      },
    });
  }

  async getProducts(type?: string): Promise<InsuranceProduct[]> {
    const params = type ? { type } : {};
    const { data } = await this.http.get("/products", { params });
    return data.products;
  }

  async getQuote(request: QuoteRequest): Promise<Quote> {
    const { data } = await this.http.post("/quotes", request);
    return data;
  }

  async purchasePolicy(quoteId: string, payment: PaymentRequest): Promise<Policy> {
    const { data } = await this.http.post("/policies", { quoteId, payment });
    return data;
  }

  async getPolicy(policyId: string): Promise<Policy> {
    const { data } = await this.http.get(`/policies/${policyId}`);
    return data;
  }

  async fileClaim(
    policyId: string,
    claim: { type: string; description: string; amount: number }
  ): Promise<Claim> {
    const { data } = await this.http.post(`/policies/${policyId}/claims`, claim);
    return data;
  }

  async getClaimStatus(claimId: string): Promise<Claim> {
    const { data } = await this.http.get(`/claims/${claimId}`);
    return data;
  }

  async cancelPolicy(policyId: string, reason: string): Promise<void> {
    await this.http.post(`/policies/${policyId}/cancel`, { reason });
  }
}
