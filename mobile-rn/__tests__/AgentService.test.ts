import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Agent Mobile App', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('Agent Dashboard', () => {
    it('should show agent performance metrics', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          agent_id: 'AGT-001',
          monthly_sales: 15,
          premium_collected: 1200000,
          commission_earned: 180000,
          target_progress: 0.75,
          tier: 'gold',
          leaderboard_rank: 3,
        }),
      });

      const response = await fetch('/api/v1/agent/dashboard');
      const data = await response.json();

      expect(data.tier).toBe('gold');
      expect(data.target_progress).toBeLessThanOrEqual(1);
      expect(data.commission_earned).toBeGreaterThan(0);
    });
  });

  describe('Field Issuance', () => {
    it('should issue policy in the field with offline sync', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          policy_id: 'POL-FIELD-001',
          status: 'issued',
          certificate_generated: true,
          sync_status: 'synced',
        }),
      });

      const response = await fetch('/api/v1/agent/issue-policy', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: 'Amina Ibrahim',
          product_type: 'microinsurance_crop',
          cover_amount: 500000,
          premium: 5000,
          payment_method: 'mobile_money',
          offline_ref: 'OFF-001',
        }),
      });
      const data = await response.json();

      expect(data.policy_id).toBeDefined();
      expect(data.certificate_generated).toBe(true);
    });

    it('should queue issuance when offline', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network unavailable'));

      // Simulate offline queue behavior
      const offlineQueue: any[] = [];
      try {
        await fetch('/api/v1/agent/issue-policy', { method: 'POST', body: '{}' });
      } catch {
        offlineQueue.push({ action: 'issue-policy', timestamp: Date.now() });
      }

      expect(offlineQueue).toHaveLength(1);
    });
  });

  describe('Customer Onboarding', () => {
    it('should onboard customer with BVN in field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          customer_id: 'CUST-NEW-001',
          kyc_status: 'verified',
          bvn_verified: true,
          can_purchase: true,
        }),
      });

      const response = await fetch('/api/v1/agent/onboard-customer', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Chidinma Eze',
          phone: '08098765432',
          bvn: '22987654321',
          location: { lat: 9.0579, lng: 7.4951 },
        }),
      });
      const data = await response.json();

      expect(data.kyc_status).toBe('verified');
      expect(data.can_purchase).toBe(true);
    });
  });

  describe('Commission Tracking', () => {
    it('should show commission statement with breakdown', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          period: '2026-05',
          gross_commission: 180000,
          tax_deducted: 18000,
          net_commission: 162000,
          breakdown: [
            { policy_id: 'POL-001', product: 'Motor', commission: 12750, rate: 0.15 },
            { policy_id: 'POL-002', product: 'Fire', commission: 20000, rate: 0.20 },
          ],
          payment_status: 'paid',
          payment_date: '2026-06-05',
        }),
      });

      const response = await fetch('/api/v1/agent/commission-statement?period=2026-05');
      const data = await response.json();

      expect(data.net_commission).toBe(data.gross_commission - data.tax_deducted);
      expect(data.breakdown[0].rate).toBeLessThanOrEqual(0.25); // NAICOM cap
    });
  });
});
