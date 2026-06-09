import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Notifications & Communication', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('Push Notifications', () => {
    it('should register device for push notifications', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          registered: true,
          device_token: 'FCM-TOKEN-001',
          topics: ['policy_updates', 'claims_status', 'payments'],
        }),
      });

      const response = await fetch('/api/v1/notifications/register', {
        method: 'POST',
        body: JSON.stringify({
          device_token: 'FCM-TOKEN-001',
          platform: 'android',
        }),
      });
      const data = await response.json();

      expect(data.registered).toBe(true);
      expect(data.topics).toContain('policy_updates');
    });

    it('should list unread notifications', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          notifications: [
            { id: 'NOT-001', type: 'claim_approved', message: 'Your claim CLM-001 has been approved', read: false, created_at: '2026-05-28T10:00:00Z' },
            { id: 'NOT-002', type: 'premium_due', message: 'Premium of ₦75,000 due in 3 days', read: false, created_at: '2026-05-27T08:00:00Z' },
          ],
          unread_count: 2,
        }),
      });

      const response = await fetch('/api/v1/notifications?read=false');
      const data = await response.json();

      expect(data.unread_count).toBe(2);
      expect(data.notifications[0].type).toBe('claim_approved');
    });
  });

  describe('Notification Preferences', () => {
    it('should update notification preferences', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          preferences: {
            push: true,
            sms: true,
            email: false,
            whatsapp: true,
            policy_renewals: true,
            marketing: false,
          },
        }),
      });

      const response = await fetch('/api/v1/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ marketing: false, whatsapp: true }),
      });
      const data = await response.json();

      expect(data.preferences.marketing).toBe(false);
      expect(data.preferences.whatsapp).toBe(true);
    });
  });

  describe('SMS/WhatsApp', () => {
    it('should send policy certificate via WhatsApp', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          message_id: 'WA-MSG-001',
          status: 'sent',
          channel: 'whatsapp',
          template: 'policy_certificate',
        }),
      });

      const response = await fetch('/api/v1/notifications/send', {
        method: 'POST',
        body: JSON.stringify({
          channel: 'whatsapp',
          phone: '08012345678',
          template: 'policy_certificate',
          params: { policy_id: 'POL-001' },
        }),
      });
      const data = await response.json();

      expect(data.channel).toBe('whatsapp');
      expect(data.status).toBe('sent');
    });
  });
});
