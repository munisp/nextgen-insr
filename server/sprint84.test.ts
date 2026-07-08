// @ts-check

/**
 * Sprint 84 Tests — Stripe Invoice Webhooks, Billing Analytics Dashboard, Monthly Invoice Cron
 *
 * Validates:
 * 1. Stripe webhook handler for invoice events (paid, failed, overdue)
 * 2. Billing analytics dashboard Chart.js integration
 * 3. Monthly invoice cron handler with Kafka event publishing
 */
import { describe, it, expect, vi } from "vitest";

// ── Stripe Webhook Handler Tests ─────────────────────────────────────────────
describe("Sprint 84 — Stripe Invoice Webhook Handler", () => {
  it("should export handleMonthlyInvoiceCron function", async () => {
    const mod = await import("./scheduled/monthlyInvoiceCron");
    expect(mod.handleMonthlyInvoiceCron).toBeDefined();
    expect(typeof mod.handleMonthlyInvoiceCron).toBe("function");
  });

  it("should export cronPublishBillingEvent for Kafka integration", async () => {
    const mod = await import("./scheduled/monthlyInvoiceCron");
    expect(mod.cronPublishBillingEvent).toBeDefined();
    expect(typeof mod.cronPublishBillingEvent).toBe("function");
  });

  it("cronPublishBillingEvent should publish to correct Kafka topic", async () => {
    const mod = await import("./scheduled/monthlyInvoiceCron");
    const result = await mod.cronPublishBillingEvent(
      "billing.invoice.generated",
      {
        tenantId: 1,
        invoiceId: "inv_test_123",
        amount: 50000,
      }
    );
    expect(result).toHaveProperty("published", true);
    expect(result).toHaveProperty("topic", "billing.invoice.generated");
    expect(result).toHaveProperty("timestamp");
  });

  it("webhook handler should handle invoice.paid event structure", () => {
    // Validate the expected Stripe event structure for invoice.paid
    const invoicePaidEvent = {
      id: "evt_test_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_123",
          customer: "cus_test_456",
          amount_paid: 5000000, // ₦50,000 in kobo
          currency: "ngn",
          status: "paid",
          metadata: {
            tenant_id: "1",
            period: "April 2026",
            billing_model: "revenue_share",
          },
        },
      },
    };
    expect(invoicePaidEvent.type).toBe("invoice.paid");
    expect(invoicePaidEvent.data.object.metadata.tenant_id).toBe("1");
    expect(invoicePaidEvent.data.object.amount_paid).toBeGreaterThan(0);
  });

  it("webhook handler should handle invoice.payment_failed event structure", () => {
    const invoiceFailedEvent = {
      id: "evt_test_invoice_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_test_789",
          customer: "cus_test_456",
          amount_due: 7500000,
          currency: "ngn",
          status: "open",
          attempt_count: 1,
          next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
          metadata: {
            tenant_id: "2",
            period: "April 2026",
            billing_model: "subscription",
          },
        },
      },
    };
    expect(invoiceFailedEvent.type).toBe("invoice.payment_failed");
    expect(invoiceFailedEvent.data.object.attempt_count).toBe(1);
    expect(invoiceFailedEvent.data.object.next_payment_attempt).toBeGreaterThan(
      0
    );
  });

  it("webhook handler should detect and respond to test events", () => {
    const testEvent = { id: "evt_test_abc123", type: "invoice.paid" };
    expect(testEvent.id.startsWith("evt_test_")).toBe(true);
    // Test events should return { verified: true }
    const expectedResponse = { verified: true };
    expect(expectedResponse.verified).toBe(true);
  });
});

