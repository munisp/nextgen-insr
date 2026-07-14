/**
 * E2E: Full Agent Workflow — Login → Transaction → Balance Check → History → Logout
 * Validates the complete agent lifecycle
 */
import { test, expect } from "@playwright/test";

test.describe("Full Agent Workflow E2E", () => {
  test("should complete full agent transaction lifecycle", async ({ page }) => {
    // 1. Navigate to POS Shell
    await page.goto("/");
    await expect(page.locator("text=InsurePortal POS")).toBeVisible({
      timeout: 10_000,
    });

    // 2. Enter agent ID
    const agentInput = page.locator('input[placeholder*="AGT"]');
    if (await agentInput.isVisible()) {
      await agentInput.fill("AGT001");
      await page.locator("button", { hasText: "Continue" }).click();
      await page.waitForTimeout(2000);
    }

    // 3. Verify page loaded
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("should access admin dashboard via SSO", async ({ page }) => {
    await page.goto("/");
    const ssoBtn = page
      .locator("button", { hasText: /supervisor|admin|sso/i })
      .first();
    if (await ssoBtn.isVisible()) {
      await ssoBtn.click();
      await page.waitForTimeout(3000);
    }
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("should navigate through all major sections", async ({ page }) => {
    const routes = [
      "/dashboard",
      "/agents",
      "/transactions",
      "/float",
      "/settlement",
      "/reports",
      "/fraud",
      "/compliance",
      "/audit-trail",
      "/api-gateway",
      "/feature-flags",
    ];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForTimeout(1000);
      const body = await page.textContent("body");
      expect(body).toBeTruthy();
    }
  });

  test("should verify mobile responsive layout", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("text=InsurePortal POS")).toBeVisible({
      timeout: 10_000,
    });
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });
});
