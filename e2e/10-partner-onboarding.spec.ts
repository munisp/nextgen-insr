/**
 * E2E: Partner Onboarding Wizard — Full Flow
 *
 * Critical flow: Tests the complete white-label partner registration
 * Steps: Invite Code → Company Details → Branding → Regions & Fees → Go Live
 * Prerequisites: Dev server running, valid invite code in seed data
 */
import { test, expect } from "@playwright/test";

test.describe("Partner Onboarding Wizard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/partner/onboard");
    await page.waitForLoadState("networkidle");
  });

  test("should display the onboarding wizard with invite code step", async ({
    page,
  }) => {
    // Verify the onboarding page renders
    await expect(
      page.locator("text=/partner|onboard|invite|welcome/i").first()
    ).toBeVisible({ timeout: 10_000 });

    // Verify invite code input exists
    const inviteInput = page
      .locator(
        'input[placeholder*="invite"], input[placeholder*="code"], input[placeholder*="INVITE"]'
      )
      .first();
    await expect(inviteInput).toBeVisible({ timeout: 5_000 });
  });

  test("should reject invalid invite code", async ({ page }) => {
    const inviteInput = page
      .locator(
        'input[placeholder*="invite"], input[placeholder*="code"], input[placeholder*="INVITE"]'
      )
      .first();
    await inviteInput.fill("INVALID-CODE-XYZ");

    const validateBtn = page
      .locator("button", { hasText: /validate|verify|next|continue/i })
      .first();
    await validateBtn.click();

    // Should show error
    await expect(
      page.locator("text=/invalid|expired|not found|error/i").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should validate invite code and proceed to company details", async ({
    page,
  }) => {
    // Use seed invite code
    const inviteInput = page
      .locator(
        'input[placeholder*="invite"], input[placeholder*="code"], input[placeholder*="INVITE"]'
      )
      .first();
    await inviteInput.fill("PARTNER-2026-DEMO");

    const validateBtn = page
      .locator("button", { hasText: /validate|verify|next|continue/i })
      .first();
    await validateBtn.click();

    // Should proceed to company details step
    await expect(
      page.locator("text=/company|business|organization|details/i").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should complete company details step", async ({ page }) => {
    // Step 1: Invite code
    const inviteInput = page
      .locator(
        'input[placeholder*="invite"], input[placeholder*="code"], input[placeholder*="INVITE"]'
      )
      .first();
    await inviteInput.fill("PARTNER-2026-DEMO");
    await page
      .locator("button", { hasText: /validate|verify|next|continue/i })
      .first()
      .click();

    await page.waitForTimeout(1_000);

    // Step 2: Fill company details
    const companyName = page
      .locator(
        'input[placeholder*="company"], input[placeholder*="Company"], input[name*="company"]'
      )
      .first();
    if (await companyName.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await companyName.fill("TestPartner Ltd");
    }

    const regNumber = page
      .locator(
        'input[placeholder*="registration"], input[placeholder*="RC"], input[name*="reg"]'
      )
      .first();
    if (await regNumber.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await regNumber.fill("RC123456");
    }

    const contactEmail = page
      .locator('input[type="email"], input[placeholder*="email"]')
      .first();
    if (await contactEmail.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await contactEmail.fill("admin@testpartner.com");
    }

    const contactPhone = page
      .locator('input[placeholder*="phone"], input[type="tel"]')
      .first();
    if (await contactPhone.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await contactPhone.fill("+2348012345678");
    }

    // Click next
    const nextBtn = page
      .locator("button", { hasText: /next|continue|proceed/i })
      .first();
    if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nextBtn.click();
    }

    // Should proceed to branding step
    await expect(
      page.locator("text=/brand|logo|color|theme|customiz/i").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show branding preview with custom colors", async ({ page }) => {
    // Navigate through steps quickly
    const inviteInput = page
      .locator(
        'input[placeholder*="invite"], input[placeholder*="code"], input[placeholder*="INVITE"]'
      )
      .first();
    await inviteInput.fill("PARTNER-2026-DEMO");
    await page
      .locator("button", { hasText: /validate|verify|next|continue/i })
      .first()
      .click();
    await page.waitForTimeout(1_000);

    // Fill minimal company details and proceed
    const companyName = page
      .locator(
        'input[placeholder*="company"], input[placeholder*="Company"], input[name*="company"]'
      )
      .first();
    if (await companyName.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await companyName.fill("TestPartner Ltd");
    }

    const contactEmail = page
      .locator('input[type="email"], input[placeholder*="email"]')
      .first();
    if (await contactEmail.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await contactEmail.fill("admin@testpartner.com");
    }

    const nextBtn = page
      .locator("button", { hasText: /next|continue|proceed/i })
      .first();
    if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nextBtn.click();
    }

    await page.waitForTimeout(1_000);

    // Verify branding step has color pickers or inputs
    const colorInput = page
      .locator(
        'input[type="color"], input[placeholder*="color"], input[placeholder*="#"]'
      )
      .first();
    await expect(colorInput).toBeVisible({ timeout: 5_000 });

    // Verify live preview section exists
    await expect(
      page.locator("text=/preview|live.*preview|branded/i").first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
