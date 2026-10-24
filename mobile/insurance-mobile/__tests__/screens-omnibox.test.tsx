/**
 * screens-omnibox.test.tsx — 2026-10-25 (W11-B4b): mobile NL omnibox
 * (components/Omnibox.tsx on DashboardScreen) over the W11-B4a router
 * (memberIntent.parseIntent / resolvePayeeHint via intentApi) — web parity
 * with tests/client/Omnibox.test.tsx.
 *
 * Matrix (funds-critical):
 *   - ready airtime intent → summary card → Continue navigates to the
 *     Airtime screen with the one-shot `omniboxPrefill` route param; NO
 *     payment endpoint is ever called and nothing is auto-submitted.
 *   - ready bill intent → Continue navigates to Bills with the param.
 *   - clarification → the question renders inline, no navigation.
 *   - unsupported → honest message + what IS supported, no navigation.
 *   - parse error → fail-closed message, no navigation.
 *   - Prefill consumption: BillsScreen / AirtimeScreen land the parsed
 *     values in normal form state (amount included); Pay/Buy stay locked
 *     behind the normal submit path.
 *   - Endpoint discipline: the omnibox flow's only server call is
 *     memberIntent.parseIntent (+ memberUxEvents.track telemetry).
 *   - Instrumentation: omnibox_opened / intent_parsed (type only) /
 *     prefill_applied (rail only) / clarify_shown — scrubbed metadata.
 *
 * Boundary mocks ONLY (harness.tsx): global.fetch with the real superjson
 * envelope, the offline-sync + auth-store boundaries. The component,
 * api.ts, memberTrpc transport, and uxTrack are production code.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { BillsScreen } from '../src/screens/BillsScreen';
import { AirtimeScreen } from '../src/screens/AirtimeScreen';
import { flushUxQueue } from '../src/services/uxTrack';

const BILLERS = {
  billers: [
    { name: 'EKEDC', commissionRate: 0.005, commissionPct: '0.5%' },
    { name: 'IKEDC', commissionRate: 0.005, commissionPct: '0.5%' },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: true,
};

const MOMO_PROVIDERS = {
  providers: [
    { name: 'MTN MoMo' }, { name: 'Airtel Money' }, { name: 'Glo Xtra' }, { name: '9PSB' },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
  configured: true,
};

const READY_AIRTIME = {
  result: {
    status: 'ready',
    intent: {
      flow: 'airtime_vend', network: 'MTN', phone: '08031234567', amountNGN: 2000,
    },
  },
  payee: null,
};

/** fetch calls hitting a given tRPC procedure. */
function callsTo(fetchMock: jest.Mock, proc: string): any[] {
  return fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes(proc));
}

/** All POSTed ux events, flattened (the uxTrack queue is module-global).
 *  Body shape: {json:{events:[...]}} (tRPC v10 + superjson envelope). */
async function trackedUxEvents(fetchMock: jest.Mock) {
  await flushUxQueue();
  await flushUxQueue();
  return callsTo(fetchMock, 'memberUxEvents.track')
    .flatMap((c: any[]) => {
      try {
        const body = JSON.parse(String(c[1]?.body ?? '{}'));
        return body?.json?.events ?? body?.events ?? [];
      } catch {
        return [];
      }
    });
}

/** Render the dashboard with a scripted parseIntent response. */
function renderDashboard(parse: () => any) {
  const fetchMock = mockFetchSequence({
    'memberIntent.parseIntent': parse,
    'memberUxEvents.track': () => ({ accepted: 1, duplicates: 0 }),
    // Dashboard's other queries settle empty (no fabrication).
    'memberInsights.nextBestActions': () => ({ actions: [] }),
    'memberPolicies.myPolicies': () => ({ policies: [], count: 0 }),
    'memberClaims.myClaims': () => ({ claims: [], count: 0 }),
  });
  renderScreen(<DashboardScreen navigation={mockNavigation} />);
  return fetchMock;
}

/** Handlers for the funds screens' settling queries. */
function fundsScreenHandlers() {
  return {
    'memberBillPayments.billers': () => BILLERS,
    'memberAirtime.myHistory': () => ({ history: [], count: 0 }),
    'memberAirtime.mySummary': () => ({ periodDays: 30, byStatus: [], totalTransactions: 0 }),
    'memberMobileMoney.providers': () => MOMO_PROVIDERS,
    'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
    'memberMobileMoney.mySummary': () => ({ periodDays: 30, byStatus: [], totalTransactions: 0 }),
    'memberPayees.list': () => ({ payees: [] }),
    'memberInsights.recurringCandidates': () => ({ candidates: [], state: 'detections_only' }),
    'memberUxEvents.track': () => ({ accepted: 1, duplicates: 0 }),
  };
}

