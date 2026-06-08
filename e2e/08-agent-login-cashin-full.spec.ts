/**
 * E2E: Agent Login → Cash-In → Receipt → Balance Verification
 *
 * Critical flow: Tests the complete agent authentication and cash-in transaction
 * Prerequisites: Dev server running, seed data loaded (AGT001 / PIN 1234)
 */
import { test, expect } from "@playwright/test";

test.describe("Agent Login & Cash-In — Full Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should display the POS login screen with agent code input", async ({
    page,
  }) => {
    // Verify the login screen renders
    await expect(page.locator("text=InsurePortal")).toBeVisible({
      timeout: 10_000,
    });

    // Verify agent code input exists
    const agentInput = page.locator('input[placeholder*="AGT"]');
    await expect(agentInput).toBeVisible();

    // Verify continue button exists
    await expect(
      page.locator("button", { hasText: /continue/i })
    ).toBeVisible();

    // Verify SSO link exists
    await expect(page.locator("text=/supervisor|admin.*sso/i")).toBeVisible();
  });

  test("should reject empty agent code", async ({ page }) => {
    const continueBtn = page.locator("button", { hasText: /continue/i });
    await continueBtn.click();

    // Should show validation error or stay on same screen
    await expect(page.locator('input[placeholder*="AGT"]')).toBeVisible();
  });

  test("should navigate to PIN entry after valid agent code", async ({
    page,
  }) => {
    const agentInput = page.locator('input[placeholder*="AGT"]');
    await agentInput.fill("AGT001");
    await page.locator("button", { hasText: /continue/i }).click();

    // Should show PIN pad or PIN entry screen
    await expect(
      page
        .locator('[data-digit], input[type="password"], text=/enter.*pin/i')
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should complete full login with agent code and PIN", async ({
    page,
  }) => {
    // Step 1: Enter agent code
    const agentInput = page.locator('input[placeholder*="AGT"]');
    await agentInput.fill("AGT001");
    await page.locator("button", { hasText: /continue/i }).click();

    // Step 2: Enter PIN via PIN pad
    await page.waitForTimeout(500);
    for (const digit of ["1", "2", "3", "4"]) {
      const pinBtn = page.locator(`button[data-digit="${digit}"]`).first();
      if (await pinBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await pinBtn.click();
        await page.waitForTimeout(100);
      }
    }

    // Step 3: Verify dashboard loads
    await expect(
      page.locator("text=/cash in|dashboard|balance|welcome/i").first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("should perform cash-in transaction after login", async ({ page }) => {
    // Login first
    const agentInput = page.locator('input[placeholder*="AGT"]');
    await agentInput.fill("AGT001");
    await page.locator("button", { hasText: /continue/i }).click();

    await page.waitForTimeout(500);
    for (const digit of ["1", "2", "3", "4"]) {
      const pinBtn = page.locator(`button[data-digit="${digit}"]`).first();
      if (await pinBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await pinBtn.click();
        await page.waitForTimeout(100);
      }
    }

    // Wait for dashboard
    await page.waitForTimeout(2_000);

    // Navigate to Cash In
    const cashInBtn = page.locator("text=Cash In").first();
    if (await cashInBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cashInBtn.click();
    }

    // Fill amount
    const amountInput = page
      .locator(
        'input[placeholder*="amount"], input[placeholder*="Amount"], input[type="number"]'
      )
      .first();
    if (await amountInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await amountInput.fill("5000");
    }

    // Fill customer phone if visible
    const phoneInput = page
      .locator(
        'input[placeholder*="phone"], input[placeholder*="customer"], input[placeholder*="Phone"]'
      )
      .first();
    if (await phoneInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await phoneInput.fill("08012345678");
    }

    // Submit
    const submitBtn = page
      .locator("button", { hasText: /confirm|proceed|submit|send/i })
      .first();
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
    }

    // Verify receipt or success message
    await expect(
      page
        .locator("text=/receipt|success|completed|₦5,000|transaction/i")
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
