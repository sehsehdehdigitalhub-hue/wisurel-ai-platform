// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 1000 },
  },
});
