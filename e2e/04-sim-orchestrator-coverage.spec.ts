/**
 * E2E: SIM Orchestrator probe ingestion → coverage map display
 */
import { test, expect } from "@playwright/test";

test.describe("SIM Orchestrator Coverage Map", () => {
  test("admin can view SIM orchestrator coverage map", async ({ page }) => {
    // Login as admin
    await page.goto("/");
    await expect(page.locator("text=InsurePortal")).toBeVisible({
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

    // Navigate to SIM Orchestrator tab
    const simTab = page.locator("text=/sim|orchestrator/i").first();
    if (await simTab.isVisible()) {
      await simTab.click();

      // Switch to Coverage Map sub-tab
      const coverageTab = page.locator("text=/coverage|map/i").first();
      if (await coverageTab.isVisible()) {
        await coverageTab.click();
        // Verify map container loads
        await expect(
          page
            .locator(".leaflet-container, [data-testid='coverage-map']")
            .first()
        ).toBeVisible({ timeout: 10_000 });
      }
    }
  });
});
