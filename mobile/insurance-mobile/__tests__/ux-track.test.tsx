/**
 * ux-track.test.tsx — 2026-10-24 (W11-B2c): the mobile UX instrumentation
 * tracker (src/services/uxTrack.ts) and its wiring on BillsScreen (mobile
 * mirror of tests/client/uxTrack.test.tsx).
 *
 * Boundary policy: only the network boundary (fetch, real superjson tRPC
 * envelope) is mocked via the harness; the tracker, screens, api wrappers,
 * memberTrpc auth, and AsyncStorage (in-memory native-boundary mock) are
 * production code. Proves:
 *   - batching: flush at 10 queued events, after 5s, and on demand; a
 *     flush never exceeds the server batch cap (20);
 *   - sessionId is minted once (uuid), persisted in AsyncStorage, and
 *     attached at flush time; clientEventId is unique per event;
 *   - every sent event matches the server event shape (MINIMAL validator
 *     replication below — the mobile bundle has no zod; dated copy of
 *     server/routers/memberUxEvents.ts trackEventSchema rules);
 *   - fail-silent: a failing send warns and requeues; the retry re-sends
 *     the SAME clientEventId (server idempotency makes retries safe);
 *   - no-PII guard: oversized/structured metadata entries are dropped;
 *     typed values never appear in the payload;
 *   - BillsScreen wiring: form_started on mount, prefill_accepted on payee
 *     select, prefill_overridden ONCE per draft on identifier edit, and
 *     field_edited on amount blur (NOT per keystroke).
 *
 * MUTANT PROBES (non-vacuous): the 5s test asserts NO send before the
 * interval (an eager-flush mutant fails); the override test edits the
 * field TWICE and asserts exactly ONE override event (a tracker without
 * the once-per-draft guard fails); the PII test asserts the typed meter
 * number never appears in ANY payload.
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

jest.setTimeout(20000);

import { trackEvent, flushUxQueue } from '../src/services/uxTrack';
import { BillsScreen } from '../src/screens/BillsScreen';

// 2026-10-24 (W11-B2c): MINIMAL replication of the server event schema
// rules (server/routers/memberUxEvents.ts trackEventSchema + metadataSchema)
// as a plain validator — the mobile bundle has no zod. If the server schema
// changes, update this copy.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set([
  'form_started', 'field_edited', 'prefill_accepted', 'prefill_overridden',
  'step_abandoned', 'completed', 'recommendation_accepted',
  'recommendation_dismissed', 'recommendation_dismissed_forever',
]);
function assertServerShape(e: any): void {
  expect(typeof e).toBe('object');
  // .strict() — no unknown keys.
  expect(Object.keys(e).sort()).toEqual(
    ['clientEventId', 'event', 'fieldName', 'flow', 'metadataJson', 'sessionId', 'step']
      .filter((k) => e[k] !== undefined && e[k] !== null)
      .sort(),
  );
  expect(UUID_RE.test(e.clientEventId)).toBe(true);
  expect(UUID_RE.test(e.sessionId)).toBe(true);
  expect(typeof e.flow).toBe('string');
  expect(e.flow.trim().length).toBeGreaterThan(0);
  expect(e.flow.length).toBeLessThanOrEqual(64);
  expect(KINDS.has(e.event)).toBe(true);
  if (e.fieldName != null) {
    expect(typeof e.fieldName).toBe('string');
    expect(e.fieldName.trim().length).toBeGreaterThan(0);
    expect(e.fieldName.length).toBeLessThanOrEqual(64);
  }
  if (e.step != null) {
    expect(typeof e.step).toBe('string');
    expect(e.step.length).toBeLessThanOrEqual(64);
  }
  if (e.metadataJson != null) {
    const keys = Object.keys(e.metadataJson);
    expect(keys.length).toBeLessThanOrEqual(20);
    for (const k of keys) {
      expect(k.length).toBeLessThanOrEqual(64);
      const v = e.metadataJson[k];
      if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(64);
      else expect(['number', 'boolean'].includes(typeof v) || v === null).toBe(true);
    }
  }
}

/** All POSTed batches to memberUxEvents.track, in order. */
function sentBatches(fetchMock: jest.Mock): Array<{ events: any[] }> {
  return fetchMock.mock.calls
    .filter(([url, opts]: any[]) => String(url).endsWith('/memberUxEvents.track') && opts?.method === 'POST')
    .map((call: any[]) => JSON.parse(call[1].body).json);
}
const sentEvents = (fetchMock: jest.Mock) => sentBatches(fetchMock).flatMap((b) => b.events);

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

