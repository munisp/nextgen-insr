/**
 * screens-money.test.tsx — 2026-10-03 (W9-B5 wave 3, FINAL wave)
 * Harness tests for the new Bills / Airtime & Mobile Money / FX / Parametric /
 * Phone Verification screens. The network boundary (fetch) is mocked with the
 * REAL superjson envelope `{result:{data:{json:<payload>}}}` (see
 * harness.tsx header); the screens, services (api.ts wrappers), memberTrpc
 * auth and config transport are all production code. Mutation tests assert
 * the exact procedure name and input body — matching the server zod schemas
 * (server/routers/memberPhone.ts:93-114).
 *
 * FUNDS DISCIPLINE — 2026-10-04 (W10-B4b, honest-contract rewrite): the
 * W10-B2 member funds mutations (memberBillPayments.pay/confirmPay,
 * memberAirtime.vend/confirmVend, memberMobileMoney.cashIn/confirmCashIn/
 * cashOut) NOW EXIST and are wired on these screens — the full flow
 * coverage (zod-exact bodies, idempotency-key lifecycle, authorizationUrl
 * handoff, tri-state renders, cashOut PRECONDITION verbatim) lives in
 * screens-funds.test.tsx. The two pre-existing "not available in this app
 * yet" assertions below were rewritten to the screens' current honest copy
 * (the pay flows are real now; member bill HISTORY is still unshipped
 * server-side and the disclosure text asserts exactly that). memberFxRates /
 * parametricMember still expose no mutations — unchanged. The phone-OTP pair
 * carries no funds and no idempotency key (throttle/lock server-side).
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

// See screens-data.test.tsx — first-test transform warm-up under worker
// contention can exceed jest's 5s default.
jest.setTimeout(20000);

import { BillsScreen } from '../src/screens/BillsScreen';
import { AirtimeScreen } from '../src/screens/AirtimeScreen';
import { FxScreen } from '../src/screens/FxScreen';
import { ParametricScreen } from '../src/screens/ParametricScreen';
import { PhoneVerificationScreen } from '../src/screens/PhoneVerificationScreen';

/** Find the fetch call to a procedure and parse its real body. */
function mutationInput(fetchMock: jest.Mock, procedure: string): any {
  const call = fetchMock.mock.calls.find(
    ([url, opts]: any[]) => String(url).endsWith(`/${procedure}`) && opts?.method === 'POST',
  );
  expect(call).toBeTruthy();
  return JSON.parse((call as any[])[1].body).json;
}

beforeEach(resetHarness);
afterEach(() => { delete (global as any).fetch; });

describe('BillsScreen', () => {
  const BILLERS = {
    billers: [
      { name: 'EKEDC', commissionRate: 0.005, commissionPct: '0.5%' },
      { name: 'DSTV', commissionRate: 0.01, commissionPct: '1.0%' },
    ],
    limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
    configured: true,
  };

  it('renders the real biller catalog, limits and honest notes', async () => {
    mockFetchSequence({ 'memberBillPayments.billers': () => BILLERS });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading billers/i)).toBeTruthy();
    expect(await screen.findByTestId('biller-EKEDC')).toBeTruthy();
    expect(screen.getByText('0.5%')).toBeTruthy();
    expect(screen.getByText(/Limits: ₦100 – ₦500,000 per payment, ₦2,000,000 daily/)).toBeTruthy();
    // 2026-10-04 (W10-B4b): pay is wired now; the remaining honest
    // disclosure is that member bill HISTORY is not server-scopable yet.
    expect(screen.getByText(/bill-payment history will appear here once member-scoped/i)).toBeTruthy();
  });

  it('discloses honestly when no provider is configured', async () => {
    mockFetchSequence({
      'memberBillPayments.billers': () => ({ ...BILLERS, configured: false }),
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    expect(await screen.findByText(/No bill-payment provider is configured/i)).toBeTruthy();
  });

  it('surfaces the server error verbatim instead of a fabricated catalog', async () => {
    mockFetchSequence({ 'memberBillPayments.billers': () => new Error('DB unavailable') });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
    expect(screen.queryByTestId('biller-EKEDC')).toBeNull();
  });

  it('validateCustomer sends the zod-exact input and renders the real result', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Biller EKEDC'));
    fireEvent.changeText(screen.getByLabelText('Customer number'), '12345678901');
    fireEvent.press(screen.getByText('Validate'));
    expect(await screen.findByText(/Valid — Valid — EKEDC \/ 12345678901/)).toBeTruthy();
    // zod-exact query input: { biller, customerNumber } only.
    const url = String(fetchMock.mock.calls.find(([u]: any[]) => String(u).includes('validateCustomer'))?.[0]);
    const parsed = JSON.parse(decodeURIComponent(url.split('input=')[1]));
    expect(parsed.json).toEqual({ biller: 'EKEDC', customerNumber: '12345678901' });
  });

  it('renders an invalid format result honestly (not a payment authorization)', async () => {
    mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: false, customerNumber: '99', biller: 'EKEDC', message: 'Invalid customer number',
      }),
    });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Biller EKEDC'));
    fireEvent.changeText(screen.getByLabelText('Customer number'), '99');
    fireEvent.press(screen.getByText('Validate'));
    expect(await screen.findByText(/Invalid — Invalid customer number/)).toBeTruthy();
  });
});

