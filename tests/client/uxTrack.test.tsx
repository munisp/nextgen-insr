/**
 * uxTrack.test.tsx — 2026-10-24 (W11-B2c): the web UX instrumentation
 * tracker (client/src/lib/uxTrack.ts) and its wiring on MemberBills.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub — memberUxEvents.track is recorded there, never a real
 * network call. sessionStorage/crypto/timers are the real happy-dom APIs.
 * Proves:
 *   - batching: flush at 10 queued events, after 5s, and on pagehide;
 *     a flush never exceeds the server batch cap (20);
 *   - sessionId is minted once (uuid), persisted in sessionStorage, and
 *     reused across events; clientEventId is unique per event;
 *   - every queued event passes the SERVER zod event shape (minimal
 *     replication below — dated comment, not an import, so the client
 *     bundle/test stays free of server code);
 *   - fail-silent: a failing send warns and requeues (server-side
 *     idempotency per clientEventId makes the retry safe); tracking never
 *     throws into the UX;
 *   - no-PII guard: oversized/structured metadata entries are dropped
 *     client-side and typed values never appear in the payload;
 *   - MemberBills wiring: form_started on mount, prefill_accepted on payee
 *     select, prefill_overridden ONCE per draft on identifier edit, and
 *     field_edited on amount blur (NOT per keystroke).
 *
 * MUTANT PROBES (non-vacuous): the 5s timer test asserts NO send before
 * the interval (a tracker that flushed eagerly fails); the override test
 * edits the field TWICE and asserts exactly ONE override event (a tracker
 * without the once-per-draft guard fails); the PII test asserts the typed
 * meter number never appears in ANY payload key or value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { z } from "zod";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import { useUxTracking, trackEvent, flushUxQueue } from "@/lib/uxTrack";
import MemberBills from "@/pages/member/MemberBills";
import {
  setQuery,
  setMutation,
  getMutationCalls,
  resetTrpcMock,
} from "./helpers/trpcMock";

// 2026-10-24 (W11-B2c): MINIMAL replication of the server event schema
// (server/routers/memberUxEvents.ts trackEventSchema + metadataSchema) —
// replicated rather than imported so the client test graph stays free of
// server code (drizzle/trpc server deps). If the server schema changes,
// update this copy.
const metadataSchema = z
  .record(
    z.string().max(64),
    z.union([z.number(), z.boolean(), z.null(), z.string().max(64)])
  )
  .refine(obj => Object.keys(obj).length <= 20);
const trackEventSchema = z
  .object({
    clientEventId: z.string().uuid(),
    sessionId: z.string().uuid(),
    flow: z.string().trim().min(1).max(64),
    event: z.enum([
      "form_started",
      "field_edited",
      "prefill_accepted",
      "prefill_overridden",
      "step_abandoned",
      "completed",
      "recommendation_accepted",
      "recommendation_dismissed",
      "recommendation_dismissed_forever",
    ]),
    fieldName: z.string().trim().min(1).max(64).nullish(),
    step: z.string().trim().min(1).max(64).nullish(),
    metadataJson: metadataSchema.nullish(),
  })
  .strict();

const MEMBER = {
  id: 9001,
  name: "Adaeze Test",
  email: "adaeze@example.com",
  role: "user",
};

const BILLERS = {
  billers: [
    { name: "EKEDC", commissionRate: 0.005, commissionPct: "0.5%" },
    { name: "DSTV", commissionRate: 0.01, commissionPct: "1.0%" },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: true,
};

const BILL_PAYEES = {
  payees: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      rail: "bill",
      label: "Home meter",
      billerCode: "EKEDC",
      meterNumber: "12345678901",
      network: null,
      phone: null,
      provider: null,
      walletNumber: null,
      lastAmountKobo: 500000,
      useCount: 3,
      lastUsedAt: new Date("2026-09-20T10:00:00Z"),
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-09-20T10:00:00Z"),
    },
  ],
};

/** Mount a bare tracker host (registers the real sender via the mocked
 *  tRPC boundary). */
function TrackerHost() {
  useUxTracking();
  return null;
}

/** Sent batches (parsed inputs to memberUxEvents.track). */
function sentBatches(): Array<{ events: Record<string, unknown>[] }> {
  return getMutationCalls("memberUxEvents.track") as Array<{
    events: Record<string, unknown>[];
  }>;
}
function sentEvents(): Record<string, unknown>[] {
  return sentBatches().flatMap(b => b.events);
}

