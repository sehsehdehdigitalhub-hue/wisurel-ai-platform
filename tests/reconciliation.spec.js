// Tests the bank-statement matching algorithm with a realistic 5-row
// scenario: 4 rows that should match the ledger exactly, 1 bank entry with
// no matching receipt, and 1 receipt with no matching bank entry. This is
// the same scenario verified by hand when reconciliation first shipped —
// now it re-checks itself on every run.
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app.html');

test('reconciliation matches, and correctly separates, mismatched entries', async ({ page }) => {
  await page.goto(APP_URL);

  const result = await page.evaluate(() => {
    transactions = [
      { id: '1', date: '12/08/2026', description: 'Broiler feed – 50 bags', amount: 185000, type: 'debit', category: 'Bird Feed & Nutrition' },
      { id: '2', date: '13/08/2026', description: 'Staff salaries – August', amount: 420000, type: 'debit', category: 'Salaries & Wages' },
      { id: '3', date: '14/08/2026', description: 'Egg sales – Ogbomosho market', amount: 610000, type: 'credit', category: 'Income' },
      { id: '4', date: '15/08/2026', description: 'Diesel – generator + van', amount: 76000, type: 'debit', category: 'Fuel & Vehicle' },
      { id: '5', date: '16/08/2026', description: 'Vet visit – Newcastle vaccine', amount: 54000, type: 'debit', category: 'Medical & Veterinary' },
    ];

    const bankRows = [
      { date: parseFlexDate('12/08/2026'), description: 'POS PURCHASE FEED SUPPLIES LTD', amount: 185000, type: 'debit' },
      { date: parseFlexDate('13/08/2026'), description: 'SALARY PAYMENT AUG', amount: 420000, type: 'debit' },
      { date: parseFlexDate('14/08/2026'), description: 'TRANSFER FROM MARKET BUYER', amount: 610000, type: 'credit' },
      { date: parseFlexDate('15/08/2026'), description: 'FUEL STATION PAYMENT', amount: 76000, type: 'debit' },
      { date: parseFlexDate('17/08/2026'), description: 'UNKNOWN VENDOR PAYMENT', amount: 32000, type: 'debit' },
    ];

    const r = matchBankRows(bankRows);
    return { matched: r.matched.length, missing: r.missing.length, orphans: r.orphans.length };
  });

  expect(result.matched).toBe(4);
  expect(result.missing).toBe(1);
  expect(result.orphans).toBe(1);
});
