/**
 * screens-prefill.test.tsx — 2026-10-06 (W11-B1c)
 *
 * Coverage for the W11-B1a prefill surface ported to mobile (web parity:
 * client/src/pages/member/RecentPayeePicker.tsx + MemberBills/MemberAirtime/
 * MemberClaims W11-B1b):
 *
 *   RecentPayeePicker + BillsScreen / AirtimeScreen (vend + momo sections)
 *     - memberPayees.list({rail}) → top-5 chips with identifier + provenance
 *       line ("last paid ₦X · date")
 *     - select prefills IDENTIFIERS ONLY (biller+meter / network+phone /
 *       provider), ALWAYS clears the amount, resets capture/validation
 *       state, and shows the provenance hint
 *     - memberPayees.remove({id}) per-chip; list cache invalidated
 *     - silent degrade on list error (form fully usable); honest note when
 *       the directory is empty
 *     - IDEMPOTENCY COMPOSITION (W10-B4b): a prefill changes the draft →
 *       the memberFundsIntent fingerprint changes → the next Pay sends a
 *       FRESH key from the REAL intentIdempotencyKey logic (in-memory
 *       AsyncStorage), while the unchanged draft keeps the stable key.
 *   FileClaimScreen
 *     - memberClaims.getClaimPrefill panel on policy select (read-only
 *       policy snapshot + member contact + last claim); silent degrade on
 *       error.
 *
 * MUTANT PROBES (non-vacuous checks):
 *   1. The bill test asserts Pay is DISABLED immediately after a payee
 *      select — a mutant onPayeeSelect that forgets setCheck(null) leaves
 *      the stale validation in place and Pay enabled (detected).
 *   2. The idempotency test asserts key AFTER prefill ≠ key BEFORE — a
 *      mutant that prefills the amount too (setAmount(lastAmount)) would
 *      mint a key over the WRONG fingerprint and also trip the
 *      amount-input value assertion (amount must be '').
 *
 * Boundary policy: only the network boundary (fetch, real superjson
 * envelope) is mocked via the harness; the picker, screens, api wrappers,
 * memberTrpc auth and intent-key logic are production code.
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

jest.setTimeout(20000);

import { BillsScreen } from '../src/screens/BillsScreen';
import { AirtimeScreen } from '../src/screens/AirtimeScreen';
import { FileClaimScreen } from '../src/screens/FileClaimScreen';

const IDEM_RE = /^[A-Za-z0-9_-]{8,20}$/;

/** All POST bodies to a mutation procedure, in order. */
function mutationInputs(fetchMock: jest.Mock, procedure: string): any[] {
  return fetchMock.mock.calls
    .filter(([url, opts]: any[]) => String(url).endsWith(`/${procedure}`) && opts?.method === 'POST')
    .map((call: any[]) => JSON.parse(call[1].body).json);
}

const BILLERS = {
  billers: [
    { name: 'EKEDC', commissionRate: 0.005, commissionPct: '0.5%' },
    { name: 'DSTV', commissionRate: 0.01, commissionPct: '1.0%' },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: true,
};

const BILL_PAYEES = {
  payees: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      rail: 'bill',
      label: 'Home meter',
      billerCode: 'EKEDC',
      meterNumber: '12345678901',
      network: null,
      phone: null,
      provider: null,
      walletNumber: null,
      lastAmountKobo: 500000,
      useCount: 3,
      lastUsedAt: '2026-10-01T12:00:00.000Z',
    },
  ],
};

const AIRTIME_PAYEES = {
  payees: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      rail: 'airtime',
      label: 'Mum’s line',
      billerCode: null,
      meterNumber: null,
      network: 'MTN',
      phone: '08031234567',
      provider: null,
      walletNumber: null,
      lastAmountKobo: 200000,
      useCount: 5,
      lastUsedAt: '2026-09-30T12:00:00.000Z',
    },
  ],
};

const MOMO_PAYEES = {
  payees: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      rail: 'momo',
      label: 'Trading wallet',
      billerCode: null,
      meterNumber: null,
      network: null,
      phone: null,
      provider: 'MTN MoMo',
      walletNumber: '08030000001',
      lastAmountKobo: 1000000,
      useCount: 2,
      lastUsedAt: '2026-09-28T12:00:00.000Z',
    },
  ],
};