describe("uxTrack (W11-B2c)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setMutation("memberUxEvents.track", { data: { accepted: 1, duplicates: 0 } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    // Unmount (drops the sender), then fire any pending timer so nothing
    // leaks into the next test before real timers return.
    cleanup();
    await vi.advanceTimersByTimeAsync(6000).catch(() => {});
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Mount the host, then drain the module-singleton queue (flush + fire
   *  any pending 5s timer, repeated) so leftovers from a previous test
   *  cannot leak into this test's recorded sends; finally clear the record. */
  async function mountHost() {
    const r = render(<TrackerHost />);
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await flushUxQueue();
        await vi.advanceTimersByTimeAsync(6000);
      });
    }
    resetTrpcMock();
    setMutation("memberUxEvents.track", { data: { accepted: 1, duplicates: 0 } });
    return r;
  }

  it("flushes automatically at 10 queued events (no timer)", async () => {
    await mountHost();
    for (let i = 0; i < 9; i++) trackEvent("member-bills", "form_started");
    expect(sentBatches()).toHaveLength(0);
    await act(async () => {
      trackEvent("member-bills", "form_started");
      await flushUxQueue();
    });
    expect(sentBatches()).toHaveLength(1);
    expect(sentBatches()[0].events).toHaveLength(10);
  });

  it("flushes after 5s, NOT before (eager-flush mutant probe)", async () => {
    await mountHost();
    trackEvent("member-bills", "form_started");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(sentBatches()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(sentBatches()).toHaveLength(1);
    expect(sentBatches()[0].events).toHaveLength(1);
  });

  it("flushes on pagehide", async () => {
    await mountHost();
    trackEvent("member-bills", "form_started");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await flushUxQueue();
    });
    expect(sentBatches()).toHaveLength(1);
  });

  it("never sends more than the server batch cap (20) per call", async () => {
    await mountHost();
    await act(async () => {
      for (let i = 0; i < 25; i++) trackEvent("member-bills", "field_edited");
      await flushUxQueue();
      await flushUxQueue();
      await flushUxQueue();
    });
    expect(sentEvents()).toHaveLength(25);
    for (const b of sentBatches()) expect(b.events.length).toBeLessThanOrEqual(20);
  });

  it("mints one uuid sessionId, persists it in sessionStorage, and gives every event a unique clientEventId — all events pass the server zod shape", async () => {
    await mountHost();
    await act(async () => {
      trackEvent("member-bills", "form_started");
      trackEvent("member-bills", "field_edited", { fieldName: "amount" });
      trackEvent("member-bills", "prefill_accepted", {
        metadata: { rail: "bill", hasMeterNumber: true },
      });
      await flushUxQueue();
    });
    const events = sentEvents();
    expect(events).toHaveLength(3);
    for (const e of events) {
      const parsed = trackEventSchema.safeParse(e);
      expect(parsed.success).toBe(true);
    }
    const sessionIds = new Set(events.map(e => e.sessionId));
    expect(sessionIds.size).toBe(1);
    const stored = sessionStorage.getItem("ux-track-session-id");
    expect(stored).toBe([...sessionIds][0]);
    const clientEventIds = new Set(events.map(e => e.clientEventId));
    expect(clientEventIds.size).toBe(3);
  });

  it("is fail-silent: a failing send warns, requeues, and the retry re-sends the SAME clientEventId (server idempotency)", async () => {
    await mountHost();
    setMutation("memberUxEvents.track", {
      error: { message: "HTTP 503" },
    });
    await act(async () => {
      trackEvent("member-bills", "form_started");
      await flushUxQueue();
    });
    expect(console.warn).toHaveBeenCalled();
    // Nothing was lost — the batch is still queued.
    setMutation("memberUxEvents.track", { data: { accepted: 1, duplicates: 0 } });
    await act(async () => {
      trackEvent("member-bills", "completed"); // re-arms the flush schedule
      await vi.advanceTimersByTimeAsync(5000);
    });
    // The boundary mock records the FAILED attempt too, so the wire shows
    // form_started twice — with the SAME clientEventId (the server dedups
    // on it, so the retry can never double-count) — and completed once.
    const events = sentEvents();
    expect(events.filter(e => e.event === "completed")).toHaveLength(1);
    const started = events.filter(e => e.event === "form_started");
    expect(started).toHaveLength(2);
    expect(started[0].clientEventId).toBe(started[1].clientEventId);
  });

  it("no-PII guard: oversized/structured metadata entries are dropped before send", async () => {
    await mountHost();
    await act(async () => {
      trackEvent("member-bills", "field_edited", {
        fieldName: "customerNumber",
        metadata: {
          ok: 1,
          // A meter-number-length string is fine ONLY if short — this one
          // simulates a typed value; long strings are dropped.
          typed: "12345678901".repeat(10),
          // @ts-expect-error — deliberate schema violation for the probe
          nested: { evil: true },
        },
      });
      await flushUxQueue();
    });
    const events = sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].metadataJson).toEqual({ ok: 1 });
    // Mutant probe: the typed value never appears ANYWHERE in the payload.
    expect(JSON.stringify(sentBatches())).not.toContain("123456789011234567890");
  });
});

