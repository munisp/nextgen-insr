// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5002';

test.describe('Authentication Flow', () => {
  test('landing page renders with login button', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('body')).toContainText('Insurance');
    const loginBtn = page.getByRole('link', { name: /login|sign/i }).first();
    await expect(loginBtn).toBeVisible();
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await expect(page.url()).toContain('/dashboard');
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'bad@email.com');
    await page.fill('input[type="password"], input[name="password"]', 'wrong');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toContainText(/invalid|error|incorrect/i);
  });

  test('dashboard shows real data after login', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('Invalid Date');
    await expect(page.locator('body')).not.toContainText('NaN');
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`);
    await page.fill('input[type="email"], input[name="email"]', 'demo@insureportal.ng');
    await page.fill('input[type="password"], input[name="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
  });

  test('claims page loads without errors', async ({ page }) => {
    await page.goto(`${BASE_URL}/claims`);
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Invalid Date');
  });

  test('policies page loads without errors', async ({ page }) => {
    await page.goto(`${BASE_URL}/policies`);
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Invalid Date');
  });
});

test.describe('API Health', () => {
  test('health endpoint returns healthy', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe('healthy');
  });

  test('readiness endpoint returns ready', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/health/ready`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe('ready');
    expect(body.database).toBe('connected');
  });

  test('metrics endpoint returns data', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/metrics`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.requests).toBeGreaterThan(0);
  });

  test('circuit breaker status endpoint works', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/health/circuits`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.circuits).toBeInstanceOf(Array);
    expect(body.circuits.length).toBeGreaterThan(0);
  });
});
