/**
 * screens-billscan.test.tsx — 2026-10-25 (W11-B4c-3): mobile OCR bill-scan
 * intake (components/BillScanSection on BillsScreen/AirtimeScreen) over the
 * W11-B4c-1 router (memberBillScan.parse via scanApi).
 *
 * Matrix (funds-critical, PREFILL-ONLY):
 *   - ok + prefill → review card "Scanned from photo — review before
 *     paying"; Apply prefills IDENTIFIERS ONLY through the existing prefill
 *     path (amount NOT set, validation/pay state reset); the amount chip
 *     requires an explicit tap to fill; NO payment endpoint is ever called;
 *     the anomaly soft-confirm gate still runs on the normal submit path.
 *   - unavailable / low_confidence / error → honest inline message, no
 *     prefill, form fully usable.
 *   - Network failure → fail-closed message, no prefill.
 *   - Fetch URL audit: the scan flow calls ONLY memberBillScan.parse (+
 *     memberUxEvents.track telemetry) — never a payment mutation.
 *   - Metadata canary: extracted values (biller/meter/amount) NEVER appear
 *     in tracked ux metadata (rail + status only).
 *
 * Boundary mocks ONLY (harness.tsx + jest.setup.js): global.fetch with the
 * real superjson envelope; react-native-image-picker is the OS camera/
 * gallery bridge mock (launchCamera/launchImageLibrary jest.fns). The
 * component, api.ts, memberTrpc transport, and uxTrack are production code.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';
import { BillsScreen } from '../src/screens/BillsScreen';
import { AirtimeScreen } from '../src/screens/AirtimeScreen';
import { flushUxQueue } from '../src/services/uxTrack';

const mockLaunchCamera = launchCamera as unknown as jest.Mock;
const mockLaunchLibrary = launchImageLibrary as unknown as jest.Mock;

// 150-char valid-base64 photo payload (server zod floor is 100 chars).
const PHOTO_BASE64 = 'A'.repeat(150);

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

const SCAN_OK = {
  status: 'ok',
  mode: 'prefill',
  prefill: { billerCode: 'EKEDC', customerNumber: '12345678901', amountKobo: 250000 },
  confidence: 0.9,
  message: 'Bill scanned — review the prefilled details before paying. Nothing has been paid or saved.',
};

/** fetch calls hitting a given tRPC procedure. */
function callsTo(fetchMock: jest.Mock, proc: string): any[] {
  return fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes(proc));
}

/** All POSTed ux events, flattened (the uxTrack queue is module-global). */
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

/** Handlers for the funds screens' settling queries (+ telemetry). */
function baseHandlers() {
  return {
    'memberBillPayments.billers': () => BILLERS,
    'memberBillPayments.validateCustomer': () => ({
      valid: true, customerNumber: '12345678901', biller: 'EKEDC', message: 'Format OK',
    }),
    'memberAirtime.myHistory': () => ({ history: [], count: 0 }),
    'memberAirtime.mySummary': () => ({ periodDays: 30, byStatus: [], totalTransactions: 0 }),
    'memberMobileMoney.providers': () => MOMO_PROVIDERS,
    'memberMobileMoney.myTransactions': () => ({ transactions: [], count: 0 }),
    'memberMobileMoney.mySummary': () => ({ periodDays: 30, byStatus: [], totalTransactions: 0 }),
    'memberPayees.list': () => ({ payees: [] }),
    'memberInsights.recurringCandidates': () => ({ candidates: [], state: 'detections_only' }),
    'memberInsights.amountAnomalyCheck': () => ({ anomalous: true, multiple: 3, reason: 'above usual' }),
    'memberUxEvents.track': () => ({ accepted: 1, duplicates: 0 }),
  };
}

/** Render BillsScreen with a scripted scan response and drive a library
 *  scan through to completion. */
async function scanOnBills(scanHandler: () => any, source: 'camera' | 'library' = 'library') {
  const fetchMock = mockFetchSequence({
    ...baseHandlers(),
    'memberBillScan.parse': scanHandler,
  });
  (source === 'camera' ? mockLaunchCamera : mockLaunchLibrary).mockResolvedValue({
    assets: [{ base64: PHOTO_BASE64, uri: 'file:///bill.jpg' }],
  });
  renderScreen(<BillsScreen navigation={mockNavigation} />);
  fireEvent.press(await screen.findByTestId('scan-open-bill'));
  fireEvent.press(screen.getByTestId(source === 'camera' ? 'scan-camera-bill' : 'scan-library-bill'));
  return fetchMock;
}

beforeEach(async () => {
  await resetHarness();
  mockLaunchCamera.mockReset();
  mockLaunchLibrary.mockReset();
});
afterEach(() => { delete (global as any).fetch; });