describe('AirtimeScreen', () => {
  const AIRTIME_ROW = {
    ref: 'AIR-001', network: 'MTN', phoneNumber: '08031234567', amount: '500',
    status: 'success', providerStatus: null, failureReason: null, createdAt: '2026-10-01',
  };
  const MOMO_ROW = {
    ref: 'MM-001', type: 'Cash In', amount: '5000', fee: '25', status: 'pending_provider',
    provider: 'MTN MoMo', providerStatus: null, createdAt: '2026-10-02',
  };

  it('renders real airtime summary/history and momo data incl. pending status', async () => {
    mockFetchSequence({
      'memberAirtime.myHistory': () => ({ history: [AIRTIME_ROW], total: 1 }),
      'memberAirtime.mySummary': () => ({
        periodDays: 30, totalTransactions: 1,
        byStatus: [{ status: 'success', count: 1, volumeNGN: 500 }],
      }),
      'memberMobileMoney.providers': () => ({
        providers: [{ name: 'MTN MoMo', cashInCommission: 0.015, cashOutCommission: 0.015 }],
        limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 1000000 },
        configured: true,
      }),
      'memberMobileMoney.myTransactions': () => ({ transactions: [MOMO_ROW], count: 1 }),
      'memberMobileMoney.mySummary': () => ({
        periodDays: 30, totalTransactions: 1,
        byStatus: [{ status: 'pending_provider', count: 1, volumeNGN: 5000 }],
      }),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading airtime summary/i)).toBeTruthy();
    expect(await screen.findByText('AIR-001')).toBeTruthy();
    expect(screen.getByText(/MTN · 08031234567 · ₦500/)).toBeTruthy();
    expect(await screen.findByText('MM-001')).toBeTruthy();
    // Pending-provider rows are disclosed, never hidden (raw text; uppercase
    // is only a display transform).
    expect(screen.getAllByText('pending_provider').length).toBeGreaterThanOrEqual(2);
    // 2026-10-04 (W10-B4b): the honest note now discloses that a submitted
    // purchase is pending until the provider confirms it (never "delivered").
    expect(screen.getByText(/pending until the provider confirms it/i)).toBeTruthy();
  });

  it('shows the honest empty states', async () => {
    mockFetchSequence({
      'memberAirtime.myHistory': () => ({ history: [], total: 0 }),
      'memberAirtime.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
      'memberMobileMoney.providers': () => ({
        providers: [], limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 1000000 }, configured: false,
      }),
      'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
      'memberMobileMoney.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    expect(await screen.findByText('You have no airtime purchases yet.')).toBeTruthy();
    expect(await screen.findByText('You have no mobile-money transactions yet.')).toBeTruthy();
    expect(screen.getByText(/No mobile-money provider is configured/i)).toBeTruthy();
    expect(screen.getAllByText(/No transactions in the last 30 days/i).length).toBe(2);
  });

  it('surfaces server errors verbatim instead of fabricated history', async () => {
    mockFetchSequence({
      'memberAirtime.myHistory': () => new Error('DB unavailable'),
      'memberAirtime.mySummary': () => new Error('DB unavailable'),
      'memberMobileMoney.myTransactions': () => new Error('DB unavailable'),
      'memberMobileMoney.mySummary': () => new Error('DB unavailable'),
      'memberMobileMoney.providers': () => new Error('DB unavailable'),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    expect((await screen.findAllByText('DB unavailable')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/₦/)).toBeNull();
  });

  it('loads momo transaction detail by ref and surfaces failureReason', async () => {
    mockFetchSequence({
      'memberAirtime.myHistory': () => ({ history: [], total: 0 }),
      'memberAirtime.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
      'memberMobileMoney.providers': () => ({ providers: [], limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 1000000 }, configured: true }),
      'memberMobileMoney.myTransactions': () => ({ transactions: [{ ...MOMO_ROW, status: 'failed' }], count: 1 }),
      'memberMobileMoney.mySummary': () => ({ periodDays: 30, totalTransactions: 1, byStatus: [{ status: 'failed', count: 1, volumeNGN: 5000 }] }),
      'memberMobileMoney.myTransaction': () => ({
        transaction: { ...MOMO_ROW, status: 'failed', failureReason: 'Provider timeout' },
      }),
    });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Transaction MM-001'));
    expect(await screen.findByTestId('momo-detail')).toBeTruthy();
    expect(screen.getByText(/Failure reason: Provider timeout/)).toBeTruthy();
  });
});

describe('FxScreen', () => {
  const RATES = { baseCurrency: 'EUR', rates: { NGN: 1650.5, USD: 1.09 }, lastUpdated: '2026-10-02T00:00:00Z' };

  it('renders the real published rate book', async () => {
    mockFetchSequence({
      'memberFxRates.rates': () => RATES,
      'memberFxRates.currencies': () => ({ currencies: [{ code: 'NGN', rate: 1650.5 }, { code: 'USD', rate: 1.09 }], baseCurrency: 'EUR' }),
    });
    renderScreen(<FxScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading exchange rates/i)).toBeTruthy();
    expect(await screen.findByTestId('fx-rate-NGN')).toBeTruthy();
    expect(screen.getByText('1650.5000')).toBeTruthy();
    expect(screen.getByText(/Base: EUR · Last updated:/)).toBeTruthy();
  });

  it('shows the honest empty state when no rates are published (no fixture rates)', async () => {
    mockFetchSequence({
      'memberFxRates.rates': () => ({ baseCurrency: 'EUR', rates: {}, lastUpdated: null }),
      'memberFxRates.currencies': () => ({ currencies: [], baseCurrency: 'EUR' }),
    });
    renderScreen(<FxScreen navigation={mockNavigation} />);
    expect(await screen.findByText('No exchange rates have been published yet.')).toBeTruthy();
    expect(screen.queryByTestId(/^fx-rate-/)).toBeNull();
  });

  it('surfaces the server error verbatim instead of fabricated rates', async () => {
    mockFetchSequence({
      'memberFxRates.rates': () => new Error('DB unavailable'),
      'memberFxRates.currencies': () => new Error('DB unavailable'),
    });
    renderScreen(<FxScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
  });

  it('convert sends the zod-exact input and renders the server conversion', async () => {
    const fetchMock = mockFetchSequence({
      'memberFxRates.rates': () => RATES,
      'memberFxRates.currencies': () => ({ currencies: [{ code: 'NGN', rate: 1650.5 }, { code: 'USD', rate: 1.09 }], baseCurrency: 'EUR' }),
      'memberFxRates.convert': () => ({ from: 'NGN', to: 'USD', amount: 1000, convertedAmount: 0.66, rate: 0.0006604 }),
    });
    renderScreen(<FxScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('FX amount'), '1000');
    fireEvent.press(screen.getByLabelText('Convert button'));
    expect(await screen.findByText(/1000 NGN = 0.66 USD/)).toBeTruthy();
    expect(screen.getByText(/rate 0\.000660/)).toBeTruthy();
    const url = String(fetchMock.mock.calls.find(([u]: any[]) => String(u).includes('memberFxRates.convert'))?.[0]);
    const parsed = JSON.parse(decodeURIComponent(url.split('input=')[1]));
    // zod-exact: { from /^[A-Z]{3}$/, to, amount > 0 } — nothing else.
    expect(parsed.json).toEqual({ from: 'NGN', to: 'USD', amount: 1000 });
  });

  it('convert surfaces PRECONDITION_FAILED verbatim when the book is missing', async () => {
    mockFetchSequence({
      'memberFxRates.rates': () => ({ baseCurrency: 'EUR', rates: {}, lastUpdated: null }),
      'memberFxRates.currencies': () => ({ currencies: [], baseCurrency: 'EUR' }),
      'memberFxRates.convert': () => new Error('convert: no FX rates are stored; rates not refreshed yet'),
    });
    renderScreen(<FxScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Convert button'));
    expect(await screen.findByText('convert: no FX rates are stored; rates not refreshed yet')).toBeTruthy();
  });

  it('historical renders the real ECB time-series rows', async () => {
    mockFetchSequence({
      'memberFxRates.rates': () => RATES,
      'memberFxRates.currencies': () => ({ currencies: [{ code: 'NGN', rate: 1650.5 }, { code: 'USD', rate: 1.09 }], baseCurrency: 'EUR' }),
      'memberFxRates.historical': () => ({
        base: 'NGN', target: 'USD',
        timeseries: [{ date: '2026-10-01', rate: 0.00066 }, { date: '2026-10-02', rate: 0.00067 }],
        source: 'frankfurter/ecb',
      }),
    });
    renderScreen(<FxScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('Load history'));
    expect(await screen.findByText('2026-10-01')).toBeTruthy();
    expect(screen.getByText('NGN → USD')).toBeTruthy();
  });
});

describe('ParametricScreen', () => {
  const COVERAGE_ROW = {
    policyId: 7, productName: 'Flood Guard', coveredPeril: 'flood',
    payoutAmount: '250000', currency: 'NGN', status: 'active', triggerStatus: 'armed',
  };
  const PAYOUT_ROW = {
    id: 3, eventId: 11, claimId: 21, policyId: 7, amount: '250000',
    currency: 'NGN', status: 'paid', createdAt: '2026-09-20',
  };

  it('renders real coverage and payouts', async () => {
    mockFetchSequence({
      'parametricMember.myCoverage': () => ({ coverage: [COVERAGE_ROW] }),
      'parametricMember.myPayouts': () => ({ payouts: [PAYOUT_ROW], count: 1 }),
    });
    renderScreen(<ParametricScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading parametric coverage/i)).toBeTruthy();
    expect(await screen.findByText('Policy #7')).toBeTruthy();
    expect(screen.getByText(/Flood Guard · Peril: flood · Payout ₦250,000/)).toBeTruthy();
    expect(screen.getByText(/Trigger: armed/)).toBeTruthy();
    expect(await screen.findByText('Payout #3')).toBeTruthy();
    expect(screen.getByText(/Policy #7 · Claim #21 · Event #11/)).toBeTruthy();
  });

  it('shows the honest empty states', async () => {
    mockFetchSequence({
      'parametricMember.myCoverage': () => ({ coverage: [] }),
      'parametricMember.myPayouts': () => ({ payouts: [], count: 0 }),
    });
    renderScreen(<ParametricScreen navigation={mockNavigation} />);
    expect(await screen.findByText('You have no parametric coverage yet.')).toBeTruthy();
    expect(await screen.findByText('You have no parametric payouts yet.')).toBeTruthy();
  });

  it('surfaces server errors verbatim instead of fabricated coverage', async () => {
    mockFetchSequence({
      'parametricMember.myCoverage': () => new Error('DB unavailable'),
      'parametricMember.myPayouts': () => new Error('DB unavailable'),
    });
    renderScreen(<ParametricScreen navigation={mockNavigation} />);
    expect((await screen.findAllByText('DB unavailable')).length).toBe(2);
    expect(screen.queryByText(/₦/)).toBeNull();
  });
});

describe('PhoneVerificationScreen', () => {
  it('request sends { phone } only — no userId/customerId anywhere', async () => {
    const fetchMock = mockFetchSequence({
      'memberPhone.requestPhoneOtp': () => ({ success: true, message: 'Verification code sent by SMS' }),
    });
    renderScreen(<PhoneVerificationScreen navigation={mockNavigation} />);
    fireEvent.changeText(screen.getByLabelText('Phone number'), '08031234567');
    fireEvent.press(screen.getByText('Send verification code'));
    await waitFor(() => {
      // zod-exact (memberPhone.ts:93-94): { phone } ONLY.
      expect(mutationInput(fetchMock, 'memberPhone.requestPhoneOtp')).toEqual({ phone: '08031234567' });
    });
    expect(await screen.findByText('Verification code sent by SMS')).toBeTruthy();
    expect(await screen.findByText('Verify code')).toBeTruthy();
  });

  it('verify sends { phone, otp } only and success requires verified===true', async () => {
    const fetchMock = mockFetchSequence({
      'memberPhone.requestPhoneOtp': () => ({ success: true, message: 'Verification code sent by SMS' }),
      'memberPhone.verifyPhoneOtp': () => ({ verified: true }),
    });
    renderScreen(<PhoneVerificationScreen navigation={mockNavigation} />);
    fireEvent.changeText(screen.getByLabelText('Phone number'), '08031234567');
    fireEvent.press(screen.getByText('Send verification code'));
    fireEvent.changeText(await screen.findByLabelText('OTP code'), '123456');
    fireEvent.press(screen.getByText('Verify code'));
    await waitFor(() => {
      // zod-exact (memberPhone.ts:107-108): { phone, otp: exactly 6 } ONLY.
      expect(mutationInput(fetchMock, 'memberPhone.verifyPhoneOtp')).toEqual({
        phone: '08031234567', otp: '123456',
      });
    });
    expect(await screen.findByText('Your phone number was verified successfully.')).toBeTruthy();
  });

  it('a wrong code ({verified:false}) is surfaced honestly — never a fabricated success', async () => {
    mockFetchSequence({
      'memberPhone.requestPhoneOtp': () => ({ success: true, message: 'Verification code sent by SMS' }),
      'memberPhone.verifyPhoneOtp': () => ({ verified: false }),
    });
    renderScreen(<PhoneVerificationScreen navigation={mockNavigation} />);
    fireEvent.changeText(screen.getByLabelText('Phone number'), '08031234567');
    fireEvent.press(screen.getByText('Send verification code'));
    fireEvent.changeText(await screen.findByLabelText('OTP code'), '000000');
    fireEvent.press(screen.getByText('Verify code'));
    expect(await screen.findByText('The code did not match. Check the SMS and try again.')).toBeTruthy();
    expect(screen.queryByText(/verified successfully/i)).toBeNull();
  });

  it('server errors surface verbatim (fail-closed throttle/lock/proof-marker errors)', async () => {
    mockFetchSequence({
      'memberPhone.requestPhoneOtp': () => ({ success: true, message: 'Verification code sent by SMS' }),
      'memberPhone.verifyPhoneOtp': () => new Error('Too many attempts — request a new code'),
    });
    renderScreen(<PhoneVerificationScreen navigation={mockNavigation} />);
    fireEvent.changeText(screen.getByLabelText('Phone number'), '08031234567');
    fireEvent.press(screen.getByText('Send verification code'));
    fireEvent.changeText(await screen.findByLabelText('OTP code'), '654321');
    fireEvent.press(screen.getByText('Verify code'));
    expect(await screen.findByText('Too many attempts — request a new code')).toBeTruthy();
    expect(screen.queryByText(/verified successfully/i)).toBeNull();
  });

  it('request-stage server errors surface verbatim (fail-loud SMS delivery)', async () => {
    mockFetchSequence({
      'memberPhone.requestPhoneOtp': () => new Error('SMS provider unreachable'),
    });
    renderScreen(<PhoneVerificationScreen navigation={mockNavigation} />);
    fireEvent.changeText(screen.getByLabelText('Phone number'), '08031234567');
    fireEvent.press(screen.getByText('Send verification code'));
    expect(await screen.findByText('SMS provider unreachable')).toBeTruthy();
    // Never advances to the verify stage on failure.
    expect(screen.queryByText('Verify code')).toBeNull();
  });

  it('client-side zod guards block invalid phone/otp before any request is sent', async () => {
    const fetchMock = mockFetchSequence({
      'memberPhone.requestPhoneOtp': () => ({ success: true }),
    });
    renderScreen(<PhoneVerificationScreen navigation={mockNavigation} />);
    fireEvent.changeText(screen.getByLabelText('Phone number'), '123');
    fireEvent.press(screen.getByText('Send verification code'));
    expect(await screen.findByText('Phone number must be 10–15 digits.')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([u]: any[]) => String(u).includes('memberPhone'))).toHaveLength(0);
  });
});
