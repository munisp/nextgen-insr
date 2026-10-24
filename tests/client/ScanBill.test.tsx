/**
 * ScanBill.test.tsx — 2026-10-25 (W11-B4c-2): the web OCR bill-scan intake
 * (client/src/pages/member/ScanBillButton.tsx) over the merged
 * memberBillScan.parse contract (server/routers/memberBillScan.ts).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub; FileReader/sessionStorage are the real happy-dom APIs.
 * Proves:
 *   - status ok → a REVIEW CARD shows the extracted biller/meter/amount;
 *     "Apply" feeds ONLY the identifiers through the existing payee-select
 *     path (amount NEVER set by Apply; validation/pay state reset);
 *   - the scanned amount is an explicit suggestion chip — never auto-filled;
 *   - validate/pay are NOT called by any scan interaction, and the anomaly
 *     soft-confirm gate still runs on the normal submit path;
 *   - unavailable / low_confidence / error / network failure → honest
 *     inline message, no prefill, form fully usable (fail closed);
 *   - mutation call-list audit: only memberBillScan.parse and
 *     memberUxEvents.track are ever invoked;
 *   - canary: the scanned meter number / amount / image base64 NEVER
 *     appear in tracked telemetry; bill_scan trackEvent metadata is ONLY
 *     {rail, status} (V7-class call-site canary);
 *   - V1-class regression: a non-ok status carrying a stray `prefill`
 *     object renders NO review card and applies nothing;
 *   - uxTrack post-B4c-1 (PR #304): the 4 omnibox kinds are now QUEUED and
 *     flushed (previously dropped), while the scan_* kinds stay dropped
 *     fail-silently until the server enum accepts them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

// trackEvent spy wrapping the REAL implementation (2026-10-25, W11-B4c-2):
// the scan_* kinds are dropped at the uxTrack enqueue boundary until the
// server enum accepts them, so the bill_scan instrumentation contract
// (kind + {rail, status}-only metadata — the V7 canary) is asserted at the
// trackEvent call site.
vi.mock("@/lib/uxTrack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uxTrack")>();
  return { ...actual, trackEvent: vi.fn(actual.trackEvent) };
});

import MemberBills from "@/pages/member/MemberBills";
import MemberAirtime from "@/pages/member/MemberAirtime";
import { useUxTracking, trackEvent, flushUxQueue } from "@/lib/uxTrack";
import {
  setQuery,
  setMutation,
  getMutationCalls,
  getQueryCalls,
  getAllMutationPaths,
  resetTrpcMock,
} from "./helpers/trpcMock";

const trackEventMock = vi.mocked(trackEvent);

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

const SCAN_OK = {
  status: "ok",
  mode: "prefill",
  prefill: {
    billerCode: "EKEDC",
    customerNumber: "12345678901",
    amountKobo: 500000, // ₦5,000.00
  },
  confidence: 0.91,
  message:
    "Bill scanned — review the prefilled details before paying. Nothing has been paid or saved.",
};

/** A tiny in-range image file (well under the canvas-downscale threshold,
 *  so the direct FileReader path is exercised). */
function billPhoto(): File {
  return new File(["x".repeat(400)], "bill.png", { type: "image/png" });
}

/** Drive the hidden file input the "Scan a bill" button opens. */
async function scanBillPhoto() {
  const input = screen.getByTestId("scan-file-input");
  fireEvent.change(input, { target: { files: [billPhoto()] } });
  // FileReader is async — let the read + mutation settle.
  await waitFor(() =>
    expect(getMutationCalls("memberBillScan.parse")).toHaveLength(1)
  );
}