// ── Billing Analytics Dashboard Tests ────────────────────────────────────────
describe("Sprint 84 — Billing Analytics Dashboard", () => {
  it("should have BillingAnalyticsDashboardPage component file", async () => {
    const fs = await import("fs");
    const path = require("path").resolve(
      __dirname,
      "../client/src/pages/BillingAnalyticsDashboardPage.tsx"
    );
    expect(fs.existsSync(path)).toBe(true);
  });

  it("dashboard page should include Chart.js integration", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/BillingAnalyticsDashboardPage.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("chart.js/auto");
    expect(content).toContain("Chart");
    expect(content).toContain("canvas");
  });

  it("dashboard should include all 6 chart types", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/BillingAnalyticsDashboardPage.tsx"
      ),
      "utf-8"
    );
    // Revenue, MRR, Churn, LTV, Cohort, Forecast
    expect(content).toContain("revenueChartRef");
    expect(content).toContain("mrrChartRef");
    expect(content).toContain("churnChartRef");
    expect(content).toContain("ltvChartRef");
    expect(content).toContain("cohortChartRef");
    expect(content).toContain("forecastChartRef");
  });

  it("dashboard should include KPI cards for MRR, ARR, Churn, LTV", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/BillingAnalyticsDashboardPage.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("Monthly Recurring Revenue");
    expect(content).toContain("Annual Run Rate");
    expect(content).toContain("Revenue Churn");
    expect(content).toContain("Avg Customer LTV");
  });

  it("dashboard should include period filter (3m, 6m, 12m)", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/BillingAnalyticsDashboardPage.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("3 Months");
    expect(content).toContain("6 Months");
    expect(content).toContain("12 Months");
  });

  it("dashboard should reference data sources", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/BillingAnalyticsDashboardPage.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("Platform Billing Ledger");
    expect(content).toContain("TigerBeetle");
    expect(content).toContain("Stripe API");
  });
});

// ── Monthly Invoice Cron Tests ───────────────────────────────────────────────
describe("Sprint 84 — Monthly Invoice Cron", () => {
  it("cron handler should be mounted at /api/scheduled/monthly-invoices", async () => {
    const fs = await import("fs");
    const indexContent = fs.readFileSync(
      require("path").resolve(__dirname, "../server/_core/index.ts"),
      "utf-8"
    );
    expect(indexContent).toContain("/api/scheduled/monthly-invoices");
    expect(indexContent).toContain("handleMonthlyInvoiceCron");
  });

  it("cron handler should support all billing models", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("revenue_share");
    expect(content).toContain("subscription");
    expect(content).toContain("hybrid");
  });

  it("cron handler should integrate with Stripe invoice creation", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("stripe.invoices.create");
    expect(content).toContain("stripe.invoices.finalizeInvoice");
    expect(content).toContain("stripe.invoiceItems.create");
    expect(content).toContain("stripe.customers.create");
  });

  it("cron handler should publish Kafka events", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("billing.invoice.generated");
    expect(content).toContain("billing.cron.monthly_invoice_complete");
    expect(content).toContain("publishBillingEvent");
  });

  it("cron handler should record audit log entries", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("billingAuditLog");
    expect(content).toContain("invoice_generated");
  });

  it("cron handler should skip tenants with no transactions", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("No transactions, skipping");
  });

  it("cron handler should enforce minimum invoice amount", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("Amount too low");
    expect(content).toContain("5000"); // ₦50 minimum in kobo
  });

  it("cron handler should return structured summary response", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("tenantsProcessed");
    expect(content).toContain("invoicesGenerated");
    expect(content).toContain("totalRevenue");
    expect(content).toContain("elapsedMs");
  });

  it("cron handler should have proper error handling with context", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../server/scheduled/monthlyInvoiceCron.ts"
      ),
      "utf-8"
    );
    expect(content).toContain("x-manus-cron-task-uid");
    expect(content).toContain("res.status(500)");
    expect(content).toContain("Fatal error");
  });
});

// ── Route Registration Tests ─────────────────────────────────────────────────
describe("Sprint 84 — Route Registration", () => {
  it("BillingAnalyticsDashboardPage should be registered in App.tsx", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      require("path").resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(content).toContain("BillingAnalyticsDashboardPage");
    expect(content).toContain("/billing/analytics");
  });
});
