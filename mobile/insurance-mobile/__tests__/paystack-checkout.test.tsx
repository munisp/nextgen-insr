/**
 * paystack-checkout.test.tsx — 2026-10-06 (W10-B5)
 *
 * Coverage for the in-app Paystack checkout WebView and the auto-confirm
 * wiring back into the MemberCapturePanel:
 *
 *   PaystackCheckoutScreen (WebView native boundary mocked — the ONLY mock
 *   here besides the harness network boundary; the screen logic, the outcome
 *   store, memberFundsIntent, BillsScreen and the api transport are all
 *   production code):
 *     (a) a navigation URL carrying the transaction reference as
 *         `?reference=` or `&trxref=` → blocked (returns false), outcome
 *         'completed' recorded, goBack called;
 *     (b) https://standard.paystack.co/close → blocked, outcome 'cancelled';
 *     (c) an unrelated Paystack checkout URL → allowed (returns true),
 *         NO outcome recorded;
 *     mutant probes: a callback URL carrying a DIFFERENT reference, and a
 *     URL mentioning the reference outside the query params, must NOT
 *     complete (fail-closed exact-match).
 *
 *   MemberCapturePanel (rendered through the REAL BillsScreen flow):
 *     (d) focus with a stored 'completed' outcome for the panel's reference
 *         auto-triggers the confirmPay mutation with the correct reference;
 *         focus with 'cancelled' NEVER confirms and shows the neutral
 *         cancelled note; a stale outcome for a DIFFERENT reference is left
 *         untouched and does not confirm.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

// Native boundary: react-native-webview renders the OS WebView. The mock
// captures the real props so the tests exercise the PRODUCTION
// onShouldStartLoadWithRequest handler.
let webViewProps: any = null;
jest.mock('react-native-webview', () => {
  const ReactActual = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    WebView: (props: any) => {
      webViewProps = props;
      return ReactActual.createElement(View, { testID: 'mock-webview' });
    },
  };
});

import { PaystackCheckoutScreen } from '../src/screens/PaystackCheckoutScreen';
import { BillsScreen } from '../src/screens/BillsScreen';
import {
  clearCheckoutOutcome,
  getCheckoutOutcome,
  setCheckoutOutcome,
} from '../src/screens/paystackCheckoutOutcome';

jest.setTimeout(20000);

const REF = 'BP123';
const ROUTE = {
  params: {
    authorizationUrl: 'https://checkout.paystack.com/real-session-b5',
    reference: REF,
  },
};

function renderCheckout(navigation: any) {
  return render(<PaystackCheckoutScreen navigation={navigation} route={ROUTE} />);
}

/** Fire the REAL production should-start handler captured by the mock. */
function shouldStart(url: string): boolean {
  expect(webViewProps).toBeTruthy();
  expect(typeof webViewProps.onShouldStartLoadWithRequest).toBe('function');
  return webViewProps.onShouldStartLoadWithRequest({ url });
}

beforeEach(async () => {
  await resetHarness();
  clearCheckoutOutcome();
  webViewProps = null;
});
afterEach(() => { delete (global as any).fetch; });

