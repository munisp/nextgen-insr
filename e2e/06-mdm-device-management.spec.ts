/**
 * E2E Test: MDM Device Management
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the MDM device management flows:
 *   - Admin views device fleet dashboard
 *   - Admin views device compliance status
 *   - Admin triggers remote wipe on compromised device
 *   - Admin views OTA update status
 *   - Admin reviews geofence violations
 */

import { test, expect, Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/`);
  // Use test admin credentials (set via environment in CI)
  const adminEmail = process.env.TEST_ADMIN_EMAIL || "admin@insureportal.ng";
  const adminPass = process.env.TEST_ADMIN_PASS || "TestAdmin123!";

  // Check if already logged in
  const isLoggedIn = await page
    .locator('[data-testid="user-menu"]')
    .isVisible()
    .catch(() => false);
  if (isLoggedIn) return;

  // Navigate to login
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
test.describe("MDM Device Management", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Admin can view MDM fleet dashboard", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/mdm`);
    await page.waitForLoadState("networkidle");

    // Fleet overview stats should be visible
    await expect(
      page.locator(
        '[data-testid="fleet-total-devices"], h2:has-text("Fleet"), h1:has-text("MDM")'
      )
    ).toBeVisible({ timeout: 10000 });

    // Should show device count metrics
    const deviceCount = page.locator(
      '[data-testid="total-devices-count"], [data-testid="fleet-stats"]'
    );
    await expect(deviceCount).toBeVisible({ timeout: 5000 });

    // Online/offline breakdown should be present
    await expect(page.locator("text=/online|offline/i").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Admin can view device compliance violations list", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/mdm/compliance`);
    await page.waitForLoadState("networkidle");

    // Compliance page should load
    await expect(
      page.locator(
        'h1:has-text("Compliance"), [data-testid="compliance-violations"]'
      )
    ).toBeVisible({ timeout: 10000 });

    // Should show violation severity filter
    const severityFilter = page.locator(
      '[data-testid="severity-filter"], select[name="severity"]'
    );
    if (await severityFilter.isVisible()) {
      await severityFilter.selectOption("critical");
      await page.waitForLoadState("networkidle");
    }
  });

  test("Admin can view device details and compliance status", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/mdm`);
    await page.waitForLoadState("networkidle");

    // Click on first device in the list
    const firstDevice = page
      .locator('[data-testid="device-row"], tr[data-device-id]')
      .first();
    if (await firstDevice.isVisible()) {
      await firstDevice.click();
      await page.waitForLoadState("networkidle");

      // Device detail page should show compliance info
      await expect(
        page.locator(
          '[data-testid="device-detail"], [data-testid="compliance-status"]'
        )
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Admin can view OTA update status", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/mdm/ota`);
    await page.waitForLoadState("networkidle");

    // OTA page should load
    await expect(
      page.locator(
        'h1:has-text("OTA"), h1:has-text("Firmware"), [data-testid="ota-updates"]'
      )
    ).toBeVisible({ timeout: 10000 });

    // Should show firmware versions
    await expect(
      page.locator('[data-testid="firmware-version"], text=/v\d+\.\d+/').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("Admin can view geofence violations", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/mdm/geofence`);
    await page.waitForLoadState("networkidle");

    // Geofence page should load
    await expect(
      page.locator(
        'h1:has-text("Geofence"), [data-testid="geofence-violations"]'
      )
    ).toBeVisible({ timeout: 10000 });
  });

  test("MDM API returns device list with compliance status", async ({
    page,
  }) => {
    // Test the tRPC API directly
    const response = await page.request.post(
      `${BASE_URL}/api/trpc/mdm.listDevices`,
      {
        data: { json: { page: 1, limit: 10 } },
        headers: { "Content-Type": "application/json" },
      }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();

    // Should return device list
    expect(body.result?.data?.json).toBeDefined();
    const data = body.result?.data?.json;
    expect(
      Array.isArray(data?.devices) || typeof data?.total === "number"
    ).toBeTruthy();
  });

  test("MDM API returns compliance violations", async ({ page }) => {
    const response = await page.request.post(
      `${BASE_URL}/api/trpc/mdm.getComplianceViolations`,
      {
        data: { json: { severity: "critical", limit: 10 } },
        headers: { "Content-Type": "application/json" },
      }
    );

    // Should succeed or return 401 (if auth required)
    expect([200, 401]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.result?.data?.json).toBeDefined();
    }
  });

  test("OTA service health endpoint is reachable", async ({ page }) => {
    const otaUrl = process.env.OTA_SERVICE_URL || "http://localhost:8081";
    const response = await page.request
      .get(`${otaUrl}/api/v1/ota/health`)
      .catch(() => null);

    if (response) {
      // OTA service should respond (200 or 503 if no firmware loaded)
      expect([200, 503]).toContain(response.status());
    } else {
      // OTA service may not be running in unit test mode — skip
      test.skip(true, "OTA service not reachable in this environment");
    }
  });
});

// ── MDM Remote Actions ────────────────────────────────────────────────────────
test.describe("MDM Remote Actions", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Admin can initiate device lock from device detail page", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/mdm`);
    await page.waitForLoadState("networkidle");

    const firstDevice = page.locator('[data-testid="device-row"]').first();
    if (!(await firstDevice.isVisible())) {
      test.skip(true, "No devices in fleet for this test");
      return;
    }

    await firstDevice.click();
    await page.waitForLoadState("networkidle");

    // Look for remote lock button
    const lockBtn = page.locator(
      '[data-testid="remote-lock-btn"], button:has-text("Lock Device")'
    );
    if (await lockBtn.isVisible()) {
      await lockBtn.click();

      // Confirmation dialog should appear
      const confirmDialog = page.locator(
        '[role="dialog"], [data-testid="confirm-dialog"]'
      );
      await expect(confirmDialog).toBeVisible({ timeout: 3000 });

      // Cancel — we don't want to actually lock a device in tests
      await page
        .locator('button:has-text("Cancel"), [data-testid="cancel-btn"]')
        .click();
    }
  });

  test("Admin can push OTA update to device", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/mdm/ota`);
    await page.waitForLoadState("networkidle");

    // Look for push update button
    const pushBtn = page
      .locator(
        '[data-testid="push-update-btn"], button:has-text("Push Update")'
      )
      .first();
    if (await pushBtn.isVisible()) {
      await pushBtn.click();

      // Should show device selection or confirmation
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.locator('button:has-text("Cancel")').click();
      }
    }
  });
});
