// Tests the invite-redemption gate that Google/magic-link sign-ins need
// (they never pass through the signup form's invite-code field, so
// handle_new_user() in schema.sql creates them as "pending" — org_id null
// — and the app has to prompt for a code before letting them any further
// in). Stubs SB.from/SB.rpc directly since a real Supabase round-trip
// isn't reachable in this environment; see README for why.
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app.html');

test('a pending profile (no org_id) is routed to the redeem screen', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    currentUser = { id: 'user1', email: 'newuser@example.com' };
    SB = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: null } }) }) }) }) };
    await routeAfterAuth();
  });
  await expect(page.locator('#screen-redeem')).toBeVisible();
  await expect(page.locator('#redeem-email')).toContainText('newuser@example.com');
});

test('an already-provisioned profile skips straight to setup', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    currentUser = { id: 'user1', email: 'existing@example.com' };
    SB = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: 'org-123' } }) }) }) }) };
    await routeAfterAuth();
  });
  await expect(page.locator('#screen-setup')).toBeVisible();
  await expect(page.locator('#screen-redeem')).toBeHidden();
});

test('an invalid invite code shows the error from the RPC', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    currentUser = { id: 'user1', email: 'newuser@example.com' };
    SB = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: null } }) }) }) }),
      rpc: async () => ({ error: { message: 'That invite code is invalid, expired, or has already been used.' } }),
    };
    await routeAfterAuth();
  });
  await page.fill('#redeem-code', 'BADCODE');
  await page.click('#redeem-btn');
  await page.waitForTimeout(200);
  await expect(page.locator('#redeem-err')).toContainText('invalid');
  await expect(page.locator('#screen-redeem')).toBeVisible();
});

test('a valid invite code proceeds into setup', async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    currentUser = { id: 'user1', email: 'newuser@example.com' };
    SB = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: null } }) }) }) }),
      rpc: async () => ({ error: null }),
    };
    await routeAfterAuth();
  });
  await page.fill('#redeem-code', 'GOODCODE');
  await page.click('#redeem-btn');
  await page.waitForTimeout(200);
  await expect(page.locator('#screen-setup')).toBeVisible();
});
