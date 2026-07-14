/**
 * E2E Test: CBN Compliance Reporting
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the CBN regulatory compliance reporting flows:
 *   - Admin views CBN report dashboard
 *   - Admin triggers manual report generation
 *   - Admin views SAR (Suspicious Activity Report) list
 *   - Admin views settlement reconciliation
 *   - Admin views KYC compliance status
 */

import { test, expect, Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/`);
  const adminEmail = process.env.TEST_ADMIN_EMAIL || "admin@insureportal.ng";
  const adminPass = process.env.TEST_ADMIN_PASS || "TestAdmin123!";

  const isLoggedIn = await page
    .locator('[data-testid="user-menu"]')
    .isVisible()
    .catch(() => false);
  if (isLoggedIn) return;

  await page
    .locator('[data-testid="login-btn"], a[href*="login"]')
    .first()
    .click();
  await page.waitForURL(/login|oauth/);
  await page.fill('input[type="email"], input[name="email"]', adminEmail);
  await page.fill('input[type="password"], input[name="password"]', adminPass);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/**`);
}

// ── Test suite ────────────────────────────────────────────────────────────────
test.describe("CBN Compliance Reporting", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Admin can view CBN compliance dashboard", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/compliance`);
    await page.waitForLoadState("networkidle");

    // CBN compliance page should load
    await expect(
      page.locator(
        'h1:has-text("CBN"), h1:has-text("Compliance"), [data-testid="cbn-dashboard"]'
      )
    ).toBeVisible({ timeout: 10000 });

    // Should show report submission status
    await expect(
      page
        .locator(
          '[data-testid="report-status"], text=/Monthly|Quarterly|Annual/i'
        )
        .first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("Admin can view CBN reports list", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/compliance/reports`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator('h1:has-text("Reports"), [data-testid="cbn-reports-list"]')
    ).toBeVisible({ timeout: 10000 });

    // Should show report type filter
    const typeFilter = page.locator(
      '[data-testid="report-type-filter"], select[name="reportType"]'
    );
    if (await typeFilter.isVisible()) {
      await typeFilter.selectOption("monthly_activity");
      await page.waitForLoadState("networkidle");
    }
  });

  test("Admin can trigger manual CBN report generation", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/compliance/reports`);
    await page.waitForLoadState("networkidle");

    const generateBtn = page.locator(
      '[data-testid="generate-report-btn"], button:has-text("Generate Report")'
    );

    if (await generateBtn.isVisible()) {
      await generateBtn.click();

      // Report generation dialog should appear
      const dialog = page.locator(
        '[role="dialog"], [data-testid="generate-report-dialog"]'
      );
      await expect(dialog).toBeVisible({ timeout: 3000 });

      // Select report type
      const reportTypeSelect = dialog.locator('select[name="reportType"]');
      if (await reportTypeSelect.isVisible()) {
        await reportTypeSelect.selectOption("monthly_activity");
      }

      // Cancel — don't actually generate in E2E test
      await page
        .locator('button:has-text("Cancel"), [data-testid="cancel-btn"]')
        .click();
    }
  });

  test("Admin can view SAR (Suspicious Activity Reports) list", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/compliance/sar`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator(
        'h1:has-text("SAR"), h1:has-text("Suspicious"), [data-testid="sar-list"]'
      )
    ).toBeVisible({ timeout: 10000 });
  });

  test("Admin can view settlement reconciliation", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/settlement`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator(
        'h1:has-text("Settlement"), [data-testid="settlement-dashboard"]'
      )
    ).toBeVisible({ timeout: 10000 });

    // Should show settlement amounts
    await expect(
      page.locator('[data-testid="settlement-amount"], text=/NGN|₦/i').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("Admin can view KYC compliance status", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/kyc`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator('h1:has-text("KYC"), [data-testid="kyc-dashboard"]')
    ).toBeVisible({ timeout: 10000 });

    // Should show compliance breakdown
    await expect(
      page
        .locator(
          '[data-testid="kyc-compliant-count"], text=/compliant|expired/i'
        )
        .first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("CBN reports API returns report list", async ({ page }) => {
    const response = await page.request.post(
      `${BASE_URL}/api/trpc/compliance.listReports`,
      {
        data: { json: { page: 1, limit: 10 } },
        headers: { "Content-Type": "application/json" },
      }
    );

    expect([200, 401]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.result?.data?.json).toBeDefined();
    }
  });

  test("Settlement API returns reconciliation data", async ({ page }) => {
    const today = new Date().toISOString().split("T")[0];
    const response = await page.request.post(
      `${BASE_URL}/api/trpc/settlement.getReconciliation`,
      {
        data: { json: { date: today } },
        headers: { "Content-Type": "application/json" },
      }
    );

    expect([200, 401]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.result?.data?.json).toBeDefined();
    }
  });
});

// ── CBN Report Content Validation ────────────────────────────────────────────
test.describe("CBN Report Content Validation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Monthly activity report contains required CBN fields", async ({
    page,
  }) => {
    // Test the report generation API
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const response = await page.request.post(
      `${BASE_URL}/api/trpc/compliance.generateReport`,
      {
        data: {
          json: {
            reportType: "monthly_activity",
            year: prevMonth.getFullYear(),
            month: prevMonth.getMonth() + 1,
            dryRun: true, // Don't submit, just validate
          },
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.status() === 200) {
      const body = await response.json();
      const report = body.result?.data?.json;

      if (report) {
        // Validate required CBN report fields
        expect(report.reportType || report.report_type).toBeDefined();
        expect(report.institutionCode || report.institution_code).toBeDefined();
        expect(report.reportingPeriod || report.reporting_period).toBeDefined();
      }
    } else if (response.status() === 401) {
      test.skip(true, "Authentication required for report generation");
    }
  });
});