const MOMO_PROVIDERS_VIEW = {
  providers: [{ name: 'MTN MoMo', cashInCommission: 1.5, cashOutCommission: 1.0 }],
  limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
  configured: true,
};

const INITIATION = {
  reference: 'BP-PREFILL1',
  authorizationUrl: 'https://checkout.paystack.com/real-prefill-1',
  accessCode: 'ac-1',
  amount: '500',
  currency: 'NGN',
  transactionId: 88,
  status: 'awaiting_payment',
  idempotent: false,
};

const AIRTIME_EMPTY = { history: [], total: 0 };
const SUMMARY_EMPTY = { periodDays: 30, totalTransactions: 0, byStatus: [] };

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => { delete (global as any).fetch; });

describe('RecentPayeePicker on BillsScreen (rail=bill)', () => {
  it('renders the top-5 chips with identifier and the "last paid ₦X · date" provenance line', async () => {
    mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberPayees.list': () => BILL_PAYEES,
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    expect(await screen.findByTestId('recent-payees')).toBeTruthy();
    // Label + rail identifier (biller · meter).
    expect(screen.getByText('Home meter')).toBeTruthy();
    expect(screen.getByText('EKEDC · 12345678901')).toBeTruthy();
    // Provenance: ₦500,000 kobo → ₦5,000; the date is locale-rendered.
    expect(screen.getByText(/last paid ₦5,000 · /)).toBeTruthy();
  });

  it('select prefills biller+meter, CLEARS the amount, re-locks Pay, and shows the provenance hint', async () => {
    mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '99999999999', biller: 'DSTV', message: 'Valid',
      }),
      'memberPayees.list': () => BILL_PAYEES,
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    const chip = await screen.findByTestId('payee-chip-11111111-1111-4111-8111-111111111111');

    // Pre-existing draft: different biller + number + an amount, validated.
    fireEvent.press(await screen.findByLabelText('Biller DSTV'));
    fireEvent.changeText(screen.getByLabelText('Customer number'), '99999999999');
    fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    fireEvent.press(screen.getByText('Validate'));
    await screen.findByText(/Valid — Valid — DSTV/);

    fireEvent.press(chip);

    // Identifiers prefilled; the amount is NEVER carried over.
    expect(screen.getByLabelText('Customer number').props.value).toBe('12345678901');
    expect(screen.getByLabelText('Amount').props.value).toBe('');
    // Provenance hint names the payee and discloses the blanked amount.
    expect(await screen.findByTestId('prefill-hint-bill')).toBeTruthy();
    expect(screen.getByText(/Prefilled from your recent payments \(Home meter\)/)).toBeTruthy();
    expect(screen.getByText(/the amount was left blank for you to confirm/)).toBeTruthy();
    // MUTANT PROBE 1: the stale DSTV validation must NOT unlock Pay for the
    // new draft — the validation state was reset by the prefill.
    expect(screen.getByLabelText('Pay').props.accessibilityState?.disabled).toBe(true);
  });

  it('silently degrades when memberPayees.list fails — the form stays fully usable', async () => {
    mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberPayees.list': () => new Error('Request failed (HTTP 500)'),
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    // The biller catalog loads and the form fields are present; no picker.
    expect(await screen.findByLabelText('Biller EKEDC')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('recent-payees')).toBeNull());
    expect(screen.getByLabelText('Customer number')).toBeTruthy();
    expect(screen.getByLabelText('Amount')).toBeTruthy();
  });

  it('shows the honest empty note when the directory has no payees', async () => {
    mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberPayees.list': () => ({ payees: [] }),
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    expect(await screen.findByTestId('recent-payees-empty')).toBeTruthy();
    expect(screen.getByText(/will appear here after a successful payment/)).toBeTruthy();
  });

  it('removes a payee via memberPayees.remove({id}) and invalidates the list', async () => {
    let listCalls = 0;
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberPayees.list': () => { listCalls += 1; return BILL_PAYEES; },
      'memberPayees.remove': () => ({ removed: true, id: '11111111-1111-4111-8111-111111111111' }),
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Remove payee Home meter'));
    await waitFor(() => {
      const bodies = mutationInputs(fetchMock, 'memberPayees.remove');
      expect(bodies).toEqual([{ id: '11111111-1111-4111-8111-111111111111' }]);
    });
    // The list query was invalidated and refetched after the removal.
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
  });

  it('compose with the W10-B4b intent keys: prefill changes the fingerprint → the next Pay mints a FRESH key', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberBillPayments.pay': () => INITIATION,
      'memberPayees.list': () => BILL_PAYEES,
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    await screen.findByTestId('recent-payees');

    // Draft A (typed by hand): EKEDC / 99999999999 / ₦500 — validated, paid.
    fireEvent.press(await screen.findByLabelText('Biller EKEDC'));
    fireEvent.changeText(screen.getByLabelText('Customer number'), '99999999999');
    fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    fireEvent.press(screen.getByText('Validate'));
    await screen.findByText(/Valid — Valid — EKEDC/);
    fireEvent.press(screen.getByLabelText('Pay'));
    await screen.findByText(/Payment initiated\. Reference: BP-PREFILL1/);

    // Payee prefill replaces the identifiers (meter 12345678901) and clears
    // the amount → NEW draft. Re-validate and pay again.
    fireEvent.press(screen.getByTestId('payee-chip-11111111-1111-4111-8111-111111111111'));
    expect(screen.getByLabelText('Customer number').props.value).toBe('12345678901');
    // MUTANT PROBE 2: the amount must be blank after prefill (a mutant that
    // prefills the amount would fail here AND mint a wrong fingerprint).
    expect(screen.getByLabelText('Amount').props.value).toBe('');
    fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    fireEvent.press(screen.getByText('Validate'));
    await waitFor(() => expect(screen.getByLabelText('Pay').props.accessibilityState?.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(mutationInputs(fetchMock, 'memberBillPayments.pay').length).toBe(2));

    const [first, second] = mutationInputs(fetchMock, 'memberBillPayments.pay');
    expect(first.customerNumber).toBe('99999999999');
    expect(second.customerNumber).toBe('12345678901');
    // Both keys satisfy the server zod boundary…
    expect(first.idempotencyKey).toMatch(IDEM_RE);
    expect(second.idempotencyKey).toMatch(IDEM_RE);
    // …and the prefilled draft minted a FRESH key (fingerprint changed).
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});