beforeEach(async () => {
  await resetHarness();
});
afterEach(() => { delete (global as any).fetch; });

describe('DashboardScreen Omnibox (W11-B4b) — ready intents', () => {
  it('ready airtime intent renders the summary card; Continue navigates to Airtime with the prefill param and never calls a payment endpoint', async () => {
    const fetchMock = renderDashboard(() => READY_AIRTIME);
    fireEvent.changeText(
      await screen.findByLabelText('Omnibox request'),
      'buy ₦2,000 MTN airtime for 08031234567',
    );
    fireEvent.press(screen.getByTestId('omnibox-submit'));

    expect(await screen.findByText(/Buy ₦2,000 MTN airtime for 08031234567/)).toBeTruthy();
    expect(screen.getByText(/Nothing is paid yet/)).toBeTruthy();
    // No navigation happened before the explicit Continue tap.
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('omnibox-continue'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Policies', {
      screen: 'Airtime',
      params: {
        omniboxPrefill: {
          rail: 'airtime', network: 'MTN', phone: '08031234567', amountNGN: 2000,
        },
      },
    });

    // NEVER a payment endpoint — parse + telemetry only.
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toEqual([]);
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toEqual([]);
    expect(callsTo(fetchMock, 'memberMobileMoney.cashIn')).toEqual([]);
    expect(callsTo(fetchMock, 'memberIntent.parseIntent').length).toBe(1);
  });

  it('ready bill intent navigates to Bills with the bill prefill param', async () => {
    renderDashboard(() => ({
      result: {
        status: 'ready',
        intent: {
          flow: 'bill_pay', billerCode: 'IKEDC', customerNumber: '12345678901', amountNGN: 5000,
        },
      },
      payee: { payeeId: 'p1', label: 'Home meter' },
    }));
    fireEvent.changeText(
      await screen.findByLabelText('Omnibox request'),
      'pay ikeja electric meter 12345678901 ₦5,000',
    );
    fireEvent.press(screen.getByTestId('omnibox-submit'));

    expect(await screen.findByText(/Pay ₦5,000 to IKEDC for customer 12345678901/)).toBeTruthy();
    expect(screen.getByText(/Matches your saved payee: Home meter/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('omnibox-continue'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Policies', {
      screen: 'Bills',
      params: {
        omniboxPrefill: {
          rail: 'bill', billerCode: 'IKEDC', customerNumber: '12345678901', amountNGN: 5000,
        },
      },
    });
  });

  it('navigate intent routes without any prefill param', async () => {
    renderDashboard(() => ({
      result: { status: 'ready', intent: { flow: 'navigate', target: 'claims_file' } },
      payee: null,
    }));
    fireEvent.changeText(await screen.findByLabelText('Omnibox request'), 'file a claim');
    fireEvent.press(screen.getByTestId('omnibox-submit'));
    fireEvent.press(await screen.findByTestId('omnibox-continue'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Claims', { screen: 'FileClaim' });
  });
});

describe('DashboardScreen Omnibox (W11-B4b) — clarify / unsupported / error', () => {
  it('clarification renders the question inline with option chips and never navigates', async () => {
    const fetchMock = renderDashboard(() => ({
      result: {
        status: 'clarification',
        flow: 'airtime_vend',
        missing: ['network'],
        partial: { phone: '08031234567', amountNGN: 2000 },
        reason: 'missing_fields',
      },
      payee: null,
    }));
    fireEvent.changeText(
      await screen.findByLabelText('Omnibox request'),
      'buy ₦2,000 airtime for 08031234567',
    );
    fireEvent.press(screen.getByTestId('omnibox-submit'));

    expect(await screen.findByText(/I need a bit more detail/)).toBeTruthy();
    expect(screen.getByText(/the network/)).toBeTruthy();
    // Chips append to the input for explicit resubmit — never an auto-pick.
    fireEvent.press(screen.getByTestId('omnibox-chip-MTN'));
    expect(screen.getByLabelText('Omnibox request').props.value).toBe(
      'buy ₦2,000 airtime for 08031234567 MTN',
    );
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('omnibox-ready')).toBeNull();
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toEqual([]);

    const events = await trackedUxEvents(fetchMock);
    expect(events.some((e: any) => e.event === 'clarify_shown')).toBe(true);
  });

  it('unsupported renders the honest refusal plus what IS supported; no navigation', async () => {
    renderDashboard(() => ({
      result: { status: 'unsupported', reason: 'data_bundle_not_supported' },
      payee: null,
    }));
    fireEvent.changeText(await screen.findByLabelText('Omnibox request'), 'buy 1gb data');
    fireEvent.press(screen.getByTestId('omnibox-submit'));

    expect(await screen.findByText(/Data bundles aren't supported/)).toBeTruthy();
    expect(screen.getByText(/Supported: buy airtime/)).toBeTruthy();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('parse error fails closed: honest message, no navigation', async () => {
    renderDashboard(() => new Error('TOO_MANY_REQUESTS'));
    fireEvent.changeText(
      await screen.findByLabelText('Omnibox request'),
      'buy ₦2,000 MTN airtime for 08031234567',
    );
    fireEvent.press(screen.getByTestId('omnibox-submit'));

    expect(await screen.findByText(/couldn't read that right now/)).toBeTruthy();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });
});

describe('DashboardScreen Omnibox (W11-B4b) — instrumentation discipline', () => {
  it('tracks omnibox_opened / intent_parsed (type only) / prefill_applied (rail only) with scrubbed metadata', async () => {
    const fetchMock = renderDashboard(() => READY_AIRTIME);
    const input = await screen.findByLabelText('Omnibox request');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'buy ₦2,000 MTN airtime for 08031234567');
    fireEvent.press(screen.getByTestId('omnibox-submit'));
    fireEvent.press(await screen.findByTestId('omnibox-continue'));

    const events = await trackedUxEvents(fetchMock);
    expect(events.some((e: any) => e.event === 'omnibox_opened')).toBe(true);

    const parsed = events.filter((e: any) => e.event === 'intent_parsed');
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    // Metadata carries the intent TYPE only — no text, amounts, identifiers.
    // (The uxTrack queue is module-global across tests in this file, so
    // match the event THIS test produced rather than positional [0].)
    expect(parsed.some((e: any) => e.metadataJson?.intentType === 'ready')).toBe(true);

    const applied = events.filter((e: any) => e.event === 'prefill_applied');
    expect(applied.some((e: any) => e.metadataJson?.rail === 'airtime')).toBe(true);

    // Scrub sweep: no event may carry the raw text / amount / phone.
    for (const e of events) {
      const blob = JSON.stringify(e.metadataJson ?? {});
      expect(blob).not.toContain('08031234567');
      expect(blob).not.toContain('2000');
      expect(blob).not.toContain('MTN airtime');
    }
  });
});

describe('Omnibox prefill consumption (W11-B4b, PREFILL-ONLY)', () => {
  it('BillsScreen lands the bill draft in normal form state; nothing is auto-submitted', async () => {
    const fetchMock = mockFetchSequence(fundsScreenHandlers());
    const route = {
      params: {
        omniboxPrefill: {
          rail: 'bill', billerCode: 'EKEDC', customerNumber: '12345678901', amountNGN: 5000,
        },
      },
    };
    renderScreen(<BillsScreen navigation={mockNavigation} route={route} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Customer number').props.value).toBe('12345678901'),
    );
    expect(screen.getByLabelText('Amount').props.value).toBe('5000');
    expect(screen.getByText(/Prefilled from your omnibox request/)).toBeTruthy();
    // The param was consumed (one-shot) and NO payment was initiated.
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ omniboxPrefill: undefined });
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toEqual([]);
    // validateCustomer only fires after the member taps Validate — the
    // prefill must not have fired it.
    expect(callsTo(fetchMock, 'memberBillPayments.validateCustomer')).toEqual([]);
  });

  it('AirtimeScreen lands the airtime draft; Buy stays locked behind the normal submit', async () => {
    const fetchMock = mockFetchSequence(fundsScreenHandlers());
    const route = {
      params: {
        omniboxPrefill: {
          rail: 'airtime', network: 'Glo', phone: '08051234567', amountNGN: 1500,
        },
      },
    };
    renderScreen(<AirtimeScreen navigation={mockNavigation} route={route} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Beneficiary phone').props.value).toBe('08051234567'),
    );
    expect(screen.getByLabelText('Airtime amount').props.value).toBe('1500');
    expect(screen.getByText(/Prefilled from your omnibox request/)).toBeTruthy();
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toEqual([]);
  });

  it('AirtimeScreen momo section lands the cash-in draft; no cash-in is auto-submitted', async () => {
    const fetchMock = mockFetchSequence(fundsScreenHandlers());
    const route = {
      params: { omniboxPrefill: { rail: 'momo', provider: 'MTN MoMo', amountNGN: 10000 } },
    };
    renderScreen(<AirtimeScreen navigation={mockNavigation} route={route} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Cash amount').props.value).toBe('10000'),
    );
    expect(screen.getByText(/Prefilled from your omnibox request/)).toBeTruthy();
    expect(callsTo(fetchMock, 'memberMobileMoney.cashIn')).toEqual([]);
    expect(callsTo(fetchMock, 'memberMobileMoney.cashOut')).toEqual([]);
  });
});
