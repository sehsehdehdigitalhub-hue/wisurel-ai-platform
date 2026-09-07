// Walks through every page of app.html the way a real user would — demo
// setup, then every item in the sidebar — and fails if anything throws a
// runtime error. Catches broken function references, missing DOM elements,
// and null-reference bugs that a syntax check alone can't see.
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app.html');
const DEMO_KEY = 'sk-ant-demo00000000000000000000000000000000000000';

async function completeDemoSetup(page) {
  await page.goto(APP_URL);
  // Demo mode now shows the real Sign in / Create account screen first
  // (matching production behavior) before the one-time API-key setup —
  // sign in with any credentials, since demo mode's auth is a local no-op.
  await page.fill('#in-email', 'demo@testfarm.com');
  await page.fill('#in-pass', 'anything-works-in-demo-mode');
  await page.click('#in-btn');
  await page.waitForTimeout(200);
  await page.fill('#setup-key', DEMO_KEY);
  await page.fill('#setup-biz', 'Test Farm');
  await page.click('text=Save & open workspace');
  await page.waitForTimeout(400);
}

test.describe('app.html smoke test', () => {
  test('a fresh visit shows the sign in / create account screen first', async ({ page }) => {
    // Regression test for a real bug: demo mode used to skip this screen
    // entirely and jump straight to API-key setup, so the signup form
    // (and its invite-code field) was unreachable without editing
    // localStorage by hand. Fixed in init() — this guards against it
    // coming back.
    await page.goto(APP_URL);
    await page.waitForTimeout(300);
    await expect(page.locator('#screen-auth')).toBeVisible();
    await expect(page.locator('#screen-setup')).toBeHidden();

    await page.click('#tab-up');
    await expect(page.locator('#up-invite')).toBeVisible();
  });

  test('a returning user with a saved API key skips straight into the app', async ({ page }) => {
    await page.goto(APP_URL);
    await page.evaluate((key) => {
      localStorage.setItem('fm_key', key);
      localStorage.setItem('fm_biz', 'Returning Test Farm');
    }, DEMO_KEY);
    await page.reload();
    await page.waitForTimeout(400);
    await expect(page.locator('#page-dashboard')).toBeVisible();
    await expect(page.locator('#screen-auth')).toBeHidden();
  });

  test('demo setup completes with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await completeDemoSetup(page);
    expect(errors).toEqual([]);
    await expect(page.locator('#page-dashboard')).toBeVisible();
  });

  test('every sidebar page navigates without error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await completeDemoSetup(page);

    const pages = [
      'Dashboard', 'Receipt Processor', 'Automations', 'Daily Reports',
      'Reconciliation', 'Weekly Digest', 'Files & Exports', 'Settings', 'AI Assistant',
    ];
    for (const label of pages) {
      await page.click(`text=${label}`);
      await page.waitForTimeout(150);
    }
    expect(errors).toEqual([]);
  });

  test('universal file upload accepts a non-image, non-pdf file', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await completeDemoSetup(page);
    await page.click('text=Receipt Processor');
    await page.waitForTimeout(200);

    const tmpCsv = path.resolve(__dirname, 'fixtures', 'sample-bank.csv');
    await page.setInputFiles('#rec-file-browse', [tmpCsv]);
    await page.waitForTimeout(300);
    await expect(page.locator('text=sample-bank.csv')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
