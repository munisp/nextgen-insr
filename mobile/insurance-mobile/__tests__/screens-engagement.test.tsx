/**
 * screens-engagement.test.tsx — 2026-10-03 (W9-B5 wave 2)
 * Harness tests for the new Savings / Loyalty / Referrals / Disputes
 * screens. The network boundary (fetch) is mocked with the REAL superjson
 * envelope `{result:{data:{json:<payload>}}}` (see harness.tsx header); the
 * screens, services (api.ts wrappers), memberTrpc auth and config transport
 * are all production code. Mutation tests assert the exact procedure name
 * and input body — matching the server zod schemas
 * (server/routers/memberSavings.ts / memberDisputes.ts). No funds mutation
 * exists on these surfaces (deposit/withdraw, redemption, referral minting
 * are deliberately absent server-side); fileDispute.amount is the
 * member-DECLARED disputed amount on an already-owned transaction — no
 * funds move and nothing is computed client-side.
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

// 2026-10-03 (W9-B6): see screens-data.test.tsx — first-test transform
// warm-up under worker contention can exceed jest's 5s default.
jest.setTimeout(20000);

import { SavingsScreen } from '../src/screens/SavingsScreen';
import { LoyaltyScreen } from '../src/screens/LoyaltyScreen';
import { ReferralsScreen } from '../src/screens/ReferralsScreen';
import { DisputesScreen } from '../src/screens/DisputesScreen';

const ACCOUNT_ROW = {
  id: 42, firstName: 'Ada', lastName: 'Obi', status: 'active', kycLevel: 'tier2', createdAt: '2026-01-15',
};

const SAVINGS_TX_ROW = {
  id: 88, ref: 'TXN-88', type: 'Cash In', amount: '12500', currency: 'NGN',
  channel: 'wallet', status: 'success', failureReason: null, createdAt: '2026-10-01',
};

const DISPUTE_ROW = {
  id: 9, ref: 'DSP-ABC123DEF456', transactionId: 88, transactionRef: 'TXN-88',
  status: 'open', priority: 'medium', type: 'customer', reason: 'Double charge',
  amount: '5000', createdAt: '2026-10-02',
};

/** Find the fetch call to a mutation procedure and parse its real body. */
function mutationInput(fetchMock: jest.Mock, procedure: string): any {
  const call = fetchMock.mock.calls.find(
    ([url, opts]: any[]) => String(url).endsWith(`/${procedure}`) && opts?.method === 'POST',
  );
  expect(call).toBeTruthy();
  return JSON.parse((call as any[])[1].body).json;
}

beforeEach(resetHarness);
afterEach(() => { delete (global as any).fetch; });

