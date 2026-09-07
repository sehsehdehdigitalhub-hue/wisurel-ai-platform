// Tests the full "Update vs Branch" lifecycle for the Receipt Processor:
// starting a new batch isolates it from existing data, switching back
// restores the original ledger, and both survive a page reload.
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app.html');
const DEMO_KEY = 'sk-ant-demo00000000000000000000000000000000000000';

async function completeDemoSetup(page) {
  await page.goto(APP_URL);
  await page.fill('#in-email', 'demo@testfarm.com');
  await page.fill('#in-pass', 'anything-works-in-demo-mode');
  await page.click('#in-btn');
  await page.waitForTimeout(200);
  await page.fill('#setup-key', DEMO_KEY);
  await page.fill('#setup-biz', 'Test Farm');
  await page.click('text=Save & open workspace');
  await page.waitForTimeout(400);
  await page.click('text=Receipt Processor');
  await page.waitForTimeout(200);
}

test('a new batch starts empty and does not touch existing data', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Test Batch'));
  await completeDemoSetup(page);

  await page.evaluate(() => {
    transactions = [{ id: '1', date: '12/08/2026', description: 'Seed row', amount: 1000, type: 'debit', category: 'Other' }];
    saveLocalState();
    renderLedger();
  });

  await page.click('text=+ Start new batch');
  await page.waitForTimeout(200);

  const newBranchCount = await page.evaluate(() => transactions.length);
  expect(newBranchCount).toBe(0);
});

test('switching back to the main branch restores its data', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Test Batch'));
  await completeDemoSetup(page);

  await page.evaluate(() => {
    transactions = [{ id: '1', date: '12/08/2026', description: 'Seed row', amount: 1000, type: 'debit', category: 'Other' }];
    saveLocalState();
    renderLedger();
  });
  await page.click('text=+ Start new batch');
  await page.waitForTimeout(200);
  await page.selectOption('#branch-picker', 'main');
  await page.waitForTimeout(200);

  const mainCount = await page.evaluate(() => transactions.length);
  expect(mainCount).toBe(1);
});

test('branches persist across a page reload', async ({ page }) => {
  page.on('dialog', (d) => d.accept('Test Batch'));
  await completeDemoSetup(page);
  await page.click('text=+ Start new batch');
  await page.waitForTimeout(200);

  await page.reload();
  await page.waitForTimeout(400);
  await page.click('text=Receipt Processor');
  await page.waitForTimeout(200);

  const branchCount = await page.evaluate(() => receiptBranches.length);
  expect(branchCount).toBe(2);
});