describe('PaystackCheckoutScreen WebView navigation detection', () => {
  it('passes the server-supplied authorizationUrl to the WebView verbatim', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(webViewProps.source).toEqual({
      uri: 'https://checkout.paystack.com/real-session-b5',
    });
    expect(webViewProps.startInLoadingState).toBe(true);
  });

  it('(a) ?reference=<ref> completes: blocked, outcome recorded, goBack called', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(shouldStart(`https://pay.example.com/callback?reference=${REF}`)).toBe(false);
    expect(getCheckoutOutcome()).toEqual({ outcome: 'completed', reference: REF });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('(a) &trxref=<ref> completes the same way', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(
      shouldStart(`https://pay.example.com/cb?foo=1&trxref=${REF}&x=2`),
    ).toBe(false);
    expect(getCheckoutOutcome()).toEqual({ outcome: 'completed', reference: REF });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('mutant probe: a callback carrying a DIFFERENT reference does NOT complete', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(shouldStart('https://pay.example.com/callback?reference=BP999')).toBe(true);
    expect(shouldStart(`https://pay.example.com/callback?trxref=${REF}9`)).toBe(true);
    expect(getCheckoutOutcome()).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('mutant probe: the reference in a non-query position does NOT complete', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(shouldStart(`https://pay.example.com/${REF}/done`)).toBe(true);
    expect(getCheckoutOutcome()).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('(b) https://standard.paystack.co/close cancels: blocked, outcome recorded, no confirm signal', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(shouldStart('https://standard.paystack.co/close')).toBe(false);
    expect(getCheckoutOutcome()).toEqual({ outcome: 'cancelled', reference: REF });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('(c) an unrelated checkout navigation is allowed and records nothing', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    expect(shouldStart('https://checkout.paystack.com/real-session-b5/pay')).toBe(true);
    expect(getCheckoutOutcome()).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('the in-app Cancel affordance goes back WITHOUT recording an outcome', () => {
    const navigation = { goBack: jest.fn() };
    renderCheckout(navigation);
    fireEvent.press(screen.getByLabelText('Close checkout'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(getCheckoutOutcome()).toBeNull();
  });
});

const BILLERS = {
  billers: [
    { name: 'EKEDC', commissionRate: 0.005, commissionPct: '0.5%' },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: true,
};

const INITIATION = {
  reference: REF,
  authorizationUrl: 'https://checkout.paystack.com/real-session-b5',
  accessCode: 'ac-b5',
  amount: '500',
  currency: 'NGN',
  transactionId: 78,
  status: 'awaiting_payment',
  idempotent: false,
};

const CONFIRM_SUBMITTED = {
  reference: REF,
  status: 'pending',
  providerStatus: 'submitted',
  captureStatus: 'captured',
  amount: '500',
  currency: 'NGN',
  transactionId: 78,
  failureReason: null,
  refundStatus: null,
  idempotent: false,
};

/** All POST bodies to a mutation procedure, in order. */
function mutationInputs(fetchMock: jest.Mock, procedure: string): any[] {
  return fetchMock.mock.calls
    .filter(([url, opts]: any[]) => String(url).endsWith(`/${procedure}`) && opts?.method === 'POST')
    .map((call: any[]) => JSON.parse(call[1].body).json);
}

/** Drive BillsScreen to an initiated capture panel; return the fetch mock. */
async function driveToInitiation(): Promise<jest.Mock> {
  const fetchMock = mockFetchSequence({
    'memberBillPayments.billers': () => BILLERS,
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
  fireEvent.press(screen.getByLabelText('Pay'));
  expect(await screen.findByText(/Payment initiated\. Reference: BP123/)).toBeTruthy();
  return fetchMock;
}

/** Fire every `focus` handler the panel registered on the navigation prop. */
function fireFocus() {
  const focusCalls = (mockNavigation.addListener as jest.Mock).mock.calls
    .filter(([event]: any[]) => event === 'focus');
  expect(focusCalls.length).toBeGreaterThan(0);
  focusCalls.forEach(([, handler]: any[]) => handler());
}

describe('MemberCapturePanel checkout-outcome auto-confirm (BillsScreen, production path)', () => {
  it("(d) focus with a 'completed' outcome auto-fires confirmPay with the correct reference", async () => {
    const fetchMock = await driveToInitiation();
    fireEvent.press(screen.getByLabelText('Complete payment'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PaystackCheckout', {
      authorizationUrl: INITIATION.authorizationUrl,
      reference: REF,
    });

    // The checkout screen records the outcome; the user returns (focus).
    setCheckoutOutcome({ outcome: 'completed', reference: REF });
    fireFocus();

    // Auto-confirm: the REAL confirmPay mutation fired with exactly the
    // initiation reference, and the submitted/pending outcome renders.
    expect(await screen.findByText(/pending fulfillment\. It has NOT been delivered yet/)).toBeTruthy();
    expect(mutationInputs(fetchMock, 'memberBillPayments.confirmPay')).toEqual([
      { reference: REF },
    ]);
    // The outcome was consumed (read-then-cleared): a second focus must NOT
    // re-fire the confirm.
    expect(getCheckoutOutcome()).toBeNull();
    fireFocus();
    await waitFor(() =>
      expect(mutationInputs(fetchMock, 'memberBillPayments.confirmPay').length).toBe(1),
    );
  });

  it("(d) focus with a 'cancelled' outcome NEVER confirms and shows the neutral cancelled note", async () => {
    const fetchMock = await driveToInitiation();
    setCheckoutOutcome({ outcome: 'cancelled', reference: REF });
    fireFocus();

    expect(await screen.findByTestId('checkout-cancelled')).toBeTruthy();
    expect(screen.getByText(/Checkout cancelled — you can retry/)).toBeTruthy();
    expect(mutationInputs(fetchMock, 'memberBillPayments.confirmPay')).toEqual([]);
    expect(getCheckoutOutcome()).toBeNull();

    // Fail-closed fallback: the manual verify button still works.
    fireEvent.press(screen.getByLabelText("I've paid — verify"));
    await waitFor(() =>
      expect(mutationInputs(fetchMock, 'memberBillPayments.confirmPay')).toEqual([
        { reference: REF },
      ]),
    );
  });

  it('fail-closed: a stale outcome for a DIFFERENT reference is ignored and left in place', async () => {
    const fetchMock = await driveToInitiation();
    setCheckoutOutcome({ outcome: 'completed', reference: 'OTHER-REF' });
    fireFocus();

    expect(mutationInputs(fetchMock, 'memberBillPayments.confirmPay')).toEqual([]);
    // Not consumed — it belongs to a different panel/initiation.
    expect(getCheckoutOutcome()).toEqual({ outcome: 'completed', reference: 'OTHER-REF' });
    expect(screen.queryByTestId('checkout-cancelled')).toBeNull();
  });

  it('opening the checkout clears any stale outcome first', async () => {
    await driveToInitiation();
    setCheckoutOutcome({ outcome: 'completed', reference: REF });
    fireEvent.press(screen.getByLabelText('Complete payment'));
    expect(getCheckoutOutcome()).toBeNull();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('PaystackCheckout', {
      authorizationUrl: INITIATION.authorizationUrl,
      reference: REF,
    });
  });
});