describe("ScanBillButton on /member/bills (W11-B4c-2)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberBillPayments.billers", { data: BILLERS });
    setQuery("memberPayees.list", { data: { payees: [] } });
    trackEventMock.mockClear();
  });
  afterEach(() => cleanup());

  it("V1-class regression: a non-ok status carrying a STRAY prefill object must NOT render the review card and must apply nothing", async () => {
    // A low_confidence response that (incorrectly) carries a prefill — the
    // review card is gated on status === "ok" + mode === "prefill", so the
    // stray fields are ignored entirely (web equivalent of the mobile M2
    // fix).
    setMutation("memberBillScan.parse", {
      data: {
        status: "low_confidence",
        mode: "manual_entry",
        prefill: {
          billerCode: "EKEDC",
          customerNumber: "12345678901",
          amountKobo: 500000,
        },
        confidence: 0.4,
        message:
          "Scan confidence 0.40 is below the 0.6 threshold — please enter the bill details manually. No fields were guessed.",
      },
    });
    render(<MemberBills />);
    await scanBillPhoto();

    const note = await screen.findByTestId("scan-message");
    expect(note).toHaveTextContent(/below the 0\.6 threshold/);
    // No review card, and NOTHING was applied to the form.
    expect(screen.queryByTestId("scan-review")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Customer \/ meter number/)).toHaveValue("");
    expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("");
    expect(screen.queryByTestId("prefill-hint")).not.toBeInTheDocument();
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
  });

  it("V7-class canary: bill_scan trackEvent metadata contains ONLY {rail, status} — never the scanned biller/meter/amount", async () => {
    setMutation("memberBillScan.parse", { data: SCAN_OK });
    render(<MemberBills />);
    await scanBillPhoto();
    await screen.findByTestId("scan-review");
    fireEvent.click(screen.getByTestId("scan-apply"));

    const scanCalls = trackEventMock.mock.calls.filter(
      ([flow]) => flow === "bill_scan"
    );
    // The scan emitted started + succeeded at the call site.
    expect(scanCalls.map(([, event]) => event)).toEqual([
      "scan_started",
      "scan_succeeded",
    ]);
    for (const [, , opts] of scanCalls) {
      const metadata = opts?.metadata ?? {};
      // Hard rule: the only metadata keys are rail and status.
      for (const key of Object.keys(metadata)) {
        expect(["rail", "status"]).toContain(key);
      }
      // And none of the extracted values appear anywhere in the metadata.
      const blob = JSON.stringify(metadata);
      expect(blob).not.toContain("EKEDC");
      expect(blob).not.toContain("12345678901");
      expect(blob).not.toContain("500000");
      expect(blob).not.toContain("5000");
    }
  });

  it("ok → review card shows the extracted values; Apply prefills identifiers via the normal path and NEVER sets the amount; validate/pay untouched", async () => {
    setMutation("memberBillScan.parse", { data: SCAN_OK });
    render(<MemberBills />);
    await scanBillPhoto();

    // The parse call carried the rail + a base64 image, nothing else.
    const parseCalls = getMutationCalls("memberBillScan.parse") as {
      imageBase64: string;
      rail: string;
    }[];
    expect(parseCalls[0].rail).toBe("bill");
    expect(parseCalls[0].imageBase64.length).toBeGreaterThan(100);

    const card = await screen.findByTestId("scan-review");
    expect(card).toHaveTextContent(
      "Scanned from photo — review before paying"
    );
    expect(card).toHaveTextContent("EKEDC");
    expect(card).toHaveTextContent("12345678901");
    expect(card).toHaveTextContent(/₦5,000\.00/);

    // The amount is NEVER auto-filled — even while the card is showing.
    expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("");

    // Apply feeds the identifiers through the existing payee-select path.
    fireEvent.click(screen.getByTestId("scan-apply"));
    expect(screen.getByLabelText(/Customer \/ meter number/)).toHaveValue(
      "12345678901"
    );
    // The biller select shows the catalog-matched biller.
    expect(screen.getByLabelText("Biller")).toHaveTextContent("EKEDC");
    // Amount STILL not set by Apply (payee-prefill contract: always cleared).
    expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("");
    // Provenance hint with the scan label.
    expect(screen.getByTestId("prefill-hint")).toHaveTextContent(
      /Prefilled from your scanned bill photo/
    );
    // The card is consumed.
    expect(screen.queryByTestId("scan-review")).not.toBeInTheDocument();

    // No validation was triggered and no payment was initiated.
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
    expect(getMutationCalls("memberBillPayments.confirmPay")).toEqual([]);
    const validateInputs = getQueryCalls(
      "memberBillPayments.validateCustomer"
    ) as { biller: string; customerNumber: string }[];
    for (const input of validateInputs) {
      // Only the disabled-sentinel input may ever appear.
      expect(input).toEqual({ biller: "__none__", customerNumber: "__none__" });
    }
  });

  it("the amount suggestion chip fills the amount field ONLY on an explicit tap", async () => {
    setMutation("memberBillScan.parse", { data: SCAN_OK });
    render(<MemberBills />);
    await scanBillPhoto();
    await screen.findByTestId("scan-review");

    const amountInput = screen.getByLabelText("Amount (NGN)");
    expect(amountInput).toHaveValue(""); // never auto-filled
    fireEvent.click(screen.getByTestId("scan-amount-chip"));
    expect(amountInput).toHaveValue("5000");

    // Tapping the chip submits nothing.
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
  });

  it("the anomaly soft-confirm gate still runs on the normal submit path after a scan Apply", async () => {
    setMutation("memberBillScan.parse", { data: SCAN_OK });
    setQuery("memberBillPayments.validateCustomer", {
      data: {
        valid: true,
        customerNumber: "12345678901",
        biller: "EKEDC",
        message: "Valid",
      },
    });
    // Anomalous verdict → the inline soft-confirm must intercept Pay.
    setQuery("memberInsights.amountAnomalyCheck", {
      data: { anomalous: true, multiple: 3 },
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
    render(<MemberBills />);
    await scanBillPhoto();
    await screen.findByTestId("scan-review");
    // Amount via the explicit chip tap, THEN Apply (the payee-prefill
    // contract clears the amount on Apply — so fill it again after, exactly
    // what a member would do).
    fireEvent.click(screen.getByTestId("scan-amount-chip"));
    fireEvent.click(screen.getByTestId("scan-apply"));
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "5000" },
    });

    // Normal flow: Validate, then Pay — the anomaly gate must intercept.
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await screen.findByTestId("anomaly-soft-confirm");
    // Pay did NOT fire until the explicit extra tap.
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
    fireEvent.click(screen.getByTestId("anomaly-confirm"));
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(1);
    // The scanned identifiers flowed into the REAL pay payload (zod-exact
    // funds fields only — idempotency key present).
    const pay = (getMutationCalls("memberBillPayments.pay") as Record<
      string,
      unknown
    >[])[0];
    expect(pay).toMatchObject({
      biller: "EKEDC",
      customerNumber: "12345678901",
      amountNGN: 5000,
    });
    expect(typeof pay.idempotencyKey).toBe("string");
  });

  it.each([
    [
      "unavailable",
      "Bill scanning is not configured on this deployment. Please enter the bill details manually.",
    ],
    [
      "low_confidence",
      "Scan confidence 0.40 is below the 0.6 threshold — please enter the bill details manually. No fields were guessed.",
    ],
    ["error", "OCR provider timed out. No fields were extracted or guessed."],
  ])(
    "%s → honest inline message, no prefill, form fully usable",
    async (status, message) => {
      setMutation("memberBillScan.parse", {
        data: { status, mode: "manual_entry", message },
      });
      render(<MemberBills />);
      await scanBillPhoto();

      const note = await screen.findByTestId("scan-message");
      expect(note).toHaveTextContent(message);
      expect(screen.queryByTestId("scan-review")).not.toBeInTheDocument();
      // Form untouched and fully usable.
      expect(screen.getByLabelText(/Customer \/ meter number/)).toHaveValue(
        ""
      );
      expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "Validate" })
      ).toBeInTheDocument();
      expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
    }
  );

  it("parse network failure → fail-closed message, no crash, no prefill", async () => {
    setMutation("memberBillScan.parse", {
      error: { message: "HTTP 503" },
    });
    render(<MemberBills />);
    await scanBillPhoto();

    const note = await screen.findByTestId("scan-message");
    expect(note).toHaveTextContent(/Bill scan failed/);
    expect(note).toHaveTextContent(/enter the details manually/);
    expect(screen.queryByTestId("scan-review")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate" })
    ).toBeInTheDocument();
  });

  it("mutation call-list audit: only memberBillScan.parse and memberUxEvents.track are ever invoked", async () => {
    setMutation("memberBillScan.parse", { data: SCAN_OK });
    render(<MemberBills />);
    await scanBillPhoto();
    await screen.findByTestId("scan-review");
    fireEvent.click(screen.getByTestId("scan-amount-chip"));
    fireEvent.click(screen.getByTestId("scan-apply"));
    await act(async () => {
      await flushUxQueue();
    });
    const allowed = new Set(["memberBillScan.parse", "memberUxEvents.track"]);
    for (const path of getAllMutationPaths()) {
      expect(allowed.has(path)).toBe(true);
    }
    expect(getMutationCalls("memberBillScan.parse")).toHaveLength(1);
  });

  it("canary: the scanned meter number, amount, and image bytes NEVER appear in tracked telemetry", async () => {
    setMutation("memberBillScan.parse", { data: SCAN_OK });
    render(<MemberBills />);
    await scanBillPhoto();
    await screen.findByTestId("scan-review");
    fireEvent.click(screen.getByTestId("scan-apply"));
    await act(async () => {
      await flushUxQueue();
    });
    const telemetry = JSON.stringify(getMutationCalls("memberUxEvents.track"));
    expect(telemetry).not.toContain("12345678901");
    expect(telemetry).not.toContain("500000");
    expect(telemetry).not.toContain("5000");
    // The image base64 (400 'x' chars → "eHh4..." repeating) is never tracked.
    expect(telemetry).not.toContain("eHh4");
  });
});

