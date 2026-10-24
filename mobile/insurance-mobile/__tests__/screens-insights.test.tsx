/**
 * screens-insights.test.tsx — 2026-10-24 (W11-B3b): Phase 3 mobile client
 * surfaces over the W11-B3a memberInsights router (web parity:
 * tests/client/MemberInsights.test.tsx):
 *   - DashboardScreen NextActionsPanel: top-3 ranked render, explain text,
 *     per-type CTA navigation, session/forever dismissal, empty → hidden,
 *     error → silent degrade.
 *   - BillsScreen / AirtimeScreen anomaly soft-confirm gate: anomalous holds
 *     the payment until the explicit extra tap; anomalous:false and check
 *     errors proceed normally (UX-only, never a security gate).
 *   - Recurring-payment prompt at the terminal confirm moment, once per app
 *     session per rail.
 *
 * Boundary mocks ONLY (harness.tsx): global.fetch with the real superjson
 * envelope, the offline-sync + auth-store boundaries. The screens, api.ts,
 * memberTrpc transport, and insightsGuards logic are production code.
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { BillsScreen } from '../src/screens/BillsScreen';
import { AirtimeScreen } from '../src/screens/AirtimeScreen';

const ACTIONS = [
  {
    type: 'policy_renewal_due', priority: 100,
    explain: 'Policy POL-1 renews on 2026-11-01 (within 14 days).',
    payload: { policyId: 77 },
  },
  {
    type: 'failed_refund_pending', priority: 90,
    explain: 'Payment BP-1 was captured but the provider rejected fulfillment — a manual refund is pending with operations.',
    payload: { transactionId: 11, reference: 'BP-1' },
  },
  {
    type: 'recurring_bill_due', priority: 70,
    explain: 'Your recurring bill payment (every ~30 days, ~₦5,000) looks due around 2026-11-05.',
    payload: { naturalKey: 'nk1', rail: 'bill' },
  },
  {
    type: 'kyc_incomplete', priority: 40,
    explain: 'Your identity verification is not complete — finish KYC to unlock higher limits.',
    payload: {},
  },
];

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

const CONFIRM_SUCCESS = {
  reference: 'BP-ABC12345',
  status: 'success',
  providerStatus: 'success',
  captureStatus: 'captured',
  amount: '500',
  currency: 'NGN',
  transactionId: 77,
  failureReason: null,
  refundStatus: null,
  idempotent: false,
};

/** fetch URLs that hit a given tRPC procedure. */
function callsTo(fetchMock: jest.Mock, proc: string): any[] {
  return fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes(proc));
}

/** Drive the BillsScreen draft to a Pay-ready state. */
async function prepareBillDraft(fetchMock: jest.Mock) {
  renderScreen(<BillsScreen navigation={mockNavigation} />);
  fireEvent.press(await screen.findByLabelText('Biller EKEDC'));
  fireEvent.changeText(screen.getByLabelText('Customer number'), '12345678901');
  fireEvent.changeText(screen.getByLabelText('Amount'), '500');
  fireEvent.press(screen.getByText('Validate'));
  await screen.findByText(/Valid — Valid — EKEDC/);
  return fetchMock;
}

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => { delete (global as any).fetch; });

