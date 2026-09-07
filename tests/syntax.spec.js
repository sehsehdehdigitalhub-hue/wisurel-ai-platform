// Confirms every inline <script> block in app.html, admin.html, and
// index.html parses cleanly — catches typos, mismatched brackets, and
// escaping mistakes before they ever reach a browser. This is the same
// check that's been run by hand before every release; here it runs itself.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractInlineScripts(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s) => s.trim().length > 0);
  return scripts.join('\n');
}

test.describe('inline script syntax', () => {
  for (const file of ['app.html', 'admin.html', 'index.html']) {
    test(`${file} inline scripts parse without syntax errors`, () => {
      const filePath = path.resolve(__dirname, '..', file);
      expect(fs.existsSync(filePath), `${file} should exist at repo root`).toBe(true);
      const code = extractInlineScripts(filePath);
      // index.html is a static landing page with no inline JS by design —
      // only app.html and admin.html are expected to contain script logic.
      if (file !== 'index.html') {
        expect(code.length, `${file} should have non-empty inline script content`).toBeGreaterThan(0);
      }
      // A syntax error throws here; a clean parse (or empty input) does nothing.
      expect(() => new vm.Script(code, { filename: file })).not.toThrow();
    });
  }
});
