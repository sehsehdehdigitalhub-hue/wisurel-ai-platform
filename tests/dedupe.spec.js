// Tests the actual matching functions used to detect "this automation
// already exists" and "this receipt was already processed" — the feature
// that stops the app from silently creating duplicates. Runs the real
// functions from app.html (not a reimplementation), so a regression here
// means the shipped app actually broke, not just the test's copy of it.
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app.html');

test.describe('transaction duplicate detection', () => {
  test('flags a fuzzy-matching transaction (different wording, same date/amount)', async ({ page }) => {
    await page.goto(APP_URL);
    const found = await page.evaluate(() => {
      const existing = [{ date: '12/08/2026', amount: 185000, description: 'Broiler feed - 50 bags' }];
      const dupe = findDuplicateTransaction(
        { date: '12/08/2026', amount: 185000, description: 'Feed purchase 50 bags broiler' },
        existing
      );
      return !!dupe;
    });
    expect(found).toBe(true);
  });

  test('does not flag a genuinely different transaction', async ({ page }) => {
    await page.goto(APP_URL);
    const found = await page.evaluate(() => {
      const existing = [{ date: '12/08/2026', amount: 185000, description: 'Broiler feed - 50 bags' }];
      const dupe = findDuplicateTransaction(
        { date: '19/08/2026', amount: 76000, description: 'Fuel purchase for generator' },
        existing
      );
      return !!dupe;
    });
    expect(found).toBe(false);
  });

  test('does not flag two different transactions that merely share a date', async ({ page }) => {
    await page.goto(APP_URL);
    const found = await page.evaluate(() => {
      const existing = [{ date: '12/08/2026', amount: 185000, description: 'Broiler feed - 50 bags' }];
      const dupe = findDuplicateTransaction(
        { date: '12/08/2026', amount: 54000, description: 'Vet visit for Newcastle vaccine' },
        existing
      );
      return !!dupe;
    });
    expect(found).toBe(false);
  });
});

test.describe('automation similarity detection', () => {
  test('flags a near-duplicate automation description', async ({ page }) => {
    await page.goto(APP_URL);
    const score = await page.evaluate(() => {
      return wordOverlap(
        'feed delivery tracking by supplier and weight',
        'Track feed deliveries by supplier, weight, and cost Feed Delivery Tracker'
      );
    });
    expect(score).toBeGreaterThan(0.5);
  });

  test('does not flag an unrelated automation description', async ({ page }) => {
    await page.goto(APP_URL);
    const score = await page.evaluate(() => {
      return wordOverlap(
        'track employee vacation days and sick leave requests',
        'Track feed deliveries by supplier, weight, and cost Feed Delivery Tracker'
      );
    });
    expect(score).toBeLessThan(0.5);
  });
});
