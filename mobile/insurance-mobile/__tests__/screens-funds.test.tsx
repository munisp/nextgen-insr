/**
 * screens-funds.test.tsx — 2026-10-04 (W10-B4b)
 *
 * Harness coverage for the W10-B2 member funds mutations wired onto the
 * mobile screens (mirroring the web W10-B4a):
 *   BillsScreen      memberBillPayments.pay / confirmPay
 *   AirtimeScreen    memberAirtime.vend / confirmVend,
 *                    memberMobileMoney.cashIn / confirmCashIn / cashOut
 *   KycSubmitScreen  memberIdentity.myKycStatus / myKycSession / submitKyc
 *
 * The network boundary (fetch) is mocked with the REAL superjson envelope
 * `{result:{data:{json:<payload>}}}` (harness.tsx); the screens, services
 * (api.ts), memberTrpc auth and config transport are production code. The
 * ONLY other boundary observed is react-navigation: 2026-10-06 (W10-B5) the
 * checkout handoff is the in-app PaystackCheckout WebView, so tests assert
 * navigation.navigate receives 'PaystackCheckout' with the SERVER-SUPPLIED
 * authorizationUrl and reference verbatim (the WebView native boundary
 * itself is covered in paystack-checkout.test.tsx).
 *
 * Asserted contracts:
 *   - zod-exact mutation bodies (no computed fields; optional beneficiary
 *     phone OMITTED when blank; meterType only for electricity billers)
 *   - idempotency-key lifecycle: /^[A-Za-z0-9_-]{8,20}$/, stable per draft
 *     fingerprint, rotated on edit, retired on terminal confirm
 *   - honest tri-state renders (submitted = pending NOT delivered; failed +
 *     failed_refund_pending; unknown_outcome = held, do NOT pay again;
 *     completed only on server status success)
 *   - validateCustomer gate staleness (editing the draft re-locks Pay)
 *   - cashOut PRECONDITION_FAILED surfaced verbatim; PENDING-only result
 *   - KYC duplicate-session panel (no second form), 11-digit guard,
 *     verbatim verdicts incl. the "unavailable stays pending" outcome
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

jest.setTimeout(20000);

import { BillsScreen } from '../src/screens/BillsScreen';
import { AirtimeScreen } from '../src/screens/AirtimeScreen';
import { KycSubmitScreen } from '../src/screens/KycSubmitScreen';

const IDEM_RE = /^[A-Za-z0-9_-]{8,20}$/;

/** Find the fetch call to a mutation procedure and parse its real body. */
function mutationInput(fetchMock: jest.Mock, procedure: string): any {
  const call = fetchMock.mock.calls.find(
    ([url, opts]: any[]) => String(url).endsWith(`/${procedure}`) && opts?.method === 'POST',
  );
  expect(call).toBeTruthy();
  return JSON.parse((call as any[])[1].body).json;
}

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

const INITIATION = {
  reference: 'BP-ABC12345',
  authorizationUrl: 'https://checkout.paystack.com/real-session-1',
  accessCode: 'ac-1',
  amount: '500',
  currency: 'NGN',
  transactionId: 77,
  status: 'awaiting_payment',
  idempotent: false,
};

const CONFIRM_SUBMITTED = {
  reference: 'BP-ABC12345',
  status: 'pending',
  providerStatus: 'submitted',
  captureStatus: 'captured',
  amount: '500',
  currency: 'NGN',
  transactionId: 77,
  failureReason: null,
  refundStatus: null,
  idempotent: false,
};

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => { delete (global as any).fetch; });

/** Drive the BillsScreen draft to a Pay-ready state. */
async function prepareBillDraft(fetchBillers: () => any = () => BILLERS) {
  const fetchMock = mockFetchSequence({
    'memberBillPayments.billers': fetchBillers,
    'memberBillPayments.validateCustomer': () => ({
      valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
    }),
    'memberBillPayments.pay': () => INITIATION,
    'memberBillPayments.confirmPay': () => CONFIRM_SUBMITTED,
  });
  renderScreen(<BillsScreen navigation={mockNavigation} />);
  fireEvent.press(await screen.findByLabelText('Biller EKEDC'));
  fireEvent.changeText(screen.getByLabelText('Customer number'), '12345678901');
  fireEvent.changeText(screen.getByLabelText('Amount'), '500');
  fireEvent.press(screen.getByText('Validate'));
  await screen.findByText(/Valid — Valid — EKEDC/);
  return fetchMock;
}

