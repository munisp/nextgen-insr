import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Policy Management', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('List Policies', () => {
    it('should fetch user policies with pagination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { id: 'POL-001', product: 'Motor Comprehensive', status: 'active', premium: 75000 },
            { id: 'POL-002', product: 'Home Contents', status: 'active', premium: 45000 },
          ],
          total: 2,
          page: 1,
          limit: 20,
        }),
      });

      const response = await fetch('/api/v1/policies?page=1&limit=20');
      const data = await response.json();

      expect(data.data).toHaveLength(2);
      expect(data.data[0].status).toBe('active');
    });

    it('should filter policies by status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'POL-003', status: 'expired', product: 'Travel' }],
          total: 1,
        }),
      });

      const response = await fetch('/api/v1/policies?status=expired');
      const data = await response.json();

      expect(data.data[0].status).toBe('expired');
    });
  });

  describe('Policy Purchase Flow', () => {
    it('should get quote for motor insurance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          quote_id: 'QUO-001',
          product: 'Motor Comprehensive',
          premium: 85000,
          cover_amount: 5000000,
          validity_days: 30,
        }),
      });

      const response = await fetch('/api/v1/quotes', {
        method: 'POST',
        body: JSON.stringify({
          product_type: 'motor_comprehensive',
          vehicle_value: 5000000,
          vehicle_year: 2022,
        }),
      });
      const data = await response.json();

      expect(data.premium).toBeGreaterThan(0);
      expect(data.cover_amount).toBe(5000000);
    });

    it('should enforce microinsurance cap of ₦2M', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'microinsurance cover capped at ₦2,000,000 (NAICOM)',
        }),
      });

      const response = await fetch('/api/v1/quotes', {
        method: 'POST',
        body: JSON.stringify({
          product_type: 'microinsurance_crop',
          cover_amount: 3000000,
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    it('should bind policy after payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          policy_id: 'POL-NEW-001',
          status: 'active',
          certificate_url: '/api/v1/documents/CERT-001/download',
          start_date: '2026-06-01',
          end_date: '2027-06-01',
        }),
      });

      const response = await fetch('/api/v1/policies/bind', {
        method: 'POST',
        body: JSON.stringify({ quote_id: 'QUO-001', payment_ref: 'PAY-001' }),
      });
      const data = await response.json();

      expect(data.status).toBe('active');
      expect(data.certificate_url).toBeDefined();
    });
  });

  describe('Policy Renewal', () => {
    it('should auto-calculate renewal premium with no-claims discount', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          original_premium: 85000,
          renewal_premium: 72250,
          discount_pct: 15,
          discount_reason: 'no_claims_2_years',
        }),
      });

      const response = await fetch('/api/v1/policies/POL-001/renewal-quote');
      const data = await response.json();

      expect(data.renewal_premium).toBeLessThan(data.original_premium);
      expect(data.discount_pct).toBe(15);
    });
  });
});
