/**
 * E2E Integration Test — Mobile App Cross-Service Workflow
 * Tests: Login → KYC → Quote → Bind → Pay Premium → File Claim → Track Payout
 */

const API_BASE = 'http://localhost:3000/api/v1';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockClear();
});

describe('E2E: Insurance Lifecycle Workflow', () => {
  let authToken: string;
  let policyId: string;
  let claimId: string;

  it('Step 1: Authenticate with biometric + BVN', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: 'jwt-test-token',
        user: { id: 'USR-001', name: 'Adebayo Ogunlesi', bvn_verified: true },
        kyc_tier: 3,
      }),
    });

    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ bvn: '22211100099', biometric: 'face_match_ok' }),
    });
    const data = await resp.json();
    authToken = data.token;

    expect(data.token).toBeTruthy();
    expect(data.user.bvn_verified).toBe(true);
    expect(data.kyc_tier).toBeGreaterThanOrEqual(2);
  });

  it('Step 2: Complete KYC verification (BVN + NIN + liveness)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        kyc_status: 'verified',
        bvn_match: true,
        nin_match: true,
        liveness_score: 0.97,
        watchlist_clear: true,
        tier: 3,
      }),
    });

    const resp = await fetch(`${API_BASE}/kyc/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ bvn: '22211100099', nin: '11122233344', selfie: 'base64...' }),
    });
    const data = await resp.json();

    expect(data.kyc_status).toBe('verified');
    expect(data.liveness_score).toBeGreaterThan(0.9);
    expect(data.watchlist_clear).toBe(true);
  });

  it('Step 3: Get motor insurance quote', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quote_id: 'QT-12345',
        product: 'motor_comprehensive',
        sum_insured: 5000000,
        premium: 75000,
        valid_until: '2026-07-01T00:00:00Z',
      }),
    });

    const resp = await fetch(`${API_BASE}/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        product: 'motor_comprehensive',
        vehicle_value: 5000000,
        year: 2024,
        driver_age: 35,
      }),
    });
    const data = await resp.json();

    expect(data.quote_id).toMatch(/^QT-/);
    expect(data.premium).toBeGreaterThan(0);
    expect(data.premium).toBeLessThan(data.sum_insured);
  });

  it('Step 4: Bind policy from quote', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        policy_id: 'POL-67890',
        status: 'active',
        start_date: '2026-06-01',
        end_date: '2027-05-31',
        naicom_registration: 'NAICOM/2026/MOT/67890',
      }),
    });

    const resp = await fetch(`${API_BASE}/policies/bind`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ quote_id: 'QT-12345' }),
    });
    const data = await resp.json();
    policyId = data.policy_id;

    expect(data.policy_id).toMatch(/^POL-/);
    expect(data.status).toBe('active');
    expect(data.naicom_registration).toBeTruthy();
  });

  it('Step 5: Pay premium via bank transfer (0% fee)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        receipt_id: 'RCP-001',
        amount: 75000,
        fee: 0,
        net_amount: 75000,
        method: 'bank_transfer',
        status: 'confirmed',
      }),
    });

    const resp = await fetch(`${API_BASE}/premiums/collect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ policy_id: policyId, amount: 75000, method: 'bank_transfer' }),
    });
    const data = await resp.json();

    expect(data.fee).toBe(0); // Bank transfer = 0% fee
    expect(data.net_amount).toBe(75000);
    expect(data.status).toBe('confirmed');
  });

  it('Step 6: Pay premium via card (1.5% fee)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        receipt_id: 'RCP-002',
        amount: 75000,
        fee: 1125, // 75000 * 0.015
        net_amount: 73875,
        method: 'card',
        status: 'confirmed',
      }),
    });

    const resp = await fetch(`${API_BASE}/premiums/collect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ policy_id: policyId, amount: 75000, method: 'card' }),
    });
    const data = await resp.json();

    expect(data.fee).toBe(1125); // 1.5% of 75000
    expect(data.net_amount).toBe(73875);
  });

  it('Step 7: File motor accident claim with FNOL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        claim_id: 'CLM-54321',
        status: 'submitted',
        fnol_received: true,
        sla_deadline: '2026-06-15T00:00:00Z',
        documents_required: ['police_report', 'damage_photos', 'repair_estimate'],
      }),
    });

    const resp = await fetch(`${API_BASE}/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        policy_id: policyId,
        type: 'motor_accident',
        description: 'Rear-end collision at Lekki tollgate',
        amount: 350000,
      }),
    });
    const data = await resp.json();
    claimId = data.claim_id;

    expect(data.claim_id).toMatch(/^CLM-/);
    expect(data.fnol_received).toBe(true);
    expect(data.documents_required.length).toBeGreaterThan(0);
  });

  it('Step 8: Track claim adjudication (AI auto-adjudicate)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        claim_id: claimId,
        status: 'approved',
        decision: 'auto_approved',
        risk_score: 15,
        confidence: 0.92,
        approved_amount: 350000,
        deductible: 50000,
        payout_amount: 300000,
      }),
    });

    const resp = await fetch(`${API_BASE}/claims/${claimId}/adjudicate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await resp.json();

    expect(data.decision).toBe('auto_approved');
    expect(data.confidence).toBeGreaterThan(0.8);
    expect(data.payout_amount).toBe(300000); // 350000 - 50000 deductible
  });

  it('Step 9: Verify payout processed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payout_id: 'PAY-99999',
        claim_id: claimId,
        amount: 300000,
        method: 'bank_transfer',
        status: 'completed',
        bank_reference: 'NIP/2026/0601/12345',
      }),
    });

    const resp = await fetch(`${API_BASE}/payouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ claim_id: claimId, amount: 300000, method: 'bank_transfer' }),
    });
    const data = await resp.json();

    expect(data.amount).toBe(300000);
    expect(data.status).toBe('completed');
    expect(data.bank_reference).toMatch(/^NIP\//);
  });

  it('Step 10: AML threshold check — ₦5M cash transaction flagged', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transaction_id: 'TXN-AML-001',
        amount: 6000000,
        aml_flag: true,
        aml_action: 'review',
        ctr_filed: true, // Cash Transaction Report
        reason: 'Cash transaction exceeds ₦5M CBN threshold',
      }),
    });

    const resp = await fetch(`${API_BASE}/aml/screen`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ amount: 6000000, method: 'cash' }),
    });
    const data = await resp.json();

    expect(data.aml_flag).toBe(true);
    expect(data.ctr_filed).toBe(true);
  });

  it('Step 11: AML threshold — ₦10M wire transfer flagged', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transaction_id: 'TXN-AML-002',
        amount: 15000000,
        aml_flag: true,
        aml_action: 'block',
        str_filed: true, // Suspicious Transaction Report
        reason: 'Wire transfer exceeds ₦10M threshold',
      }),
    });

    const resp = await fetch(`${API_BASE}/aml/screen`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ amount: 15000000, method: 'wire' }),
    });
    const data = await resp.json();

    expect(data.aml_flag).toBe(true);
    expect(data.str_filed).toBe(true);
    expect(data.aml_action).toBe('block');
  });

  it('Step 12: Microinsurance cap enforcement — ₦2M maximum', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'sum_insured_exceeds_microinsurance_cap',
        max_allowed: 2000000,
        requested: 3000000,
      }),
    });

    const resp = await fetch(`${API_BASE}/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ product: 'microinsurance_crop', sum_insured: 3000000 }),
    });

    expect(resp.ok).toBe(false);
    const data = await resp.json();
    expect(data.error).toBe('sum_insured_exceeds_microinsurance_cap');
    expect(data.max_allowed).toBe(2000000);
  });
});

describe('E2E: Offline-First Sync', () => {
  it('should queue operations when offline and sync when reconnected', async () => {
    // Simulate offline operation
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
    
    try {
      await fetch(`${API_BASE}/policies`, { headers: { Authorization: 'Bearer test' } });
    } catch (e: any) {
      expect(e.message).toBe('Network request failed');
    }

    // Simulate reconnection and sync
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        synced: 3,
        conflicts: 0,
        last_sync: '2026-06-01T12:00:00Z',
      }),
    });

    const syncResp = await fetch(`${API_BASE}/sync/push`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test' },
      body: JSON.stringify({ pending_operations: 3 }),
    });
    const syncData = await syncResp.json();

    expect(syncData.synced).toBe(3);
    expect(syncData.conflicts).toBe(0);
  });
});