describe('BillsScreen pay flow (W10-B4b)', () => {
  it('sends the zod-exact pay body, opens the in-app checkout with the authorizationUrl, and renders submitted as pending (NOT delivered)', async () => {
    const fetchMock = await prepareBillDraft();
    fireEvent.press(screen.getByLabelText('Pay'));
    // Initiation panel with the real reference.
    expect(await screen.findByText(/Payment initiated\. Reference: BP-ABC12345/)).toBeTruthy();

    // zod-exact body: biller, customerNumber, meterType (electricity),
    // amountNGN, idempotencyKey — nothing else.
    const body = mutationInput(fetchMock, 'memberBillPayments.pay');
    expect(Object.keys(body).sort()).toEqual(
      ['amountNGN', 'biller', 'customerNumber', 'idempotencyKey', 'meterType'],
    );
    expect(body).toMatchObject({
      biller: 'EKEDC', customerNumber: '12345678901', meterType: 'prepaid', amountNGN: 500,
    });
    expect(body.idempotencyKey).toMatch(IDEM_RE);

    // authorizationUrl handoff (W10-B5): the SERVER URL + reference go to
    // the in-app PaystackCheckout WebView, verbatim.
    fireEvent.press(screen.getByLabelText('Complete payment'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PaystackCheckout', {
      authorizationUrl: 'https://checkout.paystack.com/real-session-1',
      reference: 'BP-ABC12345',
    });

    // Confirm → tri-state: submitted = pending fulfillment, never delivered.
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    expect(await screen.findByText(/pending fulfillment\. It has NOT been delivered yet/)).toBeTruthy();
    expect(mutationInput(fetchMock, 'memberBillPayments.confirmPay')).toEqual({
      reference: 'BP-ABC12345',
    });
  });

  it('keeps one key per draft, rotates on edit, retires on terminal confirm', async () => {
    let confirmResponse: any = CONFIRM_SUBMITTED;
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberBillPayments.pay': () => ({ ...INITIATION, idempotent: true }),
      'memberBillPayments.confirmPay': () => confirmResponse,
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Biller EKEDC'));
    fireEvent.changeText(screen.getByLabelText('Customer number'), '12345678901');
    fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    fireEvent.press(screen.getByText('Validate'));
    await screen.findByText(/Valid — Valid — EKEDC/);

    // Same draft twice → SAME key (server would answer idempotent:true).
    fireEvent.press(screen.getByLabelText('Pay'));
    await screen.findByText(/same payment resumed/);
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(mutationInputs(fetchMock, 'memberBillPayments.pay').length).toBe(2));
    const [first, second] = mutationInputs(fetchMock, 'memberBillPayments.pay');
    expect(first.idempotencyKey).toBe(second.idempotencyKey);

    // Non-terminal confirm (submitted) keeps the key alive.
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    await screen.findByText(/pending fulfillment/);
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(mutationInputs(fetchMock, 'memberBillPayments.pay').length).toBe(3));
    expect(mutationInputs(fetchMock, 'memberBillPayments.pay')[2].idempotencyKey).toBe(first.idempotencyKey);

    // Edit the draft → key rotates (server payload-hash binding would
    // CONFLICT a reused key, so the client must mint a fresh one).
    fireEvent.changeText(screen.getByLabelText('Amount'), '700');
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(mutationInputs(fetchMock, 'memberBillPayments.pay').length).toBe(4));
    const rotated = mutationInputs(fetchMock, 'memberBillPayments.pay')[3].idempotencyKey;
    expect(rotated).not.toBe(first.idempotencyKey);
    expect(rotated).toMatch(IDEM_RE);

    // Terminal confirm (failed) retires the key → next identical draft mints
    // a NEW key.
    confirmResponse = {
      ...CONFIRM_SUBMITTED, status: 'failed', providerStatus: 'rejected',
      failureReason: 'biller rejected the meter', refundStatus: 'failed_refund_pending',
    };
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    await screen.findByText(/FAILED\./);
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(mutationInputs(fetchMock, 'memberBillPayments.pay').length).toBe(5));
    expect(mutationInputs(fetchMock, 'memberBillPayments.pay')[4].idempotencyKey).not.toBe(rotated);
  });

  it('renders failed + failed_refund_pending loudly', async () => {
    const fetchMock = await prepareBillDraft();
    fireEvent.press(screen.getByLabelText('Pay'));
    await screen.findByText(/Payment initiated/);
    // Rewire confirm to a terminal failure (payload-hash of truth: loud).
    (global as any).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('memberBillPayments.confirmPay')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            result: {
              data: {
                json: {
                  ...CONFIRM_SUBMITTED, status: 'failed', providerStatus: 'rejected',
                  failureReason: 'biller rejected the meter', refundStatus: 'failed_refund_pending',
                },
              },
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
    });
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    expect(await screen.findByText(/Your payment was captured but the bill payment FAILED\./)).toBeTruthy();
    expect(screen.getByText(/failed_refund_pending/)).toBeTruthy();
    expect(screen.getByText(/Reason: biller rejected the meter/)).toBeTruthy();
    void fetchMock;
  });

  it('renders unknown_outcome as held pending — do NOT pay again', async () => {
    await prepareBillDraft();
    fireEvent.press(screen.getByLabelText('Pay'));
    await screen.findByText(/Payment initiated/);
    (global as any).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('memberBillPayments.confirmPay')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            result: {
              data: {
                json: { ...CONFIRM_SUBMITTED, status: 'pending', providerStatus: 'unknown_outcome' },
              },
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
    });
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    expect(await screen.findByText(/held pending and will be resolved by a status check; do NOT pay again/)).toBeTruthy();
  });

  it('renders completed ONLY on a server success status', async () => {
    await prepareBillDraft();
    fireEvent.press(screen.getByLabelText('Pay'));
    await screen.findByText(/Payment initiated/);
    (global as any).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('memberBillPayments.confirmPay')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            result: {
              data: {
                json: { ...CONFIRM_SUBMITTED, status: 'success', providerStatus: 'success' },
              },
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
    });
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    expect(await screen.findByText(/confirmed your bill payment as completed/)).toBeTruthy();
    expect(screen.queryByText(/delivered/)).toBeNull();
  });

  it('re-locks Pay when the validated draft is edited (staleness gate)', async () => {
    await prepareBillDraft();
    // Sanity: the draft is Pay-ready.
    expect(screen.getByLabelText('Pay').props.accessibilityState?.disabled).toBeFalsy();
    // Edit the customer number after validating → Pay re-locks until a
    // fresh validateCustomer covers the CURRENT draft.
    fireEvent.changeText(screen.getByLabelText('Customer number'), '99999999999');
    await waitFor(() =>
      expect(screen.getByLabelText('Pay').props.accessibilityState?.disabled).toBe(true),
    );
  });

  it('omits meterType for non-electricity billers (zod-exact)', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '1234567890', biller: 'DSTV', message: 'Valid',
      }),
      'memberBillPayments.pay': () => INITIATION,
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Biller DSTV'));
    // No meter-type selector for a TV biller.
    expect(screen.queryByLabelText('Meter prepaid')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Customer number'), '1234567890');
    fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    fireEvent.press(screen.getByText('Validate'));
    await screen.findByText(/Valid — Valid — DSTV/);
    fireEvent.press(screen.getByLabelText('Pay'));
    await screen.findByText(/Payment initiated/);
    const body = mutationInput(fetchMock, 'memberBillPayments.pay');
    expect(body).toMatchObject({ biller: 'DSTV', customerNumber: '1234567890', amountNGN: 500 });
    expect('meterType' in body).toBe(false);
  });

  it('blocks Pay on an out-of-range amount and surfaces the pay error verbatim', async () => {
    const fetchMock = await prepareBillDraft();
    // Below the registry minimum → Pay stays locked.
    fireEvent.changeText(screen.getByLabelText('Amount'), '50');
    await waitFor(() =>
      expect(screen.getByLabelText('Pay').props.accessibilityState?.disabled).toBe(true),
    );
    expect(screen.getByText(/Enter a whole amount between ₦100 and ₦500,000/)).toBeTruthy();
    // Server PRECONDITION surfaces verbatim.
    (global as any).fetch = jest.fn(async (url: string, opts: any) => {
      if (String(url).includes('memberBillPayments.pay') && opts?.method === 'POST') {
        return {
          ok: false, status: 500,
          json: async () => ({ error: { message: 'No member profile is bound to this session — bill payment is unavailable (fail-closed)' } }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
    });
    fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    await waitFor(() =>
      expect(screen.getByLabelText('Pay').props.accessibilityState?.disabled).toBeFalsy(),
    );
    fireEvent.press(screen.getByLabelText('Pay'));
    expect(await screen.findByText(/Payment could not be initiated: No member profile is bound to this session/)).toBeTruthy();
    void fetchMock;
  });
});

// ── Airtime vend + momo cash flows ──────────────────────────────────────────

const AIRTIME_EMPTY = {
  'memberAirtime.myHistory': () => ({ history: [], total: 0 }),
  'memberAirtime.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
  'memberMobileMoney.providers': () => ({
    providers: [{ name: 'MTN MoMo', cashInCommission: 0.015, cashOutCommission: 0.015 }],
    limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
    configured: true,
  }),
  'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
  'memberMobileMoney.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
};

const VEND_INITIATION = {
  ...INITIATION, reference: 'AV-XYZ98765',
  authorizationUrl: 'https://checkout.paystack.com/real-vend-1',
};

describe('AirtimeScreen vend + momo cash flows (W10-B4b)', () => {
  it('vend sends the zod-exact body with NO phoneNumber when blank and hands off the authorizationUrl', async () => {
    const fetchMock = mockFetchSequence({
      ...AIRTIME_EMPTY,
      'memberAirtime.vend': () => VEND_INITIATION,
      'memberAirtime.confirmVend': () => ({ ...CONFIRM_SUBMITTED, reference: 'AV-XYZ98765' }),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('Airtime amount'), '200');
    fireEvent.press(screen.getByText('Buy airtime'));
    expect(await screen.findByText(/Payment initiated\. Reference: AV-XYZ98765/)).toBeTruthy();

    const body = mutationInput(fetchMock, 'memberAirtime.vend');
    expect(Object.keys(body).sort()).toEqual(['amountNGN', 'idempotencyKey', 'network']);
    expect(body).toMatchObject({ network: 'MTN', amountNGN: 200 });
    expect('phoneNumber' in body).toBe(false);
    expect(body.idempotencyKey).toMatch(IDEM_RE);

    fireEvent.press(screen.getByLabelText('Complete payment'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PaystackCheckout', {
      authorizationUrl: 'https://checkout.paystack.com/real-vend-1',
      reference: 'AV-XYZ98765',
    });

    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    expect(await screen.findByText(/your airtime purchase was submitted and is pending fulfillment\. It has NOT been delivered yet/)).toBeTruthy();
    expect(mutationInput(fetchMock, 'memberAirtime.confirmVend')).toEqual({ reference: 'AV-XYZ98765' });
  });

  it('vend includes the beneficiary phone only when provided, and guards invalid phones / amounts client-side', async () => {
    const fetchMock = mockFetchSequence({
      ...AIRTIME_EMPTY,
      'memberAirtime.vend': () => VEND_INITIATION,
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('Beneficiary phone'), '123'); // invalid
    fireEvent.changeText(screen.getByLabelText('Airtime amount'), '200');
    fireEvent.press(screen.getByText('Buy airtime'));
    expect(await screen.findByText(/Enter a valid Nigerian phone number/)).toBeTruthy();
    expect(mutationInputs(fetchMock, 'memberAirtime.vend').length).toBe(0);

    fireEvent.changeText(screen.getByLabelText('Beneficiary phone'), '08031234567');
    fireEvent.press(screen.getByText('Buy airtime'));
    await screen.findByText(/Payment initiated/);
    expect(mutationInput(fetchMock, 'memberAirtime.vend')).toMatchObject({
      network: 'MTN', phoneNumber: '08031234567', amountNGN: 200,
    });

    // Below ₦50 → button locked (zod boundary): pressing it sends NOTHING.
    fireEvent.changeText(screen.getByLabelText('Airtime amount'), '10');
    fireEvent.press(screen.getByText('Buy airtime'));
    await waitFor(() =>
      expect(mutationInputs(fetchMock, 'memberAirtime.vend').length).toBe(1),
    );
  });

  it('cashIn is two-phase with a stable per-draft key; cashOut surfaces PRECONDITION verbatim', async () => {
    const PRECONDITION =
      'Mobile-money provider is not configured — cash-out is unavailable (fail-closed)';
    const fetchMock = mockFetchSequence({
      ...AIRTIME_EMPTY,
      'memberMobileMoney.cashIn': () => ({
        ...INITIATION, reference: 'CI-QWE54321',
        authorizationUrl: 'https://checkout.paystack.com/real-cashin-1',
      }),
      'memberMobileMoney.confirmCashIn': () => ({ ...CONFIRM_SUBMITTED, reference: 'CI-QWE54321' }),
      'memberMobileMoney.cashOut': () => new Error(PRECONDITION),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    // Wait for the provider registry (limits gate the amount client-side).
    await screen.findByLabelText('Cash provider MTN MoMo');
    fireEvent.changeText(screen.getByLabelText('Cash amount'), '5000');

    // Cash in → zod-exact body.
    fireEvent.press(screen.getByText('Cash in'));
    expect(await screen.findByText(/Payment initiated\. Reference: CI-QWE54321/)).toBeTruthy();
    const body = mutationInput(fetchMock, 'memberMobileMoney.cashIn');
    expect(Object.keys(body).sort()).toEqual(['amountNGN', 'idempotencyKey', 'provider']);
    expect(body).toMatchObject({ provider: 'MTN MoMo', amountNGN: 5000 });

    fireEvent.press(screen.getByLabelText('Complete payment'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PaystackCheckout', {
      authorizationUrl: 'https://checkout.paystack.com/real-cashin-1',
      reference: 'CI-QWE54321',
    });
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    expect(await screen.findByText(/your cash-in was submitted and is pending fulfillment/)).toBeTruthy();

    // Cash out → the server PRECONDITION verdict is surfaced VERBATIM.
    fireEvent.press(screen.getByText('Cash out'));
    expect(await screen.findByText(`Cash-out was not recorded: ${PRECONDITION}`)).toBeTruthy();
    // No fabricated cash-out result panel.
    expect(screen.queryByTestId('cashout-result')).toBeNull();
    const coBody = mutationInput(fetchMock, 'memberMobileMoney.cashOut');
    expect(Object.keys(coBody).sort()).toEqual(['amountNGN', 'idempotencyKey', 'provider']);
  });

  it('cashOut success renders PENDING-only — never a completed payout', async () => {
    mockFetchSequence({
      ...AIRTIME_EMPTY,
      'memberMobileMoney.cashOut': () => ({
        reference: 'CO-RTY13579', status: 'pending', providerStatus: 'submitted',
        amount: '5000', currency: 'NGN', transactionId: 91,
        failureReason: null, idempotent: false,
      }),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    await screen.findByLabelText('Cash provider MTN MoMo');
    fireEvent.changeText(screen.getByLabelText('Cash amount'), '5000');
    fireEvent.press(screen.getByText('Cash out'));
    expect(await screen.findByTestId('cashout-result')).toBeTruthy();
    expect(screen.getByText(/Cash-out request recorded\. Reference: CO-RTY13579/)).toBeTruthy();
    expect(screen.getByText(/this is NOT a completed payout/)).toBeTruthy();
    expect(screen.getByText(/Status: pending/)).toBeTruthy();
  });
});

// ── KYC submission ──────────────────────────────────────────────────────────

const KYC_NO_SESSION = {
  hasProfile: true, hasSession: false, status: 'unstarted', kycLevel: 0, session: null,
};

describe('KycSubmitScreen (W10-B4b)', () => {
  it('submits the zod-strict body and renders the verbatim adjudicated verdict', async () => {
    const fetchMock = mockFetchSequence({
      'memberIdentity.myKycStatus': () => KYC_NO_SESSION,
      'memberIdentity.submitKyc': () => ({
        sessionId: 12, status: 'verified', verified: true,
        serviceOutcome: 'adjudicated', serviceStatus: 'verified',
        message: 'Identity verified by the verification service.',
      }),
    });
    renderScreen(<KycSubmitScreen navigation={mockNavigation} />);
    await screen.findByText(/Current status: unstarted/);
    fireEvent.changeText(screen.getByLabelText('Document number'), '12345678901');
    fireEvent.press(screen.getByText('Submit for verification'));
    const result = await screen.findByTestId('kyc-submit-result');
    expect(result).toBeTruthy();
    expect(screen.getByText(/Identity verified by the verification service\. \(session #12, status: verified\)/)).toBeTruthy();
    // zod-STRICT: { docType, docNumber } only.
    expect(mutationInput(fetchMock, 'memberIdentity.submitKyc')).toEqual({
      docType: 'nin', docNumber: '12345678901',
    });
  });

  it('renders the "unavailable stays pending" outcome verbatim, never as success', async () => {
    const message =
      'Verification could not be completed: service timeout. Your submission is pending and will be verified when the service recovers.';
    mockFetchSequence({
      'memberIdentity.myKycStatus': () => KYC_NO_SESSION,
      'memberIdentity.submitKyc': () => ({
        sessionId: 13, status: 'pending', verified: false,
        serviceOutcome: 'unavailable', message,
      }),
    });
    renderScreen(<KycSubmitScreen navigation={mockNavigation} />);
    await screen.findByText(/Current status: unstarted/);
    fireEvent.changeText(screen.getByLabelText('Document number'), '12345678901');
    fireEvent.press(screen.getByText('Submit for verification'));
    expect(await screen.findByText(new RegExp(`Verification could not be completed: service timeout.*status: pending`))).toBeTruthy();
  });

  it('guards the 11-digit docNumber client-side (no request is sent)', async () => {
    const fetchMock = mockFetchSequence({
      'memberIdentity.myKycStatus': () => KYC_NO_SESSION,
      'memberIdentity.submitKyc': () => ({}),
    });
    renderScreen(<KycSubmitScreen navigation={mockNavigation} />);
    await screen.findByText(/Current status: unstarted/);
    fireEvent.changeText(screen.getByLabelText('Document number'), '12345');
    fireEvent.press(screen.getByText('Submit for verification'));
    expect(await screen.findByText('NIN/BVN must be exactly 11 digits.')).toBeTruthy();
    expect(mutationInputs(fetchMock, 'memberIdentity.submitKyc').length).toBe(0);
  });

  it('renders the open-session status panel instead of a duplicate form, with refresh', async () => {
    const fetchMock = mockFetchSequence({
      'memberIdentity.myKycStatus': () => ({
        hasProfile: true, hasSession: true, status: 'pending', kycLevel: 0,
        session: {
          id: 21, status: 'pending', type: 'member_document', livenessPassed: null,
          livenessScore: null, docType: 'nin', rejectionReason: null,
          reviewedAt: null, createdAt: '2026-10-04', updatedAt: '2026-10-04',
        },
      }),
      'memberIdentity.myKycSession': () => ({
        id: 21, status: 'pending', type: 'member_document', livenessPassed: null,
        livenessScore: null, docType: 'nin', rejectionReason: null,
        reviewedAt: null, createdAt: '2026-10-04', updatedAt: '2026-10-04',
      }),
    });
    renderScreen(<KycSubmitScreen navigation={mockNavigation} />);
    expect(await screen.findByTestId('kyc-open-session')).toBeTruthy();
    expect(screen.getByText(/open KYC submission \(#21\)/)).toBeTruthy();
    // No duplicate form while the session is open.
    expect(screen.queryByLabelText('Document number')).toBeNull();
    expect(screen.queryByText('Submit for verification')).toBeNull();
    // Refresh re-reads the truth (myKycSession + myKycStatus).
    fireEvent.press(screen.getByLabelText('Refresh status'));
    await waitFor(() => {
      const sessionReads = fetchMock.mock.calls.filter(([u]: any[]) =>
        String(u).includes('memberIdentity.myKycSession'),
      );
      expect(sessionReads.length).toBeGreaterThanOrEqual(2);
    });
    // zod-strict session read input.
    const url = String(
      fetchMock.mock.calls.find(([u]: any[]) => String(u).includes('memberIdentity.myKycSession'))?.[0],
    );
    expect(JSON.parse(decodeURIComponent(url.split('input=')[1])).json).toEqual({ sessionId: 21 });
  });

  it('honest empty state when no customer profile exists (no form)', async () => {
    mockFetchSequence({
      'memberIdentity.myKycStatus': () => ({
        hasProfile: false, hasSession: false, status: 'unstarted', kycLevel: 0, session: null,
      }),
    });
    renderScreen(<KycSubmitScreen navigation={mockNavigation} />);
    expect(await screen.findByText(/No customer profile is linked to your account yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Document number')).toBeNull();
  });
});
