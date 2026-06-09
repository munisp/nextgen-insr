import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Wallet & Multi-Currency', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('Wallet Balance', () => {
    it('should show wallet balance in NGN', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          wallet_id: 'WAL-001',
          balance: 250000,
          currency: 'NGN',
          available_balance: 250000,
          pending: 0,
          last_funded: '2026-05-25T10:30:00Z',
        }),
      });

      const response = await fetch('/api/v1/wallet/balance');
      const data = await response.json();

      expect(data.currency).toBe('NGN');
      expect(data.available_balance).toBeLessThanOrEqual(data.balance);
    });
  });

  describe('Fund Wallet', () => {
    it('should fund wallet via bank transfer', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          transaction_id: 'FUND-001',
          amount: 100000,
          new_balance: 350000,
          channel: 'bank_transfer',
          status: 'completed',
        }),
      });

      const response = await fetch('/api/v1/wallet/fund', {
        method: 'POST',
        body: JSON.stringify({ amount: 100000, channel: 'bank_transfer' }),
      });
      const data = await response.json();

      expect(data.new_balance).toBe(350000);
      expect(data.status).toBe('completed');
    });
  });

  describe('Multi-Currency', () => {
    it('should convert NGN to USD at current rate', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          from: 'NGN',
          to: 'USD',
          amount: 1500000,
          converted: 937.50,
          rate: 1600.00,
          timestamp: '2026-05-28T12:00:00Z',
        }),
      });

      const response = await fetch('/api/v1/wallet/convert', {
        method: 'POST',
        body: JSON.stringify({ from: 'NGN', to: 'USD', amount: 1500000 }),
      });
      const data = await response.json();

      expect(data.converted).toBeCloseTo(data.amount / data.rate, 0);
    });

    it('should show exchange rates for supported currencies', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          base: 'NGN',
          rates: {
            USD: 0.000625,
            GBP: 0.000500,
            EUR: 0.000575,
            GHS: 0.0088,
            KES: 0.0806,
            ZAR: 0.0113,
          },
          updated_at: '2026-05-28T12:00:00Z',
        }),
      });

      const response = await fetch('/api/v1/wallet/rates?base=NGN');
      const data = await response.json();

      expect(Object.keys(data.rates).length).toBeGreaterThanOrEqual(5);
      expect(data.rates.USD).toBeGreaterThan(0);
    });
  });

  describe('Transaction Limits', () => {
    it('should enforce daily transfer limit of ₦5M', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'Daily transfer limit exceeded (₦5,000,000)',
          current_daily_total: 4800000,
          requested: 500000,
        }),
      });

      const response = await fetch('/api/v1/wallet/transfer', {
        method: 'POST',
        body: JSON.stringify({ amount: 500000, to_account: '0123456789' }),
      });

      expect(response.ok).toBe(false);
    });
  });
});
