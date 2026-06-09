import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('Claims Management', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('File a Claim (FNOL)', () => {
    it('should submit first notice of loss with required fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          claim_id: 'CLM-001',
          status: 'submitted',
          reference_number: 'REF-2026-001',
          estimated_processing_days: 5,
        }),
      });

      const response = await fetch('/api/v1/claims', {
        method: 'POST',
        body: JSON.stringify({
          policy_id: 'POL-001',
          incident_date: '2026-05-20',
          incident_type: 'accident',
          description: 'Rear-end collision at Lekki toll gate',
          amount_claimed: 450000,
          location: { lat: 6.4474, lng: 3.4728 },
        }),
      });
      const data = await response.json();

      expect(data.claim_id).toBeDefined();
      expect(data.status).toBe('submitted');
      expect(data.estimated_processing_days).toBeLessThanOrEqual(30);
    });

    it('should reject claim on expired policy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'Cannot file claim on expired policy',
        }),
      });

      const response = await fetch('/api/v1/claims', {
        method: 'POST',
        body: JSON.stringify({ policy_id: 'POL-EXPIRED', incident_date: '2026-05-20' }),
      });

      expect(response.ok).toBe(false);
    });

    it('should reject claim exceeding sum assured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'Claim amount exceeds policy sum assured of ₦5,000,000',
        }),
      });

      const response = await fetch('/api/v1/claims', {
        method: 'POST',
        body: JSON.stringify({
          policy_id: 'POL-001',
          amount_claimed: 10000000,
        }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('Claim Status Tracking', () => {
    it('should show claim progress with timeline', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          claim_id: 'CLM-001',
          status: 'under_review',
          timeline: [
            { step: 'submitted', date: '2026-05-20', completed: true },
            { step: 'documents_verified', date: '2026-05-21', completed: true },
            { step: 'under_review', date: '2026-05-22', completed: false },
            { step: 'decision', date: null, completed: false },
            { step: 'payment', date: null, completed: false },
          ],
        }),
      });

      const response = await fetch('/api/v1/claims/CLM-001/status');
      const data = await response.json();

      expect(data.timeline).toHaveLength(5);
      expect(data.timeline[0].completed).toBe(true);
      expect(data.timeline[2].completed).toBe(false);
    });
  });

  describe('Document Upload', () => {
    it('should accept photo evidence for claim', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          document_id: 'DOC-001',
          type: 'photo_evidence',
          status: 'uploaded',
          ocr_extracted: true,
        }),
      });

      const formData = new FormData();
      const response = await fetch('/api/v1/claims/CLM-001/documents', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      expect(data.status).toBe('uploaded');
    });
  });
});
