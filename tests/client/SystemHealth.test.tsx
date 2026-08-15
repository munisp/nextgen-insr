/**
 * SystemHealth.test.tsx — client page tests for the infrastructure health
 * dashboard (PR #114 high-risk page).
 *
 * Boundary mocks ONLY: the tRPC network client (@/lib/trpc) and the global
 * fetch() call to /api/health. All rendering and status mapping is real.
 *
 * Note: this page previously crashed on mount — a useQuery hook was called
 * inside useEffect (invalid hook call). It is now hoisted to the component
 * top level; these tests guard that regression by actually mounting the page.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import SystemHealth from "@/pages/SystemHealth";
import { setQuery, resetTrpcMock } from "./helpers/trpcMock";

const HEALTHY = {
  status: "ok",
  version: "1.2.3",
  timestamp: new Date("2026-01-15T12:00:00Z").toISOString(),
  uptime: 3661,
  db: "connected",
  keycloak: "configured",
  tbSidecar: "running",
  temporal: "offline",
  kafka: "reachable",
  vault: "unavailable",
  redis: "connected",
};

describe("SystemHealth (client)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("serviceHealth.getAll", { data: { items: [] } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loading state renders skeleton badges before the first response", () => {
    // fetch never resolves during this test.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    const { container } = render(<SystemHealth />);

    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    // Overall banner is honest about not knowing the state yet.
    expect(screen.getByText("System Degraded")).toBeInTheDocument();
  });

  it("error state renders the failure banner when /api/health fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 }))
    );
    render(<SystemHealth />);

    await waitFor(() =>
      expect(screen.getByText(/Health check failed/)).toBeInTheDocument()
    );
    expect(screen.getByText("System Degraded")).toBeInTheDocument();
    // No fabricated service statuses are shown.
    expect(screen.queryByText("All Systems Operational")).toBeNull();
  });

  it("healthy state renders real per-service statuses from the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(HEALTHY), { status: 200 }))
    );
    render(<SystemHealth />);

    await waitFor(() =>
      expect(screen.getByText("All Systems Operational")).toBeInTheDocument()
    );
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getAllByText("Connected").length).toBeGreaterThanOrEqual(2); // db + redis
    expect(screen.getByText("Running")).toBeInTheDocument(); // TigerBeetle
    expect(screen.getByText(/Version 1\.2\.3/)).toBeInTheDocument();
  });

  it("degraded status from the API is rendered as degraded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ...HEALTHY, status: "degraded", db: "error" }), { status: 200 })
      )
    );
    render(<SystemHealth />);

    await waitFor(() =>
      expect(screen.getByText("System Degraded")).toBeInTheDocument()
    );
    expect(screen.getByText("Error")).toBeInTheDocument(); // db badge
  });
});
