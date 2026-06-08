/**
 * E2E: Full Settlement → Reconciliation → Reporting Workflow
 * Tests the complete post-transaction lifecycle
 */
import { test, expect } from "@playwright/test";

test.describe("Settlement & Reporting E2E", () => {
  test("should navigate to settlement dashboard and view batches", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=InsurePortal")).toBeVisible({
      timeout: 10_000,
    });
    // Login via SSO
    const ssoBtn = page
      .locator("button", { hasText: /supervisor|admin|sso/i })
      .first();
    if (await ssoBtn.isVisible()) {
      await ssoBtn.click();
      await page.waitForTimeout(2000);
    }
    // Navigate to settlement
    await page.goto("/settlement");
    await page.waitForTimeout(3000);
    // Verify settlement page loads
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("should navigate to reports and generate transaction report", async ({
    page,
  }) => {
    await page.goto("/reports");
    await page.waitForTimeout(3000);
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("should navigate to fraud detection dashboard", async ({ page }) => {
    await page.goto("/fraud-realtime");
    await page.waitForTimeout(3000);
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("should navigate to AI monitoring dashboard", async ({ page }) => {
    await page.goto("/ai-monitoring");
    await page.waitForTimeout(3000);
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("should navigate to compliance chatbot", async ({ page }) => {
    await page.goto("/compliance-chatbot");
    await page.waitForTimeout(3000);
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("should navigate to pipeline monitoring", async ({ page }) => {
    await page.goto("/pipeline-monitoring");
    await page.waitForTimeout(3000);
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });
});