describe('RecentPayeePicker on AirtimeScreen (rails airtime + momo)', () => {
  // The rail travels in the URL-encoded tRPC input, so one handler can
  // branch per rail: input={"json":{"rail":"airtime"}} → %22airtime%22.
  function payeesByRail(url: string) {
    if (url.includes('%22airtime%22')) return AIRTIME_PAYEES;
    if (url.includes('%22momo%22')) return MOMO_PAYEES;
    return { payees: [] };
  }

  function mockAirtimeSurface() {
    return mockFetchSequence({
      'memberPayees.list': (url: string) => payeesByRail(url),
      'memberAirtime.myHistory': () => AIRTIME_EMPTY,
      'memberAirtime.mySummary': () => SUMMARY_EMPTY,
      'memberMobileMoney.providers': () => MOMO_PROVIDERS_VIEW,
      'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
      'memberMobileMoney.mySummary': () => SUMMARY_EMPTY,
    });
  }

  it('airtime select prefills network+phone and CLEARS the vend amount', async () => {
    mockAirtimeSurface();
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    // Pre-existing draft amount — must be wiped by the prefill.
    fireEvent.changeText(await screen.findByLabelText('Airtime amount'), '500');
    fireEvent.press(await screen.findByTestId('payee-chip-22222222-2222-4222-8222-222222222222'));
    expect(screen.getByLabelText('Beneficiary phone').props.value).toBe('08031234567');
    expect(screen.getByLabelText('Airtime amount').props.value).toBe('');
    expect(await screen.findByTestId('prefill-hint-airtime')).toBeTruthy();
    expect(screen.getByText(/Prefilled from your recent payments \(Mum’s line\)/)).toBeTruthy();
    // The picker itself shows the rail identifier and provenance.
    expect(screen.getByText('MTN · 08031234567')).toBeTruthy();
    expect(screen.getByText(/last paid ₦2,000 · /)).toBeTruthy();
  });

  it('momo select prefills the provider and CLEARS the cash amount', async () => {
    mockAirtimeSurface();
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('Cash amount'), '1000');
    fireEvent.press(await screen.findByTestId('payee-chip-33333333-3333-4333-8333-333333333333'));
    expect(screen.getByLabelText('Cash amount').props.value).toBe('');
    expect(await screen.findByTestId('prefill-hint-momo')).toBeTruthy();
    expect(screen.getByText(/Prefilled from your recent payments \(Trading wallet\)/)).toBeTruthy();
    expect(screen.getByText('MTN MoMo · 08030000001')).toBeTruthy();
  });

  it('silently degrades when memberPayees.list fails on both sections', async () => {
    mockFetchSequence({
      'memberPayees.list': () => new Error('Request failed (HTTP 500)'),
      'memberAirtime.myHistory': () => AIRTIME_EMPTY,
      'memberAirtime.mySummary': () => SUMMARY_EMPTY,
      'memberMobileMoney.providers': () => MOMO_PROVIDERS_VIEW,
      'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
      'memberMobileMoney.mySummary': () => SUMMARY_EMPTY,
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    expect(await screen.findByLabelText('Airtime amount')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('recent-payees')).toBeNull());
    expect(screen.getByLabelText('Cash amount')).toBeTruthy();
    expect(screen.getByText('Buy airtime')).toBeTruthy();
  });
});

