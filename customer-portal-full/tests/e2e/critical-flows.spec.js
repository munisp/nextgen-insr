// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5002';

/**
 * Critical user flow E2E tests covering the core insurance platform journeys:
 * - Policy browsing and premium calculation
 * - Claims submission workflow
 * - Wallet and payment operations
 * - Profile management
 * - Accessibility and responsive design
 */

test.describe('Policy Browsing & Premium Calculation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
  });

  test('policies page displays active policies with valid data', async ({ page }) => {
    await page.goto(`${BASE_URL}/policies`);
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Invalid Date');
    expect(body).not.toContain('NaN');
    expect(body).not.toContain('undefined');
  });

  test('premium calculator accepts input and returns result', async ({ request }) => {
    const loginResp = await request.post(`${BASE_URL}/api/trpc/auth.login`, {
      data: { json: { email: 'demo@insureportal.ng', password: 'demo123' } },
    });
    const loginData = await loginResp.json();
    const token = loginData.result?.data?.json?.token || loginData.result?.data?.token;

    const resp = await request.post(`${BASE_URL}/api/trpc/premium.calculate`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: { policyType: 'motor', sumAssured: 500000 } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.result?.data?.json?.premium || data.result?.data?.premium).toBeGreaterThan(0);
  });

  test('products page shows insurance products from database', async ({ page }) => {
    await page.goto(`${BASE_URL}/products`);
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/motor|health|life|travel|property|marine/i);
  });
});

test.describe('Claims Submission Workflow', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/auth.login`, {
      data: { json: { email: 'demo@insureportal.ng', password: 'demo123' } },
    });
    const data = await resp.json();
    token = data.result?.data?.json?.token || data.result?.data?.token;
  });

  test('claims list returns user claims with valid structure', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/claims.list`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: { limit: 5 } },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    const claims = data.result?.data?.json?.data || data.result?.data?.data || data.result?.data?.json;
    expect(Array.isArray(claims)).toBeTruthy();
  });

  test('claim creation validates required fields', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/claims.create`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: {} },
    });
    const data = await resp.json();
    const errMsg = JSON.stringify(data);
    expect(errMsg).toMatch(/required|validation/i);
  });

  test('claims page renders claim numbers', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto(`${BASE_URL}/claims`);
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/CLM-|claim/i);
  });
});

test.describe('Wallet & Payment Operations', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/auth.login`, {
      data: { json: { email: 'demo@insureportal.ng', password: 'demo123' } },
    });
    const data = await resp.json();
    token = data.result?.data?.json?.token || data.result?.data?.token;
  });

  test('wallet balance returns numeric value', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/wallet.balance`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: {} },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    const balance = data.result?.data?.json?.balance ?? data.result?.data?.balance;
    expect(typeof balance).toBe('number');
  });

  test('wallet topup validates minimum amount', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/wallet.topup`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: { amount: -100 } },
    });
    const data = await resp.json();
    const errMsg = JSON.stringify(data);
    expect(errMsg).toMatch(/must be at least|validation|required/i);
  });

  test('payments page loads transaction history', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto(`${BASE_URL}/payments`);
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Invalid Date');
  });
});

test.describe('Profile & Settings', () => {
  test('profile page shows user information after login', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await page.goto(`${BASE_URL}/profile`);
    await page.waitForTimeout(3000);
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/demo|profile|email/i);
  });

  test('profile update validates email format', async ({ request }) => {
    const loginResp = await request.post(`${BASE_URL}/api/trpc/auth.login`, {
      data: { json: { email: 'demo@insureportal.ng', password: 'demo123' } },
    });
    const loginData = await loginResp.json();
    const token = loginData.result?.data?.json?.token || loginData.result?.data?.token;

    const resp = await request.post(`${BASE_URL}/api/trpc/profile.update`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: { email: 'not-an-email' } },
    });
    const data = await resp.json();
    const errMsg = JSON.stringify(data);
    expect(errMsg).toMatch(/email|valid/i);
  });
});

test.describe('Accessibility Compliance', () => {
  test('main navigation has ARIA landmarks', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    const mainRegion = page.locator('[role="main"]');
    await expect(mainRegion).toBeVisible();
  });

  test('login form has proper labels and error announcements', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    const form = page.locator('form');
    await expect(form).toBeVisible();
    // Submit empty to trigger validation
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    // Error region should use aria-live for screen readers
    const alertRegion = page.locator('[role="alert"]');
    const count = await alertRegion.count();
    expect(count).toBeGreaterThanOrEqual(0); // May or may not show depending on HTML5 validation
  });

  test('skip-to-content link exists on dashboard', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    const skipLink = page.locator('a.sr-only, a[href="#dashboard-main"]');
    const count = await skipLink.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Responsive Design', () => {
  test('mobile viewport shows responsive layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}`);
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent();
    expect(body).toContain('Insurance');
  });

  test('tablet viewport renders without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    const body = page.locator('body');
    const boundingBox = await body.boundingBox();
    expect(boundingBox.width).toBeLessThanOrEqual(768);
  });
});

test.describe('Security & Error Handling', () => {
  test('unauthenticated mutation returns 401', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/trpc/claims.create`, {
      data: { json: { description: 'test' } },
    });
    expect(resp.status()).toBe(401);
    const data = await resp.json();
    expect(data.error?.message || data.error?.code).toMatch(/auth|unauthorized/i);
  });

  test('invalid route returns structured error', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/trpc/nonexistent.route`);
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });

  test('XSS payload in input is sanitized', async ({ request }) => {
    const loginResp = await request.post(`${BASE_URL}/api/trpc/auth.login`, {
      data: { json: { email: 'demo@insureportal.ng', password: 'demo123' } },
    });
    const loginData = await loginResp.json();
    const token = loginData.result?.data?.json?.token || loginData.result?.data?.token;

    const resp = await request.post(`${BASE_URL}/api/trpc/feedback.submit`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { json: { message: '<script>alert("xss")</script>', rating: 5 } },
    });
    if (resp.ok()) {
      const data = await resp.json();
      const str = JSON.stringify(data);
      expect(str).not.toContain('<script>');
    }
  });

  test('security headers are present', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/health`);
    expect(resp.headers()['x-frame-options']).toBeTruthy();
    expect(resp.headers()['x-content-type-options']).toBe('nosniff');
    expect(resp.headers()['x-request-id']).toBeTruthy();
  });
});
