/**
 * AgentFloatForecasting.test.tsx — client page tests for the ML float
 * forecasting page (PR #114 high-risk page).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc), which also backs
 * the real useAuth hook used by the real DashboardLayout shell.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import AgentFloatForecasting from "@/pages/AgentFloatForecasting";
import { setQuery, resetTrpcMock } from "./helpers/trpcMock";

const ADMIN = {
  id: 1,
  keycloakSub: "kc-admin-1",
  name: "Admin User",
  email: "admin@test.local",
  role: "admin",
};

describe("AgentFloatForecasting (client)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("auth.me", { data: ADMIN });
  });
  afterEach(() => cleanup());

  it("loading state renders skeletons and placeholders", () => {
    setQuery("agentFloatForecasting.getStats", { isLoading: true });
    setQuery("agentFloatForecasting.getForecast", { isLoading: true });
    const { container } = render(<AgentFloatForecasting />);

    expect(screen.getByText("Agent Float Forecasting")).toBeInTheDocument();
    // KPI cards show the ellipsis placeholder while loading.
    const poolCard = screen.getByText("Total Float Pool").parentElement!
      .parentElement!;
    expect(poolCard.textContent).toContain("…");
    expect(poolCard.textContent).not.toMatch(/₦\d/);
    // Forecast table shows skeleton pulse rows, not fabricated agents.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("error state renders the failure message, not fabricated forecasts", () => {
    setQuery("agentFloatForecasting.getForecast", {
      isError: true,
      error: { message: "forecast model unavailable" },
    });
    render(<AgentFloatForecasting />);

    expect(screen.getByText(/Failed to load forecasts/)).toBeInTheDocument();
    expect(
      screen.getByText(/forecast model unavailable/)
    ).toBeInTheDocument();
    expect(screen.queryByText("No forecast data available yet")).toBeNull();
  });

  it("empty state renders honestly when there is no forecast data", () => {
    setQuery("agentFloatForecasting.getStats", { data: {} });
    setQuery("agentFloatForecasting.getForecast", { data: { forecasts: [] } });
    render(<AgentFloatForecasting />);

    expect(
      screen.getByText("No forecast data available yet")
    ).toBeInTheDocument();
    const poolCard = screen.getByText("Total Float Pool").parentElement!
      .parentElement!;
    expect(poolCard.textContent).toContain("—");
  });

  it("renders real stats and forecast rows from query data", async () => {
    setQuery("agentFloatForecasting.getStats", {
      data: {
        totalFloat: 4200000,
        stockoutRisk: 3,
        agentsMonitored: 128,
        predictedDemand7d: 950000,
        avgAccuracy: 87,
      },
    });
    setQuery("agentFloatForecasting.getForecast", {
      data: {
        forecasts: [
          {
            id: "AGT-001",
            name: "Funmi Adeyemi",
            currentFloat: 45000,
            predictedNeed: 120000,
            shortfall: 75000,
            risk: "critical",
            location: "Lagos",
          },
        ],
      },
    });
    render(<AgentFloatForecasting />);

    await waitFor(() =>
      expect(screen.getByText("Funmi Adeyemi")).toBeInTheDocument()
    );
    const poolCard = screen.getByText("Total Float Pool").parentElement!
      .parentElement!;
    expect(poolCard.textContent).toContain("₦4,200,000");
    // F-12: model-telemetry fields (avgAccuracy, predictedDemand7d) have no
    // delivered data source — the page renders the honest empty state even
    // when a payload carries them, rather than displaying phantom telemetry.
    const accCard = screen.getByText("Model Accuracy").parentElement!
      .parentElement!;
    expect(accCard.textContent).toContain("—");
    expect(accCard.textContent).not.toContain("87%");
  });
});