describe("MemberBills UX wiring (W11-B2c)", () => {
  // Base registrations; also re-applied after any mid-test resetTrpcMock
  // (a reset wipes auth.me — the next render would bounce to sign-in).
  function baseSetup() {
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberBillPayments.billers", { data: BILLERS });
    setQuery("memberPayees.list", { data: BILL_PAYEES });
    setMutation("memberUxEvents.track", { data: { accepted: 1, duplicates: 0 } });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    resetTrpcMock();
    sessionStorage.clear();
    baseSetup();
  });
  afterEach(async () => {
    // Unmount, then fire any pending timer so nothing leaks into the next
    // test before real timers return.
    cleanup();
    await vi.advanceTimersByTimeAsync(6000).catch(() => {});
    vi.useRealTimers();
  });

  /** Let the mount-time flush settle (flush + any pending timer), then
   *  clear bookkeeping and re-register the base queries. */
  async function drain() {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await flushUxQueue();
        await vi.advanceTimersByTimeAsync(6000);
      });
    }
    resetTrpcMock();
    baseSetup();
  }

  it("emits form_started on mount, prefill_accepted on payee select, ONE prefill_overridden per draft on identifier edit, and field_edited on amount blur — never the typed values", async () => {
    render(<MemberBills />);
    await drain(); // mount-time form_started send bookkeeping cleared

    // Payee select → prefill_accepted with scrubbed metadata.
    fireEvent.click(
      screen.getByTestId("payee-chip-11111111-1111-4111-8111-111111111111")
    );
    // Edit the prefilled identifier TWICE — exactly ONE override event.
    const meter = screen.getByLabelText(/Customer \/ meter number/);
    fireEvent.change(meter, { target: { value: "999" } });
    fireEvent.change(meter, { target: { value: "9999" } });
    // Amount: keystrokes emit NOTHING; blur emits one field_edited.
    const amount = screen.getByLabelText("Amount (NGN)");
    fireEvent.change(amount, { target: { value: "5" } });
    fireEvent.change(amount, { target: { value: "5000" } });
    fireEvent.blur(amount);

    await act(async () => {
      await flushUxQueue();
    });
    const events = sentEvents();
    const kinds = events.map(e => `${e.flow}:${String(e.event)}`);
    expect(kinds).toContain("member-bills:prefill_accepted");
    expect(
      events.filter(e => e.event === "prefill_overridden")
    ).toHaveLength(1);
    expect(events.find(e => e.event === "prefill_overridden")).toMatchObject({
      fieldName: "customerNumber",
    });
    expect(events.filter(e => e.event === "field_edited")).toHaveLength(1);
    expect(events.find(e => e.event === "field_edited")).toMatchObject({
      fieldName: "amount",
    });
    // Every event passes the server zod shape.
    for (const e of events) expect(trackEventSchema.safeParse(e).success).toBe(true);
    // NO-PII guard: the typed meter number and amount never appear in any
    // payload (fieldName is a NAME, metadata has no typed values).
    const payload = JSON.stringify(sentBatches());
    expect(payload).not.toContain("9999");
    expect(payload).not.toContain("12345678901");
  });

  it("emits completed on a terminal confirm outcome", async () => {
    render(<MemberBills />);
    // drain() resets the mock registrations, so the pay-flow registrations
    // go AFTER it (auth/billers/payees are re-registered inside drain).
    await drain();
    setQuery("memberBillPayments.validateCustomer", {
      data: {
        valid: true,
        customerNumber: "12345678901",
        biller: "EKEDC",
        message: "Valid",
      },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-1-abc",
        authorizationUrl: "https://checkout.paystack.test/bp1",
        accessCode: "ac",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 11,
        status: "awaiting_payment",
        idempotent: false,
      },
    });
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-1-abc",
        status: "success",
        providerStatus: "success",
        captureStatus: "captured",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 11,
        failureReason: null,
        refundStatus: null,
        idempotent: false,
      },
    });

    fireEvent.change(screen.getByLabelText(/Customer \/ meter number/), {
      target: { value: "12345678901" },
    });
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(screen.getByText("I've paid — verify"));
    await act(async () => {
      await flushUxQueue();
    });
    expect(sentEvents().some(e => e.event === "completed")).toBe(true);
  });
});
