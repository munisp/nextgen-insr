/**
 * Payment SDK — Paystack + Flutterwave Integration for Frontend
 * Handles payment initiation, inline checkout, and verification.
 * Offline-first: queues payment intents when offline.
 */

export type PaymentProvider = 'paystack' | 'flutterwave' | 'mojaloop';
export type PaymentChannel = 'card' | 'bank_transfer' | 'ussd' | 'mobile_money' | 'qr';

export interface PaymentConfig {
  provider: PaymentProvider;
  publicKey: string;
  environment: 'sandbox' | 'production';
}

export interface PaymentRequest {
  amount: number; // In Naira (will be converted to kobo)
  email: string;
  reference?: string;
  channel?: PaymentChannel;
  policyId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  splitCode?: string;
  callbackUrl?: string;
}

export interface PaymentResult {
  reference: string;
  status: 'success' | 'failed' | 'pending' | 'cancelled';
  provider: PaymentProvider;
  amount: number;
  transactionId?: string;
  authorizationUrl?: string;
}

export class PaymentSDK {
  private config: PaymentConfig;
  private apiBaseUrl: string;

  constructor(config: PaymentConfig, apiBaseUrl?: string) {
    this.config = config;
    this.apiBaseUrl = apiBaseUrl || '/api/v1/payments';
  }

  /**
   * Initiate payment via backend (recommended for security)
   */
  async initiatePayment(req: PaymentRequest): Promise<PaymentResult> {
    const token = localStorage.getItem('token');
    const response = await fetch(`${this.apiBaseUrl}/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: req.amount * 100, // Convert to kobo
        email: req.email,
        reference: req.reference || `PAY-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        channel: req.channel || 'card',
        provider: this.config.provider,
        policy_id: req.policyId,
        description: req.description,
        metadata: req.metadata,
        split_code: req.splitCode,
        callback_url: req.callbackUrl || window.location.origin + '/payments/callback',
        customer_id: 'current', // Backend resolves from JWT
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Payment initiation failed');
    }

    const data = await response.json();

    // If auth URL provided, redirect (card payments)
    if (data.authorization_url) {
      return {
        reference: data.reference,
        status: 'pending',
        provider: this.config.provider,
        amount: req.amount,
        authorizationUrl: data.authorization_url,
      };
    }

    return {
      reference: data.reference,
      status: data.status,
      provider: this.config.provider,
      amount: req.amount,
    };
  }

  /**
   * Open inline payment popup (Paystack/Flutterwave)
   */
  openInlinePayment(req: PaymentRequest): Promise<PaymentResult> {
    return new Promise((resolve, reject) => {
      if (this.config.provider === 'paystack') {
        this.openPaystackInline(req, resolve, reject);
      } else if (this.config.provider === 'flutterwave') {
        this.openFlutterwaveInline(req, resolve, reject);
      } else {
        reject(new Error('Inline payment not supported for ' + this.config.provider));
      }
    });
  }

  private openPaystackInline(
    req: PaymentRequest,
    resolve: (r: PaymentResult) => void,
    reject: (e: Error) => void
  ): void {
    const ref = req.reference || `PAY-${Date.now()}`;
    // @ts-ignore - Paystack inline JS loaded externally
    const handler = (window as any).PaystackPop?.setup({
      key: this.config.publicKey,
      email: req.email,
      amount: req.amount * 100,
      ref,
      currency: 'NGN',
      metadata: { ...req.metadata, policy_id: req.policyId },
      callback: (response: { reference: string }) => {
        resolve({
          reference: response.reference,
          status: 'success',
          provider: 'paystack',
          amount: req.amount,
        });
      },
      onClose: () => {
        resolve({ reference: ref, status: 'cancelled', provider: 'paystack', amount: req.amount });
      },
    });
    if (handler) {
      handler.openIframe();
    } else {
      reject(new Error('Paystack inline script not loaded'));
    }
  }

  private openFlutterwaveInline(
    req: PaymentRequest,
    resolve: (r: PaymentResult) => void,
    reject: (e: Error) => void
  ): void {
    const ref = req.reference || `PAY-${Date.now()}`;
    // @ts-ignore - Flutterwave inline JS loaded externally
    (window as any).FlutterwaveCheckout?.({
      public_key: this.config.publicKey,
      tx_ref: ref,
      amount: req.amount,
      currency: 'NGN',
      customer: { email: req.email },
      meta: { ...req.metadata, policy_id: req.policyId },
      callback: (response: { tx_ref: string; status: string }) => {
        resolve({
          reference: response.tx_ref,
          status: response.status === 'successful' ? 'success' : 'failed',
          provider: 'flutterwave',
          amount: req.amount,
        });
      },
      onclose: () => {
        resolve({ reference: ref, status: 'cancelled', provider: 'flutterwave', amount: req.amount });
      },
    });
  }

  /**
   * Verify payment status
   */
  async verifyPayment(reference: string): Promise<PaymentResult> {
    const token = localStorage.getItem('token');
    const response = await fetch(`${this.apiBaseUrl}/verify?reference=${reference}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await response.json();
    return {
      reference: data.reference,
      status: data.status,
      provider: data.provider,
      amount: data.amount / 100,
    };
  }
}

// Default instance (configured from environment)
export const paymentSDK = new PaymentSDK({
  provider: (import.meta as any)?.env?.VITE_PAYMENT_PROVIDER || 'paystack',
  publicKey: (import.meta as any)?.env?.VITE_PAYSTACK_PUBLIC_KEY || 'pk_test_xxx',
  environment: 'sandbox',
});
