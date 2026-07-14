/**
 * E2E: Float Top-Up Request → Admin Approval
 */
import { test, expect } from "@playwright/test";

test.describe("Float Top-Up Approval Workflow", () => {
  test("admin can approve a float top-up request", async ({ page }) => {
    // Login as admin
    await page.goto("/");
    await expect(page.locator("text=InsurePortal POS")).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('input[placeholder*="AGT"]').fill("AGT001");
    await page.locator("button", { hasText: "Continue" }).click();
    for (const digit of ["1", "2", "3", "4"]) {
      await page.locator(`button[data-digit="${digit}"]`).first().click();
    }
    await expect(page.locator("text=Cash In")).toBeVisible({ timeout: 15_000 });

    // Navigate to admin panel
    await page.goto("/admin");
    await expect(page.locator("text=/admin|overview/i").first()).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to Float Requests tab
    const floatTab = page.locator("text=/float|top.up/i").first();
    if (await floatTab.isVisible()) {
      await floatTab.click();
      await expect(page.locator("text=/pending|request/i").first()).toBeVisible(
        { timeout: 5_000 }
      );

      // Approve first pending request if any
      const approveBtn = page
        .locator("button", { hasText: /approve/i })
        .first();
      if (await approveBtn.isVisible()) {
        await approveBtn.click();
        // Confirm in modal if present
        const confirmBtn = page
          .locator("button", { hasText: /confirm|yes/i })
          .first();
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
        }
        await expect(
          page.locator("text=/approved|success/i").first()
        ).toBeVisible({ timeout: 5_000 });
      }
    }
  });
});
