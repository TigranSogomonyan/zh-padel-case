import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(rootDir, 'artifacts');
const html = await readFile(join(rootDir, 'index.html'));

await mkdir(outputDir, { recursive: true });

// Serve the exact deployed HTML without rebuilding or modifying it.
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname !== '/' && pathname !== '/index.html') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const origin = 'http://127.0.0.1:' + server.address().port;
const configurations = [
  {
    name: 'desktop',
    options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  },
  {
    name: 'mobile',
    options: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  },
];

let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });

  for (const { name, options } of configurations) {
    const context = await browser.newContext({
      ...options,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const response = await page.goto(origin + '/', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      assert.equal(response?.status(), 200, name + ': page did not load');

      // Allow the software-rendered scene to initialize.
      await page.waitForTimeout(3000);

      const state = await page.evaluate(() => {
        const visibleText = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const accessibleName = (el) => {
          const labelledBy = (el.getAttribute('aria-labelledby') || '')
            .split(/\s+/).filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ').trim();
          const explicitLabel = el.labels && Array.from(el.labels).map(visibleText).join(' ').trim();
          return el.getAttribute('aria-label') || labelledBy || explicitLabel ||
            (el.tagName === 'INPUT' && el.type === 'submit' ? el.value : '') ||
            visibleText(el) || el.getAttribute('title') || '';
        };
        const inputs = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')];
        const buttons = [...document.querySelectorAll('button, [role="button"]')];
        const images = [...document.querySelectorAll('img')];
        return {
          title: document.title,
          language: document.documentElement.lang,
          viewportMeta: document.querySelector('meta[name="viewport"]')?.content || null,
          bodyTextLength: document.body?.innerText?.trim().length || 0,
          canvasCount: document.querySelectorAll('canvas').length,
          horizontalOverflowPx: Math.max(
            0,
            document.documentElement.scrollWidth - document.documentElement.clientWidth
          ),
          headings: [...document.querySelectorAll('h1,h2,h3')].map((el) => ({
            level: el.tagName.toLowerCase(), text: visibleText(el)
          })).slice(0, 30),
          controls: {
            buttons: buttons.map((el) => ({ text: visibleText(el), name: accessibleName(el) })).slice(0, 50),
            fields: inputs.map((el) => ({
              tag: el.tagName.toLowerCase(), type: el.type || null,
              name: accessibleName(el), placeholder: el.getAttribute('placeholder')
            })).slice(0, 40)
          },
          accessibilityAudit: {
            missingLanguage: !document.documentElement.lang,
            missingViewportMeta: !document.querySelector('meta[name="viewport"]'),
            unlabeledButtons: buttons.filter((el) => !accessibleName(el)).length,
            unlabeledFields: inputs.filter((el) => !accessibleName(el)).length,
            imagesWithoutAlt: images.filter((el) => !el.hasAttribute('alt')).length
          }
        };
      });

      // Keep the checks independent of styling and unstable CSS selectors.
      assert.ok(state.title.trim(), name + ': empty document title');
      assert.ok(state.bodyTextLength > 40, name + ': page content is missing');
      assert.ok(state.canvasCount > 0, name + ': 3D canvas is missing');
      assert.ok(state.horizontalOverflowPx <= 1, name + ': horizontal overflow of '
        + state.horizontalOverflowPx + 'px');

      const screenshot = join(outputDir, 'zh-' + name + '.png');
      await page.screenshot({ path: screenshot, fullPage: true, timeout: 60_000 });

      // Verify that choosing a different leather colour changes the actual
      // rendered canvas, not just the selected swatch. The configured HTML
      // must provide a button accessible by its leather colour name.
      const canvas = page.locator('canvas').first();
      const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');
      const beforeColour = checksum(await canvas.screenshot());
      await page.getByRole('button', { name: 'Burgundy', exact: true }).click();
      await page.waitForTimeout(1500);
      const afterColour = checksum(await canvas.screenshot());
      assert.notEqual(beforeColour, afterColour,
        name + ': selecting Burgundy did not change the 3D canvas');
      await page.screenshot({
        path: join(outputDir, 'zh-' + name + '-burgundy.png'),
        fullPage: true,
        timeout: 60_000
      });
      console.log(name + ': leather colour change updated the 3D canvas');

      assert.deepEqual(pageErrors, [], name + ': uncaught JavaScript errors');
      results.push({ viewport: name, ...state, screenshot });
      console.log(name + ': OK; canvas=' + state.canvasCount
        + ', horizontal overflow=' + state.horizontalOverflowPx + 'px');
      console.log(name + ' UI: ' + JSON.stringify({
        headings: state.headings,
        controls: state.controls,
        accessibilityAudit: state.accessibilityAudit
      }));
    } finally {
      await context.close();
    }
  }

  await writeFile(
    join(outputDir, 'report.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n'
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