describe('DashboardScreen NextActionsPanel (W11-B3b)', () => {
  function renderDashboard(nba: () => any) {
    mockFetchSequence({
      'memberInsights.nextBestActions': nba,
      // Dashboard's other queries settle empty.
      'memberPolicies.myPolicies': () => ({ policies: [], count: 0 }),
      'memberClaims.myClaims': () => ({ claims: [], count: 0 }),
    });
    return renderScreen(<DashboardScreen navigation={mockNavigation} />);
  }

  it('renders the top 3 ranked actions with explain text; the 4th is hidden', async () => {
    renderDashboard(() => ({ actions: ACTIONS }));
    expect(await screen.findByTestId('nba-policy_renewal_due')).toBeTruthy();
    expect(screen.getByTestId('nba-failed_refund_pending')).toBeTruthy();
    expect(screen.getByTestId('nba-recurring_bill_due')).toBeTruthy();
    expect(screen.queryByTestId('nba-kyc_incomplete')).toBeNull();
    expect(screen.getByText(/Policy POL-1 renews on 2026-11-01/)).toBeTruthy();
  }, 15000); // 2026-10-24: first test in the file absorbs jest/RN warmup.

  it('CTA taps navigate into the existing flows', async () => {
    renderDashboard(() => ({ actions: ACTIONS }));
    fireEvent.press(await screen.findByLabelText('Review renewal (policy_renewal_due)'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Policies', {
      screen: 'Renewals', params: { policyId: 77 },
    });
    fireEvent.press(screen.getByLabelText('View payment issue (failed_refund_pending)'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Policies', { screen: 'Disputes' });
    fireEvent.press(screen.getByLabelText('Pay now (recurring_bill_due)'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Policies', { screen: 'Bills' });
  });

  it('Dismiss hides the action for the app session', async () => {
    renderDashboard(() => ({ actions: [ACTIONS[3]] }));
    fireEvent.press(await screen.findByLabelText('Dismiss suggestion kyc_incomplete'));
    await waitFor(() => expect(screen.queryByTestId('nba-kyc_incomplete')).toBeNull());
    expect(screen.queryByTestId('next-actions')).toBeNull();
  });

  it('empty actions hide the panel; an error degrades silently', async () => {
    renderDashboard(() => ({ actions: [] }));
    // Wait for a dashboard element so the query has settled.
    await screen.findByText('Quick Actions');
    await waitFor(() => expect(screen.queryByTestId('next-actions')).toBeNull());

    resetHarness();
    mockFetchSequence({
      'memberInsights.nextBestActions': () => new Error('DB unavailable'),
      'memberPolicies.myPolicies': () => ({ policies: [], count: 0 }),
      'memberClaims.myClaims': () => ({ claims: [], count: 0 }),
    });
    renderScreen(<DashboardScreen navigation={mockNavigation} />);
    await screen.findByText('Quick Actions');
    await waitFor(() => expect(screen.queryByTestId('next-actions')).toBeNull());
  });
});

describe('BillsScreen anomaly soft-confirm gate (W11-B3b)', () => {
  it('an anomalous verdict holds the payment until the explicit confirm tap', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberInsights.amountAnomalyCheck': () => ({
        anomalous: true, multiple: 4.2, reason: 'exceeds_historical_multiple',
      }),
      'memberBillPayments.pay': () => INITIATION,
    });
    await prepareBillDraft(fetchMock);
    fireEvent.press(screen.getByLabelText('Pay'));

    // Soft-confirm appears; the funds mutation has NOT fired.
    expect(await screen.findByTestId('anomaly-soft-confirm')).toBeTruthy();
    expect(screen.getByText(/₦500 is 4\.2× your usual payment/)).toBeTruthy();
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toHaveLength(0);

    // Explicit extra tap → exactly one pay call.
    fireEvent.press(screen.getByLabelText('Confirm amount'));
    await waitFor(() => expect(callsTo(fetchMock, 'memberBillPayments.pay')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('anomaly-soft-confirm')).toBeNull());
  });

  it('Go back closes the dialog without paying', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberInsights.amountAnomalyCheck': () => ({
        anomalous: true, multiple: 4.2, reason: 'exceeds_historical_multiple',
      }),
      'memberBillPayments.pay': () => INITIATION,
    });
    await prepareBillDraft(fetchMock);
    fireEvent.press(screen.getByLabelText('Pay'));
    fireEvent.press(await screen.findByLabelText('Go back'));
    await waitFor(() => expect(screen.queryByTestId('anomaly-soft-confirm')).toBeNull());
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toHaveLength(0);
  });

  it('anomalous:false proceeds straight to pay (no dialog)', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberInsights.amountAnomalyCheck': () => ({
        anomalous: false, multiple: 1.1, reason: 'within_historical_range',
      }),
      'memberBillPayments.pay': () => INITIATION,
    });
    await prepareBillDraft(fetchMock);
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(callsTo(fetchMock, 'memberBillPayments.pay')).toHaveLength(1));
    expect(screen.queryByTestId('anomaly-soft-confirm')).toBeNull();
  });

  it('a check error degrades silently and proceeds to pay', async () => {
    const fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberInsights.amountAnomalyCheck': () => new Error('DB unavailable'),
      'memberBillPayments.pay': () => INITIATION,
    });
    await prepareBillDraft(fetchMock);
    fireEvent.press(screen.getByLabelText('Pay'));
    await waitFor(() => expect(callsTo(fetchMock, 'memberBillPayments.pay')).toHaveLength(1));
    expect(screen.queryByTestId('anomaly-soft-confirm')).toBeNull();
  });

  // 2026-10-24: the no-match probe runs BEFORE the match probe — the
  // once-per-session flag (insightsGuards promptShown) is module state that
  // persists across tests in this file, so a polluted flag must not be what
  // makes this assertion pass.
  it('no prompt when the paid amount matches no candidate', async () => {
    const handlers = {
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberInsights.amountAnomalyCheck': () => ({
        anomalous: false, multiple: 1.0, reason: 'within_historical_range',
      }),
      'memberBillPayments.pay': () => INITIATION,
      'memberBillPayments.confirmPay': () => CONFIRM_SUCCESS,
      'memberInsights.recurringCandidates': () => ({
        candidates: [{
          naturalKey: 'nk9', rail: 'bill', occurrences: 3, cadenceDays: 30,
          averageAmountKobo: 999900, dueSoon: true, // ₦9,999 — NOT ₦500
        }],
        state: 'detections_only',
      }),
    };
    const fetchMock = mockFetchSequence(handlers);
    await prepareBillDraft(fetchMock);
    fireEvent.press(screen.getByLabelText('Pay'));
    fireEvent.press(await screen.findByLabelText("I've paid — verify"));
    // The completed outcome renders but no recurring prompt appears.
    await screen.findByText(/confirmed your bill payment as completed/);
    expect(screen.queryByTestId('recurring-prompt')).toBeNull();
  });

  it('a terminal confirm surfaces the recurring prompt when the payee matches a candidate', async () => {
    const handlers = {
      'memberBillPayments.billers': () => BILLERS,
      'memberBillPayments.validateCustomer': () => ({
        valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Valid',
      }),
      'memberInsights.amountAnomalyCheck': () => ({
        anomalous: false, multiple: 1.0, reason: 'within_historical_range',
      }),
      'memberBillPayments.pay': () => INITIATION,
      'memberBillPayments.confirmPay': () => CONFIRM_SUCCESS,
      'memberInsights.recurringCandidates': () => ({
        candidates: [{
          naturalKey: 'nk1', rail: 'bill', occurrences: 3, cadenceDays: 30,
          averageAmountKobo: 50000, dueSoon: true, // ₦500 — matches the paid amount
        }],
        state: 'detections_only',
      }),
    };
    const fetchMock = mockFetchSequence(handlers);
    await prepareBillDraft(fetchMock);
    fireEvent.press(screen.getByLabelText('Pay'));
    fireEvent.press(await screen.findByLabelText("I've paid — verify"));
    expect(await screen.findByTestId('recurring-prompt')).toBeTruthy();
    expect(screen.getByText(/This looks like a monthly payment/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Dismiss recurring prompt'));
    await waitFor(() => expect(screen.queryByTestId('recurring-prompt')).toBeNull());
  });
});

