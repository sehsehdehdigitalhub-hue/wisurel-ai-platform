// Confirms the admin portal's demo passcode gate works and every section
// (Global Dashboard, User Management, AI Analytics) navigates cleanly.
const { test, expect } = require('@playwright/test');
const path = require('path');

const ADMIN_URL = 'file://' + path.resolve(__dirname, '..', 'admin.html');

test('admin portal demo gate and navigation work with no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(ADMIN_URL);
  await page.fill('#gate-pass', 'wisurel2026');
  await page.click('text=Enter admin portal');
  await page.waitForTimeout(300);
  await expect(page.locator('#shell')).toBeVisible();

  for (const label of ['User Management', 'AI Analytics', 'Global Dashboard']) {
    await page.click(`text=${label}`);
    await page.waitForTimeout(150);
  }
  expect(errors).toEqual([]);
});

test('wrong passcode is rejected', async ({ page }) => {
  await page.goto(ADMIN_URL);
  await page.fill('#gate-pass', 'wrong-password');
  await page.click('text=Enter admin portal');
  await page.waitForTimeout(200);
  await expect(page.locator('#shell')).toBeHidden();
  await expect(page.locator('#gate-err')).toHaveText(/incorrect/i);
});
