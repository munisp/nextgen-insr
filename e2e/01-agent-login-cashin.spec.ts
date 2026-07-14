/**
 * E2E: Agent login → Cash-In → Receipt → Logout
 * Prerequisites: seed data must be loaded (AGT001 / PIN 1234)
 */
import { test, expect } from "@playwright/test";

test.describe("Agent Login and Cash-In Flow", () => {
  test("should login, perform cash-in, see receipt, and logout", async ({
    page,
  }) => {
    // ── 1. Navigate to InsurePortal Platform ─────────────────────────────────────────────
    await page.goto("/");
    await expect(page.locator("text=InsurePortal POS")).toBeVisible({
      timeout: 10_000,
    });

    // ── 2. Enter agent code ──────────────────────────────────────────────────
    const agentCodeInput = page.locator('input[placeholder*="AGT"]');
    await agentCodeInput.fill("AGT001");
    await page.locator("button", { hasText: "Continue" }).click();

    // ── 3. Enter PIN (4-digit PIN pad) ───────────────────────────────────────
    // Click digits 1, 2, 3, 4 on the PIN pad
    for (const digit of ["1", "2", "3", "4"]) {
      await page.locator(`button[data-digit="${digit}"]`).first().click();
    }

    // ── 4. Wait for InsurePortal Platform dashboard ─────────────────────────────────────
    await expect(page.locator("text=Cash In")).toBeVisible({ timeout: 15_000 });

    // ── 5. Navigate to Cash In ───────────────────────────────────────────────
    await page.locator("text=Cash In").first().click();
    await expect(page.locator("text=Cash In")).toBeVisible();

    // ── 6. Enter amount ──────────────────────────────────────────────────────
    const amountInput = page
      .locator('input[placeholder*="amount"], input[placeholder*="Amount"]')
      .first();
    await amountInput.fill("5000");

    // Enter customer phone
    const customerInput = page
      .locator(
        'input[placeholder*="customer"], input[placeholder*="phone"], input[placeholder*="Customer"]'
      )
      .first();
    if (await customerInput.isVisible()) {
      await customerInput.fill("08012345678");
    }

    // ── 7. Submit transaction ────────────────────────────────────────────────
    await page
      .locator("button", { hasText: /confirm|proceed|submit/i })
      .first()
      .click();

    // ── 8. Verify receipt appears ────────────────────────────────────────────
    await expect(page.locator("text=/receipt|success|₦5,000/i")).toBeVisible({
      timeout: 15_000,
    });

    // ── 9. Close receipt ─────────────────────────────────────────────────────
    const closeBtn = page
      .locator("button", { hasText: /close|done|ok/i })
      .first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }

    // ── 10. Logout ───────────────────────────────────────────────────────────
    // Find logout button (usually in header or settings)
    const logoutBtn = page
      .locator("button", { hasText: /logout|sign out/i })
      .first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await expect(page.locator("text=InsurePortal POS")).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
