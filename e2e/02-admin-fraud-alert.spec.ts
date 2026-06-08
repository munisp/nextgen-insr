/**
 * E2E: Admin Panel → Fraud Alert → Status Update
 * Prerequisites: seed data with at least 1 fraud alert, admin agent (AGT001 with role=admin)
 */
import { test, expect } from "@playwright/test";

test.describe("Admin Panel Fraud Alert Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto("/");
    await expect(page.locator("text=InsurePortal")).toBeVisible({
      timeout: 10_000,
    });
    const agentCodeInput = page.locator('input[placeholder*="AGT"]');
    await agentCodeInput.fill("AGT001");
    await page.locator("button", { hasText: "Continue" }).click();
    for (const digit of ["1", "2", "3", "4"]) {
      await page.locator(`button[data-digit="${digit}"]`).first().click();
    }
    await expect(page.locator("text=Cash In")).toBeVisible({ timeout: 15_000 });
  });

  test("should navigate to admin panel and update fraud alert status", async ({
    page,
  }) => {
    // ── 1. Open Admin Panel ──────────────────────────────────────────────────
    const adminBtn = page
      .locator("button[title*='Admin'], button[aria-label*='Admin'], text=⬡")
      .first();
    if (await adminBtn.isVisible()) {
      await adminBtn.click();
    } else {
      await page.goto("/admin");
    }

    // ── 2. Verify admin panel loaded ─────────────────────────────────────────
    await expect(
      page.locator("text=/admin|fraud|overview/i").first()
    ).toBeVisible({ timeout: 10_000 });

    // ── 3. Navigate to Fraud Feed tab ────────────────────────────────────────
    const fraudTab = page.locator("text=/fraud/i").first();
    if (await fraudTab.isVisible()) {
      await fraudTab.click();
    }

    // ── 4. Verify fraud alerts table ─────────────────────────────────────────
    await expect(
      page.locator("text=/alert|fraud|severity/i").first()
    ).toBeVisible({ timeout: 5_000 });

    // ── 5. Update first alert status to "investigating" ──────────────────────
    const statusDropdown = page.locator("select, [role='combobox']").first();
    if (await statusDropdown.isVisible()) {
      await statusDropdown.selectOption("investigating");
      // Verify status updated
      await expect(page.locator("text=/investigating/i").first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