describe("ScanBillButton on /member/airtime (W11-B4c-2)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberMobileMoney.providers", {
      data: {
        providers: [{ name: "MTN MoMo" }],
        limits: {
          minAmountNGN: 100,
          maxAmountNGN: 300000,
          dailyLimitNGN: 1000000,
        },
        configured: true,
      },
    });
    setQuery("memberPayees.list", { data: { payees: [] } });
    trackEventMock.mockClear();
  });
  afterEach(() => cleanup());

  it("ok → Apply prefills network+phone via the normal path, amount only via the chip", async () => {
    setMutation("memberBillScan.parse", {
      data: {
        status: "ok",
        mode: "prefill",
        prefill: {
          billerCode: "MTN",
          customerNumber: "08031234567",
          amountKobo: 100000, // ₦1,000.00
        },
        confidence: 0.88,
        message: "Bill scanned — review the prefilled details before paying.",
      },
    });
    render(<MemberAirtime />);
    // The page has one scan widget (Buy Airtime section).
    const input = screen.getByTestId("scan-file-input");
    fireEvent.change(input, { target: { files: [billPhoto()] } });
    await waitFor(() =>
      expect(getMutationCalls("memberBillScan.parse")).toHaveLength(1)
    );
    expect(
      (getMutationCalls("memberBillScan.parse") as { rail: string }[])[0].rail
    ).toBe("airtime");

    const card = await screen.findByTestId("scan-review");
    expect(card).toHaveTextContent("MTN");
    expect(card).toHaveTextContent("08031234567");
    expect(card).toHaveTextContent(/₦1,000\.00/);

    fireEvent.click(screen.getByTestId("scan-apply"));
    expect(screen.getByLabelText("Phone (optional)")).toHaveValue(
      "08031234567"
    );
    expect(screen.getByLabelText("Network")).toHaveTextContent("MTN");
    // Amount NOT set by Apply; the chip sets it explicitly.
    expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("");
    expect(screen.getByTestId("prefill-hint-airtime")).toHaveTextContent(
      /Prefilled from your scanned bill photo/
    );
    expect(getMutationCalls("memberAirtime.vend")).toEqual([]);
  });

  it("unavailable on the airtime rail → honest message, form usable", async () => {
    setMutation("memberBillScan.parse", {
      data: {
        status: "unavailable",
        mode: "manual_entry",
        message:
          "Bill scanning is not configured on this deployment. Please enter the bill details manually.",
      },
    });
    render(<MemberAirtime />);
    const input = screen.getByTestId("scan-file-input");
    fireEvent.change(input, { target: { files: [billPhoto()] } });
    const note = await screen.findByTestId("scan-message");
    expect(note).toHaveTextContent(/not configured/);
    expect(screen.queryByTestId("scan-review")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Buy airtime" })
    ).toBeInTheDocument();
    expect(getMutationCalls("memberAirtime.vend")).toEqual([]);
  });
});