describe('FileClaimScreen claim prefill (memberClaims.getClaimPrefill)', () => {
  const PICKER = { policies: [{ id: 7, policyNumber: 'POL-2026-007', status: 'active' }] };
  const PREFILL = {
    policy: {
      id: 7,
      policyNumber: 'POL-2026-007',
      status: 'active',
      coverageType: 'Comprehensive',
      sumInsured: '5000000',
      annualPremium: '120000',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      assetDetails: null,
      productName: 'Motor Comprehensive',
      productCode: 'MTR-COMP',
    },
    member: {
      firstName: 'Ada',
      lastName: 'Obi',
      email: 'ada@example.ng',
      phone: '08031234567',
    },
    lastClaim: {
      claimNumber: 'CLM-2026-0001',
      status: 'settled',
      claimType: 'Motor Accident',
      claimedAmount: '250000',
      incidentDate: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-06-02T00:00:00.000Z',
    },
  };

  it('shows the read-only prefill panel after a policy is selected', async () => {
    mockFetchSequence({
      'memberClaims.myPoliciesPicker': () => PICKER,
      'memberClaims.getClaimPrefill': () => PREFILL,
    });
    renderScreen(<FileClaimScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('POL-2026-007 (active)'));
    expect(await screen.findByTestId('claim-prefill')).toBeTruthy();
    expect(screen.getByText(/Policy #: POL-2026-007/)).toBeTruthy();
    expect(screen.getByText(/Product: Motor Comprehensive/)).toBeTruthy();
    expect(screen.getByText(/Coverage: Comprehensive/)).toBeTruthy();
    expect(screen.getByText(/Sum insured: ₦5,000,000/)).toBeTruthy();
    expect(screen.getByText(/Contact: Ada Obi · ada@example\.ng · 08031234567/)).toBeTruthy();
    expect(screen.getByText(/Your last claim on this policy: CLM-2026-0001 \(settled,/)).toBeTruthy();
    // The form itself stays editable — nothing was auto-filed.
    expect(screen.getByText('Submit Claim')).toBeTruthy();
  });

  it('silently degrades when getClaimPrefill fails — the form stays fully usable', async () => {
    mockFetchSequence({
      'memberClaims.myPoliciesPicker': () => PICKER,
      'memberClaims.getClaimPrefill': () => new Error('Request failed (HTTP 500)'),
    });
    renderScreen(<FileClaimScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('POL-2026-007 (active)'));
    await waitFor(() => expect(screen.queryByTestId('claim-prefill')).toBeNull());
    // No panel, no fabricated data; the filing form is still present.
    expect(screen.getByText('Description *')).toBeTruthy();
    expect(screen.getByText('Submit Claim')).toBeTruthy();
  });
});