describe('BillScanSection (W11-B4c-3) — ok + prefill', () => {
  it('ok → review card; Apply prefills identifiers ONLY (amount NOT set); amount chip tap fills; pay never called; anomaly gate intact on submit', async () => {
    const fetchMock = await scanOnBills(() => SCAN_OK);

    // Review card with the extracted values.
    expect(await screen.findByTestId('scan-review-bill')).toBeTruthy();
    expect(screen.getByText(/Scanned from photo — review before paying/)).toBeTruthy();
    expect(screen.getByTestId('scan-biller-bill').props.children.join('')).toContain('EKEDC');
    expect(screen.getByTestId('scan-customer-bill').props.children.join('')).toContain('12345678901');

    // Apply → identifiers through the existing prefill path; amount CLEARED.
    fireEvent.press(screen.getByTestId('scan-apply-bill'));
    await waitFor(() =>
      expect(screen.getByLabelText('Customer number').props.value).toBe('12345678901'),
    );
    expect(screen.getByLabelText('Amount').props.value).toBe('');
    expect(screen.getByText(/Prefilled from your scanned bill photo/)).toBeTruthy();

    // The amount is a suggestion chip — explicit tap fills it.
    fireEvent.press(screen.getByTestId('scan-amount-bill'));
    await waitFor(() =>
      expect(screen.getByLabelText('Amount').props.value).toBe('2500'),
    );

    // NO payment was initiated by the scan/apply/chip.
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toEqual([]);
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toEqual([]);

    // The normal submit path is untouched: Validate → Pay → anomaly
    // soft-confirm gate fires BEFORE any capture call.
    fireEvent.press(screen.getByText('Validate'));
    await screen.findByTestId('validate-result');
    await waitFor(() => expect(screen.getByText(/Format OK/)).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Pay'));
    expect(await screen.findByTestId('anomaly-soft-confirm')).toBeTruthy();
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toEqual([]);
  });

  it('camera source scans the same way (Take photo choice)', async () => {
    await scanOnBills(() => SCAN_OK, 'camera');
    expect(await screen.findByTestId('scan-review-bill')).toBeTruthy();
    expect(mockLaunchCamera).toHaveBeenCalledWith(
      expect.objectContaining({ includeBase64: true, quality: 0.7, maxWidth: 1600, maxHeight: 1600 }),
    );
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it('biller NOT in the catalog is not applied (no nearest-guess)', async () => {
    await scanOnBills(() => ({
      ...SCAN_OK,
      prefill: { billerCode: 'UNKNOWNCO', customerNumber: '99887766554' },
    }));
    fireEvent.press(await screen.findByTestId('scan-apply-bill'));
    await waitFor(() =>
      expect(screen.getByLabelText('Customer number').props.value).toBe('99887766554'),
    );
    // Biller chips: none switched to the unknown code (no EKEDC→UNKNOWNCO).
    expect(screen.queryByText(/UNKNOWNCO/)).toBeTruthy(); // shown on the review card
    expect(screen.queryByLabelText('Biller UNKNOWNCO')).toBeNull(); // never a catalog chip
  });

  it('AirtimeScreen: ok scan prefills network (catalog match) + phone; amount only via the chip; vend never called', async () => {
    const fetchMock = mockFetchSequence({
      ...baseHandlers(),
      'memberBillScan.parse': () => ({
        status: 'ok',
        mode: 'prefill',
        prefill: { billerCode: 'Glo', customerNumber: '08051234567', amountKobo: 150000 },
        confidence: 0.88,
        message: 'Bill scanned — review the prefilled details before paying.',
      }),
    });
    mockLaunchLibrary.mockResolvedValue({ assets: [{ base64: PHOTO_BASE64 }] });
    renderScreen(<AirtimeScreen navigation={mockNavigation} />);

    fireEvent.press(await screen.findByTestId('scan-open-airtime'));
    fireEvent.press(screen.getByTestId('scan-library-airtime'));
    expect(await screen.findByTestId('scan-review-airtime')).toBeTruthy();

    fireEvent.press(screen.getByTestId('scan-apply-airtime'));
    await waitFor(() =>
      expect(screen.getByLabelText('Beneficiary phone').props.value).toBe('08051234567'),
    );
    expect(screen.getByLabelText('Airtime amount').props.value).toBe('');
    expect(screen.getByText(/Prefilled from your scanned photo/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('scan-amount-airtime'));
    await waitFor(() =>
      expect(screen.getByLabelText('Airtime amount').props.value).toBe('1500'),
    );
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toEqual([]);
  });
});

describe('BillScanSection (W11-B4c-3) — honest fail-closed outcomes', () => {
  it.each(['unavailable', 'low_confidence', 'error'] as const)(
    '%s → honest inline message, NO prefill, form fully usable',
    async (status) => {
      await scanOnBills(() => ({
        status,
        mode: 'manual_entry',
        message: `Scan outcome: ${status}. Please enter the bill details manually.`,
      }));
      expect(await screen.findByTestId('scan-notice-bill')).toBeTruthy();
      expect(screen.getByText(new RegExp(`Scan outcome: ${status}`))).toBeTruthy();
      // No review card, no prefill — the manual form is untouched.
      expect(screen.queryByTestId('scan-review-bill')).toBeNull();
      expect(screen.getByLabelText('Customer number').props.value).toBe('');
      expect(screen.getByLabelText('Amount').props.value).toBe('');
      // The form still works: fields accept input.
      fireEvent.changeText(screen.getByLabelText('Customer number'), '12345678901');
      expect(screen.getByLabelText('Customer number').props.value).toBe('12345678901');
    },
  );

  it('non-ok status carrying a stray prefill object → honest message, NO review card, no prefill applied (verifier M2)', async () => {
    await scanOnBills(() => ({
      status: 'low_confidence',
      mode: 'manual_entry',
      // Stray extraction payload on a failure verdict — must be ignored.
      prefill: { billerCode: 'EKEDC', customerNumber: '12345678901', amountKobo: 250000 },
      confidence: 0.4,
      message: 'Scan confidence below threshold. Please enter the bill details manually.',
    }));
    expect(await screen.findByTestId('scan-notice-bill')).toBeTruthy();
    expect(screen.getByText(/confidence below threshold/)).toBeTruthy();
    // The stray prefill is never rendered or applied.
    expect(screen.queryByTestId('scan-review-bill')).toBeNull();
    expect(screen.queryByTestId('scan-apply-bill')).toBeNull();
    expect(screen.getByLabelText('Customer number').props.value).toBe('');
    expect(screen.getByLabelText('Amount').props.value).toBe('');
  });

  it('network failure → fail-closed message, no prefill', async () => {
    const fetchMock = await scanOnBills(() => new Error('TOO_MANY_REQUESTS'));
    expect(await screen.findByTestId('scan-notice-bill')).toBeTruthy();
    expect(screen.getByText(/could not be scanned right now/)).toBeTruthy();
    expect(screen.queryByTestId('scan-review-bill')).toBeNull();
    expect(screen.getByLabelText('Customer number').props.value).toBe('');
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toEqual([]);
  });

  it('picker cancel / no photo data → no scan call, no message churn', async () => {
    const fetchMock = mockFetchSequence(baseHandlers());
    mockLaunchLibrary.mockResolvedValue({ didCancel: true });
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByTestId('scan-open-bill'));
    fireEvent.press(screen.getByTestId('scan-library-bill'));
    await waitFor(() => expect(mockLaunchLibrary).toHaveBeenCalled());
    expect(callsTo(fetchMock, 'memberBillScan.parse')).toEqual([]);
    expect(screen.queryByTestId('scan-review-bill')).toBeNull();
  });
});

describe('BillScanSection (W11-B4c-3) — endpoint + metadata discipline', () => {
  it('fetch URL audit: the scan flow calls ONLY memberBillScan.parse + memberUxEvents.track beyond the settling read queries', async () => {
    const fetchMock = await scanOnBills(() => SCAN_OK);
    await screen.findByTestId('scan-review-bill');
    fireEvent.press(screen.getByTestId('scan-apply-bill'));
    fireEvent.press(screen.getByTestId('scan-amount-bill'));
    await trackedUxEvents(fetchMock);

    const allowed = [
      'memberBillPayments.billers',
      'memberPayees.list',
      'memberBillScan.parse',
      'memberUxEvents.track',
    ];
    const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(allowed.some((a) => u.includes(a))).toBe(true);
    }
    // Never a payment/capture endpoint.
    expect(callsTo(fetchMock, 'memberBillPayments.pay')).toEqual([]);
    expect(callsTo(fetchMock, 'memberAirtime.vend')).toEqual([]);
    expect(callsTo(fetchMock, 'memberMobileMoney.cashIn')).toEqual([]);
    expect(callsTo(fetchMock, 'memberBillScan.parse').length).toBe(1);
  });

  it('metadata canary: scan events carry rail + status only — extracted values are NEVER tracked', async () => {
    const fetchMock = await scanOnBills(() => SCAN_OK);
    await screen.findByTestId('scan-review-bill');
    fireEvent.press(screen.getByTestId('scan-apply-bill'));
    fireEvent.press(screen.getByTestId('scan-amount-bill'));

    const events = await trackedUxEvents(fetchMock);
    const scanEvents = events.filter((e: any) => e.flow === 'bill_scan');
    expect(scanEvents.some((e: any) => e.event === 'scan_started')).toBe(true);
    expect(
      scanEvents.some(
        (e: any) => e.event === 'scan_succeeded'
          && e.metadataJson?.rail === 'bill' && e.metadataJson?.status === 'ok',
      ),
    ).toBe(true);
    // Canary: no extracted value (biller / meter / amount) anywhere in the
    // tracked metadata of ANY event this flow produced.
    for (const e of events) {
      const blob = JSON.stringify(e.metadataJson ?? {});
      expect(blob).not.toContain('EKEDC');
      expect(blob).not.toContain('12345678901');
      expect(blob).not.toContain('250000');
      expect(blob).not.toContain('2500');
    }
  });

  it('failure scan tracks scan_failed with the outcome status only', async () => {
    const fetchMock = await scanOnBills(() => ({
      status: 'unavailable', mode: 'manual_entry', message: 'not configured',
    }));
    await screen.findByTestId('scan-notice-bill');
    const events = await trackedUxEvents(fetchMock);
    expect(
      events.some(
        (e: any) => e.flow === 'bill_scan' && e.event === 'scan_failed'
          && e.metadataJson?.rail === 'bill' && e.metadataJson?.status === 'unavailable',
      ),
    ).toBe(true);
  });
});