describe("uxTrack server-accepted kinds (post-B4c-1, PR #304)", () => {
  function TrackerHost() {
    useUxTracking();
    return null;
  }
  function sentEvents(): Record<string, unknown>[] {
    return (getMutationCalls("memberUxEvents.track") as {
      events: Record<string, unknown>[];
    }[]).flatMap((b) => b.events);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setMutation("memberUxEvents.track", {
      data: { accepted: 1, duplicates: 0 },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    await vi.advanceTimersByTimeAsync(6000).catch(() => {});
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mountHost() {
    render(<TrackerHost />);
    // Drain any leftovers from a previous test, then clear the record.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await flushUxQueue();
        await vi.advanceTimersByTimeAsync(6000);
      });
    }
    resetTrpcMock();
    setMutation("memberUxEvents.track", {
      data: { accepted: 1, duplicates: 0 },
    });
  }

  it("the 4 omnibox kinds are now QUEUED and flushed (no longer dropped)", async () => {
    await mountHost();
    await act(async () => {
      trackEvent("omnibox", "omnibox_opened");
      trackEvent("omnibox", "intent_parsed", {
        metadata: { intentType: "bill_pay", rail: "bill" },
      });
      trackEvent("omnibox", "prefill_applied", { metadata: { rail: "bill" } });
      trackEvent("omnibox", "clarify_shown", {
        metadata: { intentType: "unknown" },
      });
      await flushUxQueue();
    });
    const kinds = sentEvents().map((e) => e.event);
    expect(kinds).toContain("omnibox_opened");
    expect(kinds).toContain("intent_parsed");
    expect(kinds).toContain("prefill_applied");
    expect(kinds).toContain("clarify_shown");
  });

  it("the scan_* kinds remain fail-silent dropped until the server enum accepts them", async () => {
    await mountHost();
    await act(async () => {
      trackEvent("bill_scan", "scan_started", { metadata: { rail: "bill" } });
      trackEvent("bill_scan", "scan_succeeded", {
        metadata: { rail: "bill", status: "ok" },
      });
      await flushUxQueue();
    });
    expect(sentEvents()).toEqual([]);
  });
});
