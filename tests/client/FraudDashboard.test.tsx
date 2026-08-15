/**
 * FraudDashboard.test.tsx — client page tests for the real-time fraud
 * admin dashboard (PR #114 high-risk page).
 *
 * Boundary mocks ONLY: the tRPC network client (@/lib/trpc) and the
 * Socket.IO feed hook (@/hooks/useSocket). The page component, store,
 * formatting and derivation logic are all real.
 *
 * Proves: loading/empty/error states render truthfully, live DB alerts flow
 * into the feed and KPIs, and no fabricated KPI/event data appears.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));
// Network boundary: the live socket feed. Reported as disconnected.
vi.mock("@/hooks/useSocket", () => ({
  useFraudSocket: () => false,
}));

import FraudDashboard from "@/pages/FraudDashboard";
import { setQuery, resetTrpcMock } from "./helpers/trpcMock";

const REAL_ALERT = {
  id: 4242,
  agentId: "AGT-777",
  txType: "cash_out",
  amount: 187500,
  customerName: "Chidi Okafor",
  fraudScore: "0.91",
  severity: "critical",
  reason: "Velocity spike: 9 cash-outs in 10 minutes",
  createdAt: new Date("2026-01-15T10:30:00Z").toISOString(),
  status: "open",
};

describe("FraudDashboard (client)", () => {
  beforeEach(() => resetTrpcMock());
  afterEach(() => cleanup());

  it("loading state renders without fabricating events or KPIs", () => {
    setQuery("fraud.list", { isLoading: true });
    setQuery("fraud.hourlyStats", { isLoading: true });
    render(<FraudDashboard />);

    expect(screen.getByText("Fraud Detection Center")).toBeInTheDocument();
    // No event rows while loading — the feed shows its honest empty state.
    expect(
      screen.getByText("Disconnected — waiting for the live fraud feed")
    ).toBeInTheDocument();
    // KPI cards derive from the (empty) event list: all zeros.
    expect(screen.getByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("error state renders no fabricated fallback data", () => {
    setQuery("fraud.list", {
      isError: true,
      error: { message: "database unavailable" },
    });
    setQuery("fraud.hourlyStats", {
      isError: true,
      error: { message: "database unavailable" },
    });
    render(<FraudDashboard />);

    // The page must NOT invent events/KPIs when the query fails.
    expect(
      screen.getByText("Disconnected — waiting for the live fraud feed")
    ).toBeInTheDocument();
    const totalCard = screen.getByText("Total Events").parentElement!.parentElement!;
    expect(totalCard.textContent).toContain("0");
    expect(screen.queryByText(/Chidi Okafor/)).not.toBeInTheDocument();
  });

  it("empty state renders when the database returns zero alerts", () => {
    setQuery("fraud.list", { data: { items: [], total: 0 } });
    setQuery("fraud.hourlyStats", { data: [] });
    render(<FraudDashboard />);

    expect(
      screen.getByText("Disconnected — waiting for the live fraud feed")
    ).toBeInTheDocument();
    const totalCard = screen.getByText("Total Events").parentElement!.parentElement!;
    expect(totalCard.textContent).toContain("0");
  });

  it("renders real DB alerts into the feed and derives KPIs from them", async () => {
    setQuery("fraud.list", { data: { items: [REAL_ALERT], total: 1 } });
    setQuery("fraud.hourlyStats", { data: [] });
    render(<FraudDashboard />);

    await waitFor(() =>
      expect(
        screen.getByText("Velocity spike: 9 cash-outs in 10 minutes")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("AGT-777")).toBeInTheDocument();

    // KPIs are derived from the real event, not constants.
    const totalCard = screen.getByText("Total Events").parentElement!.parentElement!;
    expect(totalCard.textContent).toContain("1");
    const criticalCard = screen.getByText("Critical").parentElement!.parentElement!;
    expect(criticalCard.textContent).toContain("1");
    const openCard = screen.getByText("Open Cases").parentElement!.parentElement!;
    expect(openCard.textContent).toContain("1");
  });
});