describe('SavingsScreen', () => {
  it('renders the real account, settled summary and transactions', async () => {
    mockFetchSequence({
      'memberSavings.myAccount': () => ({ account: ACCOUNT_ROW }),
      'memberSavings.mySummary': () => ({
        customerId: 42, balance: 12500, totalIn: 12500, totalOut: 0, settledTransactions: 1, currency: 'NGN',
      }),
      'memberSavings.myTransactions': () => ({ transactions: [SAVINGS_TX_ROW], count: 1 }),
    });
    renderScreen(<SavingsScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading savings account/i)).toBeTruthy();
    expect(await screen.findByText('TXN-88')).toBeTruthy();
    // Balance, total-in and the tx row all render the real ₦12,500.
    expect(screen.getAllByText('₦12,500').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/KYC level: tier2/)).toBeTruthy();
    // Failed/pending rows are never hidden — status badge rendered (raw
    // text; uppercase is only a display transform).
    expect(screen.getByText('success')).toBeTruthy();
    // Honest note — no deposit/withdraw mutation exists (web parity).
    expect(screen.getByText(/Deposits and withdrawals are not available/i)).toBeTruthy();
  });

  it('renders the account-opening form when the server returns { account: null }', async () => {
    mockFetchSequence({
      'memberSavings.myAccount': () => ({ account: null }),
    });
    renderScreen(<SavingsScreen navigation={mockNavigation} />);
    expect(await screen.findByText(/You do not have a savings account yet/i)).toBeTruthy();
    // Summary/transactions are NOT queried without an account (enabled gate,
    // web parity) — no fabricated balance anywhere.
    expect(screen.queryByTestId('savings-balance')).toBeNull();
  });

  it('surfaces the server error verbatim instead of fabricated balances', async () => {
    mockFetchSequence({
      'memberSavings.myAccount': () => new Error('DB unavailable'),
    });
    renderScreen(<SavingsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
    expect(screen.queryByText(/₦/)).toBeNull();
  });

  it('openMyAccount sends the exact zod input — identity never client-supplied, blanks omitted', async () => {
    const fetchMock = mockFetchSequence({
      'memberSavings.myAccount': () => ({ account: null }),
      'memberSavings.openMyAccount': () => ({ success: true, account: ACCOUNT_ROW }),
    });
    renderScreen(<SavingsScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('Phone number'), '08012345678');
    fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.ng');
    fireEvent.press(screen.getByText('Open savings account'));
    await waitFor(() => {
      // Server zod schema exactly (memberSavings.ts:279-287): phone/email
      // only — bvn/nin/address omitted entirely when blank; no names (taken
      // from the session server-side), no status, no amounts.
      expect(mutationInput(fetchMock, 'memberSavings.openMyAccount')).toEqual({
        phone: '08012345678', email: 'ada@example.ng',
      });
    });
  });

  it('surfaces openMyAccount server errors verbatim (fail-closed KYC gate)', async () => {
    const fetchMock = mockFetchSequence({
      'memberSavings.myAccount': () => ({ account: null }),
      'memberSavings.openMyAccount': () => new Error('KYC verification service unreachable — account opening BLOCKED (fail-closed). Retry when service is available.'),
    });
    renderScreen(<SavingsScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('Phone number'), '08012345678');
    fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
    fireEvent.press(screen.getByText('Open savings account'));
    expect(await screen.findByText(/KYC verification service unreachable/i)).toBeTruthy();
    expect(mutationInput(fetchMock, 'memberSavings.openMyAccount')).toEqual({
      phone: '08012345678', bvn: '12345678901',
    });
  });
});

describe('LoyaltyScreen', () => {
  const HISTORY_ROW = {
    id: 3, type: 'earned', points: 250, description: 'Premium payment POL-2026-001',
    balanceAfter: 1250, createdAt: '2026-10-01',
  };

  it('renders the real balance and ledger from memberLoyalty', async () => {
    mockFetchSequence({
      'memberLoyalty.myBalance': () => ({ customerId: 42, earned: 1300, redeemed: 50, balance: 1250 }),
      'memberLoyalty.myHistory': () => ({ history: [HISTORY_ROW], total: 1, limit: 50, offset: 0 }),
    });
    renderScreen(<LoyaltyScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading loyalty balance/i)).toBeTruthy();
    expect(await screen.findByText('1250 pts')).toBeTruthy();
    expect(screen.getByText('Premium payment POL-2026-001')).toBeTruthy();
    // Honest note — no redemption mutation exists (web parity).
    expect(screen.getByText(/Points redemption is not available/i)).toBeTruthy();
  });

  it('shows the honest empty history state', async () => {
    mockFetchSequence({
      'memberLoyalty.myBalance': () => ({ customerId: 42, earned: 0, redeemed: 0, balance: 0 }),
      'memberLoyalty.myHistory': () => ({ history: [], total: 0, limit: 50, offset: 0 }),
    });
    renderScreen(<LoyaltyScreen navigation={mockNavigation} />);
    expect(await screen.findByText('You have no loyalty activity yet.')).toBeTruthy();
  });

  it('surfaces the server error verbatim instead of fabricated points', async () => {
    mockFetchSequence({
      'memberLoyalty.myBalance': () => new Error('DB unavailable'),
      'memberLoyalty.myHistory': () => new Error('DB unavailable'),
    });
    renderScreen(<LoyaltyScreen navigation={mockNavigation} />);
    expect((await screen.findAllByText('DB unavailable')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/pts$/)).toBeNull();
  });
});