describe('AirtimeScreen anomaly soft-confirm gate (W11-B3b)', () => {
  const VEND_INITIATION = { ...INITIATION, reference: 'AV-ABC12345' };

  function setupAirtime(anomaly: () => any) {
    return mockFetchSequence({
      'memberInsights.amountAnomalyCheck': anomaly,
      'memberAirtime.vend': () => VEND_INITIATION,
      'memberAirtime.myHistory': () => ({ history: [], count: 0 }),
      'memberAirtime.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
      'memberMobileMoney.providers': () => new Error('skip momo'),
      'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
      'memberMobileMoney.mySummary': () => ({ periodDays: 30, totalTransactions: 0, byStatus: [] }),
    });
  }

  async function prepareVendable() {
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);
    fireEvent.changeText(await screen.findByLabelText('Beneficiary phone'), '08031234567');
    fireEvent.changeText(screen.getByLabelText('Airtime amount'), '1000');
  }

  it('an anomalous verdict holds the vend until the explicit confirm tap', async () => {
    const fetchMock = setupAirtime(() => ({
      anomalous: true, multiple: 6.5, reason: 'exceeds_historical_multiple',
    }));
    await prepareVendable();
    fireEvent.press(screen.getByText('Buy airtime'));

    expect(await screen.findByTestId('anomaly-soft-confirm')).toBeTruthy();
    expect(screen.getByText(/₦1,000 is 6\.5× your usual payment/)).toBeTruthy();
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toHaveLength(0);
    fireEvent.press(screen.getByLabelText('Confirm amount'));
    await waitFor(() => expect(callsTo(fetchMock, 'memberAirtime.vend')).toHaveLength(1));
  });

  it('anomalous:false proceeds straight to vend (no dialog)', async () => {
    const fetchMock = setupAirtime(() => ({
      anomalous: false, multiple: 1.0, reason: 'within_historical_range',
    }));
    await prepareVendable();
    fireEvent.press(screen.getByText('Buy airtime'));
    await waitFor(() => expect(callsTo(fetchMock, 'memberAirtime.vend')).toHaveLength(1));
    expect(screen.queryByTestId('anomaly-soft-confirm')).toBeNull();
  });
});
