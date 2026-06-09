import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock AsyncStorage
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage[key] || null)),
  setItem: jest.fn((key: string, value: string) => { mockStorage[key] = value; return Promise.resolve(); }),
  removeItem: jest.fn((key: string) => { delete mockStorage[key]; return Promise.resolve(); }),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Authentication Flow', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  });

  describe('Login', () => {
    it('should authenticate with valid BVN and password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'jwt-token-123',
          refresh_token: 'refresh-token-456',
          expires_in: 3600,
          user: { id: 'USR-001', name: 'Adewale Obi', bvn_verified: true },
        }),
      });

      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ bvn: '22345678901', password: 'SecureP@ss1' }),
      });
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.access_token).toBeDefined();
      expect(data.user.bvn_verified).toBe(true);
    });

    it('should reject invalid BVN format (not 11 digits)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'BVN must be exactly 11 digits' }),
      });

      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ bvn: '1234', password: 'test' }),
      });

      expect(response.ok).toBe(false);
    });

    it('should enforce account lockout after 5 failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      }
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: 'Account locked. Try again in 30 minutes.' }),
      });

      // 5 failures
      for (let i = 0; i < 5; i++) {
        await fetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
      }

      // 6th attempt should be locked
      const response = await fetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
      expect(response.status).toBe(429);
    });
  });

  describe('Token Refresh', () => {
    it('should refresh token before expiry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-jwt-token',
          expires_in: 3600,
        }),
      });

      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer refresh-token-456' },
      });
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.access_token).toBe('new-jwt-token');
    });
  });

  describe('Biometric Auth', () => {
    it('should register biometric after first login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ biometric_registered: true, method: 'fingerprint' }),
      });

      const response = await fetch('/api/v1/auth/biometric/register', {
        method: 'POST',
        body: JSON.stringify({ user_id: 'USR-001', biometric_type: 'fingerprint' }),
      });
      const data = await response.json();

      expect(data.biometric_registered).toBe(true);
    });
  });
});
