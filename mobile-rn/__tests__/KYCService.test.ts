import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('KYC/KYB Verification', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('BVN Verification', () => {
    it('should verify valid BVN and return customer data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          bvn_verified: true,
          name: 'ADEWALE OGUNDIMU',
          dob: '1990-03-15',
          phone_match: true,
          watchlist_clear: true,
        }),
      });

      const response = await fetch('/api/v1/kyc/bvn/verify', {
        method: 'POST',
        body: JSON.stringify({ bvn: '22345678901', phone: '08012345678' }),
      });
      const data = await response.json();

      expect(data.bvn_verified).toBe(true);
      expect(data.phone_match).toBe(true);
    });

    it('should reject invalid BVN (not 11 digits)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'BVN must be exactly 11 digits' }),
      });

      const response = await fetch('/api/v1/kyc/bvn/verify', {
        method: 'POST',
        body: JSON.stringify({ bvn: '123' }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('NIN Verification', () => {
    it('should verify NIN with photo match', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          nin_verified: true,
          photo_match_score: 0.92,
          name_match: true,
        }),
      });

      const response = await fetch('/api/v1/kyc/nin/verify', {
        method: 'POST',
        body: JSON.stringify({ nin: '12345678901', selfie_base64: 'abc...' }),
      });
      const data = await response.json();

      expect(data.nin_verified).toBe(true);
      expect(data.photo_match_score).toBeGreaterThan(0.8);
    });
  });

  describe('Document Verification', () => {
    it('should extract data from drivers license via OCR', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          document_type: 'drivers_license',
          extracted: {
            name: 'ADEWALE OGUNDIMU',
            license_number: 'AAA12345AB12',
            expiry_date: '2028-03-15',
            class: 'B',
          },
          ocr_confidence: 0.95,
          valid: true,
        }),
      });

      const response = await fetch('/api/v1/kyc/document/verify', {
        method: 'POST',
        body: JSON.stringify({ document_type: 'drivers_license', image_base64: '...' }),
      });
      const data = await response.json();

      expect(data.extracted.license_number).toBeDefined();
      expect(data.ocr_confidence).toBeGreaterThan(0.8);
    });
  });

  describe('Liveness Check', () => {
    it('should pass liveness detection with video selfie', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          liveness_passed: true,
          confidence: 0.97,
          spoofing_detected: false,
        }),
      });

      const response = await fetch('/api/v1/kyc/liveness', {
        method: 'POST',
        body: JSON.stringify({ video_frames: ['frame1', 'frame2', 'frame3'] }),
      });
      const data = await response.json();

      expect(data.liveness_passed).toBe(true);
      expect(data.spoofing_detected).toBe(false);
    });
  });

  describe('Watchlist Screening', () => {
    it('should screen against PEP and sanctions lists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          screened: true,
          pep_match: false,
          sanctions_match: false,
          adverse_media: false,
          risk_level: 'low',
        }),
      });

      const response = await fetch('/api/v1/kyc/watchlist', {
        method: 'POST',
        body: JSON.stringify({ name: 'Adewale Ogundimu', dob: '1990-03-15' }),
      });
      const data = await response.json();

      expect(data.pep_match).toBe(false);
      expect(data.risk_level).toBe('low');
    });
  });
});
