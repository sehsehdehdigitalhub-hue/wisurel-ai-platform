// Confirms the public landing page loads and its key CTAs are present.
const { test, expect } = require('@playwright/test');
const path = require('path');

const LANDING_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

test('landing page loads without error and links to the app', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(LANDING_URL);
  await page.waitForTimeout(300);
  await expect(page.locator('h1')).toContainText('paperwork');
  await expect(page.locator('a[href="app.html"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});
