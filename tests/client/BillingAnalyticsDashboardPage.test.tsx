/**
 * BillingAnalyticsDashboardPage.test.tsx — client page tests for the billing
 * analytics dashboard (PR #114 high-risk page).
 *
 * Boundary mocks ONLY: the tRPC network client (@/lib/trpc) — which also
 * backs the real useAuth hook — and chart.js (happy-dom has no canvas
 * implementation; chart instantiation is environment collateral, not data).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

// happy-dom does not implement canvas 2D — stub the Chart class so the page's
// chart effects are inert. No data is fabricated by this stub.
vi.mock("chart.js/auto", () => ({
  default: class ChartStub {
    static register() {}
    destroy() {}
    update() {}
    constructor() {}
  },
}));

import BillingAnalyticsDashboardPage from "@/pages/BillingAnalyticsDashboardPage";
import { setQuery, resetTrpcMock } from "./helpers/trpcMock";

const ADMIN = {
  id: 1,
  keycloakSub: "kc-admin-1",
  name: "Admin",
  email: "admin@test.local",
  role: "admin",
};

function authenticate() {
  setQuery("auth.me", { data: ADMIN });
}

describe("BillingAnalyticsDashboardPage (client)", () => {
  beforeEach(() => {
    resetTrpcMock();
    authenticate();
  });
  afterEach(() => cleanup());

  it("loading state renders honest placeholders, not fabricated KPIs", () => {
    setQuery("liveBillingDashboard.getMetrics", { isLoading: true });
    setQuery("billingProduction.getCohortAnalytics", { isLoading: true });
    setQuery("billingProduction.getRevenueForecast", { isLoading: true });
    render(<BillingAnalyticsDashboardPage />);

    expect(screen.getByText("Billing Analytics")).toBeInTheDocument();
    expect(screen.getByText("Monthly Recurring Revenue")).toBeInTheDocument();
    // Loading placeholder is the ellipsis — never a made-up ₦ figure.
    const mrrCard = screen.getByText("Monthly Recurring Revenue")
      .parentElement!.parentElement!;
    expect(mrrCard.textContent).toContain("…");
    expect(mrrCard.textContent).not.toMatch(/₦\d/);
  });

  it("error state renders the failure banner and no invented metrics", () => {
    setQuery("liveBillingDashboard.getMetrics", {
      isError: true,
      error: { message: "metrics service offline" },
    });
    render(<BillingAnalyticsDashboardPage />);

    expect(
      screen.getByText(/Failed to load billing metrics/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/metrics service offline/)
    ).toBeInTheDocument();
    // KPI cards fall back to the honest em-dash, not fabricated values.
    const mrrCard = screen.getByText("Monthly Recurring Revenue")
      .parentElement!.parentElement!;
    expect(mrrCard.textContent).toContain("—");
    expect(mrrCard.textContent).not.toMatch(/₦\d/);
  });

  it("empty state renders 'No data available yet' for empty charts", () => {
    setQuery("liveBillingDashboard.getMetrics", { data: {} });
    setQuery("billingProduction.getCohortAnalytics", { data: [] });
    setQuery("billingProduction.getRevenueForecast", { data: null });
    render(<BillingAnalyticsDashboardPage />);

    const empties = screen.getAllByText("No data available yet");
    expect(empties.length).toBeGreaterThan(0);
    const mrrCard = screen.getByText("Monthly Recurring Revenue")
      .parentElement!.parentElement!;
    expect(mrrCard.textContent).toContain("—");
  });

  it("renders real KPI values from the metrics query", () => {
    setQuery("liveBillingDashboard.getMetrics", {
      data: {
        mrr: 2450000,
        arr: 29400000,
        revenueChurn: 3.2,
        avgLtv: 185000,
        revenueByMonth: [
          { month: "2026-01", platform: 12.5, tenant: 8.1 },
        ],
      },
    });
    setQuery("billingProduction.getCohortAnalytics", { data: [] });
    setQuery("billingProduction.getRevenueForecast", { data: null });
    render(<BillingAnalyticsDashboardPage />);

    const mrrCard = screen.getByText("Monthly Recurring Revenue")
      .parentElement!.parentElement!;
    expect(mrrCard.textContent).toContain("₦2,450,000");
    const churnCard = screen.getByText("Revenue Churn")
      .parentElement!.parentElement!;
    expect(churnCard.textContent).toContain("3.2%");
  });
});
