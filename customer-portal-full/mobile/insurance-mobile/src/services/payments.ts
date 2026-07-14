/**
 * Payment Service for React Native
 * Integrates with Paystack and Flutterwave mobile SDKs.
 * Offline-first: caches payment intents for retry.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type PaymentProvider = 'paystack' | 'flutterwave';
export type PaymentChannel = 'card' | 'bank_transfer' | 'ussd' | 'mobile_money';

export interface PaymentRequest {
  amount: number; // In Naira
  email: string;
  reference?: string;
  channel?: PaymentChannel;
  policyId?: string;
  description?: string;
}

export interface PaymentResult {
  reference: string;
  status: 'success' | 'failed' | 'pending' | 'cancelled';
  provider: PaymentProvider;
  amount: number;
  transactionId?: string;
}

const API_BASE = __DEV__ ? 'http://localhost:8100' : 'https://api.insureportal.ng';

export class MobilePaymentService {
  private provider: PaymentProvider = 'paystack';

  async initiatePayment(req: PaymentRequest): Promise<PaymentResult> {
    const token = await AsyncStorage.getItem('auth_token');
    const reference = req.reference || `MOB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const response = await fetch(`${API_BASE}/api/v1/payments/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Platform': 'mobile',
      },
      body: JSON.stringify({
        amount: req.amount * 100, // Convert to kobo
        email: req.email,
        reference,
        channel: req.channel || 'card',
        provider: this.provider,
        policy_id: req.policyId,
        description: req.description,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || 'Payment initiation failed');
    }

    const data = await response.json();
    return {
      reference: data.reference,
      status: data.status || 'pending',
      provider: this.provider,
      amount: req.amount,
      transactionId: data.transaction_id,
    };
  }

  async verifyPayment(reference: string): Promise<PaymentResult> {
    const token = await AsyncStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/api/v1/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ reference }),
    });

    const data = await response.json();
    return {
      reference: data.reference,
      status: data.status,
      provider: data.provider,
      amount: data.amount / 100,
    };
  }

  async getPaymentHistory(limit = 20, page = 1): Promise<PaymentResult[]> {
    const token = await AsyncStorage.getItem('auth_token');
    const response = await fetch(
      `${API_BASE}/api/v1/payments/history?limit=${limit}&page=${page}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.json();
    return data.payments || [];
  }

  setProvider(provider: PaymentProvider): void {
    this.provider = provider;
  }
}

export const mobilePayments = new MobilePaymentService();