describe('ReferralsScreen', () => {
  const REFERRAL_ROW = {
    id: 4, referralCode: 'REF-ADA-01', refereeCode: null, status: 'rewarded',
    bonusPoints: 500, bonusCash: '500', activatedAt: '2026-09-01',
    rewardedAt: '2026-09-15', expiresAt: '2027-01-01', createdAt: '2026-08-01',
  };

  it('renders the real referral code and referral list', async () => {
    mockFetchSequence({
      'memberReferrals.myCode': () => ({ referralCode: 'REF-ADA-01', expiresAt: '2027-01-01', existing: true }),
      'memberReferrals.myReferrals': () => ({ referrals: [REFERRAL_ROW], total: 1, limit: 50, offset: 0 }),
    });
    renderScreen(<ReferralsScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading your referral code/i)).toBeTruthy();
    expect((await screen.findAllByText('REF-ADA-01')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('rewarded')).toBeTruthy();
    expect(screen.getByText('₦500')).toBeTruthy();
  });

  it('shows the honest unavailable state when the server returns null (no minting)', async () => {
    mockFetchSequence({
      'memberReferrals.myCode': () => null,
      'memberReferrals.myReferrals': () => ({ referrals: [], total: 0, limit: 50, offset: 0 }),
    });
    renderScreen(<ReferralsScreen navigation={mockNavigation} />);
    expect(await screen.findByText(/referral code is not available/i)).toBeTruthy();
    expect(await screen.findByText('You have not referred anyone yet.')).toBeTruthy();
    // No code is fabricated.
    expect(screen.queryByTestId('referral-code')).toBeNull();
  });

  it('surfaces the server error verbatim instead of fabricated referrals', async () => {
    mockFetchSequence({
      'memberReferrals.myCode': () => new Error('DB unavailable'),
      'memberReferrals.myReferrals': () => new Error('DB unavailable'),
    });
    renderScreen(<ReferralsScreen navigation={mockNavigation} />);
    expect((await screen.findAllByText('DB unavailable')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('DisputesScreen', () => {
  it('renders the real dispute list from memberDisputes.myDisputes', async () => {
    mockFetchSequence({
      'memberDisputes.myDisputes': () => ({ disputes: [DISPUTE_ROW], count: 1 }),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading your disputes/i)).toBeTruthy();
    expect(await screen.findByText('DSP-ABC123DEF456')).toBeTruthy();
    expect(screen.getByText(/Double charge · ₦5,000/)).toBeTruthy();
    // Badge + status filter chip both render the raw 'open' label.
    expect(screen.getAllByText('open').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the honest empty state', async () => {
    mockFetchSequence({
      'memberDisputes.myDisputes': () => ({ disputes: [], count: 0 }),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    expect(await screen.findByText('You have no disputes.')).toBeTruthy();
  });

  it('surfaces the server error verbatim instead of fabricated disputes', async () => {
    mockFetchSequence({
      'memberDisputes.myDisputes': () => new Error('DB unavailable'),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
  });

  it('fileDispute sends the exact zod input from a picked real transaction (no extra client fields)', async () => {
    const fetchMock = mockFetchSequence({
      'memberDisputes.myDisputes': () => ({ disputes: [], count: 0 }),
      'memberSavings.myTransactions': () => ({ transactions: [SAVINGS_TX_ROW], count: 1 }),
      'memberDisputes.fileDispute': () => ({ id: 10, ref: 'DSP-NEW000000001', status: 'open' }),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('File a dispute'));
    fireEvent.press(await screen.findByLabelText('Select transaction TXN-88'));
    fireEvent.changeText(screen.getByLabelText('Dispute reason'), 'Double charge');
    fireEvent.changeText(screen.getByLabelText('Dispute description'), 'I was charged twice for the same premium.');
    fireEvent.changeText(screen.getByLabelText('Disputed amount'), '5000');
    fireEvent.press(screen.getByText('File dispute'));
    await waitFor(() => {
      // Server zod schema exactly (memberDisputes.ts:225-232): the four
      // fields and NOTHING else — amount is the member-DECLARED disputed
      // amount (no funds move); ownership/agentId/ref/status are
      // server-side.
      expect(mutationInput(fetchMock, 'memberDisputes.fileDispute')).toEqual({
        transactionId: 88,
        reason: 'Double charge',
        description: 'I was charged twice for the same premium.',
        amount: 5000,
      });
    });
  });

  it('fileDispute surfaces the ownership-check NOT_FOUND verbatim — no fake success', async () => {
    const fetchMock = mockFetchSequence({
      'memberDisputes.myDisputes': () => ({ disputes: [], count: 0 }),
      // Empty transactions list → manual numeric ID path (web parity).
      'memberSavings.myTransactions': () => ({ transactions: [], count: 0 }),
      'memberDisputes.fileDispute': () => new Error('Transaction not found'),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('File a dispute'));
    fireEvent.changeText(await screen.findByLabelText('Transaction ID'), '99999');
    fireEvent.changeText(screen.getByLabelText('Dispute reason'), 'Not mine');
    fireEvent.changeText(screen.getByLabelText('Dispute description'), 'This transaction is not recognized.');
    fireEvent.changeText(screen.getByLabelText('Disputed amount'), '100');
    fireEvent.press(screen.getByText('File dispute'));
    expect(await screen.findByText('Transaction not found')).toBeTruthy();
    expect(mutationInput(fetchMock, 'memberDisputes.fileDispute')).toEqual({
      transactionId: 99999, reason: 'Not mine', description: 'This transaction is not recognized.', amount: 100,
    });
  });

  it('dispute detail loads messages and replyDispute sends { disputeId, content } exactly', async () => {
    const fetchMock = mockFetchSequence({
      // NOTE: myDisputes listed first — 'memberDisputes.myDispute' is a
      // substring of 'memberDisputes.myDisputes'.
      'memberDisputes.myDisputes': () => ({ disputes: [DISPUTE_ROW], count: 1 }),
      'memberDisputes.myDispute': () => ({
        dispute: { ...DISPUTE_ROW, description: 'Charged twice', resolution: null, resolvedAt: null, updatedAt: null },
        messages: [{ id: 1, senderType: 'agent', senderName: 'Support', content: 'We are investigating.', createdAt: '2026-10-02' }],
        evidence: [],
      }),
      'memberDisputes.replyDispute': () => ({ id: 2, senderType: 'customer' }),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Dispute DSP-ABC123DEF456'));
    expect(await screen.findByText('We are investigating.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Dispute reply'), 'Here is my receipt.');
    fireEvent.press(screen.getByText('Send reply'));
    await waitFor(() => {
      expect(mutationInput(fetchMock, 'memberDisputes.replyDispute')).toEqual({
        disputeId: 9, content: 'Here is my receipt.',
      });
    });
  });

  it('a resolved dispute honestly shows no reply form', async () => {
    mockFetchSequence({
      'memberDisputes.myDisputes': () => ({
        disputes: [{ ...DISPUTE_ROW, status: 'resolved' }], count: 1,
      }),
      'memberDisputes.myDispute': () => ({
        dispute: { ...DISPUTE_ROW, status: 'resolved', description: 'Charged twice', resolution: 'Refund issued', resolvedAt: '2026-10-03', updatedAt: '2026-10-03' },
        messages: [],
        evidence: [],
      }),
    });
    renderScreen(<DisputesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Dispute DSP-ABC123DEF456'));
    expect(await screen.findByText(/Resolution: Refund issued/)).toBeTruthy();
    expect(await screen.findByText(/no longer accepts replies/i)).toBeTruthy();
    expect(screen.queryByText('Send reply')).toBeNull();
  });
});