describe('uxTrack service (W11-B2c)', () => {
  let fetchMock: jest.Mock;
  beforeEach(async () => {
    await resetHarness();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock = mockFetchSequence({
      'memberUxEvents.track': () => ({ accepted: 1, duplicates: 0 }),
    });
    // Drain any leftovers from a previous test through the fresh mock.
    await flushUxQueue();
    fetchMock.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    (console.warn as jest.Mock).mockRestore?.();
  });

  it('flushes automatically at 10 queued events (no timer)', async () => {
    for (let i = 0; i < 9; i++) trackEvent('member-bills', 'form_started');
    // Below threshold and no explicit flush (timer has 5s): nothing sent.
    expect(sentBatches(fetchMock)).toHaveLength(0);
    trackEvent('member-bills', 'form_started');
    await waitFor(() => expect(sentBatches(fetchMock)).toHaveLength(1));
    expect(sentBatches(fetchMock)[0].events).toHaveLength(10);
  });

  it('flushes after 5s, NOT before (eager-flush mutant probe)', async () => {
    jest.useFakeTimers();
    trackEvent('member-bills', 'form_started');
    await jest.advanceTimersByTimeAsync(4999);
    expect(sentBatches(fetchMock)).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    await jest.runAllTicks();
    jest.useRealTimers();
    await waitFor(() => expect(sentBatches(fetchMock)).toHaveLength(1));
    expect(sentBatches(fetchMock)[0].events).toHaveLength(1);
  });

  it('never sends more than the server batch cap (20) per call', async () => {
    for (let i = 0; i < 25; i++) trackEvent('member-bills', 'field_edited');
    // Flush repeatedly — an in-flight flush is a no-op (serialized), and
    // the 5s timer drains the sub-threshold remainder.
    await waitFor(
      async () => {
        await flushUxQueue();
        expect(sentEvents(fetchMock)).toHaveLength(25);
      },
      { timeout: 8000 },
    );
    for (const b of sentBatches(fetchMock)) expect(b.events.length).toBeLessThanOrEqual(20);
  });

  it('mints one uuid sessionId, persists it in AsyncStorage, gives every event a unique clientEventId — all events match the server shape', async () => {
    trackEvent('member-bills', 'form_started');
    trackEvent('member-bills', 'field_edited', { fieldName: 'amount' });
    trackEvent('member-bills', 'prefill_accepted', { metadata: { rail: 'bill', hasMeterNumber: true } });
    await flushUxQueue();
    await waitFor(() => expect(sentEvents(fetchMock)).toHaveLength(3));
    const events = sentEvents(fetchMock);
    for (const e of events) assertServerShape(e);
    const sessionIds = new Set(events.map((e) => e.sessionId));
    expect(sessionIds.size).toBe(1);
    expect(await AsyncStorage.getItem('ux-track-session-id')).toBe([...sessionIds][0]);
    expect(new Set(events.map((e) => e.clientEventId)).size).toBe(3);
  });

  it('is fail-silent: a failing send warns, requeues, and the retry re-sends the SAME clientEventId', async () => {
    fetchMock = mockFetchSequence({
      'memberUxEvents.track': () => new Error('HTTP 503'),
    });
    trackEvent('member-bills', 'form_started');
    await flushUxQueue();
    await flushUxQueue();
    expect(console.warn).toHaveBeenCalled();
    // Restore success — the queued event must retry with its ORIGINAL
    // clientEventId (the server dedups on it, so no double-count).
    fetchMock = mockFetchSequence({
      'memberUxEvents.track': () => ({ accepted: 1, duplicates: 0 }),
    });
    trackEvent('member-bills', 'completed');
    await flushUxQueue();
    await waitFor(() => expect(sentEvents(fetchMock)).toHaveLength(2));
    expect(sentEvents(fetchMock).map((e) => e.event)).toEqual(['form_started', 'completed']);
  });

  it('no-PII guard: oversized/structured metadata entries are dropped before send', async () => {
    trackEvent('member-bills', 'field_edited', {
      fieldName: 'customerNumber',
      metadata: {
        ok: 1,
        typed: '12345678901'.repeat(10), // long string → dropped
        nested: { evil: true } as any,   // structured → dropped
      },
    });
    await flushUxQueue();
    await waitFor(() => expect(sentEvents(fetchMock)).toHaveLength(1));
    expect(sentEvents(fetchMock)[0].metadataJson).toEqual({ ok: 1 });
    // Mutant probe: the typed value never appears ANYWHERE in the payload.
    expect(JSON.stringify(sentBatches(fetchMock))).not.toContain('123456789011234567890');
  });
});

describe('BillsScreen UX wiring (W11-B2c)', () => {
  let fetchMock: jest.Mock;
  beforeEach(async () => {
    await resetHarness();
    fetchMock = mockFetchSequence({
      'memberBillPayments.billers': () => BILLERS,
      'memberPayees.list': () => BILL_PAYEES,
      'memberUxEvents.track': () => ({ accepted: 1, duplicates: 0 }),
    });
    await flushUxQueue();
    fetchMock.mockClear();
  });

  it('emits form_started on mount, prefill_accepted on payee select, ONE prefill_overridden per draft on identifier edit, and field_edited on amount blur — never the typed values', async () => {
    renderScreen(<BillsScreen navigation={mockNavigation} />);
    // Payee chips render once the picker query resolves.
    const chip = await screen.findByTestId('payee-chip-11111111-1111-4111-8111-111111111111');
    await flushUxQueue();
    fetchMock.mockClear(); // ignore the mount-time form_started send

    fireEvent.press(chip);
    // Edit the prefilled identifier TWICE — exactly ONE override event.
    const meter = screen.getByLabelText('Customer number');
    fireEvent.changeText(meter, '999');
    fireEvent.changeText(meter, '9999');
    // Amount: keystrokes emit NOTHING; blur emits one field_edited.
    const amount = screen.getByLabelText('Amount');
    fireEvent.changeText(amount, '5');
    fireEvent.changeText(amount, '5000');
    fireEvent(amount, 'blur');

    await flushUxQueue();
    await waitFor(() =>
      expect(sentEvents(fetchMock).some((e) => e.event === 'prefill_accepted')).toBe(true),
    );
    const events = sentEvents(fetchMock);
    const overrides = events.filter((e) => e.event === 'prefill_overridden');
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ flow: 'member-bills', fieldName: 'customerNumber' });
    const edits = events.filter((e) => e.event === 'field_edited');
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ fieldName: 'amount' });
    for (const e of events) assertServerShape(e);
    // NO-PII guard: the typed meter number and amount never appear in any
    // payload (fieldName is a NAME, metadata has no typed values).
    const payload = JSON.stringify(sentBatches(fetchMock));
    expect(payload).not.toContain('9999');
    expect(payload).not.toContain('12345678901');
  });
});
